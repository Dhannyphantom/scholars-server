const mongoose = require("mongoose");

/**
 * Lifecycle (flowVersion 2):
 *   pending     row saved, points not yet reserved
 *   processing  points reserved, request sent (or may have been sent) to provider
 *   completed   provider confirmed
 *   failed      provider rejected/failed -> points refunded (pointsRefunded)
 *
 * Every side effect has its own boolean flag so each step can be retried safely:
 *   pointsDeducted / pointsRefunded / walletDebited / walletRefunded
 *
 * Rows created by the old code have no flowVersion; they are only touched by
 * webhooks (never by the reconciler) and keep their old semantics.
 */
const payoutRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    pointsConverted: { type: Number, required: true },
    amount: { type: Number, required: true },
    payoutType: {
      type: String,
      enum: ["withdrawal", "airtime", "data"],
      required: true,
    },
    phoneNumber: String,
    network: String,
    accountNumber: String,
    accountBank: String,
    accountName: String,
    bundleCode: String,
    billerCode: String,
    bundleName: String,
    bundleAmount: Number,

    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    reference: { type: String, required: true, unique: true, index: true },
    // Client-generated per attempt. Same key => same payout (never a 2nd debit).
    idempotencyKey: String,
    flowVersion: { type: Number, default: 2 },

    flutterwaveId: String,
    errorMessage: String,
    completedAt: Date,

    pointsDeducted: { type: Boolean, default: false },
    pointsRefunded: { type: Boolean, default: false },
    walletDebited: { type: Boolean, default: false },
    walletRefunded: { type: Boolean, default: false },

    // not_sent -> never called provider; sent -> provider has it;
    // unknown -> we called it but never saw a definite answer (query first!)
    providerState: {
      type: String,
      enum: ["not_sent", "sent", "unknown"],
      default: "not_sent",
    },
    dispatchCount: { type: Number, default: 0 },
    lastDispatchAt: Date,
    lastCheckedAt: Date,
    lockedUntil: Date,
    needsReview: { type: Boolean, default: false },
    reviewNote: String,
  },
  { timestamps: true },
);

payoutRequestSchema.index({ createdAt: -1 });
payoutRequestSchema.index({ userId: 1, status: 1, createdAt: -1 });
payoutRequestSchema.index({ status: 1, updatedAt: 1 });
payoutRequestSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);

module.exports = mongoose.model("PayoutRequest", payoutRequestSchema);
