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
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers["verif-hash"];

  if (!signature || signature !== secretHash) {
    console.error("Invalid webhook signature");
    return res.status(401).end();
  }

  const payload = req.body;
  const eventType = payload.event;

  console.log(`Webhook received: ${eventType}`);

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

      default:
        console.log(`Unhandled event type: ${eventType}`);
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

    console.log("Verifying subscription:", { transaction_id, tx_ref, status });

    // Validate input
    if (!transaction_id || !tx_ref) {
      return res.status(400).json({
        success: false,
        message: "Missing transaction details",
      });
    }

    // Check if transaction already processed
    const existingTransaction = await walletService.getTransactionByReference(
      tx_ref
    );
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
    const verification = await flutterwaveService.verifyTransaction(
      transaction_id
    );

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

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Credit appropriate wallet
    await walletService.credit(accountType, amount, "subscription", tx_ref, {
      flutterwaveReference: transaction_id,
      userId: userId,
      customerEmail: transactionData.customer?.email || user.email,
      customerName: transactionData.customer?.name || getFullName(user),
      description: `${
        accountType === "school" ? "School" : "Student"
      } subscription payment`,
      pointsAdded: accountType === "student" ? amount * 10 : 0, // 1 NGN = 10 points
      walletCredited: amount,
    });

    // If student payment, credit user points
    // let pointsAdded = 0;
    // if (accountType === "student") {
    //   pointsAdded = amount * 10; // 1 NGN = 10 points
    //   user.points = (user.points || 0) + pointsAdded;
    //   await user.save();
    //   console.log(`Credited ${pointsAdded} points to user ${userId}`);
    // }

    res.json({
      success: true,
      message: "Subscription payment verified successfully",
      data: {
        amount,
        accountType,
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
    console.log(`Payment not successful: ${status}`);
    return;
  }

  // Check if already processed (idempotency)
  const existingTx = await WalletTransaction.findOne({ reference });
  if (existingTx) {
    console.log(`Transaction ${reference} already processed`);
    return;
  }

  const accountType = meta?.account_type || "student";
  const userId = meta?.user_id;

  console.log(`Processing ${accountType} payment: ₦${amount}`);

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

      console.log(`✓ Credited ${pointsToAdd} points to user ${userId}`);
    }
  }

  console.log(`✓ ${accountType} wallet credited with ₦${amount}`);
}

// Handle successful withdrawals
async function handleTransferCompleted(payload) {
  const data = payload.data;
  const { id: transferId, reference, amount } = data;

  console.log(`Transfer completed: ${reference}, Amount: ₦${amount}`);

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    console.log(`No payout request found for reference: ${reference}`);
    return;
  }

  payout.status = "completed";
  payout.completedAt = new Date();
  payout.flutterwaveId = transferId;
  await payout.save();

  console.log(`✓ Payout ${reference} marked as completed`);
}

// Handle failed withdrawals
async function handleTransferFailed(payload) {
  const data = payload.data;
  const { reference, amount, complete_message } = data;

  console.log(`Transfer failed: ${reference}, Reason: ${complete_message}`);

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    console.log(`No payout request found for reference: ${reference}`);
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
      console.log(`Refunded ${payout.pointsConverted} points to user`);
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
    }
  );

  console.log(`✓ Refunded ₦${amount} to student wallet`);
}

// Handle successful airtime/data
async function handleBillPaymentCompleted(payload) {
  const data = payload.data;
  const { reference, amount, product_name } = data;

  console.log(`Bill payment completed: ${reference}, Product: ${product_name}`);

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    console.log(`No payout request found for reference: ${reference}`);
    return;
  }

  payout.status = "completed";
  payout.completedAt = new Date();
  await payout.save();

  console.log(`✓ ${payout.payoutType} payout ${reference} completed`);
}

// Handle failed airtime/data
async function handleBillPaymentFailed(payload) {
  const data = payload.data;
  const { reference, amount, response_message } = data;

  console.log(`Bill payment failed: ${reference}, Reason: ${response_message}`);

  const payout = await PayoutRequest.findOne({ reference });

  if (!payout) {
    console.log(`No payout request found for reference: ${reference}`);
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
      console.log(`Refunded ${payout.pointsConverted} points to user`);
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
    }
  );

  console.log(`✓ Refunded ₦${amount} to student wallet`);
}

module.exports = router;
