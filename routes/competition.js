const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const router = express.Router();
const auth = require("../middlewares/authRoutes");
const { User } = require("../models/User");
const { Question } = require("../models/Question");
const { OnlineQuizCompetition } = require("../models/OnlineQuizCompetition");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const WalletTransaction = require("../models/WalletTransaction");
const expoNotifications = require("../controllers/expoNotifications");
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

// ─── Prize settlement helpers ─────────────────────────────────────────────────

const PLACE_KEYS = ["first", "second", "third"];
const ORDINALS = ["1st", "2nd", "3rd"];
const CURRENCY_SYMBOLS = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  GHS: "₵",
  KES: "KSh ",
};

const getPrize = (comp, rank) => comp.prizes?.[PLACE_KEYS[rank - 1]];

/** "points" | "cash" | "none" — derived from the competition's prize config */
const getPrizeType = (comp, rank) => {
  const prize = getPrize(comp, rank);
  if (!prize || !(Number(prize.reward) > 0)) return "none";
  return prize.type === "cash" ? "cash" : "points";
};

const describePrize = (prize) => {
  const amount = Number(prize?.reward || 0).toLocaleString();
  if (prize?.type === "cash") {
    const symbol =
      CURRENCY_SYMBOLS[prize.currency] ??
      (prize.currency ? `${prize.currency} ` : "");
    return `${symbol}${amount}`;
  }
  return `${amount} GT`;
};

/**
 * Only used for old accounts that never got a `rewards` sub-document
 * (`rewards.code` is required on the User schema, so we must not create the
 * sub-document without one). New accounts already get a referral code at
 * registration.
 */
const generateRewardCode = async () => {
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(4).toString("hex").slice(0, 8);
    const clash = await User.exists({ "rewards.code": code });
    if (!clash) return code;
  }
  return crypto.randomBytes(6).toString("hex").slice(0, 8);
};

/**
 * Credit a POINTS prize exactly once.
 *
 * The WalletTransaction (unique reference per competition + place) acts as the
 * idempotency lock: findOneAndUpdate({upsert, new:false}) returns null only for
 * the call that actually inserted it. If a transaction already exists the prize
 * was credited before, so nothing is incremented — safe to retry any time.
 *
 * The points increment and the entry in the user's `rewards.history` (their
 * in-app record of the award) are written in ONE atomic update, so a winner can
 * never be credited without the record, or get the record twice.
 * If that update fails after the lock is taken, the transaction is rolled back.
 */
const creditPointsPrize = async (comp, entry, prize, placeKey) => {
  const reference = `COMP-${comp._id}-${placeKey}`;
  const reward = Number(prize.reward);

  const current = await User.findById(entry.user)
    .select("points rewards.code")
    .lean();
  if (!current) throw new Error("Winner account not found");
  const balanceBefore = current.points || 0;

  const existing = await WalletTransaction.findOneAndUpdate(
    { reference },
    {
      $setOnInsert: {
        accountType: "student",
        transactionType: "points",
        category: "adjustment",
        amount: reward,
        balanceBefore,
        balanceAfter: balanceBefore + reward,
        reference,
        userId: entry.user,
        description: `${prize.title || `${placeKey} place`} prize — ${comp.title} (${comp.month}/${comp.year})`,
        metadata: {
          competitionId: comp._id.toString(),
          place: entry.rank,
          month: comp.month,
          year: comp.year,
        },
        status: "completed",
      },
    },
    { upsert: true, new: false, setDefaultsOnInsert: true },
  );

  if (existing) return; // already credited earlier — never pay twice

  // status "rewarded" (not "pending") on purpose: pending entries can be
  // claimed through PUT /users/rewards, and this one is already paid out.
  const historyEntry = {
    title: `${ORDINALS[entry.rank - 1]} place — ${comp.title}`,
    point: reward,
    status: "rewarded",
  };

  const update = current.rewards?.code
    ? {
        $inc: { points: reward, totalPoints: reward },
        $push: { "rewards.history": historyEntry },
      }
    : {
        $inc: { points: reward, totalPoints: reward },
        $set: {
          rewards: {
            code: await generateRewardCode(),
            point: 0,
            history: [historyEntry],
          },
        },
      };

  try {
    await User.updateOne({ _id: entry.user }, update);
  } catch (err) {
    await WalletTransaction.deleteOne({ reference }).catch(() => {});
    throw err;
  }
};

/** Best-effort push to one user (no token / Expo failure never throws). */
const pushToUser = async (userId, { title, message, data }) => {
  const u = await User.findById(userId).select("expoPushToken").lean();
  if (u?.expoPushToken) {
    await expoNotifications([u.expoPushToken], { title, message, data });
  }
};

const buildWinnerCopy = (comp, rank, prize, prizeType) => {
  const place = ORDINALS[rank - 1];
  const title = `🏆 You finished ${place}!`;
  if (prizeType === "points") {
    return {
      title,
      message: `${describePrize(prize)} has been credited to your account for ${comp.title}. Congratulations!`,
    };
  }
  if (prizeType === "cash") {
    return {
      title,
      message: `You won ${describePrize(prize)} in ${comp.title}! Our team will reach out to arrange your payout.`,
    };
  }
  return {
    title,
    message: `Congratulations on placing ${place} in ${comp.title}!`,
  };
};

