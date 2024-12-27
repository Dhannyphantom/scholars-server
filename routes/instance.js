const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const { getUploadUri } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    return cb(null, "./uploads/assets/");
  },
  filename: (req, file, cb) => {
    return cb(null, `${file.originalname}`);
  },
});

const uploader = multer({ storage, limits: { fieldSize: 2 * 1024 * 1024 } }); // 2MB

const router = express.Router();

router.get("/topic", auth, async (req, res) => {
  const { subjectId } = req.query;
  const subject = await Subject.findById(subjectId)
    .populate([
      {
        path: "topics",
        model: "Topic",
        select: "name",
      },
    ])
    .select("-image -__v");

  res.send({ status: "success", data: subject?.topics });
});

router.get("/category", auth, async (req, res) => {
  const category = await Category.find();

  res.send({ status: "success", data: category });
});

router.get("/subjects", auth, async (req, res) => {
  const subjects = await Subject.find();

  res.send({ status: "success", data: subjects });
});

module.exports = router;
