const https = require("https");
const express = require("express");
const auth = require("../middlewares/authRoutes");
const axios = require("axios");

const router = express.Router();

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
        pointsAdded: "30 days",
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
