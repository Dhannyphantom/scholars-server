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
const { migrateMedia } = require("../controllers/migrateToS3");

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
  const { questions, username } = req.body;

  // --- Input validation ---
  if (!Array.isArray(questions) || questions.length === 0 || !questions[0]) {
    return res
      .status(422)
      .json({ message: "No questions provided!", status: "failed" });
  }

  // --- Resolve userId from username if provided ---
  if (username) {
    const userInfo = await User.findOne({
      username: username.toLowerCase(),
    }).select("_id");
    if (!userInfo) {
      return res
        .status(422)
        .json({ message: "Username not registered", status: "failed" });
    }
    userId = userInfo._id;
  }

  // --- Validate each question's subject/topic before saving anything ---
  for (const [index, item] of questions.entries()) {
    const label = `Question ${index + 1}`; // for readable error messages

    if (!item.subject?._id) {
      return res
        .status(422)
        .json({ message: `${label}: subject is required`, status: "failed" });
    }
    if (!item.topic?._id) {
      return res
        .status(422)
        .json({ message: `${label}: topic is required`, status: "failed" });
    }

    // Check subject exists and contains the given topic in one query
    const subject = await Subject.findOne({
      _id: item.subject._id,
      topics: item.topic._id, // ensures topic belongs to this subject
    }).select("_id");

    if (!subject) {
      // Distinguish between "subject not found" vs "topic not in subject" for clarity
      const subjectExists = await Subject.exists({ _id: item.subject._id });
      if (!subjectExists) {
        return res.status(422).json({
          message: `${label}: subject "${item.subject._id}" does not exist`,
          status: "failed",
        });
      }
      return res.status(422).json({
        message: `${label}: topic "${item.topic._id}" does not belong to subject "${item.subject._id}"`,
        status: "failed",
      });
    }

    // Check topic exists in Topic collection
    const topicExists = await Topic.exists({ _id: item.topic._id });
    if (!topicExists) {
      return res.status(422).json({
        message: `${label}: topic "${item.topic._id}" does not exist`,
        status: "failed",
      });
    }
  }

  // --- Save all questions in parallel (all validated above) ---
  const savedQuestions = await Promise.all(
    questions.map(async (item) => {
      const question = new Question({
        question: item.question,
        answers: (item.answers ?? [])
          .filter((a) => Boolean(a?.name))
          .map(({ name, correct, latex, isLatex }) => ({
            name,
            correct,
            latex,
            isLatex,
          })),
        timer: item.timer,
        point: item.point,
        user: userId,
        image: { type: "null" },
        subject: item.subject._id,
        topic: item.topic._id,
        categories: (item.categories ?? []).map((c) => c._id),
        isTheory: item.isTheory,
        explanation: item.explanation,
        questionLatex: item.questionLatex,
        explanationLatex: item.explanationLatex,
        isLatex: item.isLatex,
      });

      await question.save();
      return { questionId: question._id, topicId: item.topic._id };
    }),
  );

  // --- Batch-update topics and user points in parallel ---
  const topicUpdates = savedQuestions
    .filter((q) => q.topicId)
    .map(({ questionId, topicId }) =>
      Topic.updateOne(
        { _id: topicId },
        { $addToSet: { questions: questionId } },
      ),
    );

  const pointsUpdate = User.updateOne(
    { _id: userId },
    { $inc: { totalPoints: savedQuestions.length * 10 } },
  );

  await Promise.all([...topicUpdates, pointsUpdate]);

  return res.status(201).json({
    status: "success",
    message: "Questions uploaded successfully",
    count: savedQuestions.length,
  });
});

// router.post("/questions_auto", auth, async (req, res) => {
//   let userId = req.user.userId;
//   const reqData = req.body;

//   const { questions, username } = reqData;

//   if (!questions || !Boolean(questions[0])) {
//     return res
//       .status(422)
//       .send({ message: "No questions provided!", status: "failed" });
//   }

//   if (username) {
//     const userInfo = await User.findOne({
//       username: username?.toLowerCase(),
//     }).select("_id");
//     if (userInfo) {
//       userId = userInfo._id;
//     } else {
//       return res
//         .status(422)
//         .send({ message: "Username not registered", status: "failed" });
//     }
//   }

//   questions?.forEach(async (item) => {
//     let question = new Question({
//       question: item.question,
//       answers: item.answers
//         ?.filter((itemz) => Boolean(itemz?.name))
//         ?.map((obj) => ({
//           name: obj.name,
//           correct: obj.correct,
//         })),
//       timer: item.timer,
//       point: item.point,
//       user: userId,
//       image: { type: "null" },
//       subject: item?.subject?._id,
//       topic: item?.topic?._id,
//       categories: item?.categories?.map((obj) => obj._id),
//       isTheory: item?.isTheory,
//       explanation: item?.explanation,
//     });

//     await question.save();
//     await Topic.updateOne(
//       { _id: item?.topic?._id },
//       {
//         $addToSet: {
//           questions: question._id,
//         },
//       },
//     );

//     await User.updateOne(
//       { _id: userId },
//       {
//         $inc: {
//           totalPoints: 10,
//         },
//       },
//     );

//     //  save question to topics
//   });

//   res.send({ status: "success", message: "Questions uploaded successfully" });
// });

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

