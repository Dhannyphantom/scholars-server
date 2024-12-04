const express = require("express");
const auth = require("../middlewares/authRoutes");
const axios = require("axios");
// const {
//   pStackOptions,
//   verifyBankAccount,
//   createRecipient,
//   initiateTransfer,
// } = require("../controllers/pstack");
const { chargeCard, initTrans } = require("../controllers/flw");
const { User } = require("../models/User");

const SUB_MILLI = 1000 * 60 * 60 * 24 * 30; // 30 days

const router = express.Router();

router.post("/subscribe", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  console.log({ body: req.body });
  let flwData;

  const userInfo = await User.findById(userId);

  try {
    flwData = await chargeCard(data);
  } catch (error) {
    return res.status(422).send({ msg: "Payment error", data: error });
  }

  if (flwData?.status == "success") {
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          subscription: {
            current: new Date(),
            expiry: new Date(new Date().getMilliseconds() + SUB_MILLI),
            isActive: true,
          },
        },
        $push: {
          tx_history: {
            type: "subscription",
            date: new Date(),
            message: "+30 days",
            amount: Number.parseInt(data?.amount),
            tx_ref: flwData.tx_ref,
            flw_ref: flwData.flw_ref,
          },
        },
      }
    );
  }

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

  console.log("Route Redirected!");
  console.log("Route Redirected!");
  console.log("Route Redirected!");
  res.send("Redirected");
});

module.exports = router;
