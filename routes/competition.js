const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const auth = require("../middlewares/authRoutes");
const { User } = require("../models/User");
const { Question } = require("../models/Question");
const { OnlineQuizCompetition } = require("../models/OnlineQuizCompetition");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const {
  getCompetitionWindow,
  computeFullMeta,
  calculateCompetitionScore,
  rankParticipants,
} = require("../controllers/competitionHelpers");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireManager = async (req, res, next) => {
  const user = await User.findById(req.user.userId)
    .select("accountType")
    .lean();
  if (!user || user.accountType !== "manager") {
    return res
      .status(403)
      .send({ status: "failed", message: "Manager access required" });
  }
  next();
};

const populateCompetition = (query) =>
  query
    .populate("subjects.subject", "name image")
    .populate("subjects.topics", "name")
    .populate("participants.user", "username firstName lastName avatar points")
    .populate("finalRankings.user", "username firstName lastName avatar points")
    .populate("createdBy", "username");

/**
 * Fisher-Yates shuffle — returns a NEW shuffled array, does not mutate input.
 */
const shuffleArray = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * formatCompetition
 *
 * isManager = true  → always include full leaderboard / rankings / participant details
 * isManager = false → gate sensitive data behind resultsPublished flag
 *
 * customSubjects are NEVER sent to participants (they would expose the full question
 * pool). They are only visible to managers via the manage endpoints.
 */
const formatCompetition = (comp, userId, isManager = false) => {
  const now = new Date();
  const participant = comp.participants?.find(
    (p) => (p.user?._id || p.user)?.toString() === userId?.toString(),
  );

  const isLive =
    comp.status === "active" &&
    now >= new Date(comp.startTime) &&
    now < new Date(comp.endTime);

  const isUpcoming = now < new Date(comp.startTime);
  const isEnded = now >= new Date(comp.endTime) || comp.status === "finished";

  const canSeeResults = isManager || comp.resultsPublished;

  return {
    _id: comp._id,
    title: comp.title,
    rules: comp.rules,
    month: comp.month,
    year: comp.year,
    startTime: comp.startTime,
    endTime: comp.endTime,
    status: comp.status,
    subjects: comp.subjects,
    // customSubjects exposed only to managers (for editing); never to participants
    customSubjects: isManager ? (comp.customSubjects ?? []) : undefined,
    prizes: comp.prizes,
    totalQuestions: comp.totalQuestions,
    approxDuration: comp.approxDuration,
    totalParticipants: comp.totalParticipants,
    finalRankings: canSeeResults ? (comp.finalRankings ?? []) : [],
    resultsPublished: comp.resultsPublished,
    isLive,
    isUpcoming,
    isEnded,
    hasParticipated: participant?.hasParticipated ?? false,
    myScore: canSeeResults ? (participant?.score ?? null) : null,
    myRank: canSeeResults ? (participant?.rank ?? null) : null,
  };
};

// ─── GET /competition/active ──────────────────────────────────────────────────
router.get("/active", auth, async (req, res) => {
  try {
    const now = new Date();
    const userId = req.user.userId;

    let comp = await OnlineQuizCompetition.findOne({
      status: "active",
      endTime: { $gte: now },
    })
      .sort({ startTime: 1 })
      .lean();

    if (!comp) {
      comp = await OnlineQuizCompetition.findOne({
        status: "active",
        startTime: { $gte: now },
      })
        .sort({ startTime: 1 })
        .lean();
    }

    if (!comp) {
      comp = await OnlineQuizCompetition.findOne({ status: "finished" })
        .sort({ endTime: -1 })
        .lean();
    }

    if (!comp) return res.send({ status: "success", data: null });

    const doc = await populateCompetition(
      OnlineQuizCompetition.findById(comp._id),
    );

    const lastWinners =
      doc.status === "finished" && doc.finalRankings?.length
        ? doc.finalRankings
        : await OnlineQuizCompetition.findOne({ status: "finished" })
            .sort({ endTime: -1 })
            .populate(
              "finalRankings.user",
              "username firstName lastName avatar",
            )
            .then((prev) => prev?.finalRankings ?? []);

    const docObj = doc.toObject();

    // Merge customSubjects into subjects using the same shape as DB subjects
    const customAsSubjects = (docObj.customSubjects ?? []).map((cs) => ({
      _id: cs._id,
      subject: { _id: cs._id, name: cs.name },
      topics: [],
      questionsCount: cs.questionsCount,
      timePerQuestion: cs.timePerQuestion ?? 40,
      isCustom: true,
    }));

    const mergedSubjects = [...(docObj.subjects ?? []), ...customAsSubjects];

    return res.send({
      status: "success",
      data: {
        ...formatCompetition(docObj, userId, false),
        subjects: mergedSubjects,
        lastWinners,
      },
    });
  } catch (err) {
    console.error("competition/active error:", err);
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to fetch competition" });
  }
});