/**
 * Settle ONE winner (mutates `entry`):
 *   1. points prize not yet credited → credit it + log it in rewards.history
 *      (cash is never auto-credited)
 *   2. not yet notified (and, for points, credit succeeded) → push notification
 * Every step is idempotent, so this is safe to call again for retries.
 */
const settleWinner = async (comp, entry) => {
  const placeKey = PLACE_KEYS[entry.rank - 1];
  const prize = getPrize(comp, entry.rank);
  const prizeType = getPrizeType(comp, entry.rank);
  entry.prizeType = prizeType;

  if (prizeType === "points" && !entry.prizeAwarded) {
    try {
      await creditPointsPrize(comp, entry, prize, placeKey);
      entry.prizeAwarded = true;
      entry.awardedAt = new Date();
    } catch (creditErr) {
      console.error(
        `Failed to credit points to winner (place ${entry.rank}) for competition ${comp._id}:`,
        creditErr,
      );
    }
  }

  const readyToNotify = prizeType !== "points" || entry.prizeAwarded;
  if (!entry.notified && readyToNotify) {
    try {
      const { title, message } = buildWinnerCopy(
        comp,
        entry.rank,
        prize,
        prizeType,
      );
      await pushToUser(entry.user, {
        title,
        message,
        data: {
          type: "competition_result",
          competitionId: comp._id.toString(),
          rank: entry.rank,
          prizeType,
        },
      });
      entry.notified = true;
    } catch (notifyErr) {
      console.error(
        `Failed to notify winner (place ${entry.rank}) for competition ${comp._id}:`,
        notifyErr,
      );
    }
  }

  return entry;
};

const buildAwardSummary = (comp) => {
  const list = comp.finalRankings || [];
  const pointsPending = list.filter(
    (e) => getPrizeType(comp, e.rank) === "points" && !e.prizeAwarded,
  ).length;
  const notifyPending = list.filter((e) => !e.notified).length;
  const cashWinners = list.filter(
    (e) => getPrizeType(comp, e.rank) === "cash",
  ).length;
  return {
    pointsPending,
    notifyPending,
    cashWinners,
    needsRetry: pointsPending > 0 || notifyPending > 0,
  };
};

/** Settle every winner on a (mongoose) competition and persist the flags. */
const settleAllWinners = async (comp) => {
  for (const entry of comp.finalRankings || []) {
    await settleWinner(comp, entry);
  }
  comp.markModified("finalRankings");
  await comp.save();
  return buildAwardSummary(comp);
};

/**
 * One shared push to everyone else who submitted: "results are out".
 * Fire-and-forget, never throws.
 */
const notifyResultsOut = async (comp, submitted, winnerIds) => {
  try {
    const otherIds = submitted
      .map((p) => p.user)
      .filter((id) => !winnerIds.has(id.toString()));
    if (!otherIds.length) return;

    const users = await User.find({ _id: { $in: otherIds } })
      .select("expoPushToken")
      .lean();
    const tokens = users.map((u) => u.expoPushToken).filter(Boolean);
    if (!tokens.length) return;

    await expoNotifications(tokens, {
      title: "Results are out 📊",
      message: `${comp.title} results are live. Tap to see how you ranked.`,
      data: {
        type: "competition_result",
        competitionId: comp._id.toString(),
      },
    });
  } catch (err) {
    console.error("notifyResultsOut error:", err);
  }
};

