const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
// const getUploadMeta = require("../controllers/getUploadMeta");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    return cb(null, "./uploads/assets/");
  },
  filename: (req, file, cb) => {
    return cb(null, `${file.originalname}`);
  },
});

const uploader = multer({ storage, limits: { fieldSize: 15 * 1024 * 1024 } }); // 15MB

const bcrypt = require("bcrypt");
const { User, validateLog, validateReg } = require("../models/User");
const auth = require("../middlewares/authRoutes");
const { getUploadUri, fullUserSelector } = require("../controllers/helpers");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, email, password, accountType } = req.body;

  const { error } = validateReg(req.body);
  if (error) return res.status(400).json(error.details[0].message);

  const aUser = await User.findOne({ username });
  if (aUser)
    return res.status(400).json("Username has been used already, Try another");
  const eEmail = await User.findOne({ email });
  if (eEmail)
    return res.status(400).json("Email has already been registered, Sign in!");

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

  const userData = await User.findById(user._id).select(fullUserSelector);

  res.header("x-auth-token", token).json({ token, user: userData });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const { error } = validateLog(req.body);
  if (error) return res.status(400).json(error.details[0].message);

  const user = await User.findOne().or([
    { email: username.toLowerCase() },
    { username },
  ]);

  if (!user) return res.status(400).json(`Invalid profile account`);

  const passValid = await bcrypt.compare(password, user.password);
  if (!passValid) return res.status(400).json("Invalid profile details");
  const token = user.generateAuthToken();

  const userData = await User.findById(user._id).select(fullUserSelector);

  res.header("x-auth-token", token).json({ token, user: userData });
});

router.get("/user", auth, async (req, res) => {
  const userId = req.user.userId;

  const userData = await User.findById(userId).select(fullUserSelector);

  if (!userData)
    return res.status(422).json("User data not found. Please sign in again");

  res.json({ user: userData });
});

router.post(
  "/updateAvatar",
  [auth, uploader.single("upload"), mediaUploader],
  async (req, res) => {
    const user = await User.findById(req.user.userId);
    const imageData = req.media;

    if (!imageData) return res.status(400).json("Media data not found!");

    const userAvatarObj = getUploadUri(req.media, "avatars");

    user.avatar.image = userAvatarObj;
    user.avatar.lastUpdate = new Date();

    await user.save();

    res.json({ avatar: user.avatar });
  }
);

router.put("/updateProfile", auth, async (req, res) => {
  const userId = req.user.userId;

  const userData = req.body;

  const update_object = {};

  const getNameVal = ["state", "lga", "preffix", "schoolLevel"];

  Object.entries(userData).map(([key, val]) => {
    update_object[key] = getNameVal.includes(key) ? val?.name : val;
  });

  const preffix = update_object?.preffix;

  if (Boolean(preffix)) {
    if (preffix == "mr.") {
      update_object["gender"] = "male";
    } else if (["ms.", "mrs."].includes(preffix)) {
      update_object["gender"] = "female";
    }
  }

  if (update_object["class"]) {
    console.log(update_object["class"]);
    update_object["class"] = {
      hasChanged: true,
      level: update_object["class"]?.name?.toLowerCase(),
    };
  }

  if (update_object["gender"]) {
    update_object["gender"] = update_object["gender"]?.name;
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $set: update_object,
    },
    {
      new: true,
    }
  );

  res.json({ user: updatedUser });
});

module.exports = router;
