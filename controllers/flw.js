const Flutterwave = require("flutterwave-node-v3");

const uuid = require("uuid");
const nanoid = uuid.v4;
// const axios = require("axios");

const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY
);
const isOffline = process.env.NET_DEV;
const cardEndpoint = "https://api.flutterwave.com/v3/charges?type=card";

const chargeCardV2 = async (amount, email) => {
  const details = {
    card_number: "5531886652142950",
    cvv: "564",
    expiry_month: "09",
    expiry_year: "32",
    currency: "NGN",
    amount: String(amount) || "100",
    fullname: "Example User",
    email: email || "user@example.com",
    tx_ref: "MC5FSJFadj",
    redirect_url: "https://www,flutterwave.ng",
    enckey: process.env.FLW_ENC_KEY,
  };
  const data = await flw.Charge.card(details);
  return data;
};

const chargeCard = async (data) => {
  const {
    sub_amount,
    email,
    pin,
    otp,
    flw_ref,
    tx_ref,
    card_number,
    card_cvv,
    card_exp_month,
    card_exp_year,
    fullName,
    contact,
  } = data;
  const custom_ref = nanoid();

  const payload = {
    card_number,
    // card_number: "5531886652142950",
    cvv: card_cvv,
    // cvv: "564",
    expiry_month: card_exp_month,
    // expiry_month: "09",
    expiry_year: card_exp_year,
    // expiry_year: "31",
    currency: "NGN",
    amount: sub_amount,
    redirect_url: "http://localhost:3700/payments/subscription_redirect",
    fullname: fullName,
    email: email,
    phone_number: contact,
    tx_ref: tx_ref || custom_ref, // This is a unique reference, unique to the particular transaction being carried out. It is generated when it is not provided by the merchant for every transaction.
    enckey: process.env.FLW_ENC_KEY,
  };

  try {
    const response = await flw.Charge.card(payload);
    // console.log(response);
    if (response.meta.authorization.mode === "pin" && pin) {
      let payload2 = payload;
      payload2.authorization = {
        mode: "pin",
        // fields: ["pin"],
        pin: pin,
      };
      if (otp && flw_ref) {
        const callValidate = await flw.Charge.validate({
          otp,
          // otp: "12345",
          flw_ref,
        });
        console.log("TRANSACTION VALIDATED", callValidate);
      }

      const reCallCharge = await flw.Charge.card(payload2);

      const gen_ref = reCallCharge?.data?.flw_ref;

      if (!otp) {
        return {
          msg: reCallCharge?.data?.processor_response,
          flw_ref: gen_ref,
          tx_ref: payload.tx_ref,
          status: "verify",
        };
      }
    } else if (response.meta.authorization.mode === "pin" && !pin) {
      return {
        msg: "Enter your card pin",
        tx_ref: payload.tx_ref,
        amount: payload.amount,
        status: "pin",
      };
    }
    // if (response.meta.authorization.mode === "redirect") {
    //   console.log("redirecting!");
    //   var url = response.meta.authorization.redirect;
    //   // open(url);

    //   const res = await axios.get(url);
    //   return {
    //     msg: "Transaction successful",
    //     flw_ref,
    //   };
    // }

    return {
      msg: "Transaction successful",
      flw_ref,
      tx_ref,
      status: "success",
    };
  } catch (error) {
    return {
      msg: "Transaction failed",
      flw_ref,
      tx_ref,
      status: "failed",
      error,
    };
  }
};

const initTrans = async (data = {}) => {
  const { acct_number, bank, amount, fullName } = data;

  const tx_ref = nanoid();

  try {
    const payload = {
      account_bank: isOffline ? "044" : bank?.code, //This is the recipient bank code. Get list here :https://developer.flutterwave.com/v3.0/reference#get-all-banks
      account_number: isOffline ? "0690000040" : acct_number,
      amount: amount || 500,
      narration: "Guru Points withdrawal. Enjoy!",
      currency: "NGN",
      reference: tx_ref, //This is a merchant's unique reference for the transfer, it can be used to query for the status of the transfer
      callback_url: "https://www.flutterwave.com/ng/",
      beneficiary_name: fullName ?? "Dan Olojo",
      debit_currency: "NGN",
      meta: {
        sender: "Guru App",
        sender_email_address: "guruapp4scholars@gmail.com",
      },
    };

    const response = await flw.Transfer.initiate(payload);
    return response;
  } catch (error) {
    console.log(error);
  }
};

const initBulk = async () => {
  try {
    const payload = {
      title: "Staff salary",
      bulk_data: [
        {
          bank_code: "044",
          account_number: "0690000032",
          amount: 100,
          currency: "NGN",
          narration: "akhlm blktrnsfr",
          reference: "fhsfhsds",
        },
        {
          bank_code: "044",
          account_number: "0690000034",
          amount: 50,
          currency: "NGN",
          narration: "akhlm blktrnsfr",
          reference: "akhlmfhsfhsds",
        },
      ],
    };

    const response = await flw.Transfer.bulk(payload);
    console.log(response);
  } catch (error) {
    console.log(error);
  }
};

const getFee = async (amount) => {
  try {
    const payload = {
      amount,
      currency: "NGN",
    };

    const response = await flw.Transfer.fee(payload);
    console.log(response);
  } catch (error) {
    console.log(error);
  }
};

const verifyTx = async (txId) => {
  try {
    const payload = { id: txId };
    //This is the transaction unique identifier. It is returned in the initiate transaction call as data.id}
    const response = await flw.Transaction.verify(payload);
    console.log(response);
    return response;
  } catch (error) {
    console.log(error);
  }
};

const fetchBanks = async () => {
  try {
    const res = await flw.Bank.country({ country: "NG" });
    return res;
  } catch (error) {
    return {
      status: "error",
      error,
    };
  }
};

const verifyAccount = async (data, test = false) => {
  const payload = test
    ? { account_number: "0690000032", account_bank: "044" }
    : data;
  try {
    const res = await flw.Misc.verify_Account(payload);

    return res;
  } catch (error) {
    return {
      error,
      status: "error",
    };
  }
};

module.exports = {
  initTrans,
  chargeCard,
  verifyTx,
  fetchBanks,
  verifyAccount,
};
