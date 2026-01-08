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
  verifyAccount,
} = require("../controllers/flw");
const { User } = require("../models/User");
const { calculatePointsAmount } = require("../controllers/helpers");
const { School } = require("../models/School");
const walletService = require("../controllers/walletService");

const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30; // 30 days

const router = express.Router();

router.post("/subscribe", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;

  let flwData;

  const userInfo = await User.findById(userId);
  const school = await School.findById(data?.school);
  const isSchool = Boolean(school);

  if (!userInfo) return res.status(422).send("User not found!");

  const { email, contact, firstName, lastName } = userInfo;

  flwData = await chargeCard({
    ...data,
    email,
    contact,
    fullName: `${firstName} ${lastName}`,
  });

  if (flwData?.status == "success") {
    let expiry;

    if (isSchool) {
      switch (data?.sub_amount?.value) {
        case 10000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 3);
          break;

        case 20000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 6);
          break;

        case 30000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 9);
          break;

        default:
          break;
      }
    } else {
      // student subscription
      switch (data?.sub_amount?.value) {
        case 2000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS);
          break;
        case 4000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 2);
          break;
        case 6000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 3);
          break;
        case 8000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 4);
          break;
        case 10000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 5);
          break;
        case 12000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 6);
          break;
        case 14000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 7);
          break;
        case 16000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 8);
          break;
        case 18000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 9);
          break;
        case 20000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 10);
          break;
        case 22000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 11);
          break;
        case 24000:
          expiry = new Date(new Date().getTime() + THIRTY_DAYS * 12);
          break;

        default:
          break;
      }
    }

    const subDetails = {
      $set: {
        subscription: {
          current: new Date(),
          expiry,
          isActive: true,
        },
      },
      $push: {
        tx_history: {
          type: "subscription",
          date: new Date(),
          message: data?.sub_amount?.title,
          amount: Number.parseInt(data?.sub_amount?.value),
          tx_ref: flwData.tx_ref,
          flw_ref: flwData.flw_ref,
          tx: flwData.tx,
          user: userId,
        },
      },
    };
    await User.updateOne({ _id: userId }, subDetails);
    if (isSchool) {
      await School.updateOne(
        { _id: data?.school, "teachers.user": userId },
        {
          $set: {
            ...subDetails.$set,
            "teachers.$.verified": true,
          },
          $push: subDetails.$push,
        }
      );
      // subscribe all teachers
      await User.updateMany(
        { _id: { $in: school?.teachers } },
        { $set: subDetails.$set }
      );
    } else {
    }
  }

  return res.send(flwData);
});

router.post("/withdraw", auth, async (req, res) => {
  const userId = req.user.userId;
  const userInfo = await User.findById(userId);
  // const { fullName, accountNumber, bankCode, amount } = req.body;

  try {
    // Replace with actual details
    const transfer = await initTrans({
      ...req.body,
      fullName: userInfo.fullName,
    });

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

router.post("/verify_account", auth, async (req, res) => {
  const { bank, acct_number } = req.body;
  const payload = {
    account_number: acct_number,
    account_bank: bank?.code,
  };
  const detail = await verifyAccount(payload, true);

  res.send(detail);
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

// When school pays subscription
router.post("/school-subscription-webhook", async (req, res) => {
  try {
    const { reference, amount, status } = req.body;

    if (status === "successful") {
      await walletService.credit("school", amount, "subscription", reference, {
        description: "School subscription payment",
        flutterwaveReference: reference,
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// When student pays subscription
router.post("/student-subscription-webhook", async (req, res) => {
  try {
    const { reference, amount, status, userId } = req.body;

    if (status === "successful") {
      await walletService.credit("student", amount, "subscription", reference, {
        userId,
        description: "Student subscription payment",
        flutterwaveReference: reference,
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
