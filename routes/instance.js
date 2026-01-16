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

  const userInfo = await User.findById(userId).select("subjects accountType");

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found!" });

  const category = await Category.findById(categoryId)
    .populate([
      {
        path: "subjects",
        model: "Subject",
        select: "name image",
      },
    ])
    .select("subjects");

  res.send({ status: "success", data: category.subjects });
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
        userQBank.includes(question._id.toString())
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

  // const userInfo = await User.findById(userId).select("qBank").lean();
  // if (!userInfo)
  //   return res
  //     .status(422)
  //     .send({ status: "failed", message: "User not found!" });

  // const userQBank = userInfo.qBank.map((q) => q.toString());

  let subject = await Subject.findById(subjectId)
    .populate([
      {
        path: "topics",
        model: "Topic",
        select: "name questions",
      },
    ])
    .select("-image -__v")
    .lean();

  // subject.topics = subject.topics.map((topic) => {
  //   // Calculate questions in the user's qBank
  //   const totalQuestions = topic.questions.length;
  //   const qBankQuestions = topic.questions.filter((question) =>
  //     userQBank.includes(question._id.toString())
  //   );

  //   return {
  //     _id: topic._id,
  //     name: topic.name,
  //     totalQuestions,
  //     qBankQuestions: qBankQuestions.length, // Count of matched questions
  //     progress: (qBankQuestions / (totalQuestions ?? 1)) * 100,
  //   };
  // });

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

/**
 * POST /premium_quiz
 * Fetches quiz questions with intelligent prioritization
 *
 * Request Body:
 * {
 *   categoryId: string,
 *   subjects: [
 *     {
 *       _id: string,
 *       topics: [string] // optional topic IDs
 *     }
 *   ]
 * }
 *
 * Features:
 * - Fetches 25 questions per subject
 * - Prioritizes fresh (unanswered) questions first
 * - Falls back to answered questions if fresh ones exhausted
 * - Totally randomized within each priority group
 * - Overrides point value to 0.2 for answered questions
 * - Validates daily limits before fetching
 */
