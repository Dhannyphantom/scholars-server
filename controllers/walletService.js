// ==========================================
// WALLET SERVICE (services/walletService.js)
// ==========================================
const WalletAccount = require("../models/WalletAccount");
const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");

class WalletService {
  // Initialize wallets (run once on app startup)
  async initializeWallets() {
    const wallets = ["school", "student"];

    for (const walletType of wallets) {
      await WalletAccount.findOneAndUpdate(
        { accountType: walletType },
        {
          accountType: walletType,
          $setOnInsert: { balance: 0, totalCredits: 0, totalDebits: 0 },
        },
        { upsert: true, new: true }
      );
    }

    console.log("Wallets initialized");
  }

  // Get wallet balance
  async getBalance(accountType) {
    const wallet = await WalletAccount.findOne({ accountType });
    return wallet?.balance || 0;
  }

  // Get both wallet balances
  async getAllBalances() {
    const wallets = await WalletAccount.find({});

    const schoolWallet = wallets.find((w) => w.accountType === "school") || {
      balance: 0,
      totalCredits: 0,
      totalDebits: 0,
    };
    const studentWallet = wallets.find((w) => w.accountType === "student") || {
      balance: 0,
      totalCredits: 0,
      totalDebits: 0,
    };

    return {
      school: {
        balance: schoolWallet.balance,
        totalCredits: schoolWallet.totalCredits,
        totalDebits: schoolWallet.totalDebits,
      },
      student: {
        balance: studentWallet.balance,
        totalCredits: studentWallet.totalCredits,
        totalDebits: studentWallet.totalDebits,
      },
    };
  }

  // Credit wallet (add money)
  async credit(accountType, amount, category, reference, metadata = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await WalletAccount.findOne({ accountType }).session(
        session
      );

      if (!wallet) {
        throw new Error(`Wallet ${accountType} not found`);
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + parseFloat(amount);

      // Update wallet
      wallet.balance = balanceAfter;
      wallet.totalCredits += parseFloat(amount);
      await wallet.save({ session });

      // Create transaction record
      const transaction = new WalletTransaction({
        accountType,
        transactionType: "credit",
        category,
        amount: parseFloat(amount),
        balanceBefore,
        balanceAfter,
        reference,
        flutterwaveReference: metadata.flutterwaveReference,
        userId: metadata.userId,
        description: metadata.description || `Credit: ${category}`,
        metadata,
        status: "completed",
      });

      await transaction.save({ session });
      await session.commitTransaction();

      return {
        success: true,
        transaction,
        newBalance: balanceAfter,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Debit wallet (remove money)
  async debit(accountType, amount, category, reference, metadata = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await WalletAccount.findOne({ accountType }).session(
        session
      );

      if (!wallet) {
        throw new Error(`Wallet ${accountType} not found`);
      }

      const balanceBefore = wallet.balance;
      const amountToDebit = parseFloat(amount);

      if (balanceBefore < amountToDebit) {
        throw new Error(`Insufficient balance in ${accountType} wallet`);
      }

      const balanceAfter = balanceBefore - amountToDebit;

      // Update wallet
      wallet.balance = balanceAfter;
      wallet.totalDebits += amountToDebit;
      await wallet.save({ session });

      // Create transaction record
      const transaction = new WalletTransaction({
        accountType,
        transactionType: "debit",
        category,
        amount: amountToDebit,
        balanceBefore,
        balanceAfter,
        reference,
        flutterwaveReference: metadata.flutterwaveReference,
        userId: metadata.userId,
        description: metadata.description || `Debit: ${category}`,
        metadata,
        status: "completed",
      });

      await transaction.save({ session });
      await session.commitTransaction();

      return {
        success: true,
        transaction,
        newBalance: balanceAfter,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Get transaction history
  async getTransactions(accountType, options = {}) {
    const { limit = 50, skip = 0, startDate, endDate, status } = options;

    const query = { accountType };

    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await WalletTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate("userId", "name email");

    const total = await WalletTransaction.countDocuments(query);

    return {
      transactions,
      total,
      page: Math.floor(skip / limit) + 1,
      pages: Math.ceil(total / limit),
    };
  }

  // Reconcile wallet (verify balance matches transactions)
  async reconcile(accountType) {
    const transactions = await WalletTransaction.find({
      accountType,
      status: "completed",
    });

    let calculatedBalance = 0;
    let totalCredits = 0;
    let totalDebits = 0;

    transactions.forEach((tx) => {
      if (tx.transactionType === "credit") {
        calculatedBalance += tx.amount;
        totalCredits += tx.amount;
      } else {
        calculatedBalance -= tx.amount;
        totalDebits += tx.amount;
      }
    });

    const wallet = await WalletAccount.findOne({ accountType });
    const actualBalance = wallet?.balance || 0;

    return {
      accountType,
      actualBalance,
      calculatedBalance,
      difference: actualBalance - calculatedBalance,
      totalCredits,
      totalDebits,
      isBalanced: Math.abs(actualBalance - calculatedBalance) < 0.01,
    };
  }
}

module.exports = new WalletService();
