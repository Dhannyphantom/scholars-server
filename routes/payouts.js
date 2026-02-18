// ==========================================
// PAYOUT ROUTES (routes/payouts.js)
// ==========================================
const express = require("express");
const router = express.Router();
const walletService = require("../controllers/walletService");
const flutterwaveService = require("../controllers/flutterwaveService");
const PayoutRequest = require("../models/PayoutRequest");

// Middleware to verify user authentication
const authMiddleware = require("../middlewares/authRoutes");
const adminMiddleware = require("../middlewares/adminRoutes");
const { User } = require("../models/User");
const { getFullName } = require("../controllers/helpers");
const PhoneValidator = require("../controllers/phoneValidation");
const { School } = require("../models/School");

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
      accountBank,
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
      callbackUrl: `${process.env.BASE_URL}/payouts/webhooks/flutterwave`,
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

    // Validate input
    if (!pointsToConvert || !phoneNumber || !network) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // ✅ VALIDATE PHONE NUMBER AND NETWORK MATCH
    const validation = PhoneValidator.validatePhoneNetwork(
      phoneNumber,
      network,
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error,
        detectedNetwork: validation.detectedNetwork,
        suggestion: validation.detectedNetwork
          ? `Did you mean to select ${validation.detectedNetwork}?`
          : null,
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
      phoneNumber: validation.normalizedPhone, // Use normalized phone
      network: network.toUpperCase(),
      reference,
      status: "processing",
    });

    await payoutRequest.save();

    // Send airtime with normalized phone number
    const airtime = await flutterwaveService.sendAirtime({
      phoneNumber: validation.normalizedPhone,
      network: network.toUpperCase(),
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
      description: `Airtime ${network} - ${validation.normalizedPhone}`,
      payoutType: "airtime",
    });

    // Update payout
    payoutRequest.flutterwaveId = airtime.flutterwaveId;
    payoutRequest.status = "completed";
    payoutRequest.completedAt = new Date();
    await payoutRequest.save();

    res.json({
      success: true,
      message: `₦${amount.toFixed(2)} ${network} airtime sent to ${
        validation.normalizedPhone
      }`,
      data: {
        reference,
        amount,
        phoneNumber: validation.normalizedPhone,
        network: network.toUpperCase(),
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
    const {
      pointsToConvert,
      phoneNumber,
      network,
      billerCode, // e.g., BIL104
      itemCode, // e.g., MD107
      bundleName, // e.g., "MTN 1.5 GB"
      bundleAmount, // e.g., 1000
    } = req.body;

    const userId = req.user.userId;

    // Validate
    if (
      !pointsToConvert ||
      !phoneNumber ||
      !network ||
      !billerCode ||
      !itemCode
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Validate phone and network
    const validation = PhoneValidator.validatePhoneNetwork(
      phoneNumber,
      network,
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error,
        detectedNetwork: validation.detectedNetwork,
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
        message: "Insufficient wallet balance",
      });
    }

    const reference = `GURU_DATA_${Date.now()}_${userId}`;

    const payoutRequest = new PayoutRequest({
      userId,
      pointsConverted: pointsToConvert,
      amount,
      payoutType: "data",
      phoneNumber: validation.normalizedPhone,
      network: network.toUpperCase(),
      bundleCode: itemCode,
      reference,
      status: "processing",
    });

    await payoutRequest.save();

    // Purchase data bundle
    const dataBundle = await flutterwaveService.sendDataBundle({
      phoneNumber: validation.normalizedPhone,
      network: network.toUpperCase(),
      amount: bundleAmount,
      billerCode: billerCode,
      itemCode: itemCode,
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
      description: `Data ${network} ${bundleName} - ${validation.normalizedPhone}`,
      payoutType: "data",
    });

    payoutRequest.flutterwaveId = dataBundle.flutterwaveId;
    payoutRequest.status = "completed";
    payoutRequest.completedAt = new Date();
    await payoutRequest.save();

    res.json({
      success: true,
      message: `${bundleName} data bundle sent to ${validation.normalizedPhone}`,
      data: {
        reference,
        phoneNumber: validation.normalizedPhone,
        network: network.toUpperCase(),
        bundle: bundleName,
        amount,
      },
    });
  } catch (error) {
    console.log("Data purchase error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add to routes/payouts.js

// Get available data bundles for a network
router.get("/data-bundles/:network", async (req, res) => {
  try {
    const { network } = req.params;

    const result = await flutterwaveService.getDataBundles(network);

    if (result.success) {
      res.json({
        success: true,
        data: {
          network: network.toUpperCase(),
          bundles: result.bundles,
        },
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all data bundles for all networks (optional)
router.get("/data-bundles", async (req, res) => {
  try {
    const networks = ["MTN", "GLO", "AIRTEL", "9MOBILE"];
    const allBundles = {};

    for (const network of networks) {
      const result = await flutterwaveService.getDataBundles(network);
      if (result.success) {
        allBundles[network] = result.bundles;
      }
    }

    res.json({
      success: true,
      data: allBundles,
    });
  } catch (error) {
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
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers["verif-hash"];

  if (!signature || signature !== secretHash) {
    console.error("Invalid webhook signature");
    return res.status(401).end();
  }

  const payload = req.body;
  const eventType = payload.event;

  try {
    switch (eventType) {
      // ===================================
      // SUBSCRIPTION PAYMENTS (charge.completed)
      // ===================================
      case "charge.completed":
        await handleChargeCompleted(payload);
        break;

      // ===================================
      // WITHDRAWALS (transfer events)
      // ===================================
      case "transfer.completed":
        await handleTransferCompleted(payload);
        break;

      case "transfer.failed":
        await handleTransferFailed(payload);
        break;

      case "transfer.reversed":
        await handleTransferFailed(payload); // Treat same as failed
        break;

      // ===================================
      // AIRTIME/DATA (bill payment events)
      // ===================================
      case "billpayment.completed":
        await handleBillPaymentCompleted(payload);
        break;

      case "billpayment.failed":
        await handleBillPaymentFailed(payload);
        break;
    }

    res.status(200).end();
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).end();
  }
});

// -====================== SUBSCRIPTION =============================================-
router.post("/verify-subscription", authMiddleware, async (req, res) => {
  try {
    const { transaction_id, tx_ref, status } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!transaction_id || !tx_ref) {
      return res.status(400).json({
        success: false,
        message: "Missing transaction details",
      });
    }

    // Check if transaction already processed
    const existingTransaction =
      await walletService.getTransactionByReference(tx_ref);
    if (existingTransaction) {
      return res.json({
        success: true,
        message: "Transaction already processed",
        data: {
          pointsAdded: existingTransaction.metadata?.pointsAdded || 0,
          walletCredited: existingTransaction.metadata?.walletCredited || 0,
        },
      });
    }

    // Verify transaction with Flutterwave
    const verification =
      await flutterwaveService.verifyTransaction(transaction_id);

    if (!verification.success) {
      return res.status(400).json({
        success: false,
        message: "Transaction verification failed",
        error: verification.error,
      });
    }

    const transactionData = verification.data;

    // Check if payment was successful
    if (transactionData.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment was not successful",
        status: transactionData.status,
      });
    }

    // Get payment details
    const amount = parseFloat(transactionData.amount);
    const accountType = transactionData.meta?.account_type || "student"; // Default to student
    const user = await User.findById(userId);
    const days = transactionData.meta?.days;
    const schoolId = transactionData.meta?.schoolId;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Credit appropriate wallet
    await walletService.credit(accountType, amount, "subscription", tx_ref, {
      flutterwaveReference: transaction_id,
      userId,
      schoolId,
      customerEmail: transactionData.customer?.email || user.email,
      customerName: transactionData.customer?.name || getFullName(user),
      description: `${
        accountType === "school" ? "School" : "Student"
      } subscription payment`,
      pointsAdded: accountType === "student" ? amount * 10 : 0, // 1 NGN = 10 points
      walletCredited: amount,
      days,
    });

    // If student payment, extend user sub

    if (accountType === "student") {
      const today = new Date();
      const millisToAdd = days * 24 * 60 * 60 * 1000;

      let startDate;

      if (user.subscription?.expiry && today < user.subscription.expiry) {
        startDate = new Date(user.subscription.expiry);
      } else {
        startDate = today;
        user.subscription.current = today;
      }

      const newExpiry = new Date(startDate.getTime() + millisToAdd);

      user.subscription.expiry = newExpiry;
      user.subscription.current = today;
      user.subscription.isActive = true;

      await user.save();
    } else if (accountType === "school") {
      // School Sub
      const schoolData = await School.findById(schoolId);

      const today = new Date();
      const millisToAdd = days * 24 * 60 * 60 * 1000;

      let startDate;

      if (
        schoolData?.subscription?.expiry &&
        today < schoolData.subscription.expiry
      ) {
        startDate = new Date(schoolData?.subscription?.expiry);
      } else {
        startDate = today;
        schoolData.subscription.current = today;
      }

      const newExpiry = new Date(startDate.getTime() + millisToAdd);

      schoolData.subscription.expiry = newExpiry;
      schoolData.subscription.current = today;
      schoolData.subscription.isActive = true;

      const schoolObj = schoolData.toObject();
      const teacherIds = schoolObj.teachers.map((teach) => teach.user);
      schoolData.teachers = schoolObj?.teachers?.map((teacher) => {
        if (
          teacher?.user?.toString() === schoolObj.rep?.toString() &&
          !teacher.verified
        ) {
          return {
            ...teacher,
            verified: true,
          };
        } else {
          return teacher;
        }
      });

      await schoolData.save();
      await User.updateMany(
        { _id: { $in: teacherIds } },
        {
          $set: {
            subscription: schoolObj.subscription,
          },
        },
      );
    }

    res.json({
      success: true,
      message: "Subscription payment verified successfully",
      data: {
        amount,
        accountType,
        days,
        // pointsAdded,
        // currentPoints: user.points,
        transactionRef: tx_ref,
        flutterwaveId: transaction_id,
      },
    });
  } catch (error) {
    console.error("Subscription verification error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ==========================================
// GET SUBSCRIPTION PACKAGES
// Return available subscription packages
// ==========================================
router.get("/subscription-packages", async (req, res) => {
  try {
    const packages = [
      {
        id: "student_monthly",
        name: "Student Monthly",
        description: "Access all features for 1 month",
        amount: 1000, // NGN
        points: 10000, // Points received (1 NGN = 10 points)
        duration: "30 days",
        accountType: "student",
      },
      {
        id: "student_quarterly",
        name: "Student Quarterly",
        description: "Access all features for 3 months + 10% bonus",
        amount: 2700, // NGN (10% discount)
        points: 27000,
        duration: "90 days",
        accountType: "student",
        savings: 300,
      },
      {
        id: "student_yearly",
        name: "Student Yearly",
        description: "Access all features for 1 year + 20% bonus",
        amount: 9600, // NGN (20% discount)
        points: 96000,
        duration: "365 days",
        accountType: "student",
        savings: 2400,
      },
      {
        id: "school_annual",
        name: "School Annual License",
        description: "Full school access for 1 year",
        amount: 50000, // NGN
        duration: "365 days",
        accountType: "school",
        features: [
          "Unlimited student accounts",
          "Admin dashboard",
          "Analytics & Reports",
          "Priority support",
        ],
      },
    ];

    res.json({
      success: true,
      data: packages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ==========================================
// GET USER SUBSCRIPTION STATUS
// ==========================================
router.get("/subscription-status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get recent subscription transactions
    const recentSubscriptions = await walletService.getTransactions("student", {
      limit: 5,
      userId: userId,
      category: "subscription",
    });

    res.json({
      success: true,
      data: {
        currentPoints: user.points || 0,
        equivalentAmount: pointsToAmount(user.points || 0),
        recentSubscriptions: recentSubscriptions.transactions,
        subscriptionActive: user.subscription.isActive || false,
        subscriptionExpiry: user.subscription.expiry || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Handle subscription payments
async function handleChargeCompleted(payload) {
  const data = payload.data;
  const {
    id: transactionId,
    tx_ref: reference,
    amount,
    customer,
    status,
    meta,
  } = data;

  if (status !== "successful") {
    return;
  }

  // Check if already processed (idempotency)
  const existingTx = await WalletTransaction.findOne({ reference });
  if (existingTx) {
    return;
  }

  const accountType = meta?.account_type || "student";
  const userId = meta?.user_id;

  // Credit appropriate wallet
  await walletService.credit(accountType, amount, "subscription", reference, {
    flutterwaveReference: transactionId,
    userId,
    customerEmail: customer?.email,
    customerName: customer?.name,
    description: `${
      accountType === "school" ? "School" : "Student"
    } subscription payment`,
    pointsAdded: accountType === "student" ? amount * 10 : 0,
    walletCredited: amount,
  });

  // If student payment, credit user points
  if (accountType === "student" && userId) {
    const user = await User.findById(userId);
    if (user) {
      const pointsToAdd = amount * 10; // 1 NGN = 10 points
      user.points = (user.points || 0) + pointsToAdd;
      await user.save();
    }
  }
}

// Handle successful withdrawals
async function handleTransferCompleted(payload) {
  const data = payload.data;
  const { id: transferId, reference, amount } = data;

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    return;
  }

  payout.status = "completed";
  payout.completedAt = new Date();
  payout.flutterwaveId = transferId;
  await payout.save();
}

// Handle failed withdrawals
async function handleTransferFailed(payload) {
  const data = payload.data;
  const { reference, amount, complete_message } = data;

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    return;
  }

  payout.status = "failed";
  payout.errorMessage = complete_message;
  await payout.save();

  // Refund points to user
  if (payout.userId) {
    const user = await User.findById(payout.userId);
    if (user) {
      user.points = (user.points || 0) + payout.pointsConverted;
      await user.save();
    }
  }

  // Credit student wallet back (refund)
  await walletService.credit(
    "student",
    payout.amount,
    "refund",
    `REFUND_${reference}`,
    {
      userId: payout.userId,
      description: `Refund for failed withdrawal: ${complete_message}`,
      originalReference: reference,
    },
  );
}

// Handle successful airtime/data
async function handleBillPaymentCompleted(payload) {
  const data = payload.data;
  const { reference, amount, product_name } = data;

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    return;
  }

  payout.status = "completed";
  payout.completedAt = new Date();
  await payout.save();
}

// Handle failed airtime/data
async function handleBillPaymentFailed(payload) {
  const data = payload.data;
  const { reference, amount, response_message } = data;

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    return;
  }

  payout.status = "failed";
  payout.errorMessage = response_message;
  await payout.save();

  // Refund points to user
  if (payout.userId) {
    const user = await User.findById(payout.userId);
    if (user) {
      user.points = (user.points || 0) + payout.pointsConverted;
      await user.save();
    }
  }

  // Credit student wallet back (refund)
  await walletService.credit(
    "student",
    payout.amount,
    "refund",
    `REFUND_${reference}`,
    {
      userId: payout.userId,
      description: `Refund for failed ${payout.payoutType}: ${response_message}`,
      originalReference: reference,
    },
  );
}

module.exports = router;
