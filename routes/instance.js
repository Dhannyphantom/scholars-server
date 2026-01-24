const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const { getUploadUri, writeToJSONConsole } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { Question } = require("../models/Question");
const { User } = require("../models/User");
const { default: mongoose } = require("mongoose");
const { AppInfo } = require("../models/AppInfo");
const { Quiz } = require("../models/Quiz");

const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEN_KEY });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    return cb(null, "./uploads/assets/");
  },
  filename: (req, file, cb) => {
    return cb(null, `${file.originalname}`);
  },
});

const A_DAY = 1000 * 60 * 60 * 24; // A DAY
const A_WEEK = 1000 * 60 * 60 * 24 * 7; // A WEEK
const QUESTIONS_PER_SUBJECT = 25;
const REPEATED_QUESTION_POINTS = 0.2;
const MAX_DAILY_QUESTIONS = 100;
const MAX_QUESTIONS_PER_SUBJECT = 50;
const MAX_DAILY_SUBJECTS = 2;

const uploader = multer({ storage, limits: { fieldSize: 2 * 1024 * 1024 } }); // 2MB

const router = express.Router();

router.get("/category", auth, async (req, res) => {
  const category = await Category.find().select("name image");

  res.send({ status: "success", data: category });
});

router.get("/subject_category", auth, async (req, res) => {
  const { categoryId } = req.query;
  const userId = req.user.userId;

  try {
    // Validate categoryId
    if (!categoryId) {
      return res.status(400).send({
        status: "failed",
        message: "Category ID is required",
      });
    }

    // Fetch user info with qBank
    const userInfo = await User.findById(userId)
      .select("subjects accountType qBank")
      .lean();

    if (!userInfo) {
      return res.status(404).send({
        status: "failed",
        message: "User not found",
      });
    }

    // Verify category exists
    const category =
      await Category.findById(categoryId).select("name subjects");

    if (!category) {
      return res.status(404).send({
        status: "failed",
        message: "Category not found",
      });
    }

    // Convert user's qBank to ObjectIds for matching
    const userQBank = (userInfo?.qBank || []).map(
      (q) => new mongoose.Types.ObjectId(q.toString()),
    );

    // Aggregate subjects with progress tracking for this category
    const subjects = await Subject.aggregate([
      // Filter to only subjects in this category
      {
        $match: { _id: { $in: category.subjects } },
      },

      // Lookup all questions for this subject
      {
        $lookup: {
          from: "questions",
          localField: "_id",
          foreignField: "subject",
          as: "allQuestions",
        },
      },

      // Lookup categories this subject belongs to
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "subjects",
          as: "categories",
        },
      },

      // Add computed fields
      {
        $addFields: {
          // Total number of questions for this subject
          numberOfQuestions: { $size: "$allQuestions" },

          // Topic count
          topicCount: { $size: "$topics" },

          // Filter questions that user has answered
          answeredQuestions: {
            $filter: {
              input: "$allQuestions",
              as: "question",
              cond: { $in: ["$$question._id", userQBank] },
            },
          },
        },
      },

      // Add count of answered questions and progress
      {
        $addFields: {
          questionsAnswered: { $size: "$answeredQuestions" },
          progressPercentage: {
            $cond: {
              if: { $eq: ["$numberOfQuestions", 0] },
              then: 0,
              else: {
                $multiply: [
                  {
                    $divide: [
                      { $size: "$answeredQuestions" },
                      "$numberOfQuestions",
                    ],
                  },
                  100,
                ],
              },
            },
          },
        },
      },

      // Clean up - remove unnecessary fields
      {
        $project: {
          allQuestions: 0,
          answeredQuestions: 0,
          topics: 0,
        },
      },

      // Final projection - shape the output
      {
        $project: {
          _id: 1,
          name: 1,
          image: 1,
          numberOfQuestions: 1,
          questionsAnswered: 1,
          questionsRemaining: {
            $subtract: ["$numberOfQuestions", "$questionsAnswered"],
          },
          progressPercentage: {
            $round: ["$progressPercentage", 2],
          },
          topicCount: 1,
          categories: {
            _id: 1,
            name: 1,
          },
          isCompleted: {
            $eq: ["$numberOfQuestions", "$questionsAnswered"],
          },
          hasStarted: {
            $gt: ["$questionsAnswered", 0],
          },
        },
      },

      // Sort by progress (subjects in progress first, then by name)
      {
        $sort: {
          hasStarted: -1, // Started subjects first
          progressPercentage: -1, // Then by progress
          name: 1, // Then alphabetically
        },
      },
    ]);

    // Calculate category-specific statistics
    const stats = {
      totalSubjects: subjects.length,
      completedSubjects: subjects.filter((s) => s.isCompleted).length,
      inProgressSubjects: subjects.filter((s) => s.hasStarted && !s.isCompleted)
        .length,
      notStartedSubjects: subjects.filter((s) => !s.hasStarted).length,
      totalQuestions: subjects.reduce((sum, s) => sum + s.numberOfQuestions, 0),
      totalAnswered: subjects.reduce((sum, s) => sum + s.questionsAnswered, 0),
    };

    stats.overallProgress =
      stats.totalQuestions > 0
        ? ((stats.totalAnswered / stats.totalQuestions) * 100).toFixed(2)
        : 0;

    res.send({
      status: "success",
      data: subjects,
      meta: {
        categoryId: category._id,
        categoryName: category.name,
        userType: userInfo.accountType,
        stats,
      },
    });
  } catch (error) {
    console.error("Error fetching category subjects:", error);
    return res.status(500).send({
      status: "failed",
      message: "Failed to fetch category subjects",
      error: error.message,
    });
  }
});