router.get("/mod_questions", async (req, res) => {
  console.log("Modifying DB....");

  // const data = await Question.updateMany(
  //   { topic: "69bc25a27450a5cc7c4aaf14" },
  //   {
  //     $set: {
  //       categories: [
  //         "678d59448f4a1d454f2ce813",
  //         "678d59448f4a1d454f2ce811",
  //         "678d59448f4a1d454f2ce80d",
  //         "678d59448f4a1d454f2ce80f",
  //       ],
  //     },
  //   },
  // );

  // console.log({ data });

  // =======================================================================
  // POPULATING THE TOPIC SUBJECT'S FIELDS
  const topics = await Topic.find({ subject: { $exists: false } }).lean();

  console.log(`Found ${topics.length} topics to migrate`);

  let success = 0;
  let failed = 0;

  for (const topic of topics) {
    if (!topic.questions?.length) {
      console.warn(
        `Topic ${topic._id} (${topic.name}) has no questions — skipping`,
      );
      failed++;
      continue;
    }

    // Grab the first populated question to extract subject
    const question = await Question.findOne({
      _id: { $in: topic.questions },
      subject: { $exists: true },
    })
      .populate("subject", "name")
      .lean();

    if (!question?.subject) {
      console.warn(
        `Topic ${topic._id} (${topic.name}) — no question with a subject found — skipping`,
      );
      failed++;
      continue;
    }

    await Topic.updateOne(
      { _id: topic._id },
      {
        $set: {
          subject: question.subject._id,
          subjectName: question.subject.name,
        },
      },
    );

    console.log(`✓ Topic "${topic.name}" → subject: ${question.subject.name}`);
    success++;
  }

  console.log(`\nDone. ${success} updated, ${failed} skipped.`);

  // ========================================================================================
  // ========================================================================================
  // ========================================================================================

  // 1. Get the question IDs first
  // const questions = await Question.find(
  //   { subject: "678d60356345f9e35e705eda", topic: "69b1b8b22ef27c21c2286204" },
  //   { _id: 1 },
  // );

  // const questionIds = questions.map((q) => q._id);

  // if (questionIds.length === 0) {
  //   console.log("No questions found");
  //   return;
  // }

  // // 2. Delete those questions
  // const question = await Question.deleteMany({
  //   _id: { $in: questionIds },
  // });

  // // 3. Remove them from the topic.questions array
  // const topic = await Topic.updateOne(
  //   { _id: "69b1b8b22ef27c21c2286204" },
  //   { $pull: { questions: { $in: questionIds } } },
  // );

  // ==============================================================
  // Step 1: get subject
  // const subject = await Subject.findById("678d60356345f9e35e705ee0").select(
  //   "topics",
  // );

  // if (!subject) throw new Error("Subject not found");

  // // Step 2: update all topics in that subject
  // const data = await Topic.updateMany(
  //   { _id: { $in: subject.topics } },
  //   {
  //     $set: {
  //       categories: [
  //         "678d59448f4a1d454f2ce813",
  //         "678d59448f4a1d454f2ce811",
  //         "678d59448f4a1d454f2ce80d",
  //         "678d59448f4a1d454f2ce80f",
  //       ],
  //     },
  //   },
  // );

  // console.log({ data });
  // =====================================================================================
  // const data = await Topic.updateMany(
  //   {
  //     _id: {
  //       $in: [
  //         "69b1b8b22ef27c21c2286204",
  //         "69b1b8c92ef27c21c2286207",
  //         "69b73f4b61d9d8ae64be4873",
  //         "69b7462561d9d8ae64be488d",
  //         "69b7462561d9d8ae64be488c",
  //         "69b7462561d9d8ae64be488b",
  //         "69b9a9f0e290d18b5cca323b",
  //         "69b9a9f0e290d18b5cca323d",
  //         "69b9a9f0e290d18b5cca323c",
  //         "69b9a9f0e290d18b5cca323a",
  //       ],
  //     },
  //   },
  //   {
  //     $addToSet: {
  //       categories: [
  //         "678d59448f4a1d454f2ce813",
  //         "678d59448f4a1d454f2ce811",
  //         "678d59448f4a1d454f2ce80d",
  //         "678d59448f4a1d454f2ce80f",
  //       ],
  //     },
  //   },
  // );

  // const checker = await Topic.find({ categories: { $size: 0 } });

  res.send({ message: "DB modified successfully" });
});

router.post("/api", async (req, res) => {
  // Question.image is an inline mediaSchema object: { uri, type, thumb, width, height }
  // Passing "image" (the object field) — the helper writes to image.uri + image.thumb
  await migrateMedia({
    model: Question,
    files: [{ field: "image", folder: "questions", type: "image" }],
  });

  // ── 2. Subject ──────────────────────────────────────────────────────────────
  // Subject.image is also a mediaSchema object (imported from User.js)
  // Same pattern — pass "image", helper resolves .uri and writes back .uri + .thumb
  await migrateMedia({
    model: Subject,
    files: [{ field: "image", folder: "subjects", type: "image" }],
  });

  // ── 3. Category ─────────────────────────────────────────────────────────────
  // Category.image — identical shape, same pattern
  await migrateMedia({
    model: Category,
    files: [{ field: "image", folder: "categories", type: "image" }],
  });

  res.send({ status: "success", message: "Media migration completed" });
});

module.exports = router;
