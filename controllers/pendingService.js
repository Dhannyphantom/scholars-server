// ==========================================
// PENDING SERVICE (controllers/pendingService.js)
// ==========================================
// Powers the in-app transaction trace ("Pending" + "Recent attempts") and the
// background reconciler. Every attempt the user starts is listed here from the
// moment they tap Pay / confirm, through to its final result.
const PaymentIntent = require("../models/PaymentIntent");
const PayoutRequest = require("../models/PayoutRequest");
const {
  settleIntent,
  dismissIntent,
  EXPIRE_AFTER_MS,
} = require("./subscriptionService");
const { advancePayout, needsWork, ACTIVE } = require("./payoutService");

const naira = (n) =>
  `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

const HOUR = 60 * 60 * 1000;
const RECENT_WINDOW_MS = 7 * 24 * HOUR;
const THROTTLE_MS = { paid: 5000, pending: 8000, created: 10000, payout: 8000 };

const dueFilter = (ms) => ({
  $or: [
    { lastCheckedAt: null },
    { lastCheckedAt: { $lt: new Date(Date.now() - ms) } },
  ],
});

// Intents that are visible to the user and not finished.
const UNRESOLVED_INTENT = {
  $or: [
    { status: { $in: ["pending", "paid"] } },
    { status: "created", initiatedAt: { $ne: null } },
  ],
};
const FINAL_INTENT = ["fulfilled", "failed", "cancelled", "expired"];

// ───────────────────────── describe for the UI ─────────────────────────
// tone: ok | warn | bad | neutral

function intentView(i) {
  const label = i.label || `${i.days} days`;
  const v = {
    id: String(i._id),
    entity: "subscription",
    kind: "subscription",
    status: i.status,
    title: `Subscription · ${label}`,
    amount: i.amount,
    reference: i.txRef,
    createdAt: i.initiatedAt || i.createdAt,
    canRetry: false,
    canDismiss: false,
    tone: "warn",
    statusLabel: "",
    description: "",
  };
  switch (i.status) {
    case "paid":
      return {
        ...v,
        statusLabel: "Payment received",
        description:
          "Your payment went through. We're activating your subscription. Tap Check status to finish it.",
        canRetry: true,
      };
    case "pending":
      return {
        ...v,
        statusLabel: "Confirming",
        description: "Waiting for your bank to confirm the payment.",
        canRetry: true,
        canDismiss: true,
      };
    case "created":
      return {
        ...v,
        statusLabel: "Not confirmed",
        description:
          "You started this payment but we haven't received confirmation yet. If you were debited, tap Check status. If you didn't pay, dismiss it.",
        canRetry: true,
        canDismiss: true,
      };
    case "fulfilled":
      return {
        ...v,
        tone: "ok",
        statusLabel: "Successful",
        description: `${i.days} days added to your subscription${
          i.plannedExpiry ? `. Valid until ${fmtDate(i.plannedExpiry)}` : ""
        }.`,
        createdAt: i.fulfilledAt || v.createdAt,
      };
    case "failed":
      return {
        ...v,
        tone: "bad",
        statusLabel: "Failed",
        description: i.needsReview
          ? "This payment needs a manual check. Contact support and quote the reference below."
          : "The payment didn't go through. You were not charged.",
      };
    case "cancelled":
      return {
        ...v,
        tone: "neutral",
        statusLabel: "Cancelled",
        description: "This payment was cancelled. No charge was made.",
      };
    default:
      return {
        ...v,
        tone: "neutral",
        statusLabel: "Not completed",
        description: "This payment was never completed.",
      };
  }
}

function payoutView(p) {
  const title =
    p.payoutType === "withdrawal"
      ? `Withdrawal · ${naira(p.amount)}`
      : p.payoutType === "airtime"
        ? `Airtime · ${naira(p.amount)}`
        : `Data · ${p.bundleName || naira(p.amount)}`;
  const to =
    p.payoutType === "withdrawal"
      ? p.accountName || "your account"
      : p.phoneNumber;

  const v = {
    id: String(p._id),
    entity: "payout",
    kind: p.payoutType,
    status: p.status,
    title,
    amount: p.amount,
    reference: p.reference,
    createdAt: p.createdAt,
    canRetry: false,
    canDismiss: false,
    tone: "warn",
    statusLabel: "",
    description: "",
  };

  if (p.status === "completed") {
    return {
      ...v,
      tone: "ok",
      statusLabel: "Successful",
      description: `Sent to ${to}.`,
      createdAt: p.completedAt || p.createdAt,
    };
  }
  if (p.status === "failed") {
    const refunded = p.pointsRefunded || !p.pointsDeducted;
    return {
      ...v,
      tone: "bad",
      statusLabel: "Failed",
      description: `${p.errorMessage || "The transaction failed"}. ${
        refunded
          ? p.pointsDeducted
            ? "Your points were refunded."
            : "No points were taken."
          : "Your points will be refunded shortly."
      }`,
      canRetry: !refunded,
    };
  }
  return {
    ...v,
    statusLabel: "Processing",
    description: `Sending to ${to}. Your points are held safely and refunded automatically if it fails.`,
    canRetry: true,
  };
}

// ───────────────────────── queries ─────────────────────────

const unresolvedPayoutQuery = (userId) => ({
  userId,
  flowVersion: { $gte: 2 },
  $or: [
    { status: { $in: ACTIVE } },
    { status: "failed", pointsDeducted: true, pointsRefunded: false },
  ],
});

async function listPending(userId) {
  const [intents, payouts, recentIntents, recentPayouts] = await Promise.all([
    PaymentIntent.find({ userId, ...UNRESOLVED_INTENT })
      .sort({ createdAt: -1 })
      .limit(20),
    PayoutRequest.find(unresolvedPayoutQuery(userId))
      .sort({ createdAt: -1 })
      .limit(20),
    PaymentIntent.find({
      userId,
      status: { $in: FINAL_INTENT },
      initiatedAt: { $ne: null },
      updatedAt: { $gte: new Date(Date.now() - RECENT_WINDOW_MS) },
    })
      .sort({ updatedAt: -1 })
      .limit(15),
    PayoutRequest.find({
      userId,
      flowVersion: { $gte: 2 },
      status: { $in: ["completed", "failed"] },
      $nor: [{ status: "failed", pointsDeducted: true, pointsRefunded: false }],
      createdAt: { $gte: new Date(Date.now() - RECENT_WINDOW_MS) },
    })
      .sort({ createdAt: -1 })
      .limit(15),
  ]);

  const byDate = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  return {
    items: [...intents.map(intentView), ...payouts.map(payoutView)].sort(byDate),
    recent: [...recentIntents.map(intentView), ...recentPayouts.map(payoutView)]
      .sort(byDate)
      .slice(0, 15),
  };
}

// ───────────────────────── heal a user's own items ─────────────────────────

/** Re-check everything unresolved for this user. Returns what got resolved. */
async function reconcileUser(userId) {
  const resolved = [];
  const now = Date.now();

  const [intents, payouts] = await Promise.all([
    PaymentIntent.find({
      userId,
      status: { $in: ["created", "pending", "paid"] },
      $and: [
        {
          // untouched intents: 6h. Ones the user actually started: 48h.
          $or: [
            { createdAt: { $gte: new Date(now - 6 * HOUR) } },
            { initiatedAt: { $ne: null }, createdAt: { $gte: new Date(now - 48 * HOUR) } },
          ],
        },
        dueFilter(5000),
      ],
    }).limit(8),
    PayoutRequest.find({
      userId,
      flowVersion: { $gte: 2 },
      status: { $in: ACTIVE },
      ...dueFilter(THROTTLE_MS.payout),
    }).limit(8),
  ]);

  await Promise.allSettled([
    ...intents
      .filter(
        (i) =>
          now - new Date(i.lastCheckedAt || 0) > (THROTTLE_MS[i.status] || 8000),
      )
      .map(async (i) => {
        const out = await settleIntent(i);
        if (out.state === "fulfilled") {
          resolved.push({
            id: String(i._id),
            kind: "subscription",
            outcome: "completed",
            message: `Your ${i.label || `${i.days}-day`} subscription is now active.`,
          });
        }
      }),
    ...payouts.map(async (p) => {
      const after = await advancePayout(p);
      if (after?.status === "completed" || after?.status === "failed") {
        const d = payoutView(after);
        resolved.push({
          id: d.id,
          kind: d.kind,
          outcome: after.status,
          message:
            after.status === "completed"
              ? `${d.title} was successful.`
              : `${d.title} failed. Your points have been refunded.`,
        });
      }
    }),
  ]);

  return resolved;
}

// ───────────────────────── user pressed "Check status" / "Dismiss" ─────────────────────────

async function retryOne(userId, entity, id) {
  if (entity === "subscription") {
    const intent = await PaymentIntent.findOne({ _id: id, userId });
    if (!intent) return null;
    const out = await settleIntent(intent);
    return {
      resolved: out.state === "fulfilled" || out.state === "failed",
      outcome:
        out.state === "fulfilled"
          ? "completed"
          : out.state === "failed"
            ? "failed"
            : "pending",
      message:
        out.state === "not_found" || out.state === "cancelled"
          ? "We still can't find a payment for this attempt. If you were debited, wait a few minutes and check again."
          : out.message,
    };
  }

  const payout = await PayoutRequest.findOne({
    _id: id,
    userId,
    flowVersion: { $gte: 2 },
  });
  if (!payout) return null;
  const after = await advancePayout(payout);
  const d = payoutView(after);
  if (after.status === "completed") {
    return { resolved: true, outcome: "completed", message: `${d.title} was successful.` };
  }
  if (after.status === "failed") {
    return { resolved: true, outcome: "failed", message: d.description };
  }
  return {
    resolved: false,
    outcome: "pending",
    message: "Still being processed by the provider. We'll keep checking and update you.",
  };
}

async function dismissOne(userId, entity, id) {
  if (entity !== "subscription") return { ok: false, message: "Only unpaid payments can be dismissed" };
  const ok = await dismissIntent(userId, id);
  return ok
    ? { ok: true, message: "Dismissed" }
    : { ok: false, message: "This payment can't be dismissed (it may already be paid)" };
}

// ───────────────────────── background sweep (all users) ─────────────────────────

async function sweepAll({ batch = 25 } = {}) {
  const intents = await PaymentIntent.find({
    status: { $in: ["created", "pending", "paid"] },
    createdAt: { $gte: new Date(Date.now() - EXPIRE_AFTER_MS - HOUR) },
    $and: [
      // brand-new untouched `created` rows belong to a user still in checkout
      {
        $or: [
          { status: { $ne: "created" } },
          { initiatedAt: { $ne: null } },
          { createdAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } },
        ],
      },
      dueFilter(5 * 60 * 1000),
    ],
  })
    .sort({ lastCheckedAt: 1 })
    .limit(batch);

  const payouts = await PayoutRequest.find({
    flowVersion: { $gte: 2 },
    needsReview: { $ne: true },
    $and: [
      {
        $or: [
          { status: { $in: ACTIVE } },
          { status: "completed", walletDebited: false },
          { status: "failed", pointsDeducted: true, pointsRefunded: false },
        ],
      },
      dueFilter(60 * 1000),
    ],
  })
    .sort({ lastCheckedAt: 1 })
    .limit(batch);

  await Promise.allSettled([
    ...intents.map((i) => settleIntent(i)),
    ...payouts.filter(needsWork).map((p) => advancePayout(p)),
  ]);

  return { intents: intents.length, payouts: payouts.length };
}

module.exports = {
  listPending,
  reconcileUser,
  retryOne,
  dismissOne,
  sweepAll,
  intentView,
  payoutView,
};
