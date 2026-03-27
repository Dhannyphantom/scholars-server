// ============================================================
// CRON NOTIFICATION ROUTES  —  routes/cron.js
//
// Mount in app.js as:
//   app.use("/api/cron", require("./routes/cron"));
//
// Each route is protected by a shared CRON_SECRET header so only
// your scheduler (e.g. node-cron, Railway cron, GitHub Actions)
// can trigger them.
//
// Recommended schedule (WAT / UTC+1):
//   1. Morning greet          →  07:00 daily
//   2. Streak warning         →  20:00 daily  (light)  +  23:00  (urgent)
//   3. Assignment / quiz      →  09:00 daily
//   4. Daily quota nudge      →  16:00 daily
//   5. Leaderboard delta      →  21:00 daily
// ============================================================

const express = require("express");
const router = express.Router();
const { User } = require("../models/User");
const { School } = require("../models/School");
const expoNotifications = require("../controllers/expoNotifications");

// ── Shared secret guard ────────────────────────────────────────────────────
const CRON_SECRET = process.env.CRON_SECRET || "guru_cron_secret_change_me";

const cronAuth = (req, res, next) => {
  const secret =
    req.headers["x-cron-secret"] || req.query.secret || req.body?.secret;
  if (!secret || secret !== CRON_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorised" });
  }
  next();
};

// ── Tiny helper: send in batches of 100, returns { sent, failed } ──────────
const sendInBatches = async (tokens, notification) => {
  let sent = 0;
  let failed = 0;
  const validTokens = tokens.filter(Boolean);

  for (let i = 0; i < validTokens.length; i += 100) {
    const chunk = validTokens.slice(i, i + 100);
    try {
      await expoNotifications(chunk, notification);
      sent += chunk.length;
    } catch {
      failed += chunk.length;
    }
  }
  return { sent, failed };
};

// ── Helper: get today's calendar date range (midnight → now) ───────────────
const todayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  return { start, end };
};

