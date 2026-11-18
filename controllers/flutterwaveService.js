// ==========================================
// FLUTTERWAVE SERVICE (controllers/flutterwaveService.js)
// ==========================================
// Every money-moving call returns an `outcome` so callers can tell apart:
//   accepted - provider took the request
//   rejected - provider definitely refused it (safe to refund)
//   unknown  - timeout / network / 5xx / duplicate reference: it MAY have
//              landed, so NEVER refund or re-charge blindly -> query by reference
// Every status query returns `state`:
//   successful | failed | pending | not_found | unknown
const axios = require("axios");

const TIMEOUT_MS = 25000;

const DUP_REF_RE =
  /(reference.*(exist|used|duplicate))|((exist|used|duplicate).*reference)/i;
const NOT_FOUND_RE = /(not\s+found|no\s+transaction|does\s+not\s+exist)/i;

const msgOf = (error, fallback) => error?.response?.data?.message || fallback;

/** True when we cannot know whether the request reached Flutterwave. */
const isAmbiguous = (error) => {
  if (!error?.response) return true; // timeout, DNS, connection reset...
  const s = error.response.status;
  return s >= 500 || s === 408 || s === 429;
};

/** Flutterwave status words -> successful | failed | pending */
const normalizeStatus = (value) => {
  const v = String(value ?? "").toLowerCase();
  if (!v) return "pending";
  if (/(fail|revers|declin|error|unsuccess|cancel)/.test(v)) return "failed";
  if (/(success|complet|deliver)/.test(v)) return "successful";
  return "pending";
};

class FlutterwaveService {
  constructor() {
    this.baseUrl = "https://api.flutterwave.com/v3";
  }

  get headers() {
    return {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      "Content-Type": "application/json",
      accept: "application/json",
    };
  }

  _get(path, params) {
    return axios.get(`${this.baseUrl}${path}`, {
      params,
      headers: this.headers,
      timeout: TIMEOUT_MS,
    });
  }

  _post(path, body) {
    return axios.post(`${this.baseUrl}${path}`, body, {
      headers: this.headers,
      timeout: TIMEOUT_MS,
    });
  }

  _classifySubmitError(error, fallback) {
    const message = msgOf(error, fallback);
    if (isAmbiguous(error)) {
      return { success: false, outcome: "unknown", error: message };
    }
    if (DUP_REF_RE.test(message)) {
      // Same reference already exists at Flutterwave => an earlier attempt landed.
      return { success: false, outcome: "unknown", duplicate: true, error: message };
    }
    return { success: false, outcome: "rejected", error: message };
  }

  // ───────────────────────── accounts / banks ─────────────────────────
  async verifyAccount(accountNumber, accountBank) {
    try {
      const response = await this._post("/accounts/resolve", {
        account_number: accountNumber,
        account_bank: accountBank,
      });
      return {
        success: response.data.status === "success",
        accountName: response.data.data?.account_name,
        accountNumber: response.data.data?.account_number,
      };
    } catch (error) {
      return {
        success: false,
        error: msgOf(error, "Account verification failed"),
      };
    }
  }

  async getBanks() {
    try {
      const response = await this._get("/banks/NG");
      return { success: true, banks: response.data.data };
    } catch (error) {
      return { success: false, error: "Failed to fetch banks" };
    }
  }

  // ───────────────────────── transfers ─────────────────────────
  async initiateTransfer(data) {
    try {
      const response = await this._post("/transfers", {
        account_bank: data.accountBank,
        account_number: data.accountNumber,
        amount: data.amount,
        narration: data.narration || "Guru EduTech Payout",
        currency: "NGN",
        reference: data.reference,
        callback_url: data.callbackUrl,
        debit_currency: "NGN",
      });

      if (response.data.status !== "success") {
        return {
          success: false,
          outcome: "rejected",
          error: response.data.message || "Transfer failed",
        };
      }
      const d = response.data.data;
      return {
        success: true,
        outcome: "accepted",
        data: d,
        reference: d?.reference,
        flutterwaveId: d?.id != null ? String(d.id) : undefined,
        // transfers settle asynchronously: only the webhook / status query
        // may call them successful.
        providerStatus: normalizeStatus(d?.status) === "failed" ? "failed" : "pending",
      };
    } catch (error) {
      return this._classifySubmitError(error, "Transfer failed");
    }
  }

  async getTransferStatus(reference) {
    try {
      // Try without a filter, then the explicit statuses, in case the API
      // applies a default status filter.
      for (const status of [undefined, "failed", "successful"]) {
        const params = { reference };
        if (status) params.status = status;
        const r = await this._get("/transfers", params);
        const hit = (r.data?.data || []).find((t) => t.reference === reference);
        if (hit) {
          return {
            state: normalizeStatus(hit.status),
            data: hit,
            message: hit.complete_message,
          };
        }
      }
      return { state: "not_found" };
    } catch (error) {
      return { state: "unknown", error: msgOf(error, error.message) };
    }
  }

  async getTransferFee(amount) {
    const response = await this._get("/transfers/fee", {
      amount,
      currency: "NGN",
    });
    return response.data.data.fee;
  }