router.get("/subjects", auth, async (req, res) => {
  const { type } = req.query;
  const userId = req.user.userId;

  try {
    // Fetch user info with qBank
    const userInfo = await User.findById(userId)
      .select("subjects accountType qBank")
      .lean();

    if (!userInfo) {
      return res.status(404).send({
        status: "failed",
        message: "User not found",
      });
    }

    // Prepare match stage for filtering
    let matchLookup = { $match: {} };

    if (type === "pro_filter" && userInfo?.accountType === "professional") {
      // Filter to only show subjects this professional has selected
      matchLookup = {
        $match: { _id: { $in: userInfo.subjects } },
      };
    }

    // Convert user's qBank to ObjectIds for matching
    const userQBank = (userInfo?.qBank || []).map(
      (q) => new mongoose.Types.ObjectId(q.toString()),
    );

    // Aggregate subjects with progress tracking
    const subjects = await Subject.aggregate([
      matchLookup,

      // Lookup all questions for this subject
      {
        $lookup: {
          from: "questions",
          localField: "_id",
          foreignField: "subject",
          as: "allQuestions",
        },
      },

      // Lookup categories this subject belongs to
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "subjects",
          as: "categories",
        },
      },

      // Add computed fields
      {
        $addFields: {
          // Total number of questions for this subject
          numberOfQuestions: { $size: "$allQuestions" },

          // Topic count
          topicCount: { $size: "$topics" },

          // Filter questions that user has answered
          answeredQuestions: {
            $filter: {
              input: "$allQuestions",
              as: "question",
              cond: { $in: ["$$question._id", userQBank] },
            },
          },
        },
      },

      // Add count of answered questions and progress
      {
        $addFields: {
          questionsAnswered: { $size: "$answeredQuestions" },
          progressPercentage: {
            $cond: {
              if: { $eq: ["$numberOfQuestions", 0] },
              then: 0,
              else: {
                $multiply: [
                  {
                    $divide: [
                      { $size: "$answeredQuestions" },
                      "$numberOfQuestions",
                    ],
                  },
                  100,
                ],
              },
            },
          },
        },
      },

      // Clean up - remove unnecessary fields
      {
        $project: {
          allQuestions: 0,
          answeredQuestions: 0,
          topics: 0,
        },
      },

      // Final projection - shape the output
      {
        $project: {
          _id: 1,
          name: 1,
          image: 1,
          numberOfQuestions: 1,
          questionsAnswered: 1,
          questionsRemaining: {
            $subtract: ["$numberOfQuestions", "$questionsAnswered"],
          },
          progressPercentage: {
            $round: ["$progressPercentage", 2],
          },
          topicCount: 1,
          categories: {
            _id: 1,
            name: 1,
          },
          isCompleted: {
            $eq: ["$numberOfQuestions", "$questionsAnswered"],
          },
          hasStarted: {
            $gt: ["$questionsAnswered", 0],
          },
        },
      },

      // Optional: Sort by progress (subjects in progress first, then by name)
      {
        $sort: {
          hasStarted: -1, // Started subjects first
          progressPercentage: -1, // Then by progress
          name: 1, // Then alphabetically
        },
      },
    ]);

    // Calculate overall statistics
    const stats = {
      totalSubjects: subjects.length,
      completedSubjects: subjects.filter((s) => s.isCompleted).length,
      inProgressSubjects: subjects.filter((s) => s.hasStarted && !s.isCompleted)
        .length,
      notStartedSubjects: subjects.filter((s) => !s.hasStarted).length,
      totalQuestions: subjects.reduce((sum, s) => sum + s.numberOfQuestions, 0),
      totalAnswered: subjects.reduce((sum, s) => sum + s.questionsAnswered, 0),
    };

    stats.overallProgress =
      stats.totalQuestions > 0
        ? ((stats.totalAnswered / stats.totalQuestions) * 100).toFixed(2)
        : 0;

    res.send({
      status: "success",
      data: subjects,
      meta: {
        userType: userInfo.accountType,
        stats,
      },
    });
  } catch (error) {
    console.error("Error fetching subjects:", error);
    return res.status(500).send({
      status: "failed",
      message: "Failed to fetch subjects",
      error: error.message,
    });
  }
});

