const mongoose = require("mongoose");

// models/WalletTransaction.js
const walletTransactionSchema = new mongoose.Schema(
  {
    accountType: {
      type: String,
      enum: ["school", "student"],
      required: true,
      index: true,
    },
    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    category: {
      type: String,
      enum: ["subscription", "payout", "refund", "adjustment"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    flutterwaveReference: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    description: String,
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
