const express = require("express");
const auth = require("../middlewares/authRoutes");
const axios = require("axios");
// const {
//   pStackOptions,
//   verifyBankAccount,
//   createRecipient,
//   initiateTransfer,
// } = require("../controllers/pstack");
const {
  chargeCard,
  initTrans,
  verifyTx,
  fetchBanks,
} = require("../controllers/flw");
const { User } = require("../models/User");
const { calculatePointsAmount } = require("../controllers/helpers");

const SUB_MILLI = 1000 * 60 * 60 * 24 * 30; // 30 days

const router = express.Router();

router.post("/subscribe", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  let flwData;

  const userInfo = await User.findById(userId);
  if (!userInfo) return res.status(422).send("User not found!");
  const { email, contact, fullName } = userInfo;

  flwData = await chargeCard({ ...data, email, contact, fullName });

  if (flwData?.status == "success") {
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          subscription: {
            current: new Date(),
            expiry: new Date(new Date().getTime() + SUB_MILLI),
            isActive: true,
          },
        },
        $push: {
          tx_history: {
            type: "subscription",
            date: new Date(),
            message: "+30 days",
            amount: Number.parseInt(data?.sub_amount),
            tx_ref: flwData.tx_ref,
            flw_ref: flwData.flw_ref,
          },
        },
      }
    );
  }

  return res.send(flwData);
});

router.post("/withdraw", auth, async (req, res) => {
  const userId = req.user.userId;
  // const { fullName, accountNumber, bankCode, amount } = req.body;

  try {
    // Replace with actual details
    const transfer = await initTrans(req.body);

    if (transfer?.status == "success") {
      await User.updateOne(
        { _id: userId },
        {
          $push: {
            tx_history: {
              type: "withdrawal",
              date: new Date(),
              message: `-${calculatePointsAmount(transfer?.data?.amount)}`,
              amount: Number.parseInt(transfer?.data?.amount),
              tx_ref: transfer.data.reference,
              flw_ref: transfer.data?.id,
            },
          },
        }
      );
    }

    return res.send(transfer);
  } catch (error) {
    console.error("Error transferring funds:", error);
    return res.status(500).json({ error });
  }
});

router.get("/subscription_callback", async (req, res) => {
  const { reference } = req.query;

  return res.send("ok");

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

router.get("/banks", auth, async (req, res) => {
  const banks = await fetchBanks();

  res.send(banks);
});

router.post("/verify_tx", auth, async (req, res) => {
  const { txId } = req.body;

  const resData = await verifyTx(txId);

  res.send(resData);
});

router.get("/subscription_redirect", async (req, res) => {
  const {} = req.query;

  console.log("Route Redirected!");
  console.log("Route Redirected!");
  console.log("Route Redirected!");
  res.send("Redirected");
});

module.exports = router;
