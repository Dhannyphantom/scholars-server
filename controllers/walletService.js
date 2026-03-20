// ==========================================
// WALLET SERVICE (services/walletService.js)
// ==========================================
const WalletAccount = require("../models/WalletAccount");
const WalletTransaction = require("../models/WalletTransaction");
// const mongoose = require("mongoose");

class WalletService {
  // Initialize wallets (run once on app startup)
  async initializeWallets() {
    const wallets = ["school", "student", "guru"];

    for (const walletType of wallets) {
      await WalletAccount.findOneAndUpdate(
        { accountType: walletType },
        {
          accountType: walletType,
          $setOnInsert: { balance: 0, totalCredits: 0, totalDebits: 0 },
        },
        { upsert: true, new: true },
      );
    }
  }

  // Get wallet balance
  async getBalance(accountType) {
    const wallet = await WalletAccount.findOne({ accountType });
    return wallet?.balance || 0;
  }

  // Get all wallet balances
  async getAllBalances() {
    const wallets = await WalletAccount.find({});

    const defaultWallet = { balance: 0, totalCredits: 0, totalDebits: 0 };

    const schoolWallet =
      wallets.find((w) => w.accountType === "school") || defaultWallet;
    const studentWallet =
      wallets.find((w) => w.accountType === "student") || defaultWallet;
    const guruWallet =
      wallets.find((w) => w.accountType === "guru") || defaultWallet;

    const formatWallet = (w) => ({
      balance: w.balance,
      totalCredits: w.totalCredits,
      totalDebits: w.totalDebits,
    });

    return {
      school: formatWallet(schoolWallet),
      student: formatWallet(studentWallet),
      guru: formatWallet(guruWallet),
    };
  }

