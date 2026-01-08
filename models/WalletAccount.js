const mongoose = require("mongoose");

const walletAccountSchema = new mongoose.Schema(
  {
    accountType: {
      type: String,
      enum: ["school", "student"],
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalCredits: {
      type: Number,
      default: 0,
    },
    totalDebits: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("WalletAccount", walletAccountSchema);