  // ───────────────────────── airtime / data ─────────────────────────
  async _payBill(billerCode, itemCode, data, fallback) {
    try {
      const response = await this._post(
        `/billers/${billerCode}/items/${itemCode}/payment`,
        {
          country: "NG",
          customer_id: data.phoneNumber,
          amount: data.amount,
          reference: data.reference,
          callback_url: `${process.env.BASE_URL}/payouts/webhooks/flutterwave`,
        },
      );

      if (response.data.status !== "success") {
        return {
          success: false,
          outcome: "rejected",
          error: response.data.message || fallback,
        };
      }
      const d = response.data.data;
      return {
        success: true,
        outcome: "accepted",
        data: d,
        reference: d?.reference || data.reference,
        flutterwaveId: d?.transaction_reference || d?.flw_ref,
        // No explicit status => keep the old behaviour (treat as delivered).
        providerStatus: d?.status ? normalizeStatus(d.status) : "successful",
      };
    } catch (error) {
      return this._classifySubmitError(error, fallback);
    }
  }

  async sendAirtime(data) {
    const networkMap = {
      MTN: "BIL099",
      GLO: "BIL098",
      AIRTEL: "BIL100",
      "9MOBILE": "BIL102",
      ETISALAT: "BIL102",
    };
    const billerCode = networkMap[String(data.network).toUpperCase()];
    if (!billerCode) {
      return {
        success: false,
        outcome: "rejected",
        error: `Unsupported network: ${data.network}. Supported networks: MTN, GLO, AIRTEL, 9MOBILE`,
      };
    }
    const itemCode = `AT${billerCode.slice(-3)}`;
    return this._payBill(billerCode, itemCode, data, "Airtime purchase failed");
  }

  async sendDataBundle(data) {
    return this._payBill(
      data.billerCode,
      data.itemCode,
      data,
      "Data purchase failed",
    );
  }

  async getBillStatus(reference) {
    try {
      const r = await this._get(`/bills/${encodeURIComponent(reference)}`, {
        verbose: 1,
      });
      const d = r.data?.data;
      if (!d) return { state: "not_found" };
      return { state: normalizeStatus(d.status), data: d, message: d.status };
    } catch (error) {
      const message = msgOf(error, error.message);
      if (error?.response?.status === 404 || NOT_FOUND_RE.test(message)) {
        return { state: "not_found" };
      }
      return { state: "unknown", error: message };
    }
  }

  async getDataBundles(network) {
    try {
      const networkBillerMap = {
        MTN: "BIL108",
        GLO: "BIL109",
        AIRTEL: "BIL110",
        "9MOBILE": "BIL111",
      };
      const billerCode = networkBillerMap[String(network).toUpperCase()];
      if (!billerCode) {
        return {
          success: false,
          error: `Unsupported network: ${network}. Supported: MTN, GLO, AIRTEL, 9MOBILE`,
        };
      }

      const response = await this._get(`/billers/${billerCode}/items`);
      if (!response.data.data || response.data.data.length === 0) {
        return { success: false, error: `No data bundles found for ${network}` };
      }

      const uniqueBundles = [];
      const seen = new Set();
      response.data.data.forEach((item) => {
        if (seen.has(item.item_code)) return;
        seen.add(item.item_code);
        uniqueBundles.push({
          id: item.id,
          billerCode: item.biller_code,
          itemCode: item.item_code,
          name: item.biller_name,
          amount: parseFloat(item.amount),
          points: `${parseFloat(item.amount) * 10} GT`,
          value: parseFloat(item.amount) * 10,
          validity: item.validity_period || "N/A",
          description: `${item.biller_name} - Valid for ${
            item.validity_period || "N/A"
          } day(s)`,
        });
      });
      uniqueBundles.sort((a, b) => a.amount - b.amount);
      return { success: true, bundles: uniqueBundles };
    } catch (error) {
      console.error("Get bundles error:", error.response?.data || error.message);
      return {
        success: false,
        error: msgOf(error, "Failed to fetch data bundles"),
      };
    }
  }

  // ───────────────────────── collections (subscriptions) ─────────────────────────
  _verifyResult(response) {
    const ok = response.data?.status === "success" && !!response.data?.data;
    return {
      ok,
      success: ok, // backwards compatible
      notFound: !ok,
      data: response.data?.data,
      error: response.data?.message,
    };
  }

  _verifyError(error, fallback) {
    const message = msgOf(error, fallback);
    if (isAmbiguous(error)) {
      return { ok: false, success: false, networkError: true, error: message };
    }
    if (error.response?.status === 404 || NOT_FOUND_RE.test(message)) {
      return { ok: false, success: false, notFound: true, error: message };
    }
    // 4xx we don't understand: not a network problem, but not proof of "no payment" either
    return { ok: false, success: false, networkError: true, error: message };
  }

  /** By Flutterwave numeric transaction id (from the redirect). */
  async verifyTransaction(transactionId) {
    try {
      const r = await this._get(`/transactions/${transactionId}/verify`);
      return this._verifyResult(r);
    } catch (error) {
      console.error("Transaction verification error:", error.response?.data);
      return this._verifyError(error, "Verification failed");
    }
  }

  /** By OUR tx_ref - works even if the app never received the redirect. */
  async verifyByReference(txRef) {
    try {
      const r = await this._get("/transactions/verify_by_reference", {
        tx_ref: txRef,
      });
      return this._verifyResult(r);
    } catch (error) {
      return this._verifyError(error, "Verification failed");
    }
  }

  async findTransactionByFlwRef(flwRef) {
    try {
      const response = await this._get("/transactions", { flw_ref: flwRef });
      const transactions = response.data?.data;
      if (!transactions || transactions.length === 0) {
        return { success: false, error: "No transaction found for this reference" };
      }
      return { success: true, data: transactions[0] };
    } catch (error) {
      console.error("findTransactionByFlwRef error:", error.response?.data);
      return {
        success: false,
        error: msgOf(error, "Failed to find transaction"),
      };
    }
  }
}

module.exports = new FlutterwaveService();
