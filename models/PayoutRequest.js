const mongoose = require("mongoose");

// models/PayoutRequest.js
const payoutRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    pointsConverted: {
      type: Number,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
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
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    flutterwaveId: String,
    errorMessage: String,
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PayoutRequest", payoutRequestSchema);
