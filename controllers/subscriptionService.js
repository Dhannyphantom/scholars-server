// ==========================================
// SUBSCRIPTION SERVICE (controllers/subscriptionService.js)
// ==========================================
// ONE code path turns "money arrived at Flutterwave" into "subscription active".
// It is used by: the app's verify call, the Flutterwave webhook, the pending
// list / retry button, the background reconciler and the manager recover tool.
//
// Safe to run any number of times for the same payment:
//   1. confirm with Flutterwave (by id, or by OUR tx_ref)  -> status "paid"
//   2. credit wallet ledger   (unique reference => once)
//   3. extend subscription    (planned expiry stored once, applied with $max)
//   4. status "fulfilled"
// If anything dies after step 1 the payment stays "paid" and the next run
// just completes the remaining steps.
const crypto = require("crypto");

const PaymentIntent = require("../models/PaymentIntent");
const { User } = require("../models/User");
const { School } = require("../models/School");
const walletService = require("./walletService");
const flw = require("./flutterwaveService");
const { findPlan, findPlanByAmount, ENFORCE } = require("../config/subscriptionPlans");

const DAY = 24 * 60 * 60 * 1000;
const LOCK_MS = 60 * 1000;
const EXPIRE_AFTER_MS = 48 * 60 * 60 * 1000;
const REUSE_WINDOW_MS = 2 * 60 * 60 * 1000;

class SubscriptionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const outcome = (state, intent, message) => ({ state, intent, message });

// ───────────────────────── intents ─────────────────────────

