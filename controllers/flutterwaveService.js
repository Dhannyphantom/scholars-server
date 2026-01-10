// ==========================================
// FLUTTERWAVE SERVICE (services/flutterwaveService.js)
// ==========================================
const axios = require("axios");

class FlutterwaveService {
  constructor() {
    this.baseUrl = "https://api.flutterwave.com/v3";
    this.secretKey = process.env.FLW_SECRET_KEY;
  }

  // Verify account number
  async verifyAccount(accountNumber, accountBank) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/accounts/resolve`,
        { account_number: accountNumber, account_bank: accountBank },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        accountName: response.data.data?.account_name,
        accountNumber: response.data.data?.account_number,
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || "Account verification failed",
      };
    }
  }

  // Initiate bank transfer
  async initiateTransfer(data) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transfers`,
        {
          account_bank: data.accountBank,
          account_number: data.accountNumber,
          amount: data.amount,
          narration: data.narration || "Guru EduTech Payout",
          currency: "NGN",
          reference: data.reference,
          callback_url: data.callbackUrl,
          debit_currency: "NGN",
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        data: response.data.data,
        reference: response.data.data?.reference,
        flutterwaveId: response.data.data?.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || "Transfer failed",
      };
    }
  }

  // Send airtime
  async sendAirtime(data) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/bills`,
        {
          country: "NG",
          customer: data.phoneNumber,
          amount: data.amount,
          recurrence: "ONCE",
          type: data.network.toUpperCase(),
          reference: data.reference,
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        data: response.data.data,
        reference: response.data.data?.reference,
        flutterwaveId: response.data.data?.flw_ref,
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || "Airtime purchase failed",
      };
    }
  }

  // Send data bundle
  async sendDataBundle(data) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/bills`,
        {
          country: "NG",
          customer: data.phoneNumber,
          amount: data.amount,
          type: "DATA_BUNDLE",
          reference: data.reference,
          biller_name: data.network.toUpperCase(),
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        data: response.data.data,
        reference: response.data.data?.reference,
        flutterwaveId: response.data.data?.flw_ref,
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || "Data purchase failed",
      };
    }
  }

  // Get banks
  async getBanks() {
    try {
      const response = await axios.get(`${this.baseUrl}/banks/NG`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });

      return {
        success: true,
        banks: response.data.data,
      };
    } catch (error) {
      return {
        success: false,
        error: "Failed to fetch banks",
      };
    }
  }

  async getTransferFee(amount) {
    const response = await axios.get(`${this.baseUrl}/transfers/fee`, {
      params: {
        amount,
        currency: "NGN",
      },
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      },
    });

    return response.data.data.fee;
  }

  // Verify transaction
  async verifyTransaction(transactionId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transactions/${transactionId}/verify`,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        data: response.data.data,
      };
    } catch (error) {
      console.error("Transaction verification error:", error.response?.data);
      return {
        success: false,
        error: error.response?.data?.message || "Verification failed",
      };
    }
  }
}

module.exports = new FlutterwaveService();
