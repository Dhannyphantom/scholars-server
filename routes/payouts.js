// ==========================================
// PAYOUT / SUBSCRIPTION ROUTES (routes/payouts.js)  — mounted at /payouts
// ==========================================
const express = require("express");
const router = express.Router();

const walletService = require("../controllers/walletService");
const flutterwaveService = require("../controllers/flutterwaveService");
const PayoutRequest = require("../models/PayoutRequest");
const PaymentIntent = require("../models/PaymentIntent");

const authMiddleware = require("../middlewares/authRoutes");
const adminMiddleware = require("../middlewares/adminRoutes");
const managerMiddleware = require("../middlewares/managerAuth");
const { User } = require("../models/User");

const payoutService = require("../controllers/payoutService");
const subscriptionService = require("../controllers/subscriptionService");
const pendingService = require("../controllers/pendingService");

const { PayoutError } = payoutService;
const { SubscriptionError } = subscriptionService;

const pointsToAmount = payoutService.pointsToAmount;

// ───────────────────────── helpers ─────────────────────────

const fail500 = (res, error, label) => {
  console.error(label, error);
  return res.status(500).json({ success: false, message: error.message });
};

// ───────────────────────── wallets / points ─────────────────────────

router.get("/wallets/balances", adminMiddleware, async (req, res) => {
  try {
    res.json({ success: true, data: await walletService.getAllBalances() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

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
    res.status(500).json({ success: false, message: error.message });
  }
});

// ───────────────────────── withdrawals / airtime / data ─────────────────────────
// Body may include `idempotencyKey` (client generates ONE per attempt). Sending
// the same key again never creates a second payout or a second debit.

const payoutRoute = (type) => async (req, res) => {
  try {
    const out = await payoutService.startPayout(req.user.userId, type, req.body);
    return res.status(out.httpStatus).json(out.body);
  } catch (error) {
    if (error instanceof PayoutError) {
      return res
        .status(error.status)
        .json({ success: false, message: error.message, ...(error.extra || {}) });
    }
    console.error(`${type} payout error:`, error);
    return res.status(500).json({
      success: false,
      message:
        "Something went wrong. If any points were deducted, they will show under Pending transactions or be refunded.",
    });
  }
};

router.post("/withdraw", authMiddleware, payoutRoute("withdrawal"));
router.post("/recharge", authMiddleware, payoutRoute("airtime"));
router.post("/data", authMiddleware, payoutRoute("data"));

// ───────────────────────── data bundles / banks / history ─────────────────────────

router.get("/data-bundles/:network", async (req, res) => {
  try {
    const result = await flutterwaveService.getDataBundles(req.params.network);
    if (result.success) {
      return res.json({
        success: true,
        data: {
          network: req.params.network.toUpperCase(),
          bundles: result.bundles,
        },
      });
    }
    res.status(400).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/data-bundles", async (req, res) => {
  try {
    const networks = ["MTN", "GLO", "AIRTEL", "9MOBILE"];
    const allBundles = {};
    for (const network of networks) {
      const result = await flutterwaveService.getDataBundles(network);
      if (result.success) allBundles[network] = result.bundles;
    }
    res.json({ success: true, data: allBundles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/banks", async (req, res) => {
  try {
    res.json(await flutterwaveService.getBanks());
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch banks" });
  }
});

router.get("/history", authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const payouts = await PayoutRequest.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);
    const total = await PayoutRequest.countDocuments({ userId: req.user.userId });
    res.json({
      success: true,
      data: { payouts, total, page: parseInt(page), pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ───────────────────────── PENDING: list + retry ─────────────────────────

// GET /payouts/pending[?refresh=0]
// Re-checks everything unresolved for the caller against Flutterwave first, so
// opening the screen heals interrupted payments automatically.
router.get("/pending", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const resolved =
      req.query.refresh === "0" ? [] : await pendingService.reconcileUser(userId);
    const { items, recent } = await pendingService.listPending(userId);
    res.json({ success: true, data: { items, recent, resolved } });
  } catch (error) {
    fail500(res, error, "pending list error:");
  }
});

// POST /payouts/pending/:entity/:id/retry   (entity = subscription | payout)
// NEVER charges or debits again: it only asks Flutterwave what happened and
// finishes whatever is still outstanding.
router.post("/pending/:entity/:id/retry", authMiddleware, async (req, res) => {
  try {
    const { entity, id } = req.params;
    if (!["subscription", "payout"].includes(entity)) {
      return res.status(400).json({ success: false, message: "Unknown transaction type" });
    }
    const result = await pendingService.retryOne(req.user.userId, entity, id);
    if (!result) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    fail500(res, error, "pending retry error:");
  }
});

// POST /payouts/pending/:entity/:id/dismiss  — "I didn't pay" (unpaid subscription attempts only)
router.post("/pending/:entity/:id/dismiss", authMiddleware, async (req, res) => {
  try {
    const { entity, id } = req.params;
    const out = await pendingService.dismissOne(req.user.userId, entity, id);
    res.status(out.ok ? 200 : 400).json({ success: out.ok, message: out.message });
  } catch (error) {
    fail500(res, error, "pending dismiss error:");
  }
});

// ───────────────────────── SUBSCRIPTION ─────────────────────────

// App calls this when the user taps Pay: from now on the attempt is visible
// in the app (Pending / Recent attempts) even if everything else fails.
router.post("/subscription/started", authMiddleware, async (req, res) => {
  try {
    await subscriptionService.markStarted(req.user.userId, req.body?.tx_ref);
    res.json({ success: true });
  } catch (error) {
    fail500(res, error, "subscription started error:");
  }
});

// 1) App asks for a tx_ref BEFORE opening Flutterwave.
router.post("/subscription/intent", authMiddleware, async (req, res) => {
  try {
    const intent = await subscriptionService.createIntent(req.user.userId, req.body);
    res.json({
      success: true,
      data: {
        intentId: String(intent._id),
        tx_ref: intent.txRef,
        amount: intent.amount,
        days: intent.days,
        currency: intent.currency,
      },
    });
  } catch (error) {
    if (error instanceof SubscriptionError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    fail500(res, error, "subscription intent error:");
  }
});

// 2) App comes back from Flutterwave (any status) and asks us to confirm.
//    Always HTTP 200 with a `state`, so the app can branch without guessing
//    whether an HTTP error means "not paid" or "network trouble".
router.post("/verify-subscription", authMiddleware, async (req, res) => {
  try {
    const { transaction_id, tx_ref, status } = req.body;
    const intent = await subscriptionService.getIntentForVerify(req.user.userId, {
      tx_ref,
      transaction_id,
    });

    if (!intent) {
      return res.json({
        success: false,
        state: "not_found",
        message: "We couldn't find a payment for this attempt.",
      });
    }

    // A verify call means the user definitely started paying.
    if (!intent.initiatedAt) {
      await PaymentIntent.updateOne(
        { _id: intent._id, initiatedAt: null },
        { $set: { initiatedAt: new Date() } },
      );
    }

    const out = await subscriptionService.settleIntent(intent, {
      transactionId: transaction_id,
      clientStatus: status,
    });

    if (out.state === "fulfilled") {
      const i = out.intent;
      return res.json({
        success: true,
        state: "fulfilled",
        message: "Subscription payment verified successfully",
        data: {
          amount: i.amount,
          accountType: i.accountType,
          days: i.days,
          expiry: i.plannedExpiry,
          transactionRef: i.txRef,
          flutterwaveId: i.flwTransactionId,
        },
      });
    }

    return res.json({
      success: false,
      state: out.state,
      retryable: ["pending", "paid_unfulfilled", "busy", "unknown"].includes(out.state),
      message: out.message,
    });
  } catch (error) {
    if (error instanceof SubscriptionError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    fail500(res, error, "Subscription verification error:");
  }
});

router.get("/subscription-packages", async (req, res) => {
  const { PLANS } = require("../config/subscriptionPlans");
  res.json({
    success: true,
    data: [
      ...PLANS.student.map((p) => ({ ...p, accountType: "student" })),
      ...PLANS.school.map((p) => ({ ...p, accountType: "school" })),
    ],
  });
});

router.get("/subscription-status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    // Filtered by userId (it used to return other users' transactions).
    const recent = await walletService.getTransactionsByUser("student", userId, {
      limit: 5,
      category: "subscription",
    });
    res.json({
      success: true,
      data: {
        currentPoints: user.points || 0,
        equivalentAmount: pointsToAmount(user.points || 0),
        recentSubscriptions: recent.transactions,
        subscriptionActive: user.subscription.isActive || false,
        subscriptionExpiry: user.subscription.expiry || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Manager tool: user sends the flw_ref from their receipt.
router.post("/recover-subscription", managerMiddleware, async (req, res) => {
  try {
    const { flw_ref, userId } = req.body;
    if (!flw_ref || !userId) {
      return res.status(400).json({
        success: false,
        message: "flw_ref and userId are required",
      });
    }

    const found = await flutterwaveService.findTransactionByFlwRef(flw_ref);
    if (!found.success) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found. Please check the reference and try again.",
      });
    }
    const tx = found.data;

    let intent = await PaymentIntent.findOne({ txRef: tx.tx_ref });
    if (intent && String(intent.userId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "This transaction belongs to a different account",
      });
    }
    if (!intent) intent = await subscriptionService.createLegacyIntent(userId, tx);

    const out = await subscriptionService.settleIntent(intent, {
      transactionId: tx.id,
    });

    if (out.state !== "fulfilled") {
      return res.status(409).json({ success: false, state: out.state, message: out.message });
    }
    res.json({
      success: true,
      message: "Payment successfully recovered and applied to the account",
      data: {
        amount: out.intent.amount,
        accountType: out.intent.accountType,
        days: out.intent.days,
        transactionRef: out.intent.txRef,
        flwRef: flw_ref,
      },
    });
  } catch (error) {
    if (error instanceof SubscriptionError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    fail500(res, error, "Recovery error:");
  }
});

// ───────────────────────── webhook ─────────────────────────
// Flutterwave retries on non-200, and every handler below is idempotent, so
// it is always safe to respond 500 on an internal error.

router.post("/webhooks/flutterwave", async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== secretHash) {
    console.error("Invalid webhook signature");
    return res.status(401).end();
  }

  const { event, data = {} } = req.body || {};

  try {
    switch (event) {
      case "charge.completed": {
        // Never trust the payload: settleIntent re-verifies with Flutterwave.
        let intent = data.tx_ref
          ? await PaymentIntent.findOne({ txRef: data.tx_ref })
          : null;

        // No intent (e.g. the app used a local tx_ref): rebuild it from the
        // verified transaction. The app sends meta.user_id with every payment.
        if (!intent && data.id && /^successful$/i.test(String(data.status))) {
          const v = await flutterwaveService.verifyTransaction(data.id);
          const uid = v.ok && v.data?.tx_ref === data.tx_ref ? v.data.meta?.user_id : null;
          if (uid) {
            intent = await subscriptionService.createLegacyIntent(uid, v.data);
          } else {
            console.warn(`[webhook] payment ${data.tx_ref} has no intent and no meta.user_id`);
          }
        }
        if (intent) {
          await subscriptionService.settleIntent(intent, { transactionId: data.id });
        }
        break;
      }

      // NOTE: Flutterwave sends "transfer.completed" for FAILED transfers too;
      // the real outcome is in data.status.
      case "transfer.completed": {
        const state = /^success/i.test(String(data.status)) ? "successful"
          : /fail|revers/i.test(String(data.status)) ? "failed"
          : "pending";
        await payoutService.applyProviderResult(data.reference, state, data);
        break;
      }
      case "transfer.failed":
      case "transfer.reversed":
        await payoutService.applyProviderResult(data.reference, "failed", data);
        break;

      case "billpayment.completed":
        await payoutService.applyProviderResult(data.reference, "successful", data);
        break;
      case "billpayment.failed":
        await payoutService.applyProviderResult(data.reference, "failed", data);
        break;

      default:
        break;
    }
    res.status(200).end();
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).end();
  }
});

// ───────────────────────── admin: move money between wallets ─────────────────────────

router.post("/wallets/transfer", managerMiddleware, async (req, res) => {
  try {
    const { fromWallet, toWallet, amount, description } = req.body;
    if (!fromWallet || !toWallet || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fromWallet, toWallet, amount",
      });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be a positive number",
      });
    }

    const reference = `GURU_TRF_${Date.now()}_${req.user.userId}`;
    const result = await walletService.transferFunds(
      fromWallet,
      toWallet,
      parsedAmount,
      reference,
      {
        userId: req.user.userId,
        description:
          description || `Admin transfer from ${fromWallet} to ${toWallet}`,
        initiatedBy: req.user.userId,
      },
    );

    res.json({
      success: true,
      message: `₦${parsedAmount.toFixed(2)} successfully transferred from ${fromWallet} to ${toWallet} wallet`,
      data: {
        reference,
        fromWallet,
        toWallet,
        amount: parsedAmount,
        fromWalletBalance: result.fromBalance,
        toWalletBalance: result.toBalance,
        debitTransactionId: result.debitTransaction._id,
        creditTransactionId: result.creditTransaction._id,
      },
    });
  } catch (error) {
    console.error("Wallet transfer error:", error);
    const knownErrors = [
      "Insufficient balance",
      "Invalid source wallet",
      "Invalid destination wallet",
      "Source and destination wallets must be different",
      "Transfer amount must be a positive number",
      "not found",
    ];
    const isKnown = knownErrors.some((m) =>
      error.message.toLowerCase().includes(m.toLowerCase()),
    );
    res.status(isKnown ? 400 : 500).json({ success: false, message: error.message });
  }
});

module.exports = router;