router.post("/subject_topics", auth, async (req, res) => {
  const userId = req.user.userId;
  const { subjects } = req.body;

  if (!subjects || (Boolean(subjects) && !subjects[0]))
    return res
      .status(422)
      .send({ status: "failed", message: "Provide subject data" });

  const userInfo = await User.findById(userId).select("qBank").lean();
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found!" });

  const banks = userInfo?.qBank || [];

  const userQBank = banks.map((q) => q.toString());

  let subjectList = await Subject.find({ _id: { $in: subjects } })
    .populate([{ path: "topics", model: "Topic", select: "name questions" }])
    .select("name topics")
    .lean();

  subjectList = subjectList.map((subject) => {
    const topics = subject.topics.map((topic, idx) => {
      // Calculate questions in the user's qBank
      const totalQuestions = topic.questions.length;
      const qBankQuestions = topic.questions.filter((question) =>
        userQBank.includes(question._id.toString()),
      );

      return {
        _id: topic._id,
        name: topic.name,
        visible: idx === 0,
        hasStudied: false,
        totalQuestions,
        qBankQuestions: qBankQuestions.length, // Count of matched questions
        progress: (qBankQuestions / (totalQuestions ?? 1)) * 100,
      };
    });

    return {
      _id: subject._id,
      name: subject.name,
      topics,
    };
  });

  res.send({ status: "success", data: subjectList });
});

