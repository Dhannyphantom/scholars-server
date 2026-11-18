// ==========================================
// PAYOUT SERVICE (controllers/payoutService.js)
// ==========================================
// Cash withdrawals, airtime and data, as a retry-safe state machine:
//
//   1. save PayoutRequest (idempotencyKey => same key never creates a 2nd one)
//   2. reserve points ATOMICALLY (conditional $inc => no double-spend)
//   3. if the provider MAY already have the request, ASK it (by our reference)
//      before ever sending again; otherwise send it
//   4. provider says success -> completed (+ company wallet debit)
//      provider says failed / definitely rejected -> failed + points refunded
//      anything unclear (timeout, 5xx) -> stays "processing"; the reconciler,
//      the webhook or the user's "Check status" button settles it later.
//
// Points are only ever refunded on a DEFINITE failure, never on a timeout, and
// the provider reference is reused on every retry, so no one is paid twice.
const PayoutRequest = require("../models/PayoutRequest");
const { User } = require("../models/User");
const walletService = require("./walletService");
const flw = require("./flutterwaveService");
const PhoneValidator = require("./phoneValidation");

const POINTS_PER_NAIRA = 10; // 10 points = ₦1
const MIN_NAIRA = { withdrawal: 500, airtime: 100, data: 100 };
const PREFIX = { withdrawal: "WD", airtime: "AIR", data: "DATA" };
const LOCK_MS = 45 * 1000;
const REDISPATCH_AFTER_MS = 30 * 1000;
const MAX_DISPATCHES = 5;
const ACTIVE = ["pending", "processing"];
const BUNDLE_TTL_MS = 5 * 60 * 1000;