// ─── Manager routes ───────────────────────────────────────────────────────────

router.get("/manage/list", auth, requireManager, async (req, res) => {
  try {
    const list = await OnlineQuizCompetition.find()
      .sort({ year: -1, month: -1 })
      .populate("subjects.subject", "name")
      .populate("subjects.topics", "name")
      .lean();
    return res.send({ status: "success", data: list });
  } catch (err) {
    console.error("manage list error:", err);
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to list competitions" });
  }
});

router.get(
  "/manage/subjects-topics",
  auth,
  requireManager,
  async (req, res) => {
    try {
      const subjects = await Subject.find()
        .select("name topics image categories")
        .populate("topics", "name")
        .lean();

      return res.send({ status: "success", data: subjects });
    } catch (err) {
      console.error("subjects-topics error:", err);
      return res.status(500).send({
        status: "failed",
        message: "Failed to fetch subjects and topics",
      });
    }
  },
);

// POST /competition/manage — create draft
router.post("/manage", auth, requireManager, async (req, res) => {
  try {
    const {
      month,
      year,
      title,
      rules,
      subjects,
      customSubjects,
      prizes,
      startTime: startOverride,
      endTime: endOverride,
    } = req.body;

    const userId = req.user.userId;

    if (!month || !year) {
      return res
        .status(422)
        .send({ status: "failed", message: "month and year are required" });
    }

    const existing = await OnlineQuizCompetition.findOne({ month, year });
    if (existing) {
      return res.status(422).send({
        status: "failed",
        message: "Competition for this month already exists",
      });
    }

    // Use manager-supplied window if provided, otherwise default to first Saturday
    const { startTime, endTime } = getCompetitionWindow(
      year,
      month,
      startOverride || null,
      endOverride || null,
    );

    const meta = computeFullMeta(subjects || [], customSubjects || []);

    const comp = new OnlineQuizCompetition({
      month,
      year,
      title: title || "Monthly Guru Quiz Tournament",
      rules: rules || "",
      startTime,
      endTime,
      subjects: subjects || [],
      customSubjects: customSubjects || [],
      prizes,
      status: "draft",
      resultsPublished: false,
      createdBy: userId,
      ...meta,
    });

    await comp.save();

    const populated = await populateCompetition(
      OnlineQuizCompetition.findById(comp._id),
    );
    return res.send({
      status: "success",
      data: populated,
      message: "Competition draft created",
    });
  } catch (err) {
    console.error("manage create error:", err);
    // Surface validation errors (e.g. required field missing, enum mismatch)
    // instead of a generic 500 so the client can show something useful.
    if (err?.name === "ValidationError") {
      const firstError = Object.values(err.errors || {})[0];
      return res.status(422).send({
        status: "failed",
        message: firstError?.message || "Invalid competition data",
      });
    }
    if (err?.code === 11000) {
      return res.status(422).send({
        status: "failed",
        message: "Competition for this month already exists",
      });
    }
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to create competition" });
  }
});