router.post("/premium_quiz", auth, async (req, res) => {
  const reqData = req.body;
  const userId = req.user.userId;

  try {
    // ========================================
    // 1. FETCH USER INFO
    // ========================================
    const userInfo = await User.findById(userId).select("qBank quota").lean();

    if (!userInfo) {
      return res.status(422).send({
        status: "failed",
        message: "User not found!",
      });
    }

    // ========================================
    // 2. VALIDATE REQUEST DATA
    // ========================================
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

    if (reqData.subjects.length > MAX_DAILY_SUBJECTS) {
      return res.status(422).send({
        status: "failed",
        message: `Maximum of ${MAX_DAILY_SUBJECTS} subjects allowed per quiz!`,
      });
    }

    // ========================================
    // 3. CHECK DAILY LIMITS
    // ========================================
    const currentQuota = userInfo.quota;
    const isToday =
      currentQuota && new Date() - new Date(currentQuota.daily_update) < A_DAY;

    const dailyQuestionsCount = isToday
      ? currentQuota.daily_questions_count || 0
      : 0;
    const dailySubjects = isToday ? currentQuota.daily_subjects || [] : [];

    // Calculate how many questions user wants to fetch
    const requestedQuestionsCount =
      reqData.subjects.length * QUESTIONS_PER_SUBJECT;

    // Check if user has enough quota remaining
    if (dailyQuestionsCount + requestedQuestionsCount > MAX_DAILY_QUESTIONS) {
      return res.status(429).send({
        status: "failed",
        message: `Cannot fetch quiz. You have ${
          MAX_DAILY_QUESTIONS - dailyQuestionsCount
        } questions remaining today. You're requesting ${requestedQuestionsCount} questions.`,
        data: {
          questionsRemaining: MAX_DAILY_QUESTIONS - dailyQuestionsCount,
          questionsRequested: requestedQuestionsCount,
          dailyLimit: MAX_DAILY_QUESTIONS,
        },
      });
    }

    // ========================================
    // 4. CHECK SUBJECT LIMITS
    // ========================================
    for (const subject of reqData.subjects) {
      const existingSubject = dailySubjects.find(
        (s) => s.subject.toString() === subject._id.toString()
      );
      const currentSubjectCount = existingSubject
        ? existingSubject.questions_count
        : 0;

      if (
        currentSubjectCount + QUESTIONS_PER_SUBJECT >
        MAX_QUESTIONS_PER_SUBJECT
      ) {
        return res.status(429).send({
          status: "failed",
          message: `Subject limit exceeded. You can only answer ${
            MAX_QUESTIONS_PER_SUBJECT - currentSubjectCount
          } more questions for this subject today.`,
          data: {
            subjectId: subject._id,
            questionsRemaining: MAX_QUESTIONS_PER_SUBJECT - currentSubjectCount,
            subjectLimit: MAX_QUESTIONS_PER_SUBJECT,
          },
        });
      }
    }

    // ========================================
    // 5. CHECK MAXIMUM SUBJECTS PER DAY
    // ========================================
    const uniqueSubjectIds = new Set(
      reqData.subjects.map((s) => s._id.toString())
    );
    const existingSubjectIds = new Set(
      dailySubjects.map((s) => s.subject.toString())
    );

    // Combine both sets to see total unique subjects
    uniqueSubjectIds.forEach((id) => existingSubjectIds.add(id));

    if (existingSubjectIds.size > MAX_DAILY_SUBJECTS) {
      return res.status(429).send({
        status: "failed",
        message: `You can only practice ${MAX_DAILY_SUBJECTS} subjects per day. You've already practiced different subjects today.`,
        data: {
          subjectsLimit: MAX_DAILY_SUBJECTS,
          subjectsToday: dailySubjects.map((s) => s.subject),
          requestedSubjects: reqData.subjects.map((s) => s._id),
        },
      });
    }

    // ========================================
    // 6. PREPARE QUERY PARAMETERS
    // ========================================
    const subjectIds = reqData.subjects.map(
      (item) => new mongoose.Types.ObjectId(item._id)
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
      (q) => new mongoose.Types.ObjectId(q.toString())
    );
    const categoryId = new mongoose.Types.ObjectId(reqData.categoryId);

    // ========================================
    // 7. FETCH QUESTIONS WITH SMART PRIORITIZATION
    // ========================================
    const matchStage = {
      categories: categoryId,
      subject: { $in: subjectIds },
      isTheory: false,
    };

    // Only add topic filter if topics were specified
    if (topicIds.length > 0) {
      matchStage.topic = { $in: topicIds };
    }

    const questions = await Question.aggregate([
      // Match questions based on criteria
      {
        $match: matchStage,
      },
      // Add hasAnswered flag and random seed
      {
        $addFields: {
          hasAnswered: {
            $in: ["$_id", userQBank],
          },
          randomSeed: { $rand: {} },
        },
      },
      // Sort: unanswered first (hasAnswered: false = 0), then by random
      {
        $sort: {
          hasAnswered: 1, // false (0) comes before true (1) - fresh questions first
          randomSeed: 1, // randomize within each group
        },
      },
      // Group by subject
      {
        $group: {
          _id: "$subject",
          questions: { $push: "$$ROOT" },
        },
      },
      // Take first 25 questions per subject (prioritizing unanswered)
      {
        $addFields: {
          questions: { $slice: ["$questions", QUESTIONS_PER_SUBJECT] },
        },
      },
      // Lookup subject details
      {
        $lookup: {
          from: "subjects",
          localField: "_id",
          foreignField: "_id",
          as: "subjectDetails",
        },
      },
      {
        $unwind: "$subjectDetails",
      },
      // Format output
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
                point: {
                  $cond: {
                    if: "$$q.hasAnswered",
                    then: REPEATED_QUESTION_POINTS, // Override to 0.2 for answered
                    else: "$$q.point", // Keep original point for fresh
                  },
                },
                subject: "$$q.subject",
                topic: "$$q.topic",
                categories: "$$q.categories",
                hasAnswered: "$$q.hasAnswered",
                isTheory: "$$q.isTheory",
              },
            },
          },
        },
      },
    ]);

    // ========================================
    // 8. VALIDATE RESULTS
    // ========================================
    if (questions.length === 0) {
      return res.status(404).send({
        status: "failed",
        message: "No questions found for the selected criteria",
        data: {
          categoryId: reqData.categoryId,
          subjects: reqData.subjects.map((s) => s._id),
          topics: topicIds.length > 0 ? topicIds : "none specified",
        },
      });
    }

    // Validate that we got questions for all requested subjects
    if (questions.length !== reqData.subjects.length) {
      const foundSubjectIds = questions.map((q) => q.subject._id.toString());
      const missingSubjects = reqData.subjects.filter(
        (s) => !foundSubjectIds.includes(s._id.toString())
      );

      return res.status(404).send({
        status: "failed",
        message: "Not enough questions available for selected subjects/topics",
        data: {
          foundSubjects: foundSubjectIds,
          missingSubjects: missingSubjects.map((s) => s._id),
        },
      });
    }

    // Check if any subject has less than required questions
    const insufficientSubjects = questions.filter(
      (q) => q.questions.length < QUESTIONS_PER_SUBJECT
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
            requiredQuestions: QUESTIONS_PER_SUBJECT,
          })),
        },
      });
    }

    // ========================================
    // 9. CALCULATE STATISTICS FOR RESPONSE
    // ========================================
    const stats = {
      totalQuestions: 0,
      freshQuestions: 0,
      answeredQuestions: 0,
      potentialPoints: 0,
      subjects: [],
    };

    questions.forEach((subjectData) => {
      const subjectStats = {
        subjectId: subjectData.subject._id,
        subjectName: subjectData.subject.name,
        totalQuestions: subjectData.questions.length,
        freshQuestions: 0,
        answeredQuestions: 0,
        potentialPoints: 0,
      };

      subjectData.questions.forEach((q) => {
        stats.totalQuestions++;
        stats.potentialPoints += q.point;
        subjectStats.potentialPoints += q.point;

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

    // ========================================
    // 10. SEND RESPONSE
    // ========================================
    res.send({
      status: "success",
      data: questions,
      meta: {
        questionsPerSubject: QUESTIONS_PER_SUBJECT,
        repeatedQuestionPoints: REPEATED_QUESTION_POINTS,
        maxDailyQuestions: MAX_DAILY_QUESTIONS,
        maxQuestionsPerSubject: MAX_QUESTIONS_PER_SUBJECT,
        maxDailySubjects: MAX_DAILY_SUBJECTS,
        stats,
        remainingToday: {
          totalQuestions: MAX_DAILY_QUESTIONS - dailyQuestionsCount,
          afterThisQuiz:
            MAX_DAILY_QUESTIONS - (dailyQuestionsCount + stats.totalQuestions),
        },
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
  const { questions, type, mode } = data;

  const userInfo = await User.findById(userId).select(
    "accountType quota quotas points totalPoints qBank"
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

  if (mode !== "solo") {
    return res.status(422).send({
      status: "failed",
      message: "Only solo mode is currently allowed!",
    });
  }

  try {
    const appInfo = await AppInfo.findOne({ ID: "APP" });

    // Check daily limits BEFORE processing
    const limitCheck = checkDailyLimits(userInfo, questions);
    if (!limitCheck.allowed) {
      return res.status(429).send({
        status: "failed",
        message: limitCheck.message,
        data: {
          remaining: limitCheck.remaining,
          dailyQuestionsAnswered: limitCheck.dailyQuestionsCount,
        },
      });
    }

    // Calculate points based on qBank
    const pointsResult = calculatePoints(
      questions,
      userInfo.qBank || [],
      appInfo
    );

    // Prepare data structures
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
        questionIds.push(question._id);
        questionData.push({
          question: question.question,
          answers: question.answers,
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

    const A_DAY = 1000 * 60 * 60 * 24;
    const A_WEEK = 1000 * 60 * 60 * 24 * 7;
    const currentQuota = userInfo.quota;

    let updatedQuota;

    if (
      currentQuota &&
      new Date() - new Date(currentQuota.daily_update) < A_DAY
    ) {
      // Same day - update existing quota
      const dailySubjects = currentQuota.daily_subjects || [];

      // Update subject counts
      questions.forEach((quest) => {
        const subjId = quest.subject._id.toString();
        const existingSubj = dailySubjects.find(
          (s) => s.subject.toString() === subjId
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
        point_per_week: pointsResult.totalPoints + currentQuota.point_per_week,
        subjects: currentQuota.subjects.concat(studentSubjects),
        daily_questions: currentQuota.daily_questions.concat(questionIds),
        daily_questions_count:
          (currentQuota.daily_questions_count || 0) + questionIds.length,
        daily_subjects: dailySubjects,
      };

      // Check if week has passed
      if (new Date() - new Date(currentQuota.weekly_update) > A_WEEK) {
        userInfo.quotas?.push(currentQuota);
        updatedQuota.weekly_update = Date.now();
        updatedQuota.point_per_week = pointsResult.totalPoints;
      }
    } else {
      // New day - reset daily counters
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
          ? pointsResult.totalPoints + currentQuota.point_per_week
          : pointsResult.totalPoints,
        subjects: studentSubjects,
        daily_questions: questionIds,
        daily_questions_count: questionIds.length,
        daily_subjects: dailySubjects,
      };

      // Check if week has passed
      if (
        currentQuota &&
        new Date() - new Date(currentQuota.weekly_update) > A_WEEK
      ) {
        userInfo.quotas?.push(currentQuota);
        updatedQuota.weekly_update = Date.now();
        updatedQuota.point_per_week = pointsResult.totalPoints;
      }
    }

    // Update user info
    userInfo.quota = updatedQuota;
    userInfo.points += pointsResult.totalPoints;
    userInfo.totalPoints += pointsResult.totalPoints;

    // Add only NEW questions to qBank
    userInfo.qBank = userInfo.qBank.concat(pointsResult.newQuestionIds);

    await userInfo.save();

    // Save quiz info
    const newQuiz = new Quiz({
      user: userId,
      mode,
      type,
      questions: questionData,
      subjects: subjectIds,
      topics: topicIds,
    });

    await newQuiz.save();

    res.send({
      status: "success",
      data: {
        pointsEarned: pointsResult.totalPoints,
        newQuestionsAnswered: pointsResult.newQuestionsCount,
        repeatedQuestions: pointsResult.repeatedQuestionsCount,
        dailyQuestionsRemaining: 100 - updatedQuota.daily_questions_count,
        dailyQuestionsAnswered: updatedQuota.daily_questions_count,
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

// router.get("/mod_data", async (req, res) => {
//   await Question.updateMany(
//     {},
//     {
//       $set: {
//         point: 5,
//       },
//     }
//   );

//   res.send({ status: "success" });
// });

module.exports = router;