class PayoutError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const pointsToAmount = (points) => points / POINTS_PER_NAIRA;
const isLegacy = (p) => !(p.flowVersion >= 2);
const naira = (n) => `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

// ───────────────────────── validation ─────────────────────────

const bundleCache = new Map();
async function lookupBundle(network, itemCode) {
  const key = String(network).toUpperCase();
  let entry = bundleCache.get(key);
  if (!entry || Date.now() - entry.at > BUNDLE_TTL_MS) {
    const r = await flw.getDataBundles(key);
    if (!r.success) return { error: r.error };
    entry = { at: Date.now(), bundles: r.bundles };
    bundleCache.set(key, entry);
  }
  return { bundle: entry.bundles.find((b) => b.itemCode === itemCode) };
}

async function buildSpec(userId, type, body) {
  const pts = Number(body.pointsToConvert);
  if (!Number.isInteger(pts) || pts <= 0) {
    throw new PayoutError(400, "Invalid amount");
  }
  const amount = pointsToAmount(pts);
  if (amount < MIN_NAIRA[type]) {
    throw new PayoutError(400, `Minimum is ${naira(MIN_NAIRA[type])}`);
  }
  const spec = { userId, payoutType: type, pointsConverted: pts, amount };

  if (type === "withdrawal") {
    const { accountNumber, accountBank } = body;
    if (!accountNumber || !accountBank) {
      throw new PayoutError(400, "Missing required fields");
    }
    const ver = await flw.verifyAccount(accountNumber, accountBank);
    if (!ver.success) {
      throw new PayoutError(400, ver.error || "Invalid account details");
    }
    return { ...spec, accountNumber, accountBank, accountName: ver.accountName };
  }

  const { phoneNumber, network } = body;
  if (!phoneNumber || !network) {
    throw new PayoutError(400, "Missing required fields");
  }
  const validation = PhoneValidator.validatePhoneNetwork(phoneNumber, network);
  if (!validation.valid) {
    throw new PayoutError(400, validation.error, {
      detectedNetwork: validation.detectedNetwork,
      suggestion: validation.detectedNetwork
        ? `Did you mean to select ${validation.detectedNetwork}?`
        : null,
    });
  }
  spec.phoneNumber = validation.normalizedPhone;
  spec.network = String(network).toUpperCase();

  if (type === "data") {
    const { billerCode, itemCode } = body;
    if (!billerCode || !itemCode) {
      throw new PayoutError(400, "Missing required fields");
    }
    // Never trust the client's price: it must match the live bundle list.
    const found = await lookupBundle(network, itemCode);
    if (found.error) {
      throw new PayoutError(503, "We couldn't validate this data plan right now. Please try again.");
    }
    if (!found.bundle) {
      throw new PayoutError(400, "This data plan is no longer available");
    }
    if (Math.abs(found.bundle.amount - amount) > 0.01) {
      throw new PayoutError(400, "Data plan price changed. Please refresh and try again.");
    }
    spec.billerCode = found.bundle.billerCode || billerCode;
    spec.bundleCode = itemCode;
    spec.bundleName = found.bundle.name || body.bundleName;
    spec.bundleAmount = found.bundle.amount;
  }
  return spec;
}

async function reservedAmount() {
  const rows = await PayoutRequest.aggregate([
    { $match: { status: { $in: ACTIVE }, flowVersion: { $gte: 2 } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return rows[0]?.total || 0;
}

// ───────────────────────── provider helpers ─────────────────────────

function callProvider(p) {
  switch (p.payoutType) {
    case "withdrawal":
      return flw.initiateTransfer({
        accountBank: p.accountBank,
        accountNumber: p.accountNumber,
        amount: p.amount,
        reference: p.reference,
        narration: `Guru EduTech Withdrawal - ${p.userId}`,
        callbackUrl: `${process.env.BASE_URL}/payouts/webhooks/flutterwave`,
      });
    case "airtime":
      return flw.sendAirtime({
        phoneNumber: p.phoneNumber,
        network: p.network,
        amount: p.amount,
        reference: p.reference,
      });
    default:
      return flw.sendDataBundle({
        phoneNumber: p.phoneNumber,
        network: p.network,
        amount: p.bundleAmount ?? p.amount,
        billerCode: p.billerCode,
        itemCode: p.bundleCode,
        reference: p.reference,
      });
  }
}

const queryProvider = (p) =>
  p.payoutType === "withdrawal"
    ? flw.getTransferStatus(p.reference)
    : flw.getBillStatus(p.reference);

// ───────────────────────── side effects (each idempotent) ─────────────────────────

async function debitWallet(p) {
  if (isLegacy(p) || p.walletDebited) return;
  try {
    await walletService.debit("student", p.amount, "payout", p.reference, {
      userId: p.userId,
      flutterwaveReference: p.flutterwaveId,
      description:
        p.payoutType === "withdrawal"
          ? `Withdrawal to ${p.accountName}`
          : p.payoutType === "airtime"
            ? `Airtime ${p.network} - ${p.phoneNumber}`
            : `Data ${p.network} ${p.bundleName} - ${p.phoneNumber}`,
      payoutType: p.payoutType,
      pointsConverted: p.pointsConverted,
      network: p.network,
      phoneNumber: p.phoneNumber,
      bundleName: p.bundleName,
    });
    await PayoutRequest.updateOne({ _id: p._id }, { $set: { walletDebited: true } });
  } catch (e) {
    console.error(`[payout] wallet debit failed ${p.reference}:`, e.message);
    await PayoutRequest.updateOne(
      { _id: p._id },
      { $set: { needsReview: true, reviewNote: `Wallet debit failed: ${e.message}` } },
    );
  }
}

async function refundPayout(p) {
  // Points
  const pointsHeld = isLegacy(p) ? true : p.pointsDeducted;
  if (pointsHeld) {
    const claim = await PayoutRequest.findOneAndUpdate(
      { _id: p._id, pointsRefunded: { $ne: true } },
      { $set: { pointsRefunded: true } },
    );
    if (claim) {
      try {
        await User.updateOne({ _id: p.userId }, { $inc: { points: p.pointsConverted } });
      } catch (e) {
        await PayoutRequest.updateOne({ _id: p._id }, { $set: { pointsRefunded: false } });
        throw e;
      }
    }
  }
  // Company wallet (only if we had already debited it)
  const walletHeld = isLegacy(p) ? true : p.walletDebited;
  if (walletHeld) {
    const claim = await PayoutRequest.findOneAndUpdate(
      { _id: p._id, walletRefunded: { $ne: true } },
      { $set: { walletRefunded: true } },
    );
    if (claim) {
      try {
        await walletService.credit("student", p.amount, "refund", `REFUND_${p.reference}`, {
          userId: p.userId,
          description: `Refund for failed ${p.payoutType}: ${p.errorMessage || ""}`,
          originalReference: p.reference,
        });
      } catch (e) {
        await PayoutRequest.updateOne({ _id: p._id }, { $set: { walletRefunded: false } });
        throw e;
      }
    }
  }
}

async function completePayout(p, data = {}) {
  const flutterwaveId =
    data.id != null
      ? String(data.id)
      : data.flutterwaveId || data.transaction_reference || data.flw_ref;

  const claimed = await PayoutRequest.findOneAndUpdate(
    { _id: p._id, status: { $in: ACTIVE } },
    {
      $set: {
        status: "completed",
        completedAt: new Date(),
        providerState: "sent",
        errorMessage: null,
        ...(flutterwaveId ? { flutterwaveId } : {}),
      },
    },
    { new: true },
  );
  if (!claimed) {
    const cur = await PayoutRequest.findById(p._id);
    if (cur?.status === "failed") {
      await PayoutRequest.updateOne(
        { _id: p._id },
        {
          $set: {
            needsReview: true,
            reviewNote: "Provider reports SUCCESS after this payout was marked failed/refunded",
          },
        },
      );
    }
    return cur;
  }
  await debitWallet(claimed);
  return claimed;
}

async function failPayout(p, message, { allowFromCompleted = false } = {}) {
  const from = allowFromCompleted ? [...ACTIVE, "completed"] : ACTIVE;
  const claimed = await PayoutRequest.findOneAndUpdate(
    { _id: p._id, status: { $in: from } },
    { $set: { status: "failed", errorMessage: message || "Transaction failed" } },
    { new: true },
  );
  if (!claimed) return null;
  await refundPayout(claimed);
  return claimed;
}

// ───────────────────────── the state machine ─────────────────────────

const needsWork = (p) =>
  ACTIVE.includes(p.status) ||
  (p.flowVersion >= 2 &&
    !p.needsReview &&
    ((p.status === "completed" && !p.walletDebited) ||
      (p.status === "failed" &&
        ((p.pointsDeducted && !p.pointsRefunded) ||
          (p.walletDebited && !p.walletRefunded)))));

async function dispatch(p) {
  await PayoutRequest.updateOne(
    { _id: p._id },
    {
      // Mark "unknown" BEFORE calling: if we crash mid-call, the next run
      // knows it must ask the provider first.
      $set: { providerState: "unknown", lastDispatchAt: new Date() },
      $inc: { dispatchCount: 1 },
    },
  );

  const r = await callProvider(p);

  if (r.outcome === "accepted") {
    if (r.providerStatus === "successful") return completePayout(p, r);
    if (r.providerStatus === "failed") {
      return failPayout(p, r.error || "Provider reported failure");
    }
    await PayoutRequest.updateOne(
      { _id: p._id, status: "processing" },
      {
        $set: {
          providerState: "sent",
          ...(r.flutterwaveId ? { flutterwaveId: r.flutterwaveId } : {}),
        },
      },
    );
    return null;
  }

  if (r.outcome === "rejected") return failPayout(p, r.error || "Transaction failed");

  // unknown
  await PayoutRequest.updateOne(
    { _id: p._id },
    { $set: { providerState: r.duplicate ? "sent" : "unknown", reviewNote: r.error } },
  );
  return null;
}

async function step(p) {
  if (p.status === "completed") return debitWallet(p);
  if (p.status === "failed") return refundPayout(p);

  // A. reserve points (atomic; fails cleanly when balance is insufficient)
  if (p.flowVersion >= 2 && !p.pointsDeducted) {
    const u = await User.findOneAndUpdate(
      { _id: p.userId, points: { $gte: p.pointsConverted } },
      { $inc: { points: -p.pointsConverted } },
      { new: true, projection: { points: 1 } },
    );
    if (!u) return failPayout(p, "Insufficient points balance");
    await PayoutRequest.updateOne(
      { _id: p._id },
      { $set: { pointsDeducted: true, status: "processing" } },
    );
    p.pointsDeducted = true;
    p.status = "processing";
  }

  // B. might the provider already have it? Ask before sending again.
  if (p.providerState !== "not_sent") {
    const q = await queryProvider(p);
    switch (q.state) {
      case "successful":
        return completePayout(p, q.data);
      case "failed":
        return failPayout(p, q.message || "The provider reported this transaction failed");
      case "pending":
        return PayoutRequest.updateOne({ _id: p._id }, { $set: { providerState: "sent" } });
      case "unknown":
        return null; // can't tell right now; try again later
      case "not_found":
        if (
          p.lastDispatchAt &&
          Date.now() - new Date(p.lastDispatchAt).getTime() < REDISPATCH_AFTER_MS
        ) {
          return null; // request may still be in flight
        }
        if (p.dispatchCount >= MAX_DISPATCHES) {
          return PayoutRequest.updateOne(
            { _id: p._id },
            { $set: { needsReview: true, reviewNote: "Provider never acknowledged this payout" } },
          );
        }
        break; // safe to send again: SAME reference, provider dedupes
    }
  }

  // C. send
  return dispatch(p);
}

/** Drive one payout forward. Never throws. Returns the fresh document. */
async function advancePayout(payoutOrId) {
  const id = payoutOrId?._id || payoutOrId;
  const now = new Date();

  const locked = await PayoutRequest.findOneAndUpdate(
    { _id: id, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS), lastCheckedAt: now } },
    { new: true },
  );
  if (!locked) return PayoutRequest.findById(id); // someone else is on it

  try {
    if (needsWork(locked)) await step(locked);
  } catch (err) {
    console.error(`[payout] advance error ${locked.reference}:`, err);
    await PayoutRequest.updateOne(
      { _id: id },
      { $set: { reviewNote: `Last error: ${err.message}` } },
    ).catch(() => {});
  } finally {
    await PayoutRequest.updateOne({ _id: id }, { $set: { lockedUntil: null } }).catch(() => {});
  }
  return PayoutRequest.findById(id);
}

// ───────────────────────── responses ─────────────────────────

function messageFor(p, done) {
  const amt = naira(p.amount);
  if (p.payoutType === "withdrawal") {
    return done
      ? `${amt} has been sent to ${p.accountName}`
      : `Transfer of ${amt} initiated to ${p.accountName}`;
  }
  if (p.payoutType === "airtime") {
    return done
      ? `${amt} ${p.network} airtime sent to ${p.phoneNumber}`
      : `${amt} ${p.network} airtime to ${p.phoneNumber} is being confirmed. Track it under Pending transactions.`;
  }
  return done
    ? `${p.bundleName} data bundle sent to ${p.phoneNumber}`
    : `${p.bundleName} for ${p.phoneNumber} is being confirmed. Track it under Pending transactions.`;
}

function respond(p) {
  const data = {
    reference: p.reference,
    status: p.status,
    amount: p.amount,
    accountName: p.accountName,
    phoneNumber: p.phoneNumber,
    network: p.network,
  };
  if (p.status === "failed") {
    return {
      httpStatus: 400,
      body: { success: false, message: p.errorMessage || "Transaction failed", data },
    };
  }
  const done = p.status === "completed";
  return {
    httpStatus: 200,
    body: { success: true, pending: !done, message: messageFor(p, done), data },
  };
}

// ───────────────────────── public API ─────────────────────────

async function startPayout(userId, type, body = {}) {
  const key =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.length <= 100
      ? body.idempotencyKey
      : undefined;

  const replay = async (existing) => {
    if (
      existing.payoutType !== type ||
      existing.pointsConverted !== Number(body.pointsToConvert)
    ) {
      throw new PayoutError(409, "This request was already used for a different transaction. Please start again.");
    }
    return respond(await advancePayout(existing));
  };

  if (key) {
    const existing = await PayoutRequest.findOne({ userId, idempotencyKey: key });
    if (existing) return replay(existing);
  }

  const spec = await buildSpec(userId, type, body);

  const [balance, reserved] = await Promise.all([
    walletService.getBalance("student"),
    reservedAmount(),
  ]);
  if (balance - reserved < spec.amount) {
    throw new PayoutError(
      400,
      "We're temporarily unable to process this payout. Please try again in a few hours or contact support.",
    );
  }

  const reference = `GURU_${PREFIX[type]}_${Date.now()}_${userId}`;
  let payout;
  try {
    payout = await PayoutRequest.create({
      ...spec,
      reference,
      idempotencyKey: key,
      status: "pending",
      flowVersion: 2,
    });
  } catch (e) {
    if (e.code === 11000 && key) {
      const existing = await PayoutRequest.findOne({ userId, idempotencyKey: key });
      if (existing) return replay(existing);
    }
    throw e;
  }

  return respond(await advancePayout(payout));
}

/** Webhook entry: provider says success/failed for this reference. */
async function applyProviderResult(reference, state, data = {}) {
  const p = await PayoutRequest.findOne({ reference });
  if (!p) return null;
  if (state === "successful") return completePayout(p, data);
  if (state === "failed") {
    return failPayout(
      p,
      data.complete_message || data.response_message || "Transaction failed",
      { allowFromCompleted: true },
    );
  }
  return p;
}

module.exports = {
  PayoutError,
  startPayout,
  advancePayout,
  applyProviderResult,
  needsWork,
  pointsToAmount,
  respond,
  ACTIVE,
};
