const { default: axios } = require("axios");
const https = require("https");

const paystackApi = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.STACK_API}`,
    "Content-Type": "application/json",
  },
});

const pStackOptions = {
  hostname: "api.paystack.co",
  port: 443,
  path: "/transaction/initialize",
  method: "POST",
  callback_url: `${process.env.ADDRESS_ONLINE}/payments/subscription_callback`,
  headers: {
    Authorization: `Bearer ${process.env.STACK_API}`,
    "Content-Type": "application/json",
  },
};

const listBanks = async () => {
  try {
    const response = await paystackApi.get("/bank");

    console.log(response.data.data);
    return response.data.data; // List of banks and their codes
  } catch (error) {
    console.error(error.response.data);
  }
};

const createRecipient = async (name, accountNumber, bankCode) => {
  try {
    const response = await paystackApi.post("/transferrecipient", {
      type: "nuban",
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: "NGN",
    });
    return response.data;
  } catch (error) {
    console.error(error.response.data);
    throw error;
  }
};

const initiateTransfer = async (amount, recipientCode, reason) => {
  try {
    const response = await paystackApi.post("/transfer", {
      source: "balance",
      amount,
      recipient: recipientCode,
      reason,
    });
    return response.data;
  } catch (error) {
    console.error(error.response.data);
    throw error;
  }
};

const verifyBankAccount = async (data) => {
  const { account_number, bank_code } = data;
  console.log({ data });

  try {
    const response = await paystackApi.get(
      `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}&account_name=Daniel Olojo`,
      {}
    );

    res.json({ status: true, accountDetails: response.data.data });
  } catch (error) {
    console.error(error.response.data);
    res
      .status(500)
      .json({ status: false, message: "Account verification failed" });
  }
};

const chargeUser = async () => {
  const params = JSON.stringify({
    email,
    amount,
  });
  const reqPaystack = https
    .request(pStackOptions, (resPaystack) => {
      let data = "";

      resPaystack.on("data", (chunk) => {
        data += chunk;
      });

      resPaystack.on("end", () => {
        const payload = JSON.parse(data);

        res.json(payload);
      });
    })
    .on("error", (error) => {
      res.status(422).json({ msg: "Error making server requests", err: error });
    });

  reqPaystack.write(params);
  reqPaystack.end();
};

module.exports = {
  createRecipient,
  verifyBankAccount,
  initiateTransfer,
  listBanks,
  pStackOptions,
  chargeUser,
};