  // Credit wallet (add money)
  async credit(accountType, amount, category, reference, metadata = {}) {
    try {
      // Check for duplicate transaction
      const existingTx = await WalletTransaction.findOne({ reference });
      if (existingTx) {
        console.log(`Transaction ${reference} already exists`);
        return {
          success: true,
          transaction: existingTx,
          newBalance: existingTx.balanceAfter,
        };
      }

      // Get wallet with retry logic for race conditions
      let wallet = await WalletAccount.findOne({ accountType });

      if (!wallet) {
        throw new Error(`Wallet ${accountType} not found`);
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + parseFloat(amount);

      // Create transaction record first
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
        schoolId: metadata.schoolId,
        description: metadata.description || `Credit: ${category}`,
        metadata,
        status: "completed",
      });

      await transaction.save();

      // Update wallet balance
      wallet.balance = balanceAfter;
      wallet.totalCredits += parseFloat(amount);
      await wallet.save();

      return {
        success: true,
        transaction,
        newBalance: balanceAfter,
      };
    } catch (error) {
      // If transaction was created but wallet update failed, mark as failed
      if (error.code !== 11000) {
        // Not a duplicate key error
        await WalletTransaction.findOneAndUpdate(
          { reference },
          { status: "failed", metadata: { ...metadata, error: error.message } },
        );
      }
      throw error;
    }
  }

  // Debit wallet (remove money)
  async debit(accountType, amount, category, reference, metadata = {}) {
    try {
      // Check for duplicate transaction
      const existingTx = await WalletTransaction.findOne({ reference });
      if (existingTx) {
        console.log(`Transaction ${reference} already exists`);
        return {
          success: true,
          transaction: existingTx,
          newBalance: existingTx.balanceAfter,
        };
      }

      // Get wallet
      let wallet = await WalletAccount.findOne({ accountType });

      if (!wallet) {
        throw new Error(`Wallet ${accountType} not found`);
      }

      const balanceBefore = wallet.balance;
      const amountToDebit = parseFloat(amount);

      if (balanceBefore < amountToDebit) {
        throw new Error(`Insufficient balance in ${accountType} wallet`);
      }

      const balanceAfter = balanceBefore - amountToDebit;

      // Create transaction record first
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

      await transaction.save();

      // Update wallet balance
      wallet.balance = balanceAfter;
      wallet.totalDebits += amountToDebit;
      await wallet.save();

      return {
        success: true,
        transaction,
        newBalance: balanceAfter,
      };
    } catch (error) {
      // If transaction was created but wallet update failed, mark as failed
      if (error.code !== 11000) {
        // Not a duplicate key error
        await WalletTransaction.findOneAndUpdate(
          { reference },
          { status: "failed", metadata: { ...metadata, error: error.message } },
        );
      }
      throw error;
    }
  }

  // Transfer funds between wallets
  async transferFunds(
    fromAccountType,
    toAccountType,
    amount,
    reference,
    metadata = {},
  ) {
    const VALID_WALLETS = ["school", "student", "guru"];
    const amountToTransfer = parseFloat(amount);

    // --- Validations ---
    if (!VALID_WALLETS.includes(fromAccountType)) {
      throw new Error(`Invalid source wallet: ${fromAccountType}`);
    }
    if (!VALID_WALLETS.includes(toAccountType)) {
      throw new Error(`Invalid destination wallet: ${toAccountType}`);
    }
    if (fromAccountType === toAccountType) {
      throw new Error("Source and destination wallets must be different");
    }
    if (isNaN(amountToTransfer) || amountToTransfer <= 0) {
      throw new Error("Transfer amount must be a positive number");
    }

    const debitReference = `${reference}-debit`;
    const creditReference = `${reference}-credit`;

    // Check for duplicate transfer
    const existingDebit = await WalletTransaction.findOne({
      reference: debitReference,
    });
    if (existingDebit) {
      console.log(`Transfer ${reference} already exists`);
      const existingCredit = await WalletTransaction.findOne({
        reference: creditReference,
      });
      return {
        success: true,
        debitTransaction: existingDebit,
        creditTransaction: existingCredit,
        fromBalance: existingDebit.balanceAfter,
      };
    }

    // Fetch both wallets
    const fromWallet = await WalletAccount.findOne({
      accountType: fromAccountType,
    });
    const toWallet = await WalletAccount.findOne({
      accountType: toAccountType,
    });

    if (!fromWallet) throw new Error(`Wallet ${fromAccountType} not found`);
    if (!toWallet) throw new Error(`Wallet ${toAccountType} not found`);

    if (fromWallet.balance < amountToTransfer) {
      throw new Error(`Insufficient balance in ${fromAccountType} wallet`);
    }

    const transferMetadata = {
      ...metadata,
      transferFrom: fromAccountType,
      transferTo: toAccountType,
      description:
        metadata.description ||
        `Transfer from ${fromAccountType} to ${toAccountType}`,
    };

    // --- Debit the source wallet ---
    const fromBalanceBefore = fromWallet.balance;
    const fromBalanceAfter = fromBalanceBefore - amountToTransfer;

    const debitTransaction = new WalletTransaction({
      accountType: fromAccountType,
      transactionType: "debit",
      category: "transfer",
      amount: amountToTransfer,
      balanceBefore: fromBalanceBefore,
      balanceAfter: fromBalanceAfter,
      reference: debitReference,
      userId: metadata.userId,
      description: `Transfer to ${toAccountType} wallet`,
      metadata: transferMetadata,
      status: "completed",
    });

    await debitTransaction.save();

    fromWallet.balance = fromBalanceAfter;
    fromWallet.totalDebits += amountToTransfer;
    await fromWallet.save();

    // --- Credit the destination wallet ---
    const toBalanceBefore = toWallet.balance;
    const toBalanceAfter = toBalanceBefore + amountToTransfer;

    const creditTransaction = new WalletTransaction({
      accountType: toAccountType,
      transactionType: "credit",
      category: "transfer",
      amount: amountToTransfer,
      balanceBefore: toBalanceBefore,
      balanceAfter: toBalanceAfter,
      reference: creditReference,
      userId: metadata.userId,
      description: `Transfer from ${fromAccountType} wallet`,
      metadata: transferMetadata,
      status: "completed",
    });

    await creditTransaction.save();

    toWallet.balance = toBalanceAfter;
    toWallet.totalCredits += amountToTransfer;
    await toWallet.save();

    return {
      success: true,
      debitTransaction,
      creditTransaction,
      fromBalance: fromBalanceAfter,
      toBalance: toBalanceAfter,
    };
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
      transactionType: { $in: ["credit", "debit"] },
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

  // Get transaction by reference
  async getTransactionByReference(reference) {
    try {
      const transaction = await WalletTransaction.findOne({ reference });
      return transaction;
    } catch (error) {
      console.error("Error fetching transaction:", error);
      return null;
    }
  }

  // Get transactions with userId filter
  async getTransactionsByUser(accountType, userId, options = {}) {
    const { limit = 50, skip = 0, category } = options;

    const query = { accountType, userId };
    if (category) query.category = category;

    const transactions = await WalletTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    const total = await WalletTransaction.countDocuments(query);

    return {
      transactions,
      total,
      page: Math.floor(skip / limit) + 1,
      pages: Math.ceil(total / limit),
    };
  }
}

module.exports = new WalletService();