// PUT /competition/manage/:id — update
router.put("/manage/:id", auth, requireManager, async (req, res) => {
  try {
    const comp = await OnlineQuizCompetition.findById(req.params.id);
    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });
    if (comp.status === "finished") {
      return res.status(422).send({
        status: "failed",
        message: "Cannot edit a finished competition",
      });
    }

    const {
      title,
      rules,
      subjects,
      customSubjects,
      prizes,
      month,
      year,
      startTime: startOverride,
      endTime: endOverride,
    } = req.body;

    if (title !== undefined) comp.title = title;
    if (rules !== undefined) comp.rules = rules;
    if (subjects !== undefined) comp.subjects = subjects;
    if (customSubjects !== undefined) comp.customSubjects = customSubjects;
    if (prizes !== undefined) comp.prizes = prizes;

    if (month && year) {
      // Recompute window for the new month/year, respecting any manual override
      const { startTime, endTime } = getCompetitionWindow(
        year,
        month,
        startOverride || null,
        endOverride || null,
      );
      comp.month = month;
      comp.year = year;
      comp.startTime = startTime;
      comp.endTime = endTime;
    } else if (startOverride && endOverride) {
      // month/year unchanged but manager edited the times directly
      comp.startTime = new Date(startOverride);
      comp.endTime = new Date(endOverride);
    }

    // Recalculate meta whenever subjects or customSubjects change
    const meta = computeFullMeta(
      subjects !== undefined ? subjects : comp.subjects,
      customSubjects !== undefined ? customSubjects : comp.customSubjects,
    );
    comp.totalQuestions = meta.totalQuestions;
    comp.approxDuration = meta.approxDuration;
    comp.updatedAt = new Date();

    await comp.save();

    const populated = await populateCompetition(
      OnlineQuizCompetition.findById(comp._id),
    );
    return res.send({
      status: "success",
      data: populated,
      message: "Competition updated",
    });
  } catch (err) {
    console.error("manage update error:", err);
    if (err?.name === "ValidationError") {
      const firstError = Object.values(err.errors || {})[0];
      return res.status(422).send({
        status: "failed",
        message: firstError?.message || "Invalid competition data",
      });
    }
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to update competition" });
  }
});

// DELETE /competition/manage/:id — delete a draft
// Only allowed when the competition is NOT currently live and has NOT already
// ended (i.e. it's a draft, or an "active" competition whose start time is
// still in the future). Finished competitions, live competitions, and
// competitions that have already ended can never be deleted.
router.delete("/manage/:id", auth, requireManager, async (req, res) => {
  try {
    const comp = await OnlineQuizCompetition.findById(req.params.id);
    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });

    const now = new Date();
    const isOngoing =
      comp.status === "active" &&
      now >= new Date(comp.startTime) &&
      now < new Date(comp.endTime);
    const hasEnded = now >= new Date(comp.endTime);

    if (comp.status === "finished") {
      return res.status(422).send({
        status: "failed",
        message: "Cannot delete a finished competition",
      });
    }
    if (isOngoing) {
      return res.status(422).send({
        status: "failed",
        message: "Cannot delete a competition that is currently live",
      });
    }
    if (comp.status === "active" && hasEnded) {
      return res.status(422).send({
        status: "failed",
        message: "Cannot delete a competition that has already ended",
      });
    }

    await comp.deleteOne();

    return res.send({
      status: "success",
      message: "Draft deleted",
    });
  } catch (err) {
    console.error("manage delete error:", err);
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to delete competition" });
  }
});

// POST /competition/manage/:id/publish — make competition live
router.post("/manage/:id/publish", auth, requireManager, async (req, res) => {
  try {
    const comp = await OnlineQuizCompetition.findById(req.params.id);
    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });

    const hasDbSubjects = comp.subjects?.length > 0;
    const hasCustomSubjects = comp.customSubjects?.length > 0;

    if (!hasDbSubjects && !hasCustomSubjects) {
      return res.status(422).send({
        status: "failed",
        message: "Add at least one subject (DB or custom) before publishing",
      });
    }

    // Validate custom subjects have enough questions
    for (const cs of comp.customSubjects || []) {
      if (cs.questions.length < cs.questionsCount) {
        return res.status(422).send({
          status: "failed",
          message: `Custom subject "${cs.name}" needs at least ${cs.questionsCount} questions (has ${cs.questions.length})`,
        });
      }
    }

    if (!comp.prizes?.first?.reward) {
      return res.status(422).send({
        status: "failed",
        message: "Configure prizes before publishing",
      });
    }

    comp.status = "active";
    comp.updatedAt = new Date();
    await comp.save();

    return res.send({
      status: "success",
      message: "Competition published and active",
      data: comp,
    });
  } catch (err) {
    console.error("manage publish error:", err);
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to publish competition" });
  }
});