// ── Helper: capitalize first letter ───────────────────────────────────────
const cap = (str) => {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// ── Helper: get friendly first name or fall back to username ──────────────
const friendlyName = (user) =>
  cap(user.firstName) || cap(user.username) || "Student";

// =============================================================================
// 1.  MORNING GREETING
//
//  POST  /api/cron/notify/morning-greet
//
//  Sends an uplifting good-morning message to ALL students and teachers
//  who have a valid push token.  Rotates through a pool of messages so
//  users see variety across the week.
//
//  Recommended schedule:  07:00 WAT daily
// =============================================================================
router.post("/notify/morning-greet", cronAuth, async (req, res) => {
  try {
    // Varied messages pool — index by day-of-week (0 = Sunday … 6 = Saturday)
    const dayMessages = [
      {
        title: "Good morning! ☀️ New week, new wins",
        body: "Start your Sunday strong — even 10 minutes of practice builds your streak and keeps you ahead.",
      },
      {
        title: "Monday motivation! 💪 Let's go",
        body: "The week is fresh and full of opportunity. Kick it off with a quick quiz session — your future self will thank you!",
      },
      {
        title: "Good morning! 📚 Tuesday grind",
        body: "Consistency beats talent every single time. Open the app, answer a few questions, and watch your rank climb.",
      },
      {
        title: "Midweek check-in! 🎯",
        body: "You're halfway through the week — great time to test your knowledge and beat yesterday's score.",
      },
      {
        title: "Good morning! 🚀 Thursday energy",
        body: "Just one quiz session today can make a big difference to your exam readiness score. Ready?",
      },
      {
        title: "Friday is here! 🎉",
        body: "End the week on a high note. A quick practice session now could push you up the leaderboard before the weekend!",
      },
      {
        title: "Weekend warrior mode! 🏆",
        body: "Saturday is your secret weapon — while others rest, you can gain serious ground. Let's study smarter!",
      },
    ];

    const dayOfWeek = new Date().getDay(); // 0 (Sun) – 6 (Sat)
    const message = dayMessages[dayOfWeek];

    // Fetch ALL students + teachers with tokens (no subscription filter —
    // the greeting is a freebie to keep everyone engaged)
    const users = await User.find(
      {
        accountType: { $in: ["student", "teacher"] },
        expoPushToken: { $exists: true, $ne: null },
      },
      { _id: 1, expoPushToken: 1 },
    ).lean();

    const tokens = users.map((u) => u.expoPushToken).filter(Boolean);

    const { sent, failed } = await sendInBatches(tokens, {
      title: message.title,
      message: message.body,
      data: { type: "morning_greet", channel: "General" },
    });

    return res.json({
      success: true,
      message: "Morning greet notifications dispatched",
      stats: { totalUsers: users.length, sent, failed },
    });
  } catch (error) {
    console.error("[cron/morning-greet]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// 2a.  STREAK WARNING  (evening — soft nudge)
//
//  POST  /api/cron/notify/streak-warning-evening
//
//  Targets users who HAVE an active streak (streak >= 1) but have NOT
//  logged any activity today.  Sent at 20:00 as a friendly reminder.
//
//  Recommended schedule:  20:00 WAT daily
// =============================================================================
router.post("/notify/streak-warning-evening", cronAuth, async (req, res) => {
  try {
    const { start } = todayRange();

    // Users with an active streak who haven't been active today
    const atRiskUsers = await User.find(
      {
        accountType: { $in: ["student", "teacher"] },
        streak: { $gte: 1 },
        expoPushToken: { $exists: true, $ne: null },
        // activeDays stores midnight-normalised dates — no entry for today means inactive
        activeDays: { $not: { $elemMatch: { $gte: start } } },
      },
      { _id: 1, expoPushToken: 1, firstName: 1, username: 1, streak: 1 },
    ).lean();

    if (!atRiskUsers.length) {
      return res.json({
        success: true,
        message: "No at-risk streak users found",
        stats: { eligible: 0, sent: 0 },
      });
    }

    // Personalised — send one-by-one (still batched inside sendInBatches)
    // For scale, group into tiers instead of fully personalising
    const tierMessages = [
      { min: 1, max: 3, emoji: "🌱", label: "budding" },
      { min: 4, max: 6, emoji: "🔥", label: "hot" },
      { min: 7, max: 13, emoji: "⚡", label: "electric" },
      { min: 14, max: 29, emoji: "💎", label: "diamond" },
      { min: 30, max: Infinity, emoji: "🏆", label: "legendary" },
    ];

    // Group tokens by streak tier for batch sending
    const tierBuckets = {};
    atRiskUsers.forEach((user) => {
      const tier =
        tierMessages.find(
          (t) => user.streak >= t.min && user.streak <= t.max,
        ) || tierMessages[0];
      const key = tier.label;
      if (!tierBuckets[key]) {
        tierBuckets[key] = { tier, tokens: [] };
      }
      tierBuckets[key].tokens.push(user.expoPushToken);
    });

    let totalSent = 0;
    let totalFailed = 0;

    for (const { tier, tokens } of Object.values(tierBuckets)) {
      const streakExample =
        atRiskUsers.find((u) => u.streak >= tier.min && u.streak <= tier.max)
          ?.streak || tier.min;

      const { sent, failed } = await sendInBatches(tokens, {
        title: `${tier.emoji} Don't break your streak!`,
        message: `Your ${tier.emoji} ${streakExample}-day streak is at risk! Log in and answer at least one question before midnight to keep it going.`,
        data: { type: "streak_warning_evening", channel: "General" },
      });

      totalSent += sent;
      totalFailed += failed;
    }

    return res.json({
      success: true,
      message: "Evening streak warnings dispatched",
      stats: {
        eligible: atRiskUsers.length,
        sent: totalSent,
        failed: totalFailed,
      },
    });
  } catch (error) {
    console.error("[cron/streak-warning-evening]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// 2b.  STREAK WARNING  (late night — urgent)
//
//  POST  /api/cron/notify/streak-warning-night
//
//  Same logic but more urgent — sent at 23:00.  Only targets users with
//  a streak >= 3 so we don't spam newcomers.
//
//  Recommended schedule:  23:00 WAT daily
// =============================================================================
router.post("/notify/streak-warning-night", cronAuth, async (req, res) => {
  try {
    const { start } = todayRange();

    const atRiskUsers = await User.find(
      {
        accountType: { $in: ["student", "teacher"] },
        streak: { $gte: 3 }, // only meaningful streaks get the midnight alarm
        expoPushToken: { $exists: true, $ne: null },
        activeDays: { $not: { $elemMatch: { $gte: start } } },
      },
      { _id: 1, expoPushToken: 1, streak: 1 },
    ).lean();

    if (!atRiskUsers.length) {
      return res.json({
        success: true,
        message: "No at-risk streak users at night check",
        stats: { eligible: 0, sent: 0 },
      });
    }

    // Split into two urgency buckets: 3-6 day streaks vs 7+ day streaks
    const shortStreakTokens = atRiskUsers
      .filter((u) => u.streak >= 3 && u.streak <= 6)
      .map((u) => u.expoPushToken);

    const longStreakTokens = atRiskUsers
      .filter((u) => u.streak >= 7)
      .map((u) => u.expoPushToken);

    let totalSent = 0;
    let totalFailed = 0;

    if (shortStreakTokens.length) {
      const { sent, failed } = await sendInBatches(shortStreakTokens, {
        title: "⏰ Last chance — streak ending soon!",
        message:
          "It's almost midnight and your streak is about to reset! Open the app and answer ONE question to keep it alive. Takes 30 seconds!",
        data: { type: "streak_warning_night", channel: "General" },
      });
      totalSent += sent;
      totalFailed += failed;
    }

    if (longStreakTokens.length) {
      const maxStreak = Math.max(...atRiskUsers.map((u) => u.streak));
      const { sent, failed } = await sendInBatches(longStreakTokens, {
        title: "🚨 URGENT — Your streak is about to die!",
        message: `Don't let all those days of hard work vanish! You have less than an hour to save your streak. Open Guru NOW!`,
        data: { type: "streak_warning_night_urgent", channel: "General" },
      });
      totalSent += sent;
      totalFailed += failed;
    }

    return res.json({
      success: true,
      message: "Late-night streak warnings dispatched",
      stats: {
        eligible: atRiskUsers.length,
        shortStreak: shortStreakTokens.length,
        longStreak: longStreakTokens.length,
        sent: totalSent,
        failed: totalFailed,
      },
    });
  } catch (error) {
    console.error("[cron/streak-warning-night]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// 3.  ASSIGNMENT & QUIZ REMINDERS
//
//  POST  /api/cron/notify/assignment-quiz-reminders
//
//  Scans every school document and:
//    — Notifies STUDENTS about ongoing assignments they haven't submitted yet
//    — Notifies STUDENTS about active quizzes they haven't attempted
//    — Notifies TEACHERS about assignments with pending submissions to grade
//    — Notifies TEACHERS about quizzes in "review" status waiting to be released
//
//  Recommended schedule:  09:00 WAT daily
// =============================================================================
router.post("/notify/assignment-quiz-reminders", cronAuth, async (req, res) => {
  try {
    const now = new Date();

    // Load all schools with relevant sub-documents
    const schools = await School.find(
      {
        "subscription.isActive": true,
      },
      {
        _id: 1,
        name: 1,
        classes: 1,
        students: 1,
        teachers: 1,
        assignments: 1,
        quiz: 1,
      },
    ).lean();

    const studentTokenMap = new Map(); // userId string → expoPushToken
    const teacherTokenMap = new Map(); // userId string → expoPushToken

    // Pre-fetch all unique user IDs across all schools in one query
    const allUserIds = new Set();
    schools.forEach((school) => {
      school.students?.forEach((s) => allUserIds.add(s.user?.toString()));
      school.teachers?.forEach((t) => allUserIds.add(t.user?.toString()));
    });

    const userDocs = await User.find(
      {
        _id: { $in: Array.from(allUserIds) },
        expoPushToken: { $exists: true, $ne: null },
      },
      { _id: 1, expoPushToken: 1, accountType: 1, class: 1 },
    ).lean();

    userDocs.forEach((u) => {
      if (u.accountType === "student") {
        studentTokenMap.set(u._id.toString(), {
          token: u.expoPushToken,
          classLevel: u.class?.level,
        });
      } else if (u.accountType === "teacher") {
        teacherTokenMap.set(u._id.toString(), u.expoPushToken);
      }
    });

    // Accumulate notification payloads
    const studentAssignmentTokens = [];
    const studentQuizTokens = [];
    const teacherGradeTokens = [];
    const teacherReviewTokens = [];

    for (const school of schools) {
      const verifiedStudentIds = new Set(
        (school.students || [])
          .filter((s) => s.verified)
          .map((s) => s.user?.toString()),
      );

      const verifiedTeacherIds = new Set(
        (school.teachers || [])
          .filter((t) => t.verified)
          .map((t) => t.user?.toString()),
      );

      // ── ASSIGNMENTS ──────────────────────────────────────────────────────
      for (const assignment of school.assignments || []) {
        if (assignment.status !== "ongoing") continue;
        if (assignment.expiry && new Date(assignment.expiry) < now) continue;

        const submittedStudentIds = new Set(
          (assignment.submissions || []).map((s) => s.student?.toString()),
        );

        // Students in the targeted class(es) who haven't submitted
        const targetClasses = new Set(assignment.classes || []);

        for (const studentIdStr of verifiedStudentIds) {
          const studentInfo = studentTokenMap.get(studentIdStr);
          if (!studentInfo) continue;

          const inTargetClass =
            targetClasses.size === 0 ||
            targetClasses.has(studentInfo.classLevel);
          if (!inTargetClass) continue;
          if (submittedStudentIds.has(studentIdStr)) continue;

          studentAssignmentTokens.push(studentInfo.token);
        }

        // Teachers — notify if there are ungraded submissions
        const ungradedCount = (assignment.submissions || []).filter(
          (sub) => sub.score?.value === undefined || sub.score?.value === null,
        ).length;

        if (ungradedCount > 0) {
          const teacherId = assignment.teacher?.toString();
          if (teacherId && teacherTokenMap.has(teacherId)) {
            teacherGradeTokens.push(teacherTokenMap.get(teacherId));
          }
        }
      }

      // ── QUIZZES ──────────────────────────────────────────────────────────
      for (const quiz of school.quiz || []) {
        if (quiz.status === "active") {
          const targetClass = quiz.class;
          const submittedIds = new Set(
            (quiz.currentSubmissions || []).map((id) => id?.toString()),
          );

          for (const studentIdStr of verifiedStudentIds) {
            const studentInfo = studentTokenMap.get(studentIdStr);
            if (!studentInfo) continue;
            if (targetClass && studentInfo.classLevel !== targetClass) continue;
            if (submittedIds.has(studentIdStr)) continue;

            studentQuizTokens.push(studentInfo.token);
          }
        }

        if (quiz.status === "review") {
          const teacherId = quiz.teacher?.toString();
          if (teacherId && teacherTokenMap.has(teacherId)) {
            teacherReviewTokens.push(teacherTokenMap.get(teacherId));
          }
        }
      }
    }

    // De-duplicate tokens before sending (a student/teacher may appear
    // in multiple schools or have multiple pending items)
    const unique = (arr) => [...new Set(arr.filter(Boolean))];

    const results = await Promise.all([
      sendInBatches(unique(studentAssignmentTokens), {
        title: "📋 Assignment pending!",
        message:
          "You have an ongoing assignment that hasn't been submitted yet. Don't miss the deadline — submit now!",
        data: { type: "assignment_reminder", channel: "Assignment" },
      }),

      sendInBatches(unique(studentQuizTokens), {
        title: "📝 Quiz waiting for you!",
        message:
          "There's an active quiz in your school portal. Participate now before it closes!",
        data: { type: "quiz_reminder", channel: "Quiz" },
      }),

      sendInBatches(unique(teacherGradeTokens), {
        title: "✏️ Submissions to grade",
        message:
          "Students are waiting! You have assignment submissions that need scoring. Open the school portal to review them.",
        data: { type: "teacher_grade_reminder", channel: "Assignment" },
      }),

      sendInBatches(unique(teacherReviewTokens), {
        title: "🔒 Quiz in review — release scores?",
        message:
          "A quiz session has ended and is waiting in review. Your students are eager to see their scores — publish when ready!",
        data: { type: "teacher_review_reminder", channel: "Quiz" },
      }),
    ]);

    const [assignRes, quizRes, gradeRes, reviewRes] = results;

    return res.json({
      success: true,
      message: "Assignment & quiz reminders dispatched",
      stats: {
        studentAssignment: {
          unique: unique(studentAssignmentTokens).length,
          ...assignRes,
        },
        studentQuiz: {
          unique: unique(studentQuizTokens).length,
          ...quizRes,
        },
        teacherGrade: {
          unique: unique(teacherGradeTokens).length,
          ...gradeRes,
        },
        teacherReview: {
          unique: unique(teacherReviewTokens).length,
          ...reviewRes,
        },
      },
    });
  } catch (error) {
    console.error("[cron/assignment-quiz-reminders]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// 4.  DAILY QUOTA NUDGE
//
//  POST  /api/cron/notify/daily-quota-nudge
//
//  Runs at 16:00 (4 pm).  Notifies students who STILL have a significant
//  chunk of their daily quota left (≥ 30 questions remaining) so they
//  don't waste the day's allowance.  We skip users who are close to their
//  cap (< 30 remaining) to avoid nagging the already-active ones.
//
//  Recommended schedule:  16:00 WAT daily
// =============================================================================
router.post("/notify/daily-quota-nudge", cronAuth, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const MAX_DAILY = 100;
    const NUDGE_THRESHOLD = 30; // warn if ≥ 30 questions remaining

    // Fetch students with quota data
    const students = await User.find(
      {
        accountType: "student",
        expoPushToken: { $exists: true, $ne: null },
      },
      {
        _id: 1,
        expoPushToken: 1,
        firstName: 1,
        username: 1,
        quota: 1,
        streak: 1,
      },
    ).lean();

    // Bucket users by how many questions they still have left
    const bigRemainingTokens = []; // 70-100 remaining (barely started)
    const medRemainingTokens = []; // 30-69 remaining  (halfway)

    for (const student of students) {
      const quota = student.quota;
      if (!quota) {
        bigRemainingTokens.push(student.expoPushToken);
        continue;
      }

      // Determine if quota was last updated today
      const lastUpdate = quota.daily_update
        ? new Date(quota.daily_update)
        : null;
      const isToday =
        lastUpdate &&
        lastUpdate.getFullYear() === now.getFullYear() &&
        lastUpdate.getMonth() === now.getMonth() &&
        lastUpdate.getDate() === now.getDate();

      const answeredToday = isToday ? quota.daily_questions_count || 0 : 0;
      const remaining = MAX_DAILY - answeredToday;

      if (remaining >= 70) {
        bigRemainingTokens.push(student.expoPushToken);
      } else if (remaining >= NUDGE_THRESHOLD) {
        medRemainingTokens.push(student.expoPushToken);
      }
      // < 30 remaining → don't nudge (they're already active)
    }

    const [bigRes, medRes] = await Promise.all([
      sendInBatches(bigRemainingTokens.filter(Boolean), {
        title: "📊 You haven't started today's questions!",
        message:
          "You still have 100 questions available today. Each question you answer earns you points and builds your exam readiness. Let's go!",
        data: {
          type: "quota_nudge_big",
          channel: "General",
          screen: "quiz",
        },
      }),

      sendInBatches(medRemainingTokens.filter(Boolean), {
        title: "⏳ Don't waste today's quota!",
        message:
          "You still have questions left for today. Keep practising — every question brings you closer to the top of the leaderboard!",
        data: {
          type: "quota_nudge_medium",
          channel: "General",
          screen: "quiz",
        },
      }),
    ]);

    return res.json({
      success: true,
      message: "Daily quota nudge notifications dispatched",
      stats: {
        totalStudentsChecked: students.length,
        bigRemainingGroup: {
          count: bigRemainingTokens.length,
          ...bigRes,
        },
        medRemainingGroup: {
          count: medRemainingTokens.length,
          ...medRes,
        },
        alreadyActiveSkipped:
          students.length -
          bigRemainingTokens.length -
          medRemainingTokens.length,
      },
    });
  } catch (error) {
    console.error("[cron/daily-quota-nudge]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// 5.  LEADERBOARD DELTA ALERTS
//
//  POST  /api/cron/notify/leaderboard-delta
//
//  How it works (fully DB-backed — no in-memory state):
//
//  Each run has two phases:
//
//  PHASE A — READ & COMPARE
//    1. Collect every verified school student.
//    2. Sort by totalPoints DESC and assign a fresh numeric rank
//       (tied scores share the same rank number).
//    3. Read each user's previously-saved `leaderboardRank` field from
//       the User document.
//    4. Compare new rank vs saved rank:
//         new > saved  →  position fell   → "dropped" notification
//         new < saved  →  position rose   → "climbed"  notification
//         new === saved or saved is null  →  no notification
//
//  PHASE B — PERSIST
//    5. Bulk-write the new rank back to `user.leaderboardRank` for
//       every student in one `bulkWrite` call so the NEXT run has
//       an accurate baseline.
//
//  The `leaderboardRank` field must be added to the User model:
//
//    leaderboardRank: {
//      type: Number,
//      default: null,
//    }
//
//  Add the migration note below as a one-time script or just let the
//  first cron run initialise the field for all users (they'll receive
//  no notification that first run, which is correct behaviour).
//
//  Recommended schedule:  21:00 WAT daily
// =============================================================================
router.post("/notify/leaderboard-delta", cronAuth, async (req, res) => {
  try {
    // ── PHASE A — Step 1: Gather verified school students ────────────────────
    // Pull only the fields we need from every school so the query is lean.
    const schoolDocs = await School.find(
      {},
      { "students.user": 1, "students.verified": 1 },
    ).lean();

    const verifiedUserIdSet = new Set();
    schoolDocs.forEach((school) => {
      (school.students || []).forEach((s) => {
        if (s.verified && s.user) verifiedUserIdSet.add(s.user.toString());
      });
    });

    if (!verifiedUserIdSet.size) {
      return res.json({
        success: true,
        message: "No verified students found — nothing to do",
        stats: { eligible: 0 },
      });
    }

    // ── PHASE A — Step 2: Fetch all verified students sorted by points ───────
    // We include `leaderboardRank` (previous snapshot) alongside the fields
    // needed to compute the new rank and send notifications.
    const students = await User.find(
      {
        _id: { $in: Array.from(verifiedUserIdSet) },
        accountType: "student",
      },
      {
        _id: 1,
        totalPoints: 1,
        firstName: 1,
        username: 1,
        expoPushToken: 1,
        leaderboardRank: 1, // ← persisted snapshot from previous run
      },
    )
      .sort({ totalPoints: -1, _id: 1 }) // stable sort: points then ObjectId
      .lean();

    if (!students.length) {
      return res.json({
        success: true,
        message: "No student documents matched verified IDs",
        stats: { eligible: 0 },
      });
    }

    // ── PHASE A — Step 3: Assign fresh numeric ranks (dense rank with ties) ──
    // e.g. scores [100, 100, 80, 60] → ranks [1, 1, 3, 4]
    const ranked = []; // { student, newRank }
    let newRank = 1;

    for (let i = 0; i < students.length; i++) {
      if (i > 0 && students[i].totalPoints < students[i - 1].totalPoints) {
        newRank = i + 1; // jump rank to actual position on a score change
      }
      ranked.push({ student: students[i], newRank });
    }

    // ── PHASE A — Step 4: Classify each student as dropped / climbed / same ──
    const droppedTokens = []; // position fell  (rank number increased)
    const climbedTokens = []; // position rose  (rank number decreased)
    const droppedDetails = []; // for response stats / debugging
    const climbedDetails = [];

    for (const { student, newRank: curr } of ranked) {
      const prev = student.leaderboardRank; // null on first-ever run

      // No previous snapshot → initialise silently, no notification
      if (prev == null) continue;

      if (curr > prev) {
        // Rank number went UP  →  position went DOWN  (bad for user)
        if (student.expoPushToken) droppedTokens.push(student.expoPushToken);
        droppedDetails.push({
          userId: student._id.toString(),
          prevRank: prev,
          currRank: curr,
          drop: curr - prev,
        });
      } else if (curr < prev) {
        // Rank number went DOWN  →  position went UP  (good for user)
        if (student.expoPushToken) climbedTokens.push(student.expoPushToken);
        climbedDetails.push({
          userId: student._id.toString(),
          prevRank: prev,
          currRank: curr,
          rise: prev - curr,
        });
      }
      // curr === prev → no change, no notification
    }

    // ── PHASE B — Step 5: Persist new ranks back to User documents ───────────
    // Single bulkWrite — far cheaper than N individual updateOne calls.
    if (ranked.length) {
      const bulkOps = ranked.map(({ student, newRank: nr }) => ({
        updateOne: {
          filter: { _id: student._id },
          update: { $set: { leaderboardRank: nr } },
        },
      }));

      await User.bulkWrite(bulkOps, { ordered: false });
    }

    // ── Step 6: Send notifications ───────────────────────────────────────────
    const validDropped = [...new Set(droppedTokens)].filter(Boolean);
    const validClimbed = [...new Set(climbedTokens)].filter(Boolean);

    const [dropRes, riseRes] = await Promise.all([
      validDropped.length
        ? sendInBatches(validDropped, {
            title: "📉 You've dropped on the leaderboard!",
            message:
              "Someone just overtook you! Answer more questions today to climb back up and protect your ranking.",
            data: {
              type: "rank_drop",
              channel: "General",
              screen: "leaderboard",
            },
          })
        : { sent: 0, failed: 0 },

      validClimbed.length
        ? sendInBatches(validClimbed, {
            title: "🚀 You've climbed the leaderboard!",
            message:
              "Great work — you've moved up in the rankings! Keep practising to hold your new position and climb even higher.",
            data: {
              type: "rank_rise",
              channel: "General",
              screen: "leaderboard",
            },
          })
        : { sent: 0, failed: 0 },
    ]);

    return res.json({
      success: true,
      message: "Leaderboard delta notifications dispatched",
      stats: {
        totalRanked: ranked.length,
        firstRunUsersInitialised: ranked.filter(
          ({ student }) => student.leaderboardRank == null,
        ).length,
        droppedInRank: {
          count: validDropped.length,
          ...dropRes,
          sample: droppedDetails.slice(0, 5),
        },
        climbedInRank: {
          count: validClimbed.length,
          ...riseRes,
          sample: climbedDetails.slice(0, 5),
        },
      },
    });
  } catch (error) {
    console.error("[cron/leaderboard-delta]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =============================================================================
// HEALTH CHECK  —  GET /api/cron/health
// =============================================================================
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Guru cron service is healthy",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
