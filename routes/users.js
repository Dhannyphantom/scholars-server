const express = require("express");
// const nodemailer = require("nodemailer");
// const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
// const getUploadMeta = require("../controllers/getUploadMeta");

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     return cb(null, "./uploads/assets/");
//   },
//   filename: (req, file, cb) => {
//     return cb(null, `${Date.now()}_${file.originalname}`);
//   },
// });

// const uploader = multer({ storage, limits: { fieldSize: 25 * 1024 * 1024 } }); // 25MB

const bcrypt = require("bcrypt");
const { User, validateLog, validateReg } = require("../models/User");
// const auth = require("../middlewares/authRoutes");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, email, password, accountType } = req.body;

  const { error } = validateReg(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const aUser = await User.findOne({ username });
  if (aUser)
    return res.status(400).send("Username has been used already, Try another");
  const eEmail = await User.findOne({ email });
  if (eEmail)
    return res.status(400).send("Email has already been registered, Sign in!");

  const user = new User({
    username,
    email,
    accountType,
    password,
  });

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);

  user.password = hash;

  const token = user.generateAuthToken();

  await user.save();

  res.header("x-auth-token", token).json({ token });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const { error } = validateLog(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  const user = await User.findOne().or([
    { email: username.toLowerCase().trim() },
    { username },
  ]);
  if (!user) return res.status(400).send(`Invalid profile account`);

  const passValid = await bcrypt.compare(password, user.password);
  if (!passValid) return res.status(400).send("Invalid profile details");
  const token = user.generateAuthToken();

  res.header("x-auth-token", token).send(token);
});

module.exports = router;