router.get("/topic", auth, async (req, res) => {
  const userId = req.user.userId;
  const { subjectId } = req.query;

  const userInfo = await User.findById(userId).select("qBank").lean();
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found!" });

  const userQBank = userInfo.qBank.map((q) => q.toString());

  let subject = await Subject.findById(subjectId)
    .populate([
      {
        path: "topics",
        select: "name questions",
      },
    ])
    .select("-image -__v")
    .lean();

  const topics = subject.topics.map((topic) => {
    // Calculate questions in the user's qBank
    const totalQuestions = topic.questions.length;
    const qBankQuestions = topic.questions.filter((question) =>
      userQBank.includes(question._id.toString()),
    );

    return {
      _id: topic._id,
      name: topic.name,
      totalQuestions,
      qBankQuestions: qBankQuestions.length, // Count of matched questions
      progress: (qBankQuestions / (totalQuestions ?? 1)) * 100,
    };
  });

  res.send({ status: "success", data: topics, id: subjectId });
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

router.get("/my_questions", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(userId) } },
      { $project: { qBank: 1 } },
      { $unwind: "$qBank" },
      {
        $lookup: {
          from: "questions",
          let: { questionId: "$qBank" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$questionId"] } } },
            {
              $lookup: {
                from: "topics",
                localField: "topic",
                foreignField: "_id",
                as: "topicData",
              },
            },
            {
              $lookup: {
                from: "subjects",
                localField: "subject",
                foreignField: "_id",
                as: "subjectData",
              },
            },
            {
              $lookup: {
                from: "categories",
                localField: "categories",
                foreignField: "_id",
                as: "categoriesData",
              },
            },
            {
              $project: {
                question: 1,
                answers: 1,
                point: 1,
                timer: 1,
                isTheory: 1,
                image: 1,
                topic: { $arrayElemAt: ["$topicData", 0] },
                subject: { $arrayElemAt: ["$subjectData", 0] },
                categories: "$categoriesData",
              },
            },
          ],
          as: "questionDetails",
        },
      },
      {
        $replaceRoot: { newRoot: { $arrayElemAt: ["$questionDetails", 0] } },
      },
      // Add random field for shuffling
      {
        $addFields: {
          randomSort: { $rand: {} },
        },
      },
      // Group questions by subject and topic
      {
        $group: {
          _id: {
            subjectId: "$subject._id",
            subjectName: "$subject.name",
            topicId: "$topic._id",
            topicName: "$topic.name",
          },
          questions: {
            $push: {
              _id: "$_id",
              question: "$question",
              answers: "$answers",
              point: "$point",
              timer: "$timer",
              isTheory: "$isTheory",
              image: "$image",
              categories: "$categories",
              randomSort: "$randomSort",
            },
          },
        },
      },
      // Group topics within subjects
      {
        $group: {
          _id: {
            subjectId: "$_id.subjectId",
            subjectName: "$_id.subjectName",
          },
          topics: {
            $push: {
              _id: "$_id.topicId",
              name: "$_id.topicName",
              questions: "$questions",
              questionCount: { $size: "$questions" },
            },
          },
          totalQuestions: { $sum: { $size: "$questions" } },
        },
      },
      // Format the final output
      {
        $project: {
          _id: "$_id.subjectId",
          name: "$_id.subjectName",
          topics: 1,
          totalQuestions: 1,
        },
      },
      // Sort subjects by name
      { $sort: { name: 1 } },
    ];

    const subjects = await User.aggregate(pipeline);

    // Randomize questions within each topic and remove randomSort field
    subjects.forEach((subject) => {
      subject.topics.forEach((topic) => {
        // Sort by the random field
        topic.questions.sort((a, b) => a.randomSort - b.randomSort);
        // Remove the randomSort field from each question
        topic.questions.forEach((q) => delete q.randomSort);
      });
    });

    // Calculate total questions across all subjects
    const totalQuestions = subjects.reduce(
      (sum, subject) => sum + subject.totalQuestions,
      0,
    );

    res.send({
      success: true,
      data: subjects,
      totalQuestions,
      totalSubjects: subjects.length,
    });
  } catch (error) {
    console.error("Error fetching user qBank questions:", error);
    res.status(500).send({
      success: false,
      message: "Failed to fetch questions",
    });
  }
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
        },
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
          },
        );
      } else {
        await Subject.updateOne(
          { _id: data?._id },
          {
            $set: {
              name: data?.name,
            },
          },
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
        },
      );
      await Category.updateMany(
        { _id: { $in: catIds } },
        {
          $addToSet: {
            subjects: data?._id,
          },
        },
      );
    }

    res.send({ status: "success" });
  },
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
          },
        );
      } else {
        await Category.updateOne(
          { _id: data?._id },
          {
            $set: {
              name: data?.name,
            },
          },
        );
      }
    }

    res.send({ status: "success", data });
  },
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
      },
    );
  } else {
    await Topic.updateOne(
      { _id },
      {
        $set: {
          name,
        },
      },
    );

    // Update subjects
    await Subject.updateMany(
      { topics: { $in: _id }, _id: { $ne: subject?._id } },
      {
        $pull: {
          topics: _id,
        },
      },
    );

    await Subject.updateOne(
      { _id: subject?._id },
      {
        $addToSet: {
          topics: _id,
        },
      },
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
      },
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
      },
    );

    // Update Question Topic;
    await Topic.updateMany(
      { questions: { $in: data?._id }, _id: { $ne: data?.topic?._id } },
      {
        $pull: {
          questions: data?._id,
        },
      },
    );

    await Topic.updateMany(
      { questions: { $in: data?._id } },
      {
        $addToSet: {
          questions: data?._id,
        },
      },
    );
  }

  res.send({ status: "success" });
});

