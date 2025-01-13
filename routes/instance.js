const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const { getUploadUri } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { Question } = require("../models/Question");

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

router.put(
  "/category",
  [auth, uploader.array("media", 100), mediaUploader],
  async (req, res) => {
    const data = req.data;

    if (data?.delete) {
      await Category.deleteOne({ _id: data?._id });
    } else {
      if (data?.media) {
        const media = getUploadUri(req.media, data?.bucket);

        const asset = media.find((obj) => obj.key == data?.image?.assetId);
        delete asset.key;

        await Category.updateOne(
          { _id: data?._id },
          {
            $set: {
              name: data?.name,
              image: asset,
            },
          }
        );
      } else {
        await Category.updateOne(
          { _id: data?._id },
          {
            $set: {
              name: data?.name,
            },
          }
        );
      }
    }

    res.send({ status: "success", data });
  }
);

router.get("/subjects", auth, async (req, res) => {
  const subjects = await Subject.find();

  res.send({ status: "success", data: subjects });
});

router.get("/questions", auth, async (req, res) => {
  const { subjectId, topicId } = req.query;
  const questions = await Question.find().or([
    { subject: subjectId },
    { topic: topicId },
  ]);

  res.send({ status: "success", data: questions });
});

module.exports = router;
