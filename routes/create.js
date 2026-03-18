const express = require("express");
const fs = require("fs");
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

router.post("/questions_auto", auth, async (req, res) => {
  let userId = req.user.userId;
  const reqData = req.body;

  const { questions, username } = reqData;

  if (!questions || !Boolean(questions[0])) {
    return res
      .status(422)
      .send({ message: "No questions provided!", status: "failed" });
  }

  if (username) {
    const userInfo = await User.findOne({
      username: username?.toLowerCase(),
    }).select("_id");
    if (userInfo) {
      userId = userInfo._id;
    } else {
      return res
        .status(422)
        .send({ message: "Username not registered", status: "failed" });
    }
  }

  questions?.forEach(async (item) => {
    let question = new Question({
      question: item.question,
      answers: item.answers
        ?.filter((itemz) => Boolean(itemz?.name))
        ?.map((obj) => ({
          name: obj.name,
          correct: obj.correct,
        })),
      timer: item.timer,
      point: item.point,
      user: userId,
      image: { type: "null" },
      subject: item?.subject?._id,
      topic: item?.topic?._id,
      categories: item?.categories?.map((obj) => obj._id),
      isTheory: item?.isTheory,
      explanation: item?.explanation,
    });

    await question.save();
    await Topic.updateOne(
      { _id: item?.topic?._id },
      {
        $addToSet: {
          questions: question._id,
        },
      },
    );

    await User.updateOne(
      { _id: userId },
      {
        $inc: {
          totalPoints: 10,
        },
      },
    );

    //  save question to topics
  });

  res.send({ status: "success", message: "Questions uploaded successfully" });
});

router.post(
  "/questions",
  [auth, uploader.array("media_file", 100), mediaUploader],
  async (req, res) => {
    const userId = req.user.userId;
    const reqData = req.data;
    const media = reqData?.media
      ? getUploadUri(req.media, reqData?.bucket)
      : [];

    // write to file
    fs.writeFile(
      "questions.json",
      JSON.stringify(reqData?.data || [], null, 2),
      (err) => {
        if (err) {
          console.error("Error writing file:", err);
        }
      },
    );

    reqData?.data?.forEach(async (item) => {
      const asset = media.find((obj) => obj.key == item?.image?.assetId);
      let question;
      if (Boolean(asset)) {
        delete asset.key;
        question = new Question({
          question: item.question,
          answers: item.answers
            ?.filter((itemz) => Boolean(itemz?.name))
            ?.map((obj) => ({
              name: obj.name,
              correct: obj.correct,
            })),
          timer: item.timer,
          point: item.point,
          image: asset,
          user: userId,
          subject: item?.subject?._id,
          topic: item?.topic?._id,
          categories: item?.categories?.map((obj) => obj._id),
          isTheory: item?.isTheory,
        });
      } else {
        question = new Question({
          question: item.question,
          answers: item.answers
            ?.filter((itemz) => Boolean(itemz?.name))
            ?.map((obj) => ({
              name: obj.name,
              correct: obj.correct,
            })),
          timer: item.timer,
          point: item.point,
          user: userId,
          image: { type: "null" },
          subject: item?.subject?._id,
          topic: item?.topic?._id,
          categories: item?.categories?.map((obj) => obj._id),
          isTheory: item?.isTheory,
        });
      }

      await question.save();
      await Topic.updateOne(
        { _id: item?.topic?._id },
        {
          $addToSet: {
            questions: question._id,
          },
        },
      );

      await User.updateOne(
        { _id: userId },
        {
          $inc: {
            totalPoints: 10,
          },
        },
      );

      //  save question to topics
    });

    res.send({ status: "success" });
  },
);

router.post("/topic", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;

  data.forEach(async (item) => {
    const topic = new Topic({
      name: item.name,
      user: userId,
    });

    await topic.save();
    //  save topics to subject
    await Subject.updateOne(
      { _id: item?.subject?._id },
      {
        $addToSet: {
          topics: topic._id,
        },
      },
    );
  });

  res.send({ status: "success" });
});

