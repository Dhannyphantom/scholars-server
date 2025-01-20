const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const path = require("path");

// const getUploadMeta = require("../controllers/getUploadMeta");

const bcrypt = require("bcrypt");
const { User, validateLog, validateReg } = require("../models/User");
const auth = require("../middlewares/authRoutes");
const {
  getUploadUri,
  fullUserSelector,
  createDir,
  userSelector,
} = require("../controllers/helpers");
const { AppInfo } = require("../models/AppInfo");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/assets";
    createDir(uploadPath);
    return cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    return cb(null, `${file.originalname}`);
  },
});
const uploader = multer({ storage, limits: { fieldSize: 5 * 1024 * 1024 } }); // 5MB

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, email, password, accountType, token: proToken } = req.body;

  const appInfo = await AppInfo.findOne({ ID: "APP" });

  const { error } = validateReg(req.body);
  if (error) return res.status(400).json(error.details[0].message);

  const isPro = accountType == "professional";

  if (isPro) {
    if (appInfo.PRO_TOKEN !== proToken) {
      return res.status(400).send("Invalid pro token");
    }
  }

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

  if (isPro) {
    // change PRO_TOKEN
    const randInt = Math.floor(Math.random() * 10e9);
    await AppInfo.updateOne(
      { ID: "APP" },
      {
        $set: {
          PRO_TOKEN: `mosdan@pro${randInt}`,
        },
      }
    );
  }

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

router.get("/userInfo", auth, async (req, res) => {
  const { userId } = req.query;

  const userData = await User.findById(userId).select(userSelector);

  if (!userData)
    return res.status(422).json("User data not found. Please sign in again");

  res.json({ user: userData, status: "success" });
});

router.get("/professionals", auth, async (req, res) => {
  const userId = req.user.userId;

  const userInfo = await User.findById(userId).select("accountType");

  if (userInfo.accountType !== "manager")
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });

  const pros = await User.find({ accountType: "professional" })
    .populate([
      {
        path: "subjects",
        model: "Subject",
        select: "name",
      },
    ])
    .select(
      "username firstName lastName state email subjects lga avatar verified address contact"
    )
    .sort({ verified: 1 });

  res.send({ status: "success", data: pros });
});

router.put("/professional", auth, async (req, res) => {
  const userId = req.user.userId;
  const { proId, subjects, action } = req.body;
  // action = 'verify' | 'reject' | 'revoke'

  const userInfo = await User.findById(userId).select("accountType");

  if (userInfo.accountType !== "manager")
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });

  if (!action)
    return res
      .status(422)
      .send({ status: "failed", message: "Missing action info!" });

  switch (action) {
    case "verify":
      await User.updateOne(
        { _id: proId },
        {
          $set: {
            verified: true,
            subjects: subjects?.map((item) => item?._id),
          },
        }
      );
      break;
    case "revoke":
      await User.updateOne(
        { _id: proId },
        {
          $set: {
            verified: false,
            subjects: [],
          },
        }
      );
      break;
    case "reject":
      await User.deleteOne({ _id: proId });
      break;

    default:
      break;
  }

  res.send({ status: "success" });
});

router.post(
  "/updateAvatar",
  [auth, uploader.single("upload"), mediaUploader],
  async (req, res) => {
    const user = await User.findById(req.user.userId);
    const imageData = req.media;

    if (!imageData) return res.status(400).json("Media data not found!");

    const userAvatarObj = getUploadUri(req.media, "avatars");

    // return res.status(422).send({ status: "failed", message: "Testing" });

    user.avatar.image = userAvatarObj;
    user.avatar.lastUpdate = new Date();

    await user.save();

    res.json({ avatar: user.avatar });
  }
);

router.post("/generate_appinfo", async (req, res) => {
  const appInfo = new AppInfo({ ID: "APP" });

  await appInfo.save();

  res.send({ status: "success" });
});

router.get("/app_info", async (req, res) => {
  const appInfo = await AppInfo.findOne({ ID: "APP" });

  if (!appInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "App info not found!" });

  res.send({ status: "success", data: appInfo });
});

router.put("/updateProfile", auth, async (req, res) => {
  const userId = req.user.userId;

  const userData = req.body;

  const update_object = {};

  const getNameVal = ["state", "lga", "preffix", "schoolLevel"];

  Object.entries(userData).map(([key, val]) => {
    update_object[key] = getNameVal.includes(key) ? val?.name : val;
  });

  const preffix = update_object?.preffix;

  if (update_object["gender"]) {
    update_object["gender"] = update_object["gender"]?.name;
  }

  if (Boolean(preffix)) {
    if (preffix == "mr.") {
      update_object["gender"] = "male";
    } else if (["ms.", "mrs."].includes(preffix)) {
      update_object["gender"] = "female";
    }
  }

  if (update_object["class"]) {
    update_object["class"] = {
      hasChanged: true,
      level: update_object["class"]?.name?.toLowerCase(),
    };
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
