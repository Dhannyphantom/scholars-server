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
const { User } = require("../models/User");

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

router.get("/category", auth, async (req, res) => {
  const category = await Category.find();

  res.send({ status: "success", data: category });
});

router.get("/subjects", auth, async (req, res) => {
  const { type } = req.query;
  const userId = req.user.userId;

  const userInfo = await User.findById(userId).select("subjects accountType");

  let matchLookup = { $match: {} };

  if (type == "pro_filter" && userInfo?.accountType == "professional") {
    matchLookup = {
      $match: { _id: { $in: userInfo.subjects } },
    };
  }

  const subjects = await Subject.aggregate([
    matchLookup,
    {
      $lookup: {
        from: "questions", // The name of your questions collection
        localField: "_id",
        foreignField: "subject",
        as: "questions",
      },
    },
    {
      $lookup: {
        from: "categories", // The name of your questions collection
        localField: "_id",
        foreignField: "subjects",
        as: "categories",
      },
    },
    {
      $addFields: {
        numberOfQuestions: { $size: "$questions" },
        topicCount: { $size: "$topics" },
      },
    },
    {
      $project: {
        questions: 0, // Remove the questions array from the result
        topics: 0, // Remove the questions array from the result
      },
    },
    {
      $project: {
        categories: { name: 1, _id: 1 },
        topicCount: 1,
        numberOfQuestions: 1,
        name: 1,
        image: 1,
      },
    },
  ]);

  res.send({ status: "success", data: subjects });
});

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

router.get("/questions", auth, async (req, res) => {
  const { subjectId, topicId } = req.query;
  if (!subjectId)
    return res
      .status(422)
      .send({ status: "failed", message: "Please select a subject" });

  let questions;
  if (Boolean(topicId) && topicId !== "null") {
    questions = await Question.find({
      subject: subjectId,
      topic: topicId,
    }).populate([
      { path: "subject", model: "Subject", select: "name" },
      { path: "topic", model: "Topic", select: "name" },
      { path: "categories", model: "Category", select: "name" },
    ]);
  } else {
    questions = await Question.find({ subject: subjectId }).populate([
      { path: "subject", model: "Subject", select: "name" },
      { path: "topic", model: "Topic", select: "name" },
      { path: "categories", model: "Category", select: "name" },
    ]);
  }

  res.send({ status: "success", data: questions });
});

router.put(
  "/subject",
  [auth, uploader.array("media", 2), mediaUploader],
  async (req, res) => {
    const data = req.data;

    if (data?.delete) {
      await Subject.deleteOne({ _id: data?._id });
      await Category.updateMany(
        { subjects: { $in: data?._id } },
        {
          $pull: {
            subjects: data?._id,
          },
        }
      );
    } else {
      if (data?.media) {
        const media = getUploadUri(req.media, data?.bucket);

        const asset = media.find((obj) => obj.key == data?.image?.assetId);
        delete asset.key;

        await Subject.updateOne(
          { _id: data?._id },
          {
            $set: {
              name: data?.name,
              image: asset,
            },
          }
        );
      } else {
        await Subject.updateOne(
          { _id: data?._id },
          {
            $set: {
              name: data?.name,
            },
          }
        );
      }
      // update categories
      const catIds = data.categories.map((item) => item._id);
      await Category.updateMany(
        { _id: { $nin: catIds } },
        {
          $pull: {
            subjects: data?._id,
          },
        }
      );
      await Category.updateMany(
        { _id: { $in: catIds } },
        {
          $addToSet: {
            subjects: data?._id,
          },
        }
      );
    }

    res.send({ status: "success" });
  }
);

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

router.put("/topic", auth, async (req, res) => {
  const { name, subject, _id } = req.body;

  if (!name || !subject || !_id)
    return res
      .status(422)
      .send({ status: "failed", message: "Incomplete info" });

  if (req?.body?.delete == true) {
    await Topic.deleteOne({ _id });

    await Subject.updateMany(
      { topics: { $in: _id } },
      {
        $pull: {
          topics: _id,
        },
      }
    );
  } else {
    await Topic.updateOne(
      { _id },
      {
        $set: {
          name,
        },
      }
    );

    // Update subjects
    await Subject.updateMany(
      { topics: { $in: _id }, _id: { $ne: subject?._id } },
      {
        $pull: {
          topics: _id,
        },
      }
    );

    await Subject.updateOne(
      { _id: subject?._id },
      {
        $addToSet: {
          topics: _id,
        },
      }
    );
  }

  res.send({ status: "success" });
});

router.put("/question", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;

  if (req?.body?.delete == true) {
    await Topic.updateMany(
      { questions: { $in: data?._id } },
      {
        $pull: {
          questions: data?._id,
        },
      }
    );
    await Question.deleteOne({ _id: data?._id });
  } else {
    await Question.updateOne(
      { _id: data?._id },
      {
        $set: {
          question: data?.question,
          point: data?.point,
          timer: data?.timer,
          answers: data?.answers,
          topic: data?.topic?._id,
          subject: data?.subject?._id,
          categories: data?.categories?.map((item) => item._id),
          isTheory: data?.isTheory,
        },
        $addToSet: {
          edits: userId,
        },
      }
    );

    // Update Question Topic;
    await Topic.updateMany(
      { questions: { $in: data?._id }, _id: { $ne: data?.topic?._id } },
      {
        $pull: {
          questions: data?._id,
        },
      }
    );

    await Topic.updateMany(
      { questions: { $in: data?._id } },
      {
        $addToSet: {
          questions: data?._id,
        },
      }
    );
  }

  res.send({ status: "success" });
});

module.exports = router;
