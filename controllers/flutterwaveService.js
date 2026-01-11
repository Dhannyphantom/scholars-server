// ==========================================
// FLUTTERWAVE SERVICE (services/flutterwaveService.js)
// ==========================================
const axios = require("axios");

// Add to services/flutterwaveService.js or create utils/phoneValidation.js

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
  // Update in services/flutterwaveService.js

  // Send airtime - CORRECTED VERSION
  // async sendAirtime(data) {
  //   try {
  //     // Map network names to Flutterwave biller codes
  //     const networkMap = {
  //       MTN: "BIL099", // MTN Nigeria
  //       GLO: "BIL098", // Glo Nigeria
  //       AIRTEL: "BIL100", // Airtel Nigeria
  //       "9MOBILE": "BIL102", // 9mobile Nigeria
  //       ETISALAT: "BIL102", // Alternative name for 9mobile
  //     };

  //     const billerCode = networkMap[data.network.toUpperCase()];

  //     if (!billerCode) {
  //       return {
  //         success: false,
  //         error: `Unsupported network: ${data.network}. Supported networks: MTN, GLO, AIRTEL, 9MOBILE`,
  //       };
  //     }

  //     const response = await axios.post(
  //       `${this.baseUrl}/bills`,
  //       {
  //         country: "NG",
  //         customer: data.phoneNumber,
  //         amount: data.amount,
  //         type: "AIRTIME", // Changed from network name
  //         reference: data.reference,
  //         biller_code: billerCode, // Add biller code
  //       },
  //       {
  //         headers: {
  //           Authorization: `Bearer ${this.secretKey}`,
  //           "Content-Type": "application/json",
  //         },
  //       }
  //     );

  //     return {
  //       success: response.data.status === "success",
  //       data: response.data.data,
  //       reference: response.data.data?.reference,
  //       flutterwaveId: response.data.data?.flw_ref,
  //     };
  //   } catch (error) {
  //     console.error("Airtime error:", error.response?.data);
  //     return {
  //       success: false,
  //       error: error.response?.data?.message || "Airtime purchase failed",
  //     };
  //   }
  // }
  async sendAirtime(data) {
    try {
      // Map network names to Flutterwave biller codes
      const networkMap = {
        MTN: "BIL099",
        GLO: "BIL098",
        AIRTEL: "BIL100",
        "9MOBILE": "BIL102",
        ETISALAT: "BIL102",
      };

      const billerCode = networkMap[data.network.toUpperCase()];

      if (!billerCode) {
        return {
          success: false,
          error: `Unsupported network: ${data.network}. Supported networks: MTN, GLO, AIRTEL, 9MOBILE`,
        };
      }

      // Airtime uses a generic item code "AT" + last 3 digits of biller code
      const itemCode = `AT${billerCode.slice(-3)}`;

      // Use the new endpoint format
      const url = `${this.baseUrl}/billers/${billerCode}/items/${itemCode}/payment`;

      const response = await axios.post(
        url,
        {
          country: "NG",
          customer_id: data.phoneNumber,
          amount: data.amount,
          reference: data.reference,
          callback_url: `${process.env.BASE_URL}/api/payouts/webhooks/flutterwave`,
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        data: response.data.data,
        reference: response.data.data?.reference || data.reference,
        flutterwaveId:
          response.data.data?.transaction_reference ||
          response.data.data?.flw_ref,
      };
    } catch (error) {
      console.error("Airtime error:", error.response?.data);
      return {
        success: false,
        error: error.response?.data?.message || "Airtime purchase failed",
      };
    }
  }

  // Add to services/flutterwaveService.js

  // Get data bundles for a specific network
  // Replace the getDataBundles method in services/flutterwaveService.js

  // Replace getDataBundles in services/flutterwaveService.js

  async getDataBundles(network) {
    try {
      // Correct biller codes from actual API
      const networkBillerMap = {
        MTN: "BIL104",
        GLO: "BIL105",
        AIRTEL: "BIL106",
        "9MOBILE": "BIL107",
      };

      const billerCode = networkBillerMap[network.toUpperCase()];

      if (!billerCode) {
        return {
          success: false,
          error: `Unsupported network: ${network}. Supported: MTN, GLO, AIRTEL, 9MOBILE`,
        };
      }

      // Get items for this biller
      const response = await axios.get(
        `${this.baseUrl}/billers/${billerCode}/items`,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
        }
      );

      if (!response.data.data || response.data.data.length === 0) {
        return {
          success: false,
          error: `No data bundles found for ${network}`,
        };
      }

      // Remove duplicates based on item_code
      const uniqueBundles = [];
      const seenItemCodes = new Set();

      response.data.data.forEach((item) => {
        if (!seenItemCodes.has(item.item_code)) {
          seenItemCodes.add(item.item_code);
          uniqueBundles.push({
            id: item.id,
            billerCode: item.biller_code,
            itemCode: item.item_code,
            name: item.biller_name, // e.g., "MTN 1.5 GB"
            amount: parseFloat(item.amount),
            points: `${parseFloat(item.amount) * 10} GT`,
            value: parseFloat(item.amount) * 10,
            validity: item.validity_period || "N/A",
            description: `${item.biller_name} - Valid for ${
              item.validity_period || "N/A"
            } day(s)`,
          });
        }
      });

      // Sort by amount
      uniqueBundles.sort((a, b) => a.amount - b.amount);

      return {
        success: true,
        bundles: uniqueBundles,
      };
    } catch (error) {
      console.error(
        "Get bundles error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data?.message || "Failed to fetch data bundles",
      };
    }
  }

  // Purchase data bundle - UPDATED
  // Update sendDataBundle in services/flutterwaveService.js

  async sendDataBundle(data) {
    try {
      // Use the new endpoint format
      const url = `${this.baseUrl}/billers/${data.billerCode}/items/${data.itemCode}/payment`;

      const response = await axios.post(
        url,
        {
          country: "NG",
          customer_id: data.phoneNumber, // Note: customer_id not customer
          amount: data.amount,
          reference: data.reference,
          callback_url: `${process.env.BASE_URL}/api/payouts/webhooks/flutterwave`,
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
        }
      );

      return {
        success: response.data.status === "success",
        data: response.data.data,
        reference: response.data.data?.reference || data.reference,
        flutterwaveId:
          response.data.data?.transaction_reference ||
          response.data.data?.flw_ref,
      };
    } catch (error) {
      console.error("Data bundle error:", error.response?.data);
      return {
        success: false,
        error: error.response?.data?.message || "Data purchase failed",
        details: error.response?.data,
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