router.post("/premium_quiz", auth, async (req, res) => {
  const reqData = req.body;
  const userId = req.user.userId;
  const { mode } = reqData; // 'solo' or 'friends'

  try {
    const userInfo = await User.findById(userId).select("qBank quota").lean();

    if (!userInfo) {
      return res.status(422).send({
        status: "failed",
        message: "User not found!",
      });
    }

    // Validate request
    if (!reqData?.categoryId) {
      return res.status(422).send({
        status: "failed",
        message: "Category is required!",
      });
    }

    if (!reqData?.subjects || reqData.subjects.length === 0) {
      return res.status(422).send({
        status: "failed",
        message: "At least one subject is required!",
      });
    }

    if (reqData.subjects.length > 2) {
      return res.status(422).send({
        status: "failed",
        message: "Maximum of 2 subjects allowed per quiz!",
      });
    }

    // FOR SOLO MODE: Check daily limits
    // FOR MULTIPLAYER: Skip limit checks (host manages this)
    if (mode === "solo") {
      const A_DAY = 1000 * 60 * 60 * 24;
      const currentQuota = userInfo.quota;
      const isToday =
        currentQuota &&
        new Date() - new Date(currentQuota.daily_update) < A_DAY;

      const dailyQuestionsCount = isToday
        ? currentQuota.daily_questions_count || 0
        : 0;
      const dailySubjects = isToday ? currentQuota.daily_subjects || [] : [];

      const requestedQuestionsCount = reqData.subjects.length * 25;

      if (dailyQuestionsCount + requestedQuestionsCount > 100) {
        return res.status(429).send({
          status: "failed",
          message: `Cannot fetch quiz. You have ${
            100 - dailyQuestionsCount
          } questions remaining today.`,
          data: {
            questionsRemaining: 100 - dailyQuestionsCount,
            questionsRequested: requestedQuestionsCount,
          },
        });
      }

      // Check subject limits
      for (const subject of reqData.subjects) {
        const existingSubject = dailySubjects.find(
          (s) => s.subject.toString() === subject._id.toString(),
        );
        const currentSubjectCount = existingSubject
          ? existingSubject.questions_count
          : 0;

        if (currentSubjectCount + 25 > 50) {
          return res.status(429).send({
            status: "failed",
            message: `Subject limit exceeded. You have ${
              50 - currentSubjectCount
            } questions remaining for this subject.`,
          });
        }
      }

      // Check max subjects per day
      const uniqueSubjectIds = new Set(
        reqData.subjects.map((s) => s._id.toString()),
      );
      const existingSubjectIds = new Set(
        dailySubjects.map((s) => s.subject.toString()),
      );
      uniqueSubjectIds.forEach((id) => existingSubjectIds.add(id));

      if (existingSubjectIds.size > 2) {
        return res.status(429).send({
          status: "failed",
          message: "You can only practice 2 subjects per day.",
        });
      }
    }

    // Prepare query
    const subjectIds = reqData.subjects.map(
      (item) => new mongoose.Types.ObjectId(item._id),
    );

    const topicIds = [];
    reqData.subjects.forEach((subject) => {
      if (subject.topics && subject.topics.length > 0) {
        subject.topics.forEach((topic) => {
          topicIds.push(new mongoose.Types.ObjectId(topic));
        });
      }
    });

    const userQBank = (userInfo?.qBank || []).map(
      (q) => new mongoose.Types.ObjectId(q.toString()),
    );
    const categoryId = new mongoose.Types.ObjectId(reqData.categoryId);

    const matchStage = {
      categories: categoryId,
      subject: { $in: subjectIds },
      isTheory: false,
    };

    if (topicIds.length > 0) {
      matchStage.topic = { $in: topicIds };
    }

    // Fetch questions
    const questions = await Question.aggregate([
      { $match: matchStage },
      {
        $addFields: {
          hasAnswered: { $in: ["$_id", userQBank] },
          randomSeed: { $rand: {} },
        },
      },
      {
        $sort: {
          hasAnswered: 1, // Fresh questions first
          randomSeed: 1,
        },
      },
      {
        $group: {
          _id: "$subject",
          questions: { $push: "$$ROOT" },
        },
      },
      {
        $addFields: {
          questions: { $slice: ["$questions", 25] },
        },
      },
      {
        $lookup: {
          from: "subjects",
          localField: "_id",
          foreignField: "_id",
          as: "subjectDetails",
        },
      },
      { $unwind: "$subjectDetails" },
      {
        $project: {
          subject: {
            _id: "$subjectDetails._id",
            name: "$subjectDetails.name",
          },
          questions: {
            $map: {
              input: "$questions",
              as: "q",
              in: {
                _id: "$$q._id",
                question: "$$q.question",
                answers: "$$q.answers",
                timer: "$$q.timer",
                point: "$$q.point", // KEEP ORIGINAL - don't override!
                subject: "$$q.subject",
                topic: "$$q.topic",
                categories: "$$q.categories",
                hasAnswered: "$$q.hasAnswered", // Only for host's reference
                isTheory: "$$q.isTheory",
              },
            },
          },
        },
      },
    ]);

    // Validate results
    if (questions.length === 0) {
      return res.status(404).send({
        status: "failed",
        message: "No questions found for the selected criteria",
      });
    }

    if (questions.length !== reqData.subjects.length) {
      return res.status(404).send({
        status: "failed",
        message: "Not enough questions available for selected subjects/topics",
      });
    }

    const insufficientSubjects = questions.filter(
      (q) => q.questions.length < 25,
    );
    if (insufficientSubjects.length > 0) {
      return res.status(404).send({
        status: "failed",
        message: "Some subjects don't have enough questions",
        data: {
          insufficientSubjects: insufficientSubjects.map((s) => ({
            subjectId: s.subject._id,
            subjectName: s.subject.name,
            availableQuestions: s.questions.length,
            requiredQuestions: 25,
          })),
        },
      });
    }

    // Calculate stats (for host only)
    const stats = {
      totalQuestions: 0,
      freshQuestions: 0,
      answeredQuestions: 0,
      subjects: [],
    };

    questions.forEach((subjectData) => {
      const subjectStats = {
        subjectId: subjectData.subject._id,
        subjectName: subjectData.subject.name,
        totalQuestions: subjectData.questions.length,
        freshQuestions: 0,
        answeredQuestions: 0,
      };

      subjectData.questions.forEach((q) => {
        stats.totalQuestions++;
        if (q.hasAnswered) {
          stats.answeredQuestions++;
          subjectStats.answeredQuestions++;
        } else {
          stats.freshQuestions++;
          subjectStats.freshQuestions++;
        }
      });

      stats.subjects.push(subjectStats);
    });

    res.send({
      status: "success",
      data: questions,
      meta: {
        mode: mode || "solo",
        questionsPerSubject: 25,
        repeatedQuestionPoints: 0.2,
        stats, // These stats are only accurate for the host
        note:
          mode === "friends"
            ? "Stats shown are for host only. Each player's points will be calculated based on their individual history."
            : null,
      },
    });
  } catch (error) {
    console.error("Error fetching premium quiz:", error);
    return res.status(500).send({
      status: "failed",
      message: "Failed to fetch quiz questions",
      error: error.message,
    });
  }
});

