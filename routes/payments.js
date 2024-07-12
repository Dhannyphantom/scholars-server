const https = require("https");
const express = require("express");
const auth = require("../middlewares/authRoutes");
const axios = require("axios");

const router = express.Router();

const paystackApi = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.STACK_API}`,
    "Content-Type": "application/json",
  },
});

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

router.post("/subscribe", auth, async (req, res) => {
  const user = req.user.userId;
  const { email, amount } = req.body;

  const params = JSON.stringify({
    email,
    amount,
  });

  const options = {
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

  const reqPaystack = https
    .request(options, (resPaystack) => {
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
});

router.post("/withdraw", auth, async (req, res) => {
  const userId = req.user.userId;
  const { fullName, accountNumber, bankCode, amount } = req.body;
  // 'John Doe', '0123456789', '058'
  console.log(req.body);

  // get User Info and check if amount exceed the user's current amount

  try {
    // Replace with actual details
    const recipient = await createRecipient(fullName, accountNumber, bankCode);
    console.log("Recipient:", recipient);

    const transfer = await initiateTransfer(
      amount,
      recipient.data.recipient_code,
      "Payment for Scholars points withdrawal"
    );
    console.log("Transfer:", transfer);
    res.status(200).json({ transfer });
  } catch (error) {
    console.error("Error transferring funds:", error);
    return res.status(500).json({ error });
  }
});

router.get("/subscription_callback", async (req, res) => {
  const { reference } = req.query;

  try {
    // Verify payment with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STACK_API}`,
        },
      }
    );

    if (response.data.status) {
      // Handle successful payment
      console.log(response.data);
      res.render("paymentSuccess", {
        userName: "Dhannyphantom",
        amountPaid: response.data.amount / 100,
        valueAdded: "30 days subscription",
      });
      // award user subscription
      // res.status(200).json({ status: "success", data: response.data });
    } else {
      // Handle failed payment
      res.status(400).json({ status: "failed", data: response.data });
    }
  } catch (error) {
    // Handle error
    res.status(500).json({ status: "error", message: error.message });
  }
});

module.exports = router;