router.post(
  "/subject",
  [auth, uploader.array("media_file", 500), mediaUploader],
  async (req, res) => {
    const userId = req.user.userId;
    const reqData = req.data;
    const media = getUploadUri(req.media, reqData?.bucket);

    reqData.data.forEach(async (item) => {
      const asset = media.find((obj) => obj.key == item?.image?.assetId);
      delete asset.key;

      const subject = new Subject({
        name: item.name,
        image: asset,
        user: userId,
      });

      try {
        await subject.save();
        // push subject to selected categories
        const catIds = item.categories.map((cats) => cats._id);
        await Category.updateMany(
          { _id: { $in: catIds } },
          {
            $addToSet: {
              subjects: subject._id,
            },
          },
        );
      } catch (error) {
        return res.status(422).send({ status: "failed", error });
      }
    });

    res.send({ status: "success" });
  },
);

router.post(
  "/category",
  [auth, uploader.array("media_file", 100), mediaUploader],
  async (req, res) => {
    const userId = req.user.userId;
    const reqData = req.data;
    const media = getUploadUri(req.media, reqData?.bucket);

    reqData.data.forEach(async (item) => {
      const asset = media.find((obj) => obj.key == item?.image?.assetId);
      if (Boolean(asset)) {
        delete asset.key;
        const category = new Category({
          name: item.name,
          image: asset,
          user: userId,
        });

        try {
          await category.save();
        } catch (error) {
          return res.status(422).send({ status: "failed", error });
        }
      } else {
        return res
          .status(422)
          .send({ status: "failed", error: "Asset not found" });
      }
    });

    res.send({ status: "success" });
  },
);

router.delete("/questions_auto", auth, async (req, res) => {
  let userId = req.user.userId;
  const { topicId, subjectId, username } = req.query;

  if (!topicId) {
    return res
      .status(422)
      .send({ message: "topicId is required", status: "failed" });
  }

  if (username) {
    const userInfo = await User.findOne({
      username: username?.toLowerCase(),
    }).select("_id");
    if (userInfo) {
      userId = userInfo._id;
    } else {
      return res
        .status(422)
        .send({ message: "Username not registered", status: "failed" });
    }
  }

  const filter = {
    user: userId,
    topic: topicId,
    ...(subjectId && { subject: subjectId }),
  };

  const questions = await Question.find(filter).select("_id");

  if (!questions.length) {
    return res
      .status(404)
      .send({ message: "No questions found for this topic", status: "failed" });
  }

  const questionIds = questions.map((q) => q._id);

  await Question.deleteMany({ _id: { $in: questionIds } });

  await Topic.updateOne(
    { _id: topicId },
    { $pull: { questions: { $in: questionIds } } },
  );

  await User.updateOne(
    { _id: userId },
    { $inc: { totalPoints: -(10 * questionIds.length) } },
  );

  res.send({
    status: "success",
    message: `${questionIds.length} question(s) removed successfully`,
  });
});

// router.get("/mod_questions", async (req, res) => {
//   console.log("Modifying DB....");
//   // const data = await Topic.updateMany(
//   //   {
//   //     _id: {
//   //       $in: [
//   //         "69b1b8b22ef27c21c2286204",
//   //         "69b1b8c92ef27c21c2286207",
//   //         "69b73f4b61d9d8ae64be4873",
//   //         "69b7462561d9d8ae64be488d",
//   //         "69b7462561d9d8ae64be488c",
//   //         "69b7462561d9d8ae64be488b",
//   //         "69b9a9f0e290d18b5cca323b",
//   //         "69b9a9f0e290d18b5cca323d",
//   //         "69b9a9f0e290d18b5cca323c",
//   //         "69b9a9f0e290d18b5cca323a",
//   //       ],
//   //     },
//   //   },
//   //   {
//   //     $addToSet: {
//   //       categories: [
//   //         "678d59448f4a1d454f2ce813",
//   //         "678d59448f4a1d454f2ce811",
//   //         "678d59448f4a1d454f2ce80d",
//   //         "678d59448f4a1d454f2ce80f",
//   //       ],
//   //     },
//   //   },
//   // );

//   const checker = await Topic.find({ categories: { $size: 0 } });

//   res.send({ message: "DB modified successfully", checker });
// });

module.exports = router;