// ==========================================
// 3. UPDATED SUBMIT_PREMIUM ENDPOINT
// ==========================================

router.post("/submit_premium", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  const { questions, type, mode, sessionId, participantCount, rank, isWinner } =
    data;

  const userInfo = await User.findById(userId).select(
    "accountType quota quotas points totalPoints qBank quizStats quizHistory",
  );

  if (!userInfo) {
    return res.status(422).send({
      status: "failed",
      message: "User not found",
    });
  }

  if (userInfo.accountType !== "student") {
    return res.status(422).send({
      status: "failed",
      message: "User not authorized",
    });
  }

  try {
    const appInfo = await AppInfo.findOne({ ID: "APP" });

    // ========================================
    // CALCULATE POINTS BASED ON THIS USER'S qBank
    // ========================================
    const REPEATED_QUESTION_POINTS = 0.2;
    const userQBank = (userInfo.qBank || []).map((q) => q.toString());
    const qBankSet = new Set(userQBank);

    let totalPoints = 0;
    const newQuestionIds = [];
    const answeredQuestionIds = [];
    let correctAnswers = 0;
    let totalQuestions = 0;

    const studentSubjects = [];
    const questionIds = [];
    const questionData = [];
    const subjectIds = [];
    const topicIds = [];

    questions.forEach((quest) => {
      studentSubjects.push({
        subject: quest.subject._id,
        questions: quest.questions.map((q) => q._id),
      });

      subjectIds.push(quest.subject._id);

      quest.questions.forEach((question) => {
        totalQuestions++;
        questionIds.push(question._id);

        const questionId = question._id.toString();
        const isNewQuestion = !qBankSet.has(questionId);

        // Calculate points based on THIS user's history
        if (question.answered?.correct) {
          correctAnswers++;
          if (isNewQuestion) {
            // Award full points for NEW correct answers
            totalPoints += question.point;
            newQuestionIds.push(question._id);
          } else {
            // Award 0.2 points for REPEATED correct answers
            totalPoints += REPEATED_QUESTION_POINTS;
            answeredQuestionIds.push(question._id);
          }
        } else {
          // Wrong answer - deduct points
          totalPoints -= appInfo.POINT_FAIL;
          if (isNewQuestion) {
            newQuestionIds.push(question._id);
          } else {
            answeredQuestionIds.push(question._id);
          }
        }

        questionData.push({
          question: question.question,
          answers: question.answers?.map((ans) => ({
            ...ans,
            name: ans?.name || "null",
          })),
          answered: question.answered,
          timer: question.timer,
          point: question.point,
          subject: question.subject,
          topic: question.topic,
          categories: question.categories,
        });

        if (!topicIds.includes(question.topic)) {
          topicIds.push(question.topic);
        }
      });
    });

    totalPoints = Math.max(0, totalPoints);

    // ========================================
    // UPDATE QUOTA (ONLY FOR SOLO MODE)
    // ========================================
    const A_DAY = 1000 * 60 * 60 * 24;
    const A_WEEK = 1000 * 60 * 60 * 24 * 7;

    if (mode === "solo") {
      const currentQuota = userInfo.quota;
      let updatedQuota;

      if (
        currentQuota &&
        new Date() - new Date(currentQuota.daily_update) < A_DAY
      ) {
        const dailySubjects = currentQuota.daily_subjects || [];

        questions.forEach((quest) => {
          const subjId = quest.subject._id.toString();
          const existingSubj = dailySubjects.find(
            (s) => s.subject.toString() === subjId,
          );

          if (existingSubj) {
            existingSubj.questions_count += quest.questions.length;
          } else {
            dailySubjects.push({
              subject: quest.subject._id,
              questions_count: quest.questions.length,
              date: Date.now(),
            });
          }
        });

        updatedQuota = {
          last_update: Date.now(),
          daily_update: currentQuota.daily_update,
          weekly_update: currentQuota.weekly_update,
          point_per_week: totalPoints + currentQuota.point_per_week,
          subjects: currentQuota.subjects.concat(studentSubjects),
          daily_questions: currentQuota.daily_questions.concat(questionIds),
          daily_questions_count:
            (currentQuota.daily_questions_count || 0) + questionIds.length,
          daily_subjects: dailySubjects,
        };

        if (new Date() - new Date(currentQuota.weekly_update) > A_WEEK) {
          userInfo.quotas?.push(currentQuota);
          updatedQuota.weekly_update = Date.now();
          updatedQuota.point_per_week = totalPoints;
        }
      } else {
        const dailySubjects = questions.map((quest) => ({
          subject: quest.subject._id,
          questions_count: quest.questions.length,
          date: Date.now(),
        }));

        updatedQuota = {
          last_update: Date.now(),
          daily_update: Date.now(),
          weekly_update: currentQuota?.weekly_update || Date.now(),
          point_per_week: currentQuota
            ? totalPoints + currentQuota.point_per_week
            : totalPoints,
          subjects: studentSubjects,
          daily_questions: questionIds,
          daily_questions_count: questionIds.length,
          daily_subjects: dailySubjects,
        };

        if (
          currentQuota &&
          new Date() - new Date(currentQuota.weekly_update) > A_WEEK
        ) {
          userInfo.quotas?.push(currentQuota);
          updatedQuota.weekly_update = Date.now();
          updatedQuota.point_per_week = totalPoints;
        }
      }

      userInfo.quota = updatedQuota;
    }

    // ========================================
    // UPDATE USER POINTS & qBank
    // ========================================
    userInfo.points += totalPoints;
    userInfo.totalPoints += totalPoints;
    userInfo.qBank = userInfo.qBank.concat(newQuestionIds);

    // ========================================
    // UPDATE QUIZ STATS
    // ========================================
    if (!userInfo.quizStats) {
      userInfo.quizStats = {};
    }

    userInfo.quizStats.totalQuizzes =
      (userInfo.quizStats.totalQuizzes || 0) + 1;

    if (mode === "solo") {
      userInfo.quizStats.totalSoloQuizzes =
        (userInfo.quizStats.totalSoloQuizzes || 0) + 1;
    } else if (mode === "friends") {
      userInfo.quizStats.totalMultiplayerQuizzes =
        (userInfo.quizStats.totalMultiplayerQuizzes || 0) + 1;

      if (isWinner) {
        userInfo.quizStats.totalWins = (userInfo.quizStats.totalWins || 0) + 1;
        userInfo.quizStats.multiplayerStats.wins =
          (userInfo.quizStats.multiplayerStats?.wins || 0) + 1;
      }

      if (rank === 2) {
        userInfo.quizStats.multiplayerStats.secondPlace =
          (userInfo.quizStats.multiplayerStats?.secondPlace || 0) + 1;
      } else if (rank === 3) {
        userInfo.quizStats.multiplayerStats.thirdPlace =
          (userInfo.quizStats.multiplayerStats?.thirdPlace || 0) + 1;
      }
    }

    userInfo.quizStats.totalCorrectAnswers =
      (userInfo.quizStats.totalCorrectAnswers || 0) + correctAnswers;
    userInfo.quizStats.totalQuestionsAnswered =
      (userInfo.quizStats.totalQuestionsAnswered || 0) + totalQuestions;

    // ========================================
    // SAVE QUIZ DOCUMENT
    // ========================================
    const newQuiz = new Quiz({
      user: userId,
      mode,
      type,
      questions: questionData,
      subjects: subjectIds,
      topics: topicIds,
      sessionId: sessionId,
    });

    await newQuiz.save();
    // ========================================
    // ADD TO QUIZ HISTORY
    // ========================================
    const quizSession = {
      quizId: newQuiz?._id, // Set after creating Quiz document
      sessionId: sessionId || new mongoose.Types.ObjectId().toString(),
      mode,
      type,
      pointsEarned: totalPoints,
      correctAnswers,
      totalQuestions,
      rank: rank || null,
      isWinner: isWinner || false,
      participantCount: participantCount || 1,
      date: Date.now(),
    };

    if (!userInfo.quizHistory) {
      userInfo.quizHistory = [];
    }
    userInfo.quizHistory.push(quizSession);

    await userInfo.save();

    res.send({
      status: "success",
      data: {
        pointsEarned: totalPoints,
        newQuestionsAnswered: newQuestionIds.length,
        repeatedQuestions: answeredQuestionIds.length,
        correctAnswers,
        totalQuestions,
        accuracy: ((correctAnswers / totalQuestions) * 100).toFixed(2),
        ...(mode === "solo"
          ? {
              dailyQuestionsRemaining:
                100 - (userInfo.quota?.daily_questions_count || 0),
              dailyQuestionsAnswered:
                userInfo.quota?.daily_questions_count || 0,
            }
          : {}),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(422).send({
      status: "failed",
      message: "Something went wrong",
      error: err.message,
    });
  }
});

/**
 * POST /api/questions/generate-explanations
 * Body (optional):
 * {
 *   "limit": 10
 * }
 */

router.post("/generate-explanations", async (req, res) => {
  const limit = Math.min(Number(req.body.limit) || 5, 5); // stay within free tier

  try {
    const questions = await Question.find({
      explanation: { $exists: false },
    }).limit(limit);

    if (!questions.length) {
      return res.json({
        success: true,
        updated: 0,
        message: "No questions pending explanation",
      });
    }

    let updated = 0;
    const errors = [];

    for (const question of questions) {
      try {
        const correctAnswers = question.answers.filter((a) => a.correct);
        if (correctAnswers.length !== 1) continue;

        const prompt = `
          You are an expert exam tutor.

          Explain the correct answer and briefly explain why the other options are incorrect.

          Rules:
          - Use plain text only
          - Do NOT use markdown
          - Do NOT use asterisks, bullet points, or headings
          - Do NOT use bold or italics
          - Do NOT add extra information.
          - Keep explanations concise and student-friendly

          Question:
          ${question.question}

          Options:
          ${question.answers.map((a) => `- ${a.name}`).join("\n")}
          `;

        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });

        const text = result.text?.trim();

        // Detect quota or empty response
        if (!text || text.includes("Quota exceeded")) {
          errors.push({
            questionId: question._id,
            error: "Rate limit reached",
          });
          break; // stop processing further
        }

        question.explanation = text;
        await question.save();
        updated++;
      } catch (err) {
        errors.push({
          questionId: question._id,
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      processed: questions.length,
      updated,
      errors,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// router.get("/mod_data", async (req, res) => {
//   await Question.updateMany(
//     { topic: "69656935513e4e01dc60d94a", subject: "678d60356345f9e35e705ed8" },
//     {
//       $set: {
//         user: "68c08834856d0d53ca1923a1",
//       },
//     },
//   );

//   res.send({ status: "success" });
// });

module.exports = router;