/**
 * formatCompetition
 *
 * isManager = true  → always include full leaderboard / rankings / participant details
 * isManager = false → gate sensitive data behind resultsPublished flag
 *
 * customSubjects are NEVER sent to participants (they would expose the full question
 * pool). They are only visible to managers via the manage endpoints.
 *
 * canPublishResults is computed HERE (server clock) so the client never has to
 * compare against the phone's clock — a skewed device clock used to make the
 * app think the tournament was still live.
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

  const canPublishResults =
    isEnded && !comp.resultsPublished && comp.status !== "draft";

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
    finalRankings: canSeeResults
      ? (comp.finalRankings ?? []).map((e) => ({
          ...e,
          prizeType: getPrizeType(comp, e.rank),
          prizeAwarded: !!e.prizeAwarded,
          notified: !!e.notified,
        }))
      : [],
    awardSummary:
      isManager && comp.resultsPublished ? buildAwardSummary(comp) : undefined,
    resultsPublished: comp.resultsPublished,
    isLive,
    isUpcoming,
    isEnded,
    canPublishResults,
    hasParticipated: participant?.hasParticipated ?? false,
    myScore: canSeeResults ? (participant?.score ?? null) : null,
    myRank: canSeeResults ? (participant?.rank ?? null) : null,
  };
};

// ─── GET /competition/active ──────────────────────────────────────────────────
// Priority:
//   1. A live / upcoming competition (active, hasn't ended yet)
//   2. An ENDED competition whose results are still unpublished
//      (previously skipped — the card jumped straight to the previous month's
//      finished competition, so a manager could never publish results)
//   3. The most recently finished competition
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
        endTime: { $lt: now },
        resultsPublished: false,
      })
        .sort({ endTime: -1 })
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
//
// Publishing also settles prizes for the top 3 who actually submitted:
//   - "points" prizes are credited to the winner (WalletTransaction lock + atomic
//     $inc, idempotent), logged in the winner's rewards.history, and the winner
//     gets a push notification.
//   - "cash" prizes are NEVER auto-credited — prizeAwarded stays false and the
//     winner is told to expect a manual payout.
// Everyone else who submitted gets one shared "results are out" push.
// Anything that fails can be retried with POST /manage/:id/award-prizes.
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
      if (comp.status === "draft") {
        return res.status(422).send({
          status: "failed",
          message: "This competition was never published",
        });
      }

      const now = new Date();
      if (now < new Date(comp.endTime) && comp.status !== "finished") {
        return res.status(422).send({
          status: "failed",
          message: "Tournament is still live — it hasn't ended yet",
        });
      }

      // Rank all participants (score desc, then duration/submittedAt tiebreak)
      const ranked = rankParticipants(comp.participants || []);
      comp.participants = ranked;

      // Only people who actually submitted can place — someone who merely
      // opened the quiz (score 0, hasParticipated false) must never win a prize.
      const submitted = ranked.filter((p) => p.hasParticipated);

      // 1) Publish first, so a failure while settling prizes can never leave
      //    results unpublished — it can always be retried afterwards.
      comp.finalRankings = submitted.slice(0, 3).map((p, i) => ({
        user: p.user,
        rank: i + 1,
        score: p.score,
        prizeType: getPrizeType(comp, i + 1),
        prizeAwarded: false,
        notified: false,
      }));
      comp.resultsPublished = true;
      comp.status = "finished";
      comp.updatedAt = now;
      await comp.save();

      // 2) Credit points prizes + notify winners (idempotent, never throws)
      const awardSummary = await settleAllWinners(comp);

      res.send({
        status: "success",
        message: awardSummary.needsRetry
          ? "Results published — some awards need a retry"
          : "Results published — winners credited and notified",
        data: {
          resultsPublished: true,
          finalRankings: comp.finalRankings,
          awardSummary,
        },
      });

      // 3) Everyone else: "results are out" (after responding, never blocks)
      const winnerIds = new Set(
        comp.finalRankings.map((e) => e.user.toString()),
      );
      await notifyResultsOut(comp, submitted, winnerIds);
    } catch (err) {
      console.error("manage publish-results error:", err);
      if (!res.headersSent) {
        return res
          .status(500)
          .send({ status: "failed", message: "Failed to publish results" });
      }
    }
  },
);

// POST /competition/manage/:id/award-prizes — retry button
// Credits any points prize that failed and pushes to any winner who hasn't been
// notified. Cash prizes are never credited. Safe to press repeatedly.
router.post(
  "/manage/:id/award-prizes",
  auth,
  requireManager,
  async (req, res) => {
    try {
      const comp = await OnlineQuizCompetition.findById(req.params.id);
      if (!comp)
        return res
          .status(404)
          .send({ status: "failed", message: "Competition not found" });
      if (!comp.resultsPublished) {
        return res.status(422).send({
          status: "failed",
          message: "Publish the results first",
        });
      }

      const before = buildAwardSummary(comp);
      if (!before.needsRetry) {
        return res.send({
          status: "success",
          message: "Everything is already awarded and notified",
          data: before,
        });
      }

      const summary = await settleAllWinners(comp);

      return res.send({
        status: "success",
        message: summary.needsRetry
          ? "Some awards still couldn't be processed — check server logs"
          : "Points credited and winners notified",
        data: summary,
      });
    } catch (err) {
      console.error("manage award-prizes error:", err);
      return res
        .status(500)
        .send({ status: "failed", message: "Failed to award prizes" });
    }
  },
);

// ─── GET /competition/:id ─────────────────────────────────────────────────────
// `leaderboard`:
//   - managers      → EVERY participant who submitted, ranked
//   - participants  → top 10, only while live or after results are published
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
    const submitted = ranked.filter((p) => p.hasParticipated);

    const now = new Date();
    const isLive =
      comp.status === "active" &&
      now >= new Date(comp.startTime) &&
      now < new Date(comp.endTime);

    const canSeeLeaderboard = isManager || isLive || comp.resultsPublished;
    const leaderboard = !canSeeLeaderboard
      ? []
      : isManager
        ? submitted
        : submitted.slice(0, 10);

    return res.send({
      status: "success",
      data: {
        ...formatCompetition(comp.toObject(), userId, isManager),
        leaderboard,
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
      data: ranked
        .filter((p) => p.hasParticipated)
        .map((p) => ({
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
