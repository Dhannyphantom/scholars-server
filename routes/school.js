const express = require("express");
// const nodemailer = require("nodemailer");
// const mediaUploader = require("../middlewares/mediaUploader");
// const multer = require("multer");
// const { getUploadUri } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { School } = require("../models/School");
const { User } = require("../models/User");

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     return cb(null, "./uploads/assets/");
//   },
//   filename: (req, file, cb) => {
//     return cb(null, `${file.originalname}`);
//   },
// });

// const uploader = multer({ storage, limits: { fieldSize: 2 * 1024 * 1024 } }); // 2MB

const router = express.Router();

router.post("/create", auth, async (req, res) => {
  const data = req.body;
  const user = req.user.userId;

  const school = new School({
    contact: data.contact,
    email: data.email,
    levels: data.levels?.map((obj) => ({ name: obj.name })),
    name: data.name,
    lga: data?.lga?.name,
    state: data?.state?.name,
    type: data?.type?.name,
    rep: user,
    createdAt: new Date(),
    teachers: [user],
  });

  await school.save();

  res.send({ status: "success", data: school });
});

router.get("/fetch", auth, async (req, res) => {
  const userId = req.user.userId;

  const userInfo = await User.findById(userId).select("accountType");

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  const isTeacher = userInfo?.accountType == "teacher";
  const isStudent = userInfo?.accountType == "student";

  let school;
  if (isTeacher) {
    school = await School.findOne({ teachers: userId })
      .select("-__v -tx_history")
      .populate([
        {
          path: "teachers",
          model: "User",
          select: "username firstName lastName avatar preffix",
        },
      ]);
  } else if (isStudent) {
    school = await School.findOne({ students: userId }).select(
      "-__v -tx_history"
    );
  }

  res.send({ status: "success", data: school });
});

router.post("/class", auth, async (req, res) => {
  const data = req.body;
  const school = await School.findById(data?.schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  school.classes.push({ alias: data.name, level: data.class?.name });

  await school.save();

  res.send({ status: "success" });
});

router.get("/classes", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.query;
  const school = await School.findById(schoolId).select("classes");
  const userInfo = await User.findById(userId);

  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  res.send({
    status: "success",
    data: school.classes,
  });
});

module.exports = router;
