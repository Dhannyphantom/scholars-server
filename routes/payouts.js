// ==========================================
// PAYOUT ROUTES (routes/payouts.js)
// ==========================================
const express = require("express");
const router = express.Router();
const walletService = require("../controllers/walletService");
const flutterwaveService = require("../controllers/flutterwaveService");
const PayoutRequest = require("../models/PayoutRequest");
const User = require("../models/User"); // Your user model

// Middleware to verify user authentication
const authMiddleware = require("../middlewares/authRoutes");
const adminMiddleware = require("../middlewares/adminRoutes");

// Helper function to convert points to amount
const pointsToAmount = (points) => {
  const conversionRate = 10; // 10 points = 1 NGN
  return points / conversionRate;
};

// Get wallet balances (admin only)
router.get("/wallets/balances", adminMiddleware, async (req, res) => {
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

// Get user's available points
router.get("/user/points", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    res.json({
      success: true,
      data: {
        points: user.points || 0,
        equivalentAmount: pointsToAmount(user.points || 0),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 1. BANK WITHDRAWAL
router.post("/withdraw", authMiddleware, async (req, res) => {
  try {
    const { pointsToConvert, accountNumber, accountBank } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!pointsToConvert || !accountNumber || !accountBank) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Get user and check points
    const user = await User.findById(userId);
    if (!user || user.points < pointsToConvert) {
      return res.status(400).json({
        success: false,
        message: "Insufficient points balance",
      });
    }

    const amount = pointsToAmount(pointsToConvert);

    // Check student wallet balance
    const walletBalance = await walletService.getBalance("student");
    if (walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance. Please contact support.",
      });
    }

    // Verify account
    const verification = await flutterwaveService.verifyAccount(
      accountNumber,
      accountBank
    );
    if (!verification.success) {
      return res.status(400).json({
        success: false,
        message: verification.error || "Invalid account details",
      });
    }

    const reference = `GURU_WD_${Date.now()}_${userId}`;

    // Create payout request
    const payoutRequest = new PayoutRequest({
      userId,
      pointsConverted: pointsToConvert,
      amount,
      payoutType: "withdrawal",
      accountNumber,
      accountBank,
      accountName: verification.accountName,
      reference,
      status: "processing",
    });

    await payoutRequest.save();

    // Initiate transfer
    const transfer = await flutterwaveService.initiateTransfer({
      accountBank,
      accountNumber,
      amount,
      reference,
      narration: `Guru EduTech Withdrawal - ${user.name || userId}`,
      callbackUrl: `${process.env.ADDRESS}/payouts/webhooks/flutterwave`,
    });

    if (!transfer.success) {
      payoutRequest.status = "failed";
      payoutRequest.errorMessage = transfer.error;
      await payoutRequest.save();

      return res.status(400).json({
        success: false,
        message: transfer.error || "Transfer failed",
      });
    }

    // Deduct points from user
    user.points -= pointsToConvert;
    await user.save();

    // Debit student wallet
    await walletService.debit("student", amount, "payout", reference, {
      userId,
      flutterwaveReference: transfer.reference,
      description: `Withdrawal to ${verification.accountName}`,
      payoutType: "withdrawal",
    });

    // Update payout request
    payoutRequest.flutterwaveId = transfer.flutterwaveId;
    payoutRequest.status = "processing";
    await payoutRequest.save();

    res.json({
      success: true,
      message: `Transfer of ₦${amount.toFixed(2)} initiated to ${
        verification.accountName
      }`,
      data: {
        reference,
        accountName: verification.accountName,
        amount,
        status: "processing",
      },
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 2. AIRTIME RECHARGE
router.post("/recharge", authMiddleware, async (req, res) => {
  try {
    const { pointsToConvert, phoneNumber, network } = req.body;
    const userId = req.user.userId;

    // Validate
    if (!pointsToConvert || !phoneNumber || !network) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Validate phone number
    if (!/^(\+234|0)[789]\d{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Nigerian phone number",
      });
    }

    const user = await User.findById(userId);
    if (!user || user.points < pointsToConvert) {
      return res.status(400).json({
        success: false,
        message: "Insufficient points balance",
      });
    }

    const amount = pointsToAmount(pointsToConvert);
    const walletBalance = await walletService.getBalance("student");

    if (walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance. Try again in the next 24 hours",
      });
    }

    const reference = `GURU_AIR_${Date.now()}_${userId}`;

    // Create payout request
    const payoutRequest = new PayoutRequest({
      userId,
      pointsConverted: pointsToConvert,
      amount,
      payoutType: "airtime",
      phoneNumber,
      network,
      reference,
      status: "processing",
    });

    await payoutRequest.save();

    // Send airtime
    const airtime = await flutterwaveService.sendAirtime({
      phoneNumber,
      network,
      amount,
      reference,
    });

    if (!airtime.success) {
      payoutRequest.status = "failed";
      payoutRequest.errorMessage = airtime.error;
      await payoutRequest.save();

      return res.status(400).json({
        success: false,
        message: airtime.error || "Airtime purchase failed",
      });
    }

    // Deduct points
    user.points -= pointsToConvert;
    await user.save();

    // Debit wallet
    await walletService.debit("student", amount, "payout", reference, {
      userId,
      flutterwaveReference: airtime.reference,
      description: `Airtime ${network} - ${phoneNumber}`,
      payoutType: "airtime",
    });

    // Update payout
    payoutRequest.flutterwaveId = airtime.flutterwaveId;
    payoutRequest.status = "completed";
    payoutRequest.completedAt = new Date();
    await payoutRequest.save();

    res.json({
      success: true,
      message: `₦${amount.toFixed(2)} airtime sent to ${phoneNumber}`,
      data: {
        reference,
        amount,
        phoneNumber,
        network,
      },
    });
  } catch (error) {
    console.error("Recharge error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 3. DATA BUNDLE
router.post("/data", authMiddleware, async (req, res) => {
  try {
    const { pointsToConvert, phoneNumber, network, bundleCode } = req.body;
    const userId = req.user.userId;

    if (!pointsToConvert || !phoneNumber || !network) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const user = await User.findById(userId);
    if (!user || user.points < pointsToConvert) {
      return res.status(400).json({
        success: false,
        message: "Insufficient points balance",
      });
    }

    const amount = pointsToAmount(pointsToConvert);
    const walletBalance = await walletService.getBalance("student");

    if (walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance. Please try again in the next 24 hours",
      });
    }

    const reference = `GURU_DATA_${Date.now()}_${userId}`;

    const payoutRequest = new PayoutRequest({
      userId,
      pointsConverted: pointsToConvert,
      amount,
      payoutType: "data",
      phoneNumber,
      network,
      bundleCode,
      reference,
      status: "processing",
    });

    await payoutRequest.save();

    const dataBundle = await flutterwaveService.sendDataBundle({
      phoneNumber,
      network,
      amount,
      reference,
    });

    if (!dataBundle.success) {
      payoutRequest.status = "failed";
      payoutRequest.errorMessage = dataBundle.error;
      await payoutRequest.save();

      return res.status(400).json({
        success: false,
        message: dataBundle.error || "Data purchase failed",
      });
    }

    user.points -= pointsToConvert;
    await user.save();

    await walletService.debit("student", amount, "payout", reference, {
      userId,
      flutterwaveReference: dataBundle.reference,
      description: `Data ${network} - ${phoneNumber}`,
      payoutType: "data",
    });

    payoutRequest.flutterwaveId = dataBundle.flutterwaveId;
    payoutRequest.status = "completed";
    payoutRequest.completedAt = new Date();
    await payoutRequest.save();

    res.json({
      success: true,
      message: `Data bundle sent to ${phoneNumber}`,
      data: {
        reference,
        phoneNumber,
        network,
      },
    });
  } catch (error) {
    console.error("Data purchase error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get list of banks
router.get("/banks", async (req, res) => {
  try {
    const result = await flutterwaveService.getBanks();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch banks",
    });
  }
});

// Get user's payout history
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const payouts = await PayoutRequest.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await PayoutRequest.countDocuments({
      userId: req.user.userId,
    });

    res.json({
      success: true,
      data: {
        payouts,
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
});

// Webhook handler for Flutterwave
router.post("/webhooks/flutterwave", async (req, res) => {
  const secretHash = process.env.FLW_SECRET_KEY;
  const signature = req.headers["verif-hash"];

  if (!signature || signature !== secretHash) {
    return res.status(401).end();
  }

  const payload = req.body;

  try {
    if (payload.event === "transfer.completed") {
      const payout = await PayoutRequest.findOne({
        reference: payload.data.reference,
      });

      if (payout) {
        payout.status = "completed";
        payout.completedAt = new Date();
        await payout.save();
      }
    } else if (payload.event === "transfer.failed") {
      const payout = await PayoutRequest.findOne({
        reference: payload.data.reference,
      });

      if (payout) {
        payout.status = "failed";
        payout.errorMessage = payload.data.complete_message;
        await payout.save();

        // Refund points to user
        const user = await User.findById(payout.userId);
        if (user) {
          user.points += payout.pointsConverted;
          await user.save();
        }

        // Credit wallet back
        await walletService.credit(
          "student",
          payout.amount,
          "refund",
          `REFUND_${payout.reference}`,
          {
            userId: payout.userId,
            description: `Refund for failed payout ${payout.reference}`,
          }
        );
      }
    }

    res.status(200).end();
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).end();
  }
});

module.exports = router;
