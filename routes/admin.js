// ==========================================
// ADMIN ROUTES (routes/admin.js)
// ==========================================

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const walletService = require("../controllers/walletService");
const WalletTransaction = require("../models/WalletTransaction");
const PayoutRequest = require("../models/PayoutRequest");
const { Question } = require("../models/Question");
const { AppInfo } = require("../models/AppInfo");

// Middleware for admin authentication
const adminAuth = require("../middlewares/adminRoutes");

// Get wallet balances
router.get("/wallets", adminAuth, async (req, res) => {
  try {
    const balances = await walletService.getAllBalances();
    res.json({
      success: true,
      data: balances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get wallet transactions with filters
router.get(
  "/wallets/:accountType/transactions",
  adminAuth,
  async (req, res) => {
    try {
      const { accountType } = req.params;
      const {
        page = 1,
        limit = 50,
        startDate,
        endDate,
        status,
        transactionType,
      } = req.query;

      const query = { accountType };

      if (status) query.status = status;
      if (transactionType) query.transactionType = transactionType;

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const transactions = await WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .populate("userId", "name email");

      const total = await WalletTransaction.countDocuments(query);

      res.json({
        success: true,
        data: {
          transactions,
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

// Reconcile wallet
router.get("/wallets/:accountType/reconcile", adminAuth, async (req, res) => {
  try {
    const { accountType } = req.params;
    const result = await walletService.reconcile(accountType);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all payout requests with filters
router.get("/payouts", adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      payoutType,
      startDate,
      endDate,
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (payoutType) query.payoutType = payoutType;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const payouts = await PayoutRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate("userId", "name email phone");

    const total = await PayoutRequest.countDocuments(query);

    // Get statistics
    const stats = await PayoutRequest.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        payouts,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        stats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Manual wallet adjustment (admin only - use with caution)
router.post("/wallets/adjust", adminAuth, async (req, res) => {
  try {
    const { accountType, amount, reason, adjustmentType } = req.body;

    if (!["credit", "debit"].includes(adjustmentType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid adjustment type",
      });
    }

    const reference = `ADMIN_ADJ_${Date.now()}`;

    let result;
    if (adjustmentType === "credit") {
      result = await walletService.credit(
        accountType,
        amount,
        "adjustment",
        reference,
        {
          description: `Admin adjustment: ${reason}`,
          adminId: req.admin.id,
        },
      );
    } else {
      result = await walletService.debit(
        accountType,
        amount,
        "adjustment",
        reference,
        {
          description: `Admin adjustment: ${reason}`,
          adminId: req.admin.id,
        },
      );
    }

    res.json({
      success: true,
      message: "Wallet adjusted successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Dashboard statistics
router.get("/dashboard/stats", adminAuth, async (req, res) => {
  try {
    const balances = await walletService.getAllBalances();

    // Today's transactions
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTransactions = await WalletTransaction.aggregate([
      {
        $match: {
          createdAt: { $gte: today },
          status: "completed",
        },
      },
      {
        $group: {
          _id: {
            accountType: "$accountType",
            transactionType: "$transactionType",
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    // Pending payouts
    const pendingPayouts = await PayoutRequest.countDocuments({
      status: { $in: ["pending", "processing"] },
    });

    // Failed payouts (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const failedPayouts = await PayoutRequest.countDocuments({
      status: "failed",
      createdAt: { $gte: sevenDaysAgo },
    });

    res.json({
      success: true,
      data: {
        wallets: balances,
        todayTransactions,
        pendingPayouts,
        failedPayouts,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/app_version", async (req, res) => {
  const appData = await AppInfo.findOne({ ID: "APP" });

  const {
    latestVersion,
    minimumSupportedVersion,
    otaEnabled,
    updateMessage,
    forceMessage,
  } = appData.VERSION;

  return res.json({
    latestVersion,
    minimumSupportedVersion,
    otaEnabled,
    updateMessage,
    forceMessage,
  });
});

router.put("/q_update", async (req, res) => {
  // const result = await Topic.updateMany(
  //   {
  //     _id: "690e61734e72018502f38563",
  //   },
  //   {
  //     $set: {
  //       user: "6758b009146bd4915853caab",
  //     },
  //   },
  // );

  // const result = await Question.updateMany(
  //   {
  //     topic: {
  //       $in: [new mongoose.Types.ObjectId("690e61734e72018502f38563")],
  //     },
  //     user: new mongoose.Types.ObjectId("6758b009146bd4915853caab"),
  //   },
  //   {
  //     $set: {
  //       categories: ["678d59448f4a1d454f2ce813"],
  //     },
  //   },
  // );

  // const result = await Topic.updateMany(
  //   {
  //     _id: {
  //       $in: [
  //         new mongoose.Types.ObjectId("69656935513e4e01dc60d949"),
  //         new mongoose.Types.ObjectId("69656935513e4e01dc60d94a"),
  //       ],
  //     },
  //   },
  //   {
  //     $set: {
  //       categories: [
  //         // JUNIORS
  //         // "678d59448f4a1d454f2ce815",
  //         // SENIORS
  //         "678d59448f4a1d454f2ce813",
  //         "678d59448f4a1d454f2ce811",
  //         "678d59448f4a1d454f2ce80d",
  //         "678d59448f4a1d454f2ce80f",
  //       ],
  //     },
  //   },
  // );

  res.send({ success: true, update: result?.modifiedCount || 0 });
});

module.exports = router;
