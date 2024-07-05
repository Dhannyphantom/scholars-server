const https = require("https");
const express = require("express");
const auth = require("../middlewares/authRoutes");

const router = express.Router();

router.post("/subscribe", auth, async (req, res) => {
  const user = req.user.userId;
  const { email, amount } = req.body;

  const params = JSON.stringify({
    email: "customer@email.com",
    amount: "500000",
  });

  const options = {
    hostname: "api.paystack.co",
    port: 443,
    path: "/transaction/initialize",
    method: "POST",
    callback_url: `${process.env.ADDRESS}:${process.env.PORT}/payments/success`,
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
        console.log(payload);

        res.json(payload);
      });
    })
    .on("error", (error) => {
      console.log({ error });
      res.status(422).json({ msg: "Error making server requests" });
    });

  reqPaystack.write(params);
  reqPaystack.end();
});

module.exports = router;
