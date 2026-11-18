const mongoose = require("mongoose");

/**
 * A PaymentIntent is created on OUR server BEFORE Flutterwave is opened.
 * It remembers who is paying, for which plan, and how many days they are owed,
 * so the payment can be confirmed and fulfilled even if the app dies, the
 * network drops, or the redirect is never received.
 *
 * status:
 *   created   - issued, no signal from Flutterwave yet
 *   pending   - Flutterwave says the payment is still in progress
 *   paid      - money confirmed, subscription NOT yet applied (retry will finish it)
 *   fulfilled - done
 *   failed    - Flutterwave says it failed (or amount mismatch -> needsReview)
 *   cancelled - user backed out and Flutterwave has no successful charge
 *   expired   - nothing ever happened for 48h
 * Anything except `fulfilled` can still be fulfilled later (e.g. a delayed
 * bank-transfer, or a webhook arriving after we marked it expired).
 */
const paymentIntentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    txRef: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: ["subscription"], default: "subscription" },
    accountType: { type: String, enum: ["student", "school"], required: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School" },

    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    days: { type: Number, required: true },
    label: String,

    status: {
      type: String,
      enum: [
        "created",
        "pending",
        "paid",
        "fulfilled",
        "failed",
        "cancelled",
        "expired",
      ],
      default: "created",
      index: true,
    },
    source: { type: String, enum: ["intent", "legacy"], default: "intent" },

    flwTransactionId: String,
    flwRef: String,
    paidAmount: Number,
    paidAt: Date,
    customerEmail: String,
    customerName: String,

    // Computed ONCE, then applied with $max => applying twice is harmless.
    plannedExpiry: Date,
    walletCredited: { type: Boolean, default: false },
    fulfilledAt: Date,

    // set when the user taps Pay (or any verify call arrives): only these are
    // shown in the app as a transaction. Plan-browsing intents stay invisible.
    initiatedAt: Date,

    attempts: { type: Number, default: 0 },
    lastError: String,
    lastCheckedAt: Date,
    lockedUntil: Date,
    needsReview: { type: Boolean, default: false },
  },
  { timestamps: true },
);

paymentIntentSchema.index({ userId: 1, status: 1, createdAt: -1 });
paymentIntentSchema.index({ status: 1, lastCheckedAt: 1 });

module.exports = mongoose.model("PaymentIntent", paymentIntentSchema);