// POST /competition/manage/:id/publish-results — release results to participants
router.post(
  "/manage/:id/publish-results",
  auth,
  requireManager,
  async (req, res) => {
    try {
      const comp = await OnlineQuizCompetition.findById(req.params.id);
      if (!comp)
        return res
          .status(404)
          .send({ status: "failed", message: "Competition not found" });
      if (comp.resultsPublished) {
        return res.status(422).send({
          status: "failed",
          message: "Results have already been published",
        });
      }

      const now = new Date();
      if (now < new Date(comp.endTime) && comp.status !== "finished") {
        return res
          .status(422)
          .send({ status: "failed", message: "Competition has not ended yet" });
      }

      comp.resultsPublished = true;
      comp.status = "finished";
      comp.updatedAt = now;
      await comp.save();

      return res.send({
        status: "success",
        message: "Results published — participants can now view their scores",
        data: { resultsPublished: true },
      });
    } catch (err) {
      console.error("manage publish-results error:", err);
      return res
        .status(500)
        .send({ status: "failed", message: "Failed to publish results" });
    }
  },
);

// ─── GET /competition/:id ─────────────────────────────────────────────────────
router.get("/:id", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userInfo = await User.findById(userId).select("accountType").lean();
    const isManager = userInfo?.accountType === "manager";

    const comp = await populateCompetition(
      OnlineQuizCompetition.findById(req.params.id),
    );
    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });

    const ranked = rankParticipants(comp.participants || []);
    const now = new Date();
    const isLive =
      comp.status === "active" &&
      now >= new Date(comp.startTime) &&
      now < new Date(comp.endTime);

    const canSeeLeaderboard = isManager || isLive || comp.resultsPublished;
    const topTen = canSeeLeaderboard ? ranked.slice(0, 10) : [];

    return res.send({
      status: "success",
      data: {
        ...formatCompetition(comp.toObject(), userId, isManager),
        leaderboard: topTen,
        participantsCount: comp.totalParticipants,
      },
    });
  } catch (err) {
    console.error("competition/:id error:", err);
    return res.status(500).send({
      status: "failed",
      message: "Failed to fetch competition details",
    });
  }
});

// GET /competition/:id/leaderboard
router.get("/:id/leaderboard", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userInfo = await User.findById(userId).select("accountType").lean();
    const isManager = userInfo?.accountType === "manager";

    const comp = await OnlineQuizCompetition.findById(req.params.id)
      .populate(
        "participants.user",
        "username firstName lastName avatar points class",
      )
      .lean();

    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });

    const now = new Date();
    const isLive =
      comp.status === "active" &&
      now >= new Date(comp.startTime) &&
      now < new Date(comp.endTime);

    if (!isManager && !isLive && !comp.resultsPublished) {
      return res.send({
        status: "success",
        data: [],
        resultsPublished: false,
        totalParticipants: comp.totalParticipants,
      });
    }

    const ranked = rankParticipants(comp.participants || []);
    return res.send({
      status: "success",
      resultsPublished: comp.resultsPublished,
      totalParticipants: comp.totalParticipants,
      data: ranked.map((p) => ({
        _id: p.user?._id,
        username: p.user?.username,
        firstName: p.user?.firstName,
        lastName: p.user?.lastName,
        avatar: p.user?.avatar,
        points: p.score,
        rank: p.rank,
        duration: p.duration,
      })),
    });
  } catch (err) {
    console.error("competition leaderboard error:", err);
    return res
      .status(500)
      .send({ status: "failed", message: "Failed to fetch leaderboard" });
  }
});

