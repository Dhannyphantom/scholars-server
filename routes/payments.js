const express = require("express");
const auth = require("../middlewares/authRoutes");
const axios = require("axios");
const {
  pStackOptions,
  verifyBankAccount,
  createRecipient,
  initiateTransfer,
} = require("../controllers/pstack");
const { chargeCard, initTrans } = require("../controllers/flw");

const router = express.Router();

router.post("/subscribe", auth, async (req, res) => {
  // const user = req.user.userId;
  const data = req.body;
  console.log({ body: req.body });

  const flwData = await chargeCard(data);

  res.send(flwData);
});

router.post("/withdraw", auth, async (req, res) => {
  const userId = req.user.userId;
  const { fullName, accountNumber, bankCode, amount } = req.body;

  try {
    // Replace with actual details
    const transfer = await initTrans();
    // const recipient = await createRecipient(fullName, accountNumber, bankCode);
    // console.log("Response:", recipient);

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

router.get("/subscription_redirect", async (req, res) => {
  const {} = req.query;

  console.log("Redirected!");
  res.send("Redirected");
});

module.exports = router;