async function createIntent(userId, input = {}) {
  const accountType = input.type === "school" ? "school" : "student";
  const amount = Number(input.amount);
  const days = Number(input.days);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SubscriptionError(400, "Invalid plan amount");
  }
  if (!Number.isInteger(days) || days <= 0 || days > 3660) {
    throw new SubscriptionError(400, "Invalid plan duration");
  }

  if (!findPlan(accountType, amount, days)) {
    if (ENFORCE()) throw new SubscriptionError(400, "This plan is not available");
    console.warn(
      `[plans] ${accountType} plan not in catalogue: ₦${amount} / ${days}d (user ${userId})`,
    );
  }

  let schoolId;
  if (accountType === "school") {
    schoolId = input.schoolId;
    const school = schoolId ? await School.exists({ _id: schoolId }) : null;
    if (!school) throw new SubscriptionError(400, "School not found");
  }

  // Re-use an untouched intent for the same plan (user hopping between plans
  // must not spam the DB). `fresh` is sent after a cancel/failure, because
  // Flutterwave wants a new tx_ref per attempt.
  if (!input.fresh) {
    const existing = await PaymentIntent.findOne({
      userId,
      accountType,
      schoolId: schoolId || null,
      amount,
      days,
      status: "created",
      createdAt: { $gte: new Date(Date.now() - REUSE_WINDOW_MS) },
    }).sort({ createdAt: -1 });
    if (existing) return existing;
  }

  return PaymentIntent.create({
    userId,
    txRef: `GURU_SUB_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    accountType,
    schoolId: schoolId || undefined,
    amount,
    days,
    label: input.label,
  });
}

/**
 * Find the intent a verify call is about. Old app versions never created one,
 * so for an unknown tx_ref we build it from Flutterwave's own data.
 */
async function getIntentForVerify(userId, { tx_ref, transaction_id }) {
  if (!tx_ref) throw new SubscriptionError(400, "Missing transaction reference");

  const intent = await PaymentIntent.findOne({ txRef: tx_ref });
  if (intent) {
    if (String(intent.userId) !== String(userId)) {
      throw new SubscriptionError(403, "This payment does not belong to your account");
    }
    return intent;
  }
  if (!transaction_id) return null;

  const v = await flw.verifyTransaction(transaction_id);
  if (!v.ok || v.data?.tx_ref !== tx_ref) return null;
  return createLegacyIntent(userId, v.data);
}

async function createLegacyIntent(userId, data) {
  const user = await User.findById(userId).select("email");
  if (!user) throw new SubscriptionError(404, "User not found");

  const paidEmail = String(data.customer?.email || "").toLowerCase();
  if (paidEmail && user.email && paidEmail !== String(user.email).toLowerCase()) {
    throw new SubscriptionError(403, "This transaction does not belong to your account");
  }

  const accountType = data.meta?.account_type === "school" ? "school" : "student";
  const amount = Number(data.amount);
  const catalog = findPlanByAmount(accountType, amount);
  const days = catalog ? catalog.days : Number(data.meta?.days);
  const notInCatalogue = !catalog;
  if (notInCatalogue) {
    console.warn(`[plans] legacy payment ${data.tx_ref}: ₦${amount} not in catalogue`);
  }

  try {
    return await PaymentIntent.create({
      userId,
      txRef: data.tx_ref,
      source: "legacy",
      accountType,
      schoolId: accountType === "school" ? data.meta?.schoolId || undefined : undefined,
      amount,
      days: Number.isFinite(days) ? days : 0,
      label: `${days || "?"} days`,
      needsReview: notInCatalogue,
      initiatedAt: new Date(), // a real payment exists, so it must be visible
      status: notInCatalogue && ENFORCE() ? "failed" : "created",
      lastError:
        notInCatalogue && ENFORCE() ? "Amount does not match any plan" : undefined,
    });
  } catch (e) {
    if (e.code === 11000) return PaymentIntent.findOne({ txRef: data.tx_ref });
    throw e;
  }
}

/** The user tapped Pay: from now on this attempt has a visible trace in the app. */
async function markStarted(userId, txRef) {
  if (!txRef) return false;
  const r = await PaymentIntent.updateOne(
    { txRef, userId, initiatedAt: null },
    { $set: { initiatedAt: new Date() } },
  );
  return r.matchedCount > 0 || r.modifiedCount > 0;
}

/** User says "I didn't pay". Only for unpaid attempts; a later webhook can still fulfil it. */
async function dismissIntent(userId, id) {
  const r = await PaymentIntent.updateOne(
    { _id: id, userId, status: { $in: ["created", "pending"] } },
    { $set: { status: "cancelled" } },
  );
  return r.modifiedCount > 0;
}

// ───────────────────────── confirm with Flutterwave ─────────────────────────

async function confirmPayment(intent, transactionId) {
  let v = null;

  if (transactionId) {
    v = await flw.verifyTransaction(transactionId);
    // Someone else's transaction id? Ignore it, fall back to our own tx_ref.
    if (v.ok && v.data?.tx_ref !== intent.txRef) v = null;
  }
  if (!v || !v.ok) {
    v = await flw.verifyByReference(intent.txRef);
  }

  if (v.networkError) return { state: "unknown" };
  if (!v.ok) return { state: "not_found" };

  const d = v.data;
  const flwStatus = String(d.status || "").toLowerCase();

  if (flwStatus === "successful") {
    const amountOk = Number(d.amount) >= intent.amount;
    const currencyOk = !d.currency || d.currency === intent.currency;
    const refOk = d.tx_ref === intent.txRef;
    if (!amountOk || !currencyOk || !refOk) {
      return {
        state: "mismatch",
        message: `Paid ${d.currency} ${d.amount}, expected ${intent.currency} ${intent.amount}`,
      };
    }
    return { state: "paid", data: d };
  }
  if (flwStatus === "failed") return { state: "failed" };
  return { state: "pending" };
}

// ───────────────────────── apply subscription ─────────────────────────

async function applySubscription(intent) {
  if (!(intent.days > 0)) {
    throw new Error("Missing plan duration for this payment (needs manual review)");
  }
  const isSchool = intent.accountType === "school";
  const Holder = isSchool ? School : User;
  const holderId = isSchool ? intent.schoolId : intent.userId;

  // Compute the new expiry ONCE and remember it on the intent.
  let planned = intent.plannedExpiry;
  if (!planned) {
    const holder = await Holder.findById(holderId).select("subscription");
    if (!holder) throw new Error(isSchool ? "School not found" : "User not found");
    const now = new Date();
    const current = holder.subscription?.expiry;
    const base = current && current > now ? current : now;
    const candidate = new Date(base.getTime() + intent.days * DAY);

    const saved = await PaymentIntent.findOneAndUpdate(
      { _id: intent._id, plannedExpiry: null },
      { $set: { plannedExpiry: candidate } },
      { new: true },
    );
    planned = (saved || (await PaymentIntent.findById(intent._id))).plannedExpiry;
    intent.plannedExpiry = planned;
  }

  const now = new Date();
  const setActive = {
    "subscription.isActive": true,
    "subscription.current": intent.paidAt || now,
  };

  // $max => running this twice (or after a crash) can never double-extend.
  await Holder.updateOne(
    { _id: holderId },
    { $max: { "subscription.expiry": planned }, $set: setActive },
  );

  if (isSchool) {
    const school = await School.findById(holderId).lean();
    const teacherIds = (school?.teachers || []).map((t) => t.user);

    if (school?.rep) {
      await School.updateOne(
        { _id: holderId, "teachers.user": school.rep },
        { $set: { "teachers.$.verified": true } },
      );
    }
    if (teacherIds.length) {
      await User.updateMany(
        { _id: { $in: teacherIds } },
        {
          $max: { "subscription.expiry": school.subscription?.expiry || planned },
          $set: setActive,
        },
      );
    }
  }
}

// ───────────────────────── the one entry point ─────────────────────────

async function fulfil(intent) {
  try {
    await walletService.credit(
      intent.accountType,
      intent.paidAmount ?? intent.amount,
      "subscription",
      intent.txRef,
      {
        flutterwaveReference: intent.flwTransactionId,
        userId: intent.userId,
        schoolId: intent.schoolId,
        customerEmail: intent.customerEmail,
        customerName: intent.customerName,
        description: `${
          intent.accountType === "school" ? "School" : "Student"
        } subscription payment`,
        pointsAdded: intent.accountType === "student" ? intent.amount * 10 : 0,
        walletCredited: intent.paidAmount ?? intent.amount,
        days: intent.days,
      },
    );

    await applySubscription(intent);

    const done = await PaymentIntent.findOneAndUpdate(
      { _id: intent._id },
      {
        $set: {
          status: "fulfilled",
          fulfilledAt: new Date(),
          walletCredited: true,
          lastError: null,
        },
      },
      { new: true },
    );
    return outcome("fulfilled", done, "Subscription activated");
  } catch (err) {
    console.error(`[subscription] fulfil failed for ${intent.txRef}:`, err);
    await PaymentIntent.updateOne(
      { _id: intent._id },
      { $set: { lastError: err.message } },
    );
    return outcome(
      "paid_unfulfilled",
      intent,
      "Payment received. We're activating your subscription…",
    );
  }
}

async function run(intent, { transactionId, clientStatus }) {
  if (!intent.paidAt) {
    const c = await confirmPayment(intent, transactionId);

    switch (c.state) {
      case "unknown":
        return outcome("unknown", intent, "We couldn't reach the payment provider. Please check again shortly.");

      case "not_found": {
        const patch = {};
        if (clientStatus === "cancelled") patch.status = "cancelled";
        else if (
          intent.status === "created" &&
          Date.now() - new Date(intent.createdAt).getTime() > EXPIRE_AFTER_MS
        ) {
          patch.status = "expired";
        }
        if (patch.status) {
          await PaymentIntent.updateOne(
            { _id: intent._id, status: { $nin: ["fulfilled", "paid"] } },
            { $set: patch },
          );
        }
        return outcome(
          clientStatus === "cancelled" ? "cancelled" : "not_found",
          intent,
          "We couldn't find a payment for this attempt.",
        );
      }

      case "pending":
        await PaymentIntent.updateOne(
          { _id: intent._id, status: { $in: ["created", "pending"] } },
          { $set: { status: "pending" } },
        );
        return outcome("pending", intent, "Your payment is still being confirmed by your bank.");

      case "failed":
        await PaymentIntent.updateOne(
          { _id: intent._id, status: { $nin: ["fulfilled", "paid"] } },
          { $set: { status: "failed" } },
        );
        return outcome("failed", intent, "That payment didn't go through. You were not charged.");

      case "mismatch":
        await PaymentIntent.updateOne(
          { _id: intent._id, status: { $nin: ["fulfilled", "paid"] } },
          { $set: { status: "failed", needsReview: true, lastError: c.message } },
        );
        return outcome(
          "failed",
          intent,
          "The amount paid doesn't match the selected plan. Please contact support with your reference.",
        );

      case "paid": {
        const d = c.data;
        intent = await PaymentIntent.findOneAndUpdate(
          { _id: intent._id },
          {
            $set: {
              status: "paid",
              paidAt: new Date(),
              paidAmount: Number(d.amount),
              flwTransactionId: String(d.id),
              flwRef: d.flw_ref,
              customerEmail: d.customer?.email,
              customerName: d.customer?.name,
            },
          },
          { new: true },
        );
        break; // continue to fulfilment
      }
    }
  }

  return fulfil(intent);
}

/**
 * Confirm + fulfil one intent. Never throws; returns { state, intent, message }
 * state: fulfilled | pending | paid_unfulfilled | not_found | cancelled |
 *        failed | busy | unknown
 */
async function settleIntent(intentOrId, { transactionId, clientStatus } = {}) {
  const id = intentOrId?._id || intentOrId;
  const now = new Date();

  const intent = await PaymentIntent.findOneAndUpdate(
    {
      _id: id,
      status: { $ne: "fulfilled" },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    },
    {
      $set: { lockedUntil: new Date(now.getTime() + LOCK_MS), lastCheckedAt: now },
      $inc: { attempts: 1 },
    },
    { new: true },
  );

  if (!intent) {
    const cur = await PaymentIntent.findById(id);
    if (!cur) return outcome("not_found", null, "Payment record not found");
    if (cur.status === "fulfilled") return outcome("fulfilled", cur, "Subscription activated");
    return outcome("busy", cur, "We're still processing your payment…");
  }

  try {
    return await run(intent, { transactionId, clientStatus });
  } catch (err) {
    console.error(`[subscription] settle error ${intent.txRef}:`, err);
    await PaymentIntent.updateOne({ _id: id }, { $set: { lastError: err.message } });
    return outcome(
      intent.paidAt ? "paid_unfulfilled" : "unknown",
      intent,
      "We hit a snag confirming your payment. Please check again in a moment.",
    );
  } finally {
    await PaymentIntent.updateOne({ _id: id }, { $set: { lockedUntil: null } }).catch(() => {});
  }
}

module.exports = {
  SubscriptionError,
  createIntent,
  getIntentForVerify,
  createLegacyIntent,
  markStarted,
  dismissIntent,
  settleIntent,
  EXPIRE_AFTER_MS,
};