// ─── POST /competition/:id/questions ─────────────────────────────────────────
// Fetch quiz questions for a participant — DB subjects + custom subjects combined.
router.post("/:id/questions", auth, async (req, res) => {
  const userId = req.user.userId;

  try {
    const userInfo = await User.findById(userId)
      .select("accountType subscription qBank")
      .lean();

    if (!userInfo)
      return res
        .status(422)
        .send({ status: "failed", message: "User not found" });

    if (userInfo.accountType !== "student") {
      return res
        .status(422)
        .send({ status: "failed", message: "Only students can participate" });
    }

    if (!userInfo.subscription?.isActive) {
      return res.status(403).send({
        status: "failed",
        message: "Active subscription required to participate",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }

    const comp = await OnlineQuizCompetition.findById(req.params.id).populate(
      "subjects.subject",
      "name",
    );
    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });

    const now = new Date();
    if (comp.status !== "active") {
      return res
        .status(422)
        .send({ status: "failed", message: "Competition is not active" });
    }
    if (now < comp.startTime || now >= comp.endTime) {
      return res.status(422).send({
        status: "failed",
        message: "Competition is not live right now",
      });
    }

    const existing = comp.participants.find(
      (p) => p.user.toString() === userId,
    );
    if (existing?.hasParticipated) {
      return res.status(422).send({
        status: "failed",
        message: "You have already completed this competition",
      });
    }

    const userQBank = (userInfo.qBank || []).map(
      (entry) => new mongoose.Types.ObjectId(entry.question.toString()),
    );

    const qBankResults = [];

    // ── 1. DB subjects ────────────────────────────────────────────────────────
    for (const subjConfig of comp.subjects) {
      const subjectId = subjConfig.subject._id || subjConfig.subject;

      // Only filter by topics when the manager actually selected some;
      // empty array means "all topics" — no $in filter applied.
      const topicIds = (subjConfig.topics || [])
        .filter(Boolean)
        .map((t) => new mongoose.Types.ObjectId(t.toString()));

      const matchStage = {
        subject: new mongoose.Types.ObjectId(subjectId.toString()),
        isTheory: false,
      };

      if (topicIds.length > 0) {
        matchStage.topic = { $in: topicIds };
      }

      const questions = await Question.aggregate([
        { $match: matchStage },
        {
          $addFields: {
            hasAnswered: { $in: ["$_id", userQBank] },
            randomSeed: { $rand: {} },
          },
        },
        // Prioritise unseen questions, then randomise within each bucket
        { $sort: { hasAnswered: 1, randomSeed: 1 } },
        { $limit: subjConfig.questionsCount },
        {
          $lookup: {
            from: "subjects",
            localField: "subject",
            foreignField: "_id",
            as: "subjectDetails",
          },
        },
        { $unwind: "$subjectDetails" },
        {
          $project: {
            _id: 1,
            question: 1,
            answers: 1,
            timer: { $literal: subjConfig.timePerQuestion || 40 },
            point: 1,
            subject: {
              _id: "$subjectDetails._id",
              name: "$subjectDetails.name",
            },
            topic: 1,
            categories: 1,
            hasAnswered: 1,
            isTheory: 1,
            explanation: 1,
            questionLatex: 1,
            isLatex: 1,
          },
        },
      ]);

      if (questions.length < subjConfig.questionsCount) {
        const topicNote = topicIds.length > 0 ? " (with selected topics)" : "";
        return res.status(404).send({
          status: "failed",
          message: `Not enough questions for "${subjConfig.subject?.name || "a subject"}"${topicNote}. Need ${subjConfig.questionsCount}, found ${questions.length}.`,
        });
      }

      qBankResults.push({
        subject: questions[0].subject,
        questions,
        timePerQuestion: subjConfig.timePerQuestion || 40,
      });
    }

    // ── 2. Custom subjects ────────────────────────────────────────────────────
    for (const customSubj of comp.customSubjects || []) {
      if (!customSubj.questions || customSubj.questions.length === 0) continue;

      const shuffled = shuffleArray(customSubj.questions);
      const selected = shuffled
        .slice(0, customSubj.questionsCount)
        .map((q) => ({
          _id: q._id,
          question: q.question,
          answers: q.answers,
          explanation: q.explanation || "",
          point: q.point ?? 5,
          timer: customSubj.timePerQuestion || q.timer || 40,
          isLatex: q.isLatex ?? false,
          isTheory: false,
          hasAnswered: false,
          subject: { _id: customSubj._id, name: customSubj.name },
        }));

      qBankResults.push({
        subject: { _id: customSubj._id, name: customSubj.name },
        questions: selected,
        timePerQuestion: customSubj.timePerQuestion || 40,
      });
    }

    // Register participant if first time
    if (!existing) {
      comp.participants.push({ user: userId, hasParticipated: false });
    }
    await comp.save();

    return res.send({
      status: "success",
      data: qBankResults,
      meta: { competitionId: comp._id, totalQuestions: comp.totalQuestions },
    });
  } catch (err) {
    console.error("competition questions error:", err);
    return res.status(500).send({
      status: "failed",
      message: "Failed to fetch competition questions",
    });
  }
});

