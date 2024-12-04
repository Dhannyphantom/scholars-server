const Flutterwave = require("flutterwave-node-v3");

const uuid = require("uuid");
const nanoid = uuid.v4;
// const axios = require("axios");

const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY
);
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
    amount,
    email,
    pin,
    otp,
    flw_ref,
    tx_ref,
    card_number,
    cvv,
    expiry_month,
    expiry_year,
    fullname,
    phone_number,
  } = data;
  const custom_ref = nanoid();
  const payload = {
    card_number: "5531886652142950",
    cvv: "564",
    expiry_month: "09",
    expiry_year: "31",
    currency: "NGN",
    amount: amount || "1000",
    redirect_url: "http://localhost:3700/payments/subscription_redirect",
    fullname: "John Paul",
    email: email || "youngskillzzz@gmail.com",
    phone_number: "07081713909",
    tx_ref: tx_ref || custom_ref, // This is a unique reference, unique to the particular transaction being carried out. It is generated when it is not provided by the merchant for every transaction.
    enckey: process.env.FLW_ENC_KEY,
  };

  try {
    const response = await flw.Charge.card(payload);
    // console.log(response);
    if (response.meta.authorization.mode === "pin") {
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

const chargeCardX = async (data) => {
  const payload = {
    card_number: "5531886652142950",
    cvv: "564",
    expiry_month: "09",
    expiry_year: "25",
    currency: "NGN",
    amount: "100",
    redirect_url: "https://www.google.com",
    fullname: "Olufemi Obafunmiso",
    email: "olufemi@flw.com",
    phone_number: "0902620185",
    enckey: process.env.FLW_ENC_KEY,
    tx_ref: "MC-32444ee--4eerye4euee3rerds4423e43e", // This is a unique reference, unique to the particular transaction being carried out. It is generated when it is not provided by the merchant for every transaction.
  };
  try {
    const response = await flw.Charge.card(payload);
    console.log(response);
  } catch (err) {
    return {
      msg: "Transaction Failed",
      status: "failed",
      error: err,
    };
  }
};

const initTrans = async (data = {}) => {
  const { account_bank, account_number } = data;
  const tx_ref = nanoid();

  try {
    const payload = {
      account_bank: "044", //This is the recipient bank code. Get list here :https://developer.flutterwave.com/v3.0/reference#get-all-banks
      account_number: "0690000040",
      amount: 2500,
      narration: "Guru Points withdrawal. Enjoy!",
      currency: "NGN",
      reference: tx_ref, //This is a merchant's unique reference for the transfer, it can be used to query for the status of the transfer
      callback_url: "https://www.flutterwave.com/ng/",
      debit_currency: "NGN",
    };

    const response = await flw.Transfer.initiate(payload);
    console.log(response);
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

module.exports = {
  initTrans,
  chargeCard,
};
