const https = require("https");
const express = require("express");
const auth = require("../middlewares/authRoutes");

const router = express.Router();

router.post("/subscribe", auth, async (req, res) => {
  const user = req.user.userId;
  const { email, amount } = req.body;
  console.log({ body: req.body });

  const params = JSON.stringify({
    email,
    amount,
  });

  const options = {
    hostname: "api.paystack.co",
    port: 443,
    path: "/transaction/initialize",
    method: "POST",
    callback_url: `${process.env.ADDRESS_ONLINE}/payments/subcription_callback`,
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

router.get("/subcription_callback", async (req, res) => {});

module.exports = router;
