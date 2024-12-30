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
const { capFirstLetter, userSelector } = require("../controllers/helpers");

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

// MAKE A SEPERATE AUTH ROUTE CHECKER FOR TEACHERS ONLY

router.post("/create", auth, async (req, res) => {
  const data = req.body;
  const userId = req.user.userId;

  const school = new School({
    contact: data.contact,
    email: data.email,
    levels: data.levels?.map((obj) => ({ name: obj.name })),
    name: data.name,
    lga: data?.lga?.name,
    state: data?.state?.name,
    type: data?.type?.name,
    rep: userId,
    createdAt: new Date(),
    teachers: [{ user: userId }],
  });

  await school.save();

  res.send({ status: "success", data: school });
});

router.post("/verify", auth, async (req, res) => {
  const userId = req.user.userId;
  const { instanceId, instance, type, schoolId } = req.body;

  const userInfo = await User.findById(userId).select(
    "firstName lastName preffix"
  );
  const instanceInfo = await User.findById(instanceId).select(
    "firstName lastName preffix"
  );

  const school = await School.findOne({
    _id: schoolId,
    "teachers.user": userId,
  });

  const teacherData = school.teachers.find(
    (item) => item.user?.toString() == userId
  );

  if (!teacherData?.verified) {
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });
  }

  if (type === "accept") {
    if (instance == "teacher") {
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $set: {
            "teachers.$.verified": true,
          },
          $push: {
            announcements: {
              system: true,
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has verified ${capFirstLetter(
                instanceInfo?.preffix
              )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a fellow colleaque`,
              visibility: "all",
            },
          },
        }
      );
    }
  } else if (type == "reject") {
    if (instance == "teacher") {
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $pull: {
            teachers: { user: instanceId },
          },
          $push: {
            announcements: {
              system: true,
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has rejected ${capFirstLetter(
                instanceInfo?.preffix
              )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a fellow colleaque`,
              visibility: "all",
            },
          },
        }
      );
    }
  } else if (type == "unverify") {
    await School.updateOne(
      { _id: schoolId, "teachers.user": instanceId },
      {
        $set: {
          "teachers.$.verified": false,
        },
        $push: {
          announcements: {
            system: true,
            message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
              userInfo.firstName
            )} ${capFirstLetter(
              userInfo?.lastName
            )} has un-verified ${capFirstLetter(
              instanceInfo?.preffix
            )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
              instanceInfo?.lastName
            )} as a fellow colleaque`,
            visibility: "all",
          },
        },
      }
    );
  }

  res.send({ status: "success" });
});

router.post("/join", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.body;

  const userInfo = await User.findById(userId);
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "Invalid user account" });

  const school = await School.findById(schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  if (!school?.subscription?.isActive) {
    return res.status(422).send({
      status: "failed",
      message: "School does not have an active subscription",
    });
  }

  const isTeacher = userInfo?.accountType == "teacher";
  const isStudent = userInfo?.accountType == "student";

  if (isTeacher) {
    // check if teacher has joined other schools
    const teachSchool = await School.findOne({
      _id: { $ne: schoolId },
      "teachers.user": userId,
    });

    if (teachSchool) {
      teachSchool.teachers = teachSchool.teachers.filter(
        (item) => item?.user?.toString() != userId
      );
      await teachSchool.save();
    }

    // Check if school already has this teacher
    const checker = school.teachers.findIndex(
      (item) => item?.user?.toString() == userId
    );
    if (checker < 0) {
      school.teachers.push({ user: userId });
      await school.save();
    }
  } else if (isStudent) {
    const checker = school.students.findIndex(
      (item) => item?.user?.toString() == userId
    );
    if (checker < 0) {
      school.students.push({ user: userId });
      await school.save();
    }
  }

  res.send({ status: "success" });
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

  let school, isVerified;
  if (isTeacher) {
    school = await School.findOne({ "teachers.user": userId })
      .select("-__v -tx_history")
      .populate([
        {
          path: "teachers.user",
          model: "User",
          select: userSelector,
        },
        {
          path: "rep",
          model: "User",
          select: userSelector,
        },
      ]);
    if (school) {
      const teacherData = school.teachers.find(
        (item) => item.user?._id?.toString() == userId
      );
      isVerified = teacherData?.verified;
    }
  } else if (isStudent) {
    school = await School.findOne({ "students.user": userId }).select(
      "-__v -tx_history"
    );
  }

  res.send({ status: "success", data: school, isVerified });
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

router.get("/search", auth, async (req, res) => {
  const { q } = req.query;
  console.log({ q });
  const reqExp = new RegExp(q, "gi");

  const search = await School.find({ name: reqExp })
    .select("name state lga subscription rep")
    .populate([
      {
        path: "rep",
        model: "User",
        select: "avatar username firstName lastName preffix",
      },
    ]);

  res.send({ status: "success", data: search });
});

router.get("/instances", auth, async (req, res) => {
  const { type, schoolId } = req.query;
  let data;

  if (type === "teacher") {
    const school = await School.findById(schoolId)
      .select("teachers")
      .populate([
        {
          path: "teachers.user",
          model: "User",
          select: userSelector,
        },
      ]);

    data = school.teachers.sort((a, b) => a.verified - b.verified);
  }
  res.send({ status: "success", data });
});

module.exports = router;