// ─── POST /competition/:id/submit ─────────────────────────────────────────────
router.post("/:id/submit", auth, async (req, res) => {
  const userId = req.user.userId;
  const { questions, duration } = req.body;

  try {
    const userInfo = await User.findById(userId).select(
      "accountType subscription qBank points totalPoints quizStats",
    );
    if (!userInfo)
      return res
        .status(422)
        .send({ status: "failed", message: "User not found" });

    if (!userInfo.subscription?.isActive) {
      return res.status(403).send({
        status: "failed",
        message: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }

    const comp = await OnlineQuizCompetition.findById(req.params.id);
    if (!comp)
      return res
        .status(404)
        .send({ status: "failed", message: "Competition not found" });

    const now = new Date();
    if (
      comp.status !== "active" ||
      now < comp.startTime ||
      now >= comp.endTime
    ) {
      return res.status(422).send({
        status: "failed",
        message: "Competition submission window is closed",
      });
    }

    const participantIdx = comp.participants.findIndex(
      (p) => p.user.toString() === userId,
    );
    if (participantIdx === -1) {
      return res.status(422).send({
        status: "failed",
        message: "Start the competition before submitting",
      });
    }
    if (comp.participants[participantIdx].hasParticipated) {
      return res
        .status(422)
        .send({ status: "failed", message: "You have already submitted" });
    }

    const qBankMap = new Map(
      (userInfo.qBank || []).map((entry) => [
        entry.question.toString(),
        { correct: entry.correct },
      ]),
    );

    const result = calculateCompetitionScore(questions, qBankMap);

    // Only update qBank for DB questions (custom questions have no DB _id to track)
    const customQuestionIds = new Set(
      (comp.customSubjects || []).flatMap((cs) =>
        cs.questions.map((q) => q._id.toString()),
      ),
    );

    for (const [questionId, correct] of Object.entries(result.qBankUpdates)) {
      if (customQuestionIds.has(questionId)) continue;
      const existingEntry = userInfo.qBank.find(
        (e) => e.question.toString() === questionId,
      );
      if (existingEntry) {
        existingEntry.correct = correct;
      } else {
        userInfo.qBank.push({ question: questionId, correct });
      }
    }
    userInfo.markModified("qBank");

    comp.participants[participantIdx].score = result.score;
    comp.participants[participantIdx].duration = duration || 0;
    comp.participants[participantIdx].submittedAt = now;
    comp.participants[participantIdx].hasParticipated = true;

    const ranked = rankParticipants(comp.participants);
    comp.participants = ranked;
    comp.totalParticipants = ranked.filter((p) => p.hasParticipated).length;
    comp.updatedAt = now;

    await comp.save();
    await userInfo.save();

    return res.send({
      status: "success",
      data: {
        score: result.score,
        correctAnswers: result.correctAnswers,
        totalQuestions: result.totalQuestions,
        accuracy: result.accuracy,
        rank: null,
        pointsEarned: result.score,
        duration,
      },
    });
  } catch (err) {
    console.error("competition submit error:", err);
    return res.status(500).send({
      status: "failed",
      message: "Failed to submit competition results",
    });
  }
});

module.exports = router;
