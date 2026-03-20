// ==========================================
// TRANSACTIONS ROUTER (routes/transactions.js)
// ==========================================
const express = require("express");
const router = express.Router();
const WalletTransaction = require("../models/WalletTransaction");
const PayoutRequest = require("../models/PayoutRequest");
const adminMiddleware = require("../middlewares/adminRoutes");
const managerMiddleware = require("../middlewares/managerAuth");

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Parse a pagination query into { page, limit, skip }.
 * Clamps page ≥ 1 and limit to [1, 100].
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Parse a date range from query strings (startDate / endDate).
 * Returns a MongoDB $gte/$lte object or undefined.
 */
const parseDateRange = (query) => {
  const { startDate, endDate } = query;
  if (!startDate && !endDate) return undefined;
  const range = {};
  if (startDate) range.$gte = new Date(startDate);
  if (endDate) {
    // include the full end day
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
};

// =============================================================================
// GET /transactions/wallet
// Fetch wallet transactions with pagination + filters (admin/manager only)
//
// Query params:
//   page         number   default 1
//   limit        number   default 20, max 100
//   accountType  string   "school" | "student" | "guru"
//   transType    string   "credit" | "debit" | "points"
//   category     string   "subscription" | "payout" | "refund" | "transfer" | "adjustment"
//   status       string   "pending" | "completed" | "failed"
//   search       string   matches reference or description (case-insensitive)
//   startDate    ISO date
//   endDate      ISO date
//   sortBy       string   "createdAt" | "amount"  default "createdAt"
//   sortOrder    string   "asc" | "desc"           default "desc"
// =============================================================================
router.get("/wallet", managerMiddleware, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const {
      accountType,
      transType,
      category,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};

    if (accountType) filter.accountType = accountType;
    if (transType) filter.transactionType = transType;
    if (category) filter.category = category;
    if (status) filter.status = status;

    const dateRange = parseDateRange(req.query);
    if (dateRange) filter.createdAt = dateRange;

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [{ reference: regex }, { description: regex }];
    }

    const allowedSortFields = ["createdAt", "amount"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .populate("userId", "firstName lastName email username")
        .populate("schoolId", "name")
        .lean(),
      WalletTransaction.countDocuments(filter),
    ]);

    // Summary stats for the current filtered result set
    const summaryAgg = await WalletTransaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          totalCredits: {
            $sum: {
              $cond: [{ $eq: ["$transactionType", "credit"] }, "$amount", 0],
            },
          },
          totalDebits: {
            $sum: {
              $cond: [{ $eq: ["$transactionType", "debit"] }, "$amount", 0],
            },
          },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
        },
      },
    ]);

    const summary = summaryAgg[0] || {
      totalAmount: 0,
      totalCredits: 0,
      totalDebits: 0,
      completedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    };
    delete summary._id;

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
        summary,
      },
    });
  } catch (error) {
    console.error("Wallet transactions fetch error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// GET /transactions/payouts
// Fetch payout requests with pagination + filters (admin/manager only)
//
// Query params:
//   page        number   default 1
//   limit       number   default 20, max 100
//   payoutType  string   "withdrawal" | "airtime" | "data"
//   status      string   "pending" | "processing" | "completed" | "failed"
//   search      string   matches reference, accountName, phoneNumber (case-insensitive)
//   startDate   ISO date
//   endDate     ISO date
//   sortBy      string   "createdAt" | "amount"  default "createdAt"
//   sortOrder   string   "asc" | "desc"           default "desc"
//   minAmount   number
//   maxAmount   number
// =============================================================================
router.get("/payouts", managerMiddleware, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const {
      payoutType,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      minAmount,
      maxAmount,
    } = req.query;

    const filter = {};

    if (payoutType) filter.payoutType = payoutType;
    if (status) filter.status = status;

    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = parseFloat(minAmount);
      if (maxAmount) filter.amount.$lte = parseFloat(maxAmount);
    }

    const dateRange = parseDateRange(req.query);
    if (dateRange) filter.createdAt = dateRange;

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { reference: regex },
        { accountName: regex },
        { phoneNumber: regex },
        { accountNumber: regex },
      ];
    }

    const allowedSortFields = ["createdAt", "amount"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [payouts, total] = await Promise.all([
      PayoutRequest.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .populate("userId", "firstName lastName email username")
        .lean(),
      PayoutRequest.countDocuments(filter),
    ]);

    // Summary stats
    const summaryAgg = await PayoutRequest.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          totalPoints: { $sum: "$pointsConverted" },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          pendingCount: {
            $sum: {
              $cond: [{ $in: ["$status", ["pending", "processing"]] }, 1, 0],
            },
          },
          withdrawalCount: {
            $sum: {
              $cond: [{ $eq: ["$payoutType", "withdrawal"] }, 1, 0],
            },
          },
          airtimeCount: {
            $sum: { $cond: [{ $eq: ["$payoutType", "airtime"] }, 1, 0] },
          },
          dataCount: {
            $sum: { $cond: [{ $eq: ["$payoutType", "data"] }, 1, 0] },
          },
        },
      },
    ]);

    const summary = summaryAgg[0] || {
      totalAmount: 0,
      totalPoints: 0,
      completedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      withdrawalCount: 0,
      airtimeCount: 0,
      dataCount: 0,
    };
    delete summary._id;

    res.json({
      success: true,
      data: {
        payouts,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
        summary,
      },
    });
  } catch (error) {
    console.error("Payout requests fetch error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// GET /transactions/wallet/:reference
// Single wallet transaction detail
// =============================================================================
router.get("/wallet/:reference", managerMiddleware, async (req, res) => {
  try {
    const tx = await WalletTransaction.findOne({
      reference: req.params.reference,
    })
      .populate("userId", "firstName lastName email username")
      .populate("schoolId", "name")
      .lean();

    if (!tx) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    res.json({ success: true, data: tx });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// GET /transactions/payouts/:reference
// Single payout request detail
// =============================================================================
router.get("/payouts/:reference", managerMiddleware, async (req, res) => {
  try {
    const payout = await PayoutRequest.findOne({
      reference: req.params.reference,
    })
      .populate("userId", "firstName lastName email username")
      .lean();

    if (!payout) {
      return res
        .status(404)
        .json({ success: false, message: "Payout request not found" });
    }

    res.json({ success: true, data: payout });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
