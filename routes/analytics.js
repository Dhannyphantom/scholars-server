const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { User } = require("../models/User");
const { School } = require("../models/School");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { Question } = require("../models/Question");
const { Quiz } = require("../models/Quiz");
const { SupportTicket } = require("../models/SupportTicket");
const PayoutRequest = require("../models/PayoutRequest");
const WalletAccount = require("../models/WalletAccount");
const WalletTransaction = require("../models/WalletTransaction");

const auth = require("../middlewares/authRoutes");
const manager = require("../middlewares/managerAuth");

// const cache = require("node-cac")

/**
 * GET /api/analytics
 * Comprehensive analytics endpoint that aggregates statistics from all models
 */
router.get("/", manager, async (req, res) => {
  try {
    // Parallel execution of all analytics queries for better performance
    const [
      userAnalytics,
      schoolAnalytics,
      contentAnalytics,
      quizAnalytics,
      financialAnalytics,
      supportAnalytics,
      engagementAnalytics,
    ] = await Promise.all([
      getUserAnalytics(),
      getSchoolAnalytics(),
      getContentAnalytics(),
      getQuizAnalytics(),
      getFinancialAnalytics(),
      getSupportAnalytics(),
      getEngagementAnalytics(),
    ]);

    // Return comprehensive analytics
    res.json({
      success: true,
      timestamp: new Date(),
      analytics: {
        users: userAnalytics,
        schools: schoolAnalytics,
        content: contentAnalytics,
        quizzes: quizAnalytics,
        financial: financialAnalytics,
        support: supportAnalytics,
        engagement: engagementAnalytics,
      },
    });
  } catch (error) {
    console.error("Analytics Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching analytics",
      error: error.message,
    });
  }
});

// ==================== USER ANALYTICS ====================
async function getUserAnalytics() {
  const [
    totalUsers,
    usersByType,
    verifiedUsers,
    activeSubscriptions,
    usersByGender,
    usersByClass,
    topUsersByPoints,
    topUsersByStreak,
    recentUsers,
    userGrowth,
  ] = await Promise.all([
    // Total users count
    User.countDocuments(),

    // Users by account type
    User.aggregate([
      {
        $group: {
          _id: "$accountType",
          count: { $sum: 1 },
        },
      },
    ]),

    // Verified users
    User.countDocuments({ verified: true }),

    // Active subscriptions
    User.countDocuments({ "subscription.isActive": true }),

    // Users by gender
    User.aggregate([
      {
        $group: {
          _id: "$gender",
          count: { $sum: 1 },
        },
      },
    ]),

    // Users by class level
    User.aggregate([
      {
        $match: { "class.level": { $exists: true, $ne: null } },
      },
      {
        $group: {
          _id: "$class.level",
          count: { $sum: 1 },
        },
      },
    ]),

    // Top 10 users by points
    User.find()
      .select("username firstName lastName points totalPoints avatar")
      .sort({ totalPoints: -1 })
      .limit(10)
      .lean(),

    // Top 10 users by streak
    User.find()
      .select("username firstName lastName streak avatar")
      .sort({ streak: -1 })
      .limit(10)
      .lean(),

    // Recent users (last 30 days)
    User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }),

    // User growth (monthly)
    User.aggregate([
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": -1, "_id.month": -1 } },
      { $limit: 12 },
    ]),
  ]);

  // Points statistics
  const pointsStats = await User.aggregate([
    {
      $group: {
        _id: null,
        totalPoints: { $sum: "$totalPoints" },
        totalActivePoints: { $sum: "$points" },
        totalSchoolPoints: { $sum: "$schoolPoints" },
        averagePoints: { $avg: "$totalPoints" },
        maxPoints: { $max: "$totalPoints" },
      },
    },
  ]);

  return {
    overview: {
      total: totalUsers,
      verified: verifiedUsers,
      activeSubscriptions,
      recentUsers,
    },
    distribution: {
      byAccountType: usersByType,
      byGender: usersByGender,
      byClass: usersByClass,
    },
    leaderboards: {
      topByPoints: topUsersByPoints,
      topByStreak: topUsersByStreak,
    },
    points: pointsStats[0] || {},
    growth: userGrowth,
  };
}

// ==================== SCHOOL ANALYTICS ====================
async function getSchoolAnalytics() {
  const [
    totalSchools,
    schoolsByType,
    activeSchoolSubscriptions,
    totalStudents,
    totalTeachers,
    schoolsWithMostStudents,
    schoolsWithMostTeachers,
    totalClasses,
    totalAnnouncements,
    totalAssignments,
    assignmentsByStatus,
    recentSchools,
  ] = await Promise.all([
    // Total schools
    School.countDocuments(),

    // Schools by type
    School.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]),

    // Active school subscriptions
    School.countDocuments({ "subscription.isActive": true }),

    // Total students across all schools
    School.aggregate([
      {
        $project: {
          studentCount: { $size: "$students" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$studentCount" },
        },
      },
    ]),

    // Total teachers across all schools
    School.aggregate([
      {
        $project: {
          teacherCount: { $size: "$teachers" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$teacherCount" },
        },
      },
    ]),

    // Top 10 schools by student count
    School.aggregate([
      {
        $project: {
          name: 1,
          studentCount: { $size: "$students" },
        },
      },
      { $sort: { studentCount: -1 } },
      { $limit: 10 },
    ]),

    // Top 10 schools by teacher count
    School.aggregate([
      {
        $project: {
          name: 1,
          teacherCount: { $size: "$teachers" },
        },
      },
      { $sort: { teacherCount: -1 } },
      { $limit: 10 },
    ]),

    // Total classes
    School.aggregate([
      {
        $project: {
          classCount: { $size: "$classes" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$classCount" },
        },
      },
    ]),

    // Total announcements
    School.aggregate([
      {
        $project: {
          announcementCount: { $size: "$announcements" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$announcementCount" },
        },
      },
    ]),

    // Total assignments
    School.aggregate([
      {
        $project: {
          assignmentCount: { $size: "$assignments" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$assignmentCount" },
        },
      },
    ]),

    // Assignments by status
    School.aggregate([
      { $unwind: "$assignments" },
      {
        $group: {
          _id: "$assignments.status",
          count: { $sum: 1 },
        },
      },
    ]),

    // Recent schools (last 30 days)
    School.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  // Quiz statistics for schools
  const schoolQuizStats = await School.aggregate([
    {
      $project: {
        quizCount: { $size: "$quiz" },
      },
    },
    {
      $group: {
        _id: null,
        totalQuizzes: { $sum: "$quizCount" },
        averagePerSchool: { $avg: "$quizCount" },
      },
    },
  ]);

  return {
    overview: {
      total: totalSchools,
      activeSubscriptions: activeSchoolSubscriptions,
      recentSchools,
    },
    distribution: {
      byType: schoolsByType,
    },
    people: {
      totalStudents: totalStudents[0]?.total || 0,
      totalTeachers: totalTeachers[0]?.total || 0,
    },
    topSchools: {
      byStudents: schoolsWithMostStudents,
      byTeachers: schoolsWithMostTeachers,
    },
    activities: {
      totalClasses: totalClasses[0]?.total || 0,
      totalAnnouncements: totalAnnouncements[0]?.total || 0,
      totalAssignments: totalAssignments[0]?.total || 0,
      assignmentsByStatus,
      totalQuizzes: schoolQuizStats[0]?.totalQuizzes || 0,
      averageQuizzesPerSchool: schoolQuizStats[0]?.averagePerSchool || 0,
    },
  };
}

// ==================== CONTENT ANALYTICS ====================
async function getContentAnalytics() {
  const [
    totalCategories,
    totalSubjects,
    totalTopics,
    totalQuestions,
    questionsByType,
    topCategories,
    topSubjects,
    topTopics,
    recentQuestions,
    questionsWithImages,
  ] = await Promise.all([
    // Total categories
    Category.countDocuments(),

    // Total subjects
    Subject.countDocuments(),

    // Total topics
    Topic.countDocuments(),

    // Total questions
    Question.countDocuments(),

    // Questions by type
    Question.aggregate([
      {
        $group: {
          _id: "$isTheory",
          count: { $sum: 1 },
        },
      },
    ]),

    // Top 10 categories by subject count
    Category.aggregate([
      {
        $project: {
          name: 1,
          subjectCount: { $size: "$subjects" },
        },
      },
      { $sort: { subjectCount: -1 } },
      { $limit: 10 },
    ]),

    // Top 10 subjects by topic count
    Subject.aggregate([
      {
        $project: {
          name: 1,
          topicCount: { $size: "$topics" },
        },
      },
      { $sort: { topicCount: -1 } },
      { $limit: 10 },
    ]),

    // Top 10 topics by question count
    Topic.aggregate([
      {
        $project: {
          name: 1,
          questionCount: { $size: "$questions" },
        },
      },
      { $sort: { questionCount: -1 } },
      { $limit: 10 },
    ]),

    // Recent questions (last 7 days)
    Question.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),

    // Questions with images
    Question.countDocuments({ "image.uri": { $exists: true, $ne: null } }),
  ]);

  // Average questions per topic
  const avgQuestionsPerTopic = await Topic.aggregate([
    {
      $project: {
        questionCount: { $size: "$questions" },
      },
    },
    {
      $group: {
        _id: null,
        average: { $avg: "$questionCount" },
      },
    },
  ]);

  // Questions by category
  const questionsByCategory = await Question.aggregate([
    { $unwind: "$categories" },
    {
      $lookup: {
        from: "categories",
        localField: "categories",
        foreignField: "_id",
        as: "categoryInfo",
      },
    },
    { $unwind: "$categoryInfo" },
    {
      $group: {
        _id: "$categoryInfo.name",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  return {
    overview: {
      totalCategories,
      totalSubjects,
      totalTopics,
      totalQuestions,
      recentQuestions,
      questionsWithImages,
    },
    questionTypes: {
      theory: questionsByType.find((q) => q._id === true)?.count || 0,
      objective: questionsByType.find((q) => q._id === false)?.count || 0,
    },
    topContent: {
      categories: topCategories,
      subjects: topSubjects,
      topics: topTopics,
    },
    questionsByCategory,
    metrics: {
      averageQuestionsPerTopic: avgQuestionsPerTopic[0]?.average || 0,
    },
  };
}

// ==================== QUIZ ANALYTICS ====================
async function getQuizAnalytics() {
  const [
    totalQuizzes,
    quizzesByMode,
    quizzesByType,
    recentQuizzes,
    totalParticipants,
  ] = await Promise.all([
    // Total quizzes
    Quiz.countDocuments(),

    // Quizzes by mode
    Quiz.aggregate([
      {
        $group: {
          _id: "$mode",
          count: { $sum: 1 },
        },
      },
    ]),

    // Quizzes by type
    Quiz.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]),

    // Recent quizzes (last 7 days)
    Quiz.countDocuments({
      date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),

    // Total participants
    Quiz.aggregate([
      {
        $project: {
          participantCount: { $size: "$participants" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$participantCount" },
        },
      },
    ]),
  ]);

  // Quiz engagement stats
  const quizEngagement = await Quiz.aggregate([
    {
      $project: {
        questionCount: { $size: "$questions" },
        participantCount: { $size: "$participants" },
      },
    },
    {
      $group: {
        _id: null,
        averageQuestions: { $avg: "$questionCount" },
        averageParticipants: { $avg: "$participantCount" },
        totalQuestions: { $sum: "$questionCount" },
      },
    },
  ]);

  // User quiz statistics aggregation
  const userQuizStats = await User.aggregate([
    {
      $match: { "quizStats.totalQuizzes": { $gt: 0 } },
    },
    {
      $group: {
        _id: null,
        totalQuizzesCompleted: { $sum: "$quizStats.totalQuizzes" },
        totalSoloQuizzes: { $sum: "$quizStats.totalSoloQuizzes" },
        totalMultiplayerQuizzes: { $sum: "$quizStats.totalMultiplayerQuizzes" },
        totalWins: { $sum: "$quizStats.totalWins" },
        averageAccuracy: { $avg: "$quizStats.accuracyRate" },
        averageScore: { $avg: "$quizStats.averageScore" },
      },
    },
  ]);

  // Top performers
  const topPerformers = await User.find({
    "quizStats.totalQuizzes": { $gt: 0 },
  })
    .select(
      "username firstName lastName quizStats.averageScore quizStats.totalQuizzes quizStats.accuracyRate avatar",
    )
    .sort({ "quizStats.averageScore": -1 })
    .limit(10)
    .lean();

  return {
    overview: {
      total: totalQuizzes,
      recentQuizzes,
      totalParticipants: totalParticipants[0]?.total || 0,
    },
    distribution: {
      byMode: quizzesByMode,
      byType: quizzesByType,
    },
    engagement: {
      averageQuestions: quizEngagement[0]?.averageQuestions || 0,
      averageParticipants: quizEngagement[0]?.averageParticipants || 0,
      totalQuestions: quizEngagement[0]?.totalQuestions || 0,
    },
    userStats: userQuizStats[0] || {},
    topPerformers,
  };
}

// ==================== FINANCIAL ANALYTICS ====================
async function getFinancialAnalytics() {
  const [
    walletAccounts,
    totalTransactions,
    transactionsByType,
    transactionsByStatus,
    payoutRequests,
    payoutsByStatus,
    payoutsByType,
    recentTransactions,
    recentPayouts,
  ] = await Promise.all([
    // Wallet accounts
    WalletAccount.find().lean(),

    // Total transactions
    WalletTransaction.countDocuments(),

    // Transactions by type
    WalletTransaction.aggregate([
      {
        $group: {
          _id: "$transactionType",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]),

    // Transactions by status
    WalletTransaction.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]),

    // Total payout requests
    PayoutRequest.countDocuments(),

    // Payouts by status
    PayoutRequest.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalPoints: { $sum: "$pointsConverted" },
        },
      },
    ]),

    // Payouts by type
    PayoutRequest.aggregate([
      {
        $group: {
          _id: "$payoutType",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalPoints: { $sum: "$pointsConverted" },
        },
      },
    ]),

    // Recent transactions (last 30 days)
    WalletTransaction.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }),

    // Recent payouts (last 30 days)
    PayoutRequest.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  // Transaction volume over time
  const transactionVolume = await WalletTransaction.aggregate([
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
      },
    },
    { $sort: { "_id.year": -1, "_id.month": -1 } },
    { $limit: 12 },
  ]);

  // Payout statistics
  const payoutStats = await PayoutRequest.aggregate([
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
        totalPoints: { $sum: "$pointsConverted" },
        averageAmount: { $avg: "$amount" },
        averagePoints: { $avg: "$pointsConverted" },
      },
    },
  ]);

  return {
    wallets: {
      accounts: walletAccounts,
      totalBalance: walletAccounts.reduce((sum, acc) => sum + acc.balance, 0),
    },
    transactions: {
      total: totalTransactions,
      recent: recentTransactions,
      byType: transactionsByType,
      byStatus: transactionsByStatus,
      volumeOverTime: transactionVolume,
    },
    payouts: {
      total: payoutRequests,
      recent: recentPayouts,
      byStatus: payoutsByStatus,
      byType: payoutsByType,
      statistics: payoutStats[0] || {},
    },
  };
}

// ==================== SUPPORT ANALYTICS ====================
async function getSupportAnalytics() {
  const [
    totalTickets,
    ticketsByStatus,
    ticketsByCategory,
    ticketsByPriority,
    recentTickets,
    openTickets,
    resolvedTickets,
  ] = await Promise.all([
    // Total tickets
    SupportTicket.countDocuments(),

    // Tickets by status
    SupportTicket.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),

    // Tickets by category
    SupportTicket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]),

    // Tickets by priority
    SupportTicket.aggregate([
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 },
        },
      },
    ]),

    // Recent tickets (last 7 days)
    SupportTicket.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),

    // Open tickets
    SupportTicket.countDocuments({
      status: { $in: ["open", "in_progress", "waiting_user"] },
    }),

    // Resolved tickets
    SupportTicket.countDocuments({ status: "resolved" }),
  ]);

  // Average response and resolution times
  const performanceMetrics = await SupportTicket.aggregate([
    {
      $match: {
        resolvedAt: { $exists: true },
      },
    },
    {
      $project: {
        resolutionTime: {
          $subtract: ["$resolvedAt", "$createdAt"],
        },
        messageCount: { $size: "$messages" },
      },
    },
    {
      $group: {
        _id: null,
        averageResolutionTime: { $avg: "$resolutionTime" },
        averageMessageCount: { $avg: "$messageCount" },
      },
    },
  ]);

  // Rating statistics
  const ratingStats = await SupportTicket.aggregate([
    {
      $match: {
        "rating.score": { $exists: true },
      },
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating.score" },
        totalRatings: { $sum: 1 },
        ratingDistribution: {
          $push: "$rating.score",
        },
      },
    },
  ]);

  return {
    overview: {
      total: totalTickets,
      open: openTickets,
      resolved: resolvedTickets,
      recent: recentTickets,
    },
    distribution: {
      byStatus: ticketsByStatus,
      byCategory: ticketsByCategory,
      byPriority: ticketsByPriority,
    },
    performance: {
      averageResolutionTime: performanceMetrics[0]?.averageResolutionTime || 0,
      averageMessageCount: performanceMetrics[0]?.averageMessageCount || 0,
    },
    satisfaction: {
      averageRating: ratingStats[0]?.averageRating || 0,
      totalRatings: ratingStats[0]?.totalRatings || 0,
    },
  };
}

// ==================== ENGAGEMENT ANALYTICS ====================
async function getEngagementAnalytics() {
  // Daily active users (last 7 days)
  const dailyActiveUsers = await User.aggregate([
    {
      $match: {
        "quota.last_update": {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$quota.last_update" },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: -1 } },
  ]);

  // Users with active streaks
  const activeStreaks = await User.countDocuments({ streak: { $gt: 0 } });

  // Average streak
  const streakStats = await User.aggregate([
    {
      $group: {
        _id: null,
        averageStreak: { $avg: "$streak" },
        maxStreak: { $max: "$streak" },
      },
    },
  ]);

  // Daily question completion
  const dailyQuestionStats = await User.aggregate([
    {
      $match: {
        "quota.daily_questions_count": { $gt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        totalDailyQuestions: { $sum: "$quota.daily_questions_count" },
        averageDailyQuestions: { $avg: "$quota.daily_questions_count" },
        usersCompletingDaily: { $sum: 1 },
      },
    },
  ]);

  // Subject engagement
  const subjectEngagement = await User.aggregate([
    { $unwind: "$quota.subjects" },
    {
      $lookup: {
        from: "subjects",
        localField: "quota.subjects.subject",
        foreignField: "_id",
        as: "subjectInfo",
      },
    },
    { $unwind: "$subjectInfo" },
    {
      $group: {
        _id: "$subjectInfo.name",
        totalQuestions: {
          $sum: { $size: "$quota.subjects.questions" },
        },
        userCount: { $sum: 1 },
      },
    },
    { $sort: { userCount: -1 } },
    { $limit: 10 },
  ]);

  // Invite statistics
  const inviteStats = await User.aggregate([
    { $unwind: "$invites" },
    {
      $group: {
        _id: "$invites.status",
        count: { $sum: 1 },
      },
    },
  ]);

  // Recent quiz activity
  const recentQuizActivity = await User.aggregate([
    { $unwind: "$quizHistory" },
    {
      $match: {
        "quizHistory.date": {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$quizHistory.date" },
        },
        count: { $sum: 1 },
        totalPoints: { $sum: "$quizHistory.pointsEarned" },
      },
    },
    { $sort: { _id: -1 } },
  ]);

  return {
    dailyActivity: {
      activeUsers: dailyActiveUsers,
      usersWithStreaks: activeStreaks,
      streakStatistics: streakStats[0] || {},
    },
    questionActivity: {
      dailyStats: dailyQuestionStats[0] || {},
      topSubjects: subjectEngagement,
    },
    quizActivity: {
      recentActivity: recentQuizActivity,
      inviteStatistics: inviteStats,
    },
  };
}

// ME
/**
 * GET /api/users/analytics/me
 *
 * Comprehensive personal academic analytics for the authenticated student.
 *
 * Sections returned:
 *  1.  profile          — identity, class, school, subscription, streak
 *  2.  overview         — all-time totals (quizzes, accuracy, points, rank)
 *  3.  examReadiness    — weighted 0-100 readiness index + component breakdown
 *                         (WAEC/NECO/JAMB for senior; BECE/NECO for junior)
 *  4.  subjectPerformance — per-subject accuracy, trend, mastery %, tag
 *  5.  topicPerformance — per-topic accuracy nested under each subject, tagged
 *  6.  weakSpotsDigest  — flat ranked list of the 10 weakest topics across all subjects
 *  7.  strongSpotsDigest — flat ranked list of the 10 strongest topics
 *  8.  classComparison  — how this user ranks vs classmates (percentile, rank)
 *  9.  schoolComparison — how this user ranks vs whole school
 * 10.  trends           — weekly & monthly accuracy + activity over time
 * 11.  streakHistory    — current streak, best streak, active days heatmap (last 60d)
 * 12.  multiplayerStats — wins, win-rate, games played, avg rank
 * 13.  recentActivity   — last 10 quiz sessions with per-session breakdown
 * 14.  studyConsistency — quizzes-per-day avg, best day, most-practiced subject
 * 15.  recommendations  — auto-generated action items based on weak topics/subjects
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const JUNIOR_CLASSES = ["jss 1", "jss 2", "jss 3"];
const SENIOR_CLASSES = ["sss 1", "sss 2", "sss 3"];

// Readiness formula weights (must sum to 1.0)
const W_ACCURACY = 0.4;
const W_CONSISTENCY = 0.25;
const W_VOLUME = 0.15;
const W_SPEED = 0.1;
const W_BREADTH = 0.1; // number of distinct subjects covered

const TARGET_QUIZZES_MONTH = 20;
const TARGET_QUESTIONS_MONTH = 90;
const TARGET_MS_PER_QUESTION = 60_000; // 60 s — fast completion = good
const TARGET_SUBJECTS = 5; // breadth benchmark

const r2 = (n) => (n == null ? 0 : parseFloat(Number(n).toFixed(2)));

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userObjId = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    // ── Time windows ──────────────────────────────────────────────────────────
    const last30d = new Date(now - 30 * 86_400_000);
    const last60d = new Date(now - 60 * 86_400_000);
    const last7d = new Date(now - 7 * 86_400_000);
    const last12w = new Date(now - 12 * 7 * 86_400_000);
    const last6mo = new Date(now - 6 * 30 * 86_400_000);
    const last60dMs = 60 * 86_400_000;

    // ── 1. Fetch user & school in parallel ───────────────────────────────────
    const [userDoc, schoolDoc] = await Promise.all([
      User.findById(userId)
        .select(
          "firstName lastName username preffix avatar accountType class " +
            "schoolLevel school subscription points totalPoints schoolPoints " +
            "streak activeDays quizStats quizHistory rank",
        )
        .lean(),
      School.findOne({ "students.user": userObjId })
        .select("_id name type state students classes")
        .lean(),
    ]);

    if (!userDoc) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (userDoc.accountType !== "student") {
      return res
        .status(403)
        .json({ success: false, message: "Analytics are for students only" });
    }

    const schoolId = schoolDoc?._id ?? null;
    const schoolObjId = schoolId ? new mongoose.Types.ObjectId(schoolId) : null;
    const classLevel = userDoc.class?.level ?? null;
    const isJunior = JUNIOR_CLASSES.includes(classLevel);
    const examLabel = isJunior ? "BECE / NECO" : "WAEC / NECO / JAMB";

    // ── 2. Core quiz aggregations — all run in parallel ──────────────────────
    const [
      allTimeAgg, // overall totals across all quizzes
      subjectAgg, // per-subject accuracy from Quiz.summary.subjectBreakdown
      topicAgg, // per-topic accuracy from Quiz.questions (inline)
      last30dAgg, // last 30d stats — for readiness & improvement
      prior30dAgg, // 30-60d — for improvement delta
      weeklyTrendAgg, // weekly accuracy trend (12 weeks)
      monthlyTrendAgg, // monthly accuracy trend (6 months)
      classPeersAgg, // all classmates scores (for percentile)
      schoolPeersAgg, // all school students scores (for percentile)
      modeBreakdownAgg, // solo vs friends split
      dayOfWeekAgg, // activity by day of week
    ] = await Promise.all([
      // ── 2A. ALL-TIME TOTALS ────────────────────────────────────────────────
      Quiz.aggregate([
        { $match: { user: userObjId } },
        {
          $group: {
            _id: null,
            totalQuizzes: { $sum: 1 },
            totalCorrect: { $sum: "$summary.correctAnswers" },
            totalQuestions: { $sum: "$summary.totalQuestions" },
            totalPoints: { $sum: "$summary.pointsEarned" },
            avgDuration: { $avg: "$summary.duration" },
            avgAccuracy: { $avg: "$summary.accuracyRate" },
            firstQuizDate: { $min: "$date" },
            lastQuizDate: { $max: "$date" },
          },
        },
      ]),

      // ── 2B. PER-SUBJECT ACCURACY (all-time, from denormalised summary) ─────
      Quiz.aggregate([
        { $match: { user: userObjId } },
        { $unwind: "$summary.subjectBreakdown" },
        {
          $group: {
            _id: "$summary.subjectBreakdown.subject",
            totalQuestions: {
              $sum: "$summary.subjectBreakdown.totalQuestions",
            },
            totalCorrect: { $sum: "$summary.subjectBreakdown.correctAnswers" },
            quizCount: { $sum: 1 },
            // Last 30 d accuracy for trend arrow
            recentCorrect: {
              $sum: {
                $cond: [
                  { $gte: ["$date", last30d] },
                  "$summary.subjectBreakdown.correctAnswers",
                  0,
                ],
              },
            },
            recentTotal: {
              $sum: {
                $cond: [
                  { $gte: ["$date", last30d] },
                  "$summary.subjectBreakdown.totalQuestions",
                  0,
                ],
              },
            },
          },
        },
        {
          $addFields: {
            accuracyRate: {
              $cond: [
                { $gt: ["$totalQuestions", 0] },
                {
                  $multiply: [
                    { $divide: ["$totalCorrect", "$totalQuestions"] },
                    100,
                  ],
                },
                0,
              ],
            },
            recentAccuracy: {
              $cond: [
                { $gt: ["$recentTotal", 0] },
                {
                  $multiply: [
                    { $divide: ["$recentCorrect", "$recentTotal"] },
                    100,
                  ],
                },
                0,
              ],
            },
            masteryPct: {
              // Questions answered correctly / total unique questions answered (proxy for mastery)
              $cond: [
                { $gt: ["$totalQuestions", 0] },
                {
                  $multiply: [
                    { $divide: ["$totalCorrect", "$totalQuestions"] },
                    100,
                  ],
                },
                0,
              ],
            },
          },
        },
        {
          $lookup: {
            from: "subjects",
            localField: "_id",
            foreignField: "_id",
            as: "info",
          },
        },
        { $unwind: { path: "$info", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            subjectId: "$_id",
            name: { $ifNull: ["$info.name", "Unknown"] },
            totalQuestions: 1,
            totalCorrect: 1,
            quizCount: 1,
            accuracyRate: { $round: ["$accuracyRate", 2] },
            recentAccuracy: { $round: ["$recentAccuracy", 2] },
            masteryPct: { $round: ["$masteryPct", 2] },
          },
        },
        { $sort: { accuracyRate: -1 } },
      ]),

      // ── 2C. PER-TOPIC ACCURACY (from Quiz.questions inline array) ──────────
      // Each question in Quiz.questions has { topic, subject, answered }
      // answered.correct tells us if they got it right.
      Quiz.aggregate([
        { $match: { user: userObjId } },
        { $unwind: "$questions" },
        // Only count questions that actually have a topic and were answered
        {
          $match: {
            "questions.topic": { $exists: true, $ne: null },
            "questions.subject": { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: {
              topic: "$questions.topic",
              subject: "$questions.subject",
            },
            totalAttempts: { $sum: 1 },
            totalCorrect: {
              $sum: { $cond: ["$questions.answered.correct", 1, 0] },
            },
            // For recent trend
            recentAttempts: {
              $sum: { $cond: [{ $gte: ["$date", last30d] }, 1, 0] },
            },
            recentCorrect: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$date", last30d] },
                      "$questions.answered.correct",
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $addFields: {
            accuracyRate: {
              $cond: [
                { $gt: ["$totalAttempts", 0] },
                {
                  $multiply: [
                    { $divide: ["$totalCorrect", "$totalAttempts"] },
                    100,
                  ],
                },
                0,
              ],
            },
            recentAccuracy: {
              $cond: [
                { $gt: ["$recentAttempts", 0] },
                {
                  $multiply: [
                    { $divide: ["$recentCorrect", "$recentAttempts"] },
                    100,
                  ],
                },
                0,
              ],
            },
          },
        },
        {
          $lookup: {
            from: "topics",
            localField: "_id.topic",
            foreignField: "_id",
            as: "topicInfo",
          },
        },
        { $unwind: { path: "$topicInfo", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            topicId: "$_id.topic",
            subjectId: "$_id.subject",
            topicName: { $ifNull: ["$topicInfo.name", "Unknown"] },
            totalAttempts: 1,
            totalCorrect: 1,
            recentAttempts: 1,
            recentCorrect: 1,
            accuracyRate: { $round: ["$accuracyRate", 2] },
            recentAccuracy: { $round: ["$recentAccuracy", 2] },
          },
        },
        { $sort: { subjectId: 1, accuracyRate: -1 } },
      ]),

      // ── 2D. LAST 30D STATS — for readiness index ──────────────────────────
      Quiz.aggregate([
        { $match: { user: userObjId, date: { $gte: last30d } } },
        {
          $group: {
            _id: null,
            quizCount: { $sum: 1 },
            totalCorrect: { $sum: "$summary.correctAnswers" },
            totalQuestions: { $sum: "$summary.totalQuestions" },
            totalDuration: { $sum: "$summary.duration" },
            distinctSubjects: { $addToSet: "$subjects" },
          },
        },
        {
          $addFields: {
            accuracy: {
              $cond: [
                { $gt: ["$totalQuestions", 0] },
                {
                  $multiply: [
                    { $divide: ["$totalCorrect", "$totalQuestions"] },
                    100,
                  ],
                },
                0,
              ],
            },
          },
        },
      ]),

      // ── 2E. PRIOR 30D (30-60d ago) for improvement delta ──────────────────
      Quiz.aggregate([
        { $match: { user: userObjId, date: { $gte: last60d, $lt: last30d } } },
        {
          $group: {
            _id: null,
            quizCount: { $sum: 1 },
            totalCorrect: { $sum: "$summary.correctAnswers" },
            totalQuestions: { $sum: "$summary.totalQuestions" },
          },
        },
        {
          $addFields: {
            accuracy: {
              $cond: [
                { $gt: ["$totalQuestions", 0] },
                {
                  $multiply: [
                    { $divide: ["$totalCorrect", "$totalQuestions"] },
                    100,
                  ],
                },
                0,
              ],
            },
          },
        },
      ]),

      // ── 2F. WEEKLY TREND (last 12 weeks) ─────────────────────────────────
      Quiz.aggregate([
        { $match: { user: userObjId, date: { $gte: last12w } } },
        {
          $group: {
            _id: {
              year: { $isoWeekYear: "$date" },
              week: { $isoWeek: "$date" },
            },
            avgAccuracy: { $avg: "$summary.accuracyRate" },
            totalQuizzes: { $sum: 1 },
            totalCorrect: { $sum: "$summary.correctAnswers" },
            totalQuestions: { $sum: "$summary.totalQuestions" },
            totalPoints: { $sum: "$summary.pointsEarned" },
          },
        },
        {
          $addFields: {
            weekLabel: {
              $concat: [
                { $toString: "$_id.year" },
                "-W",
                { $toString: "$_id.week" },
              ],
            },
          },
        },
        {
          $project: {
            weekLabel: 1,
            avgAccuracy: { $round: ["$avgAccuracy", 2] },
            totalQuizzes: 1,
            totalCorrect: 1,
            totalQuestions: 1,
            totalPoints: 1,
          },
        },
        { $sort: { "_id.year": 1, "_id.week": 1 } },
      ]),

      // ── 2G. MONTHLY TREND (last 6 months) ────────────────────────────────
      Quiz.aggregate([
        { $match: { user: userObjId, date: { $gte: last6mo } } },
        {
          $group: {
            _id: {
              year: { $year: "$date" },
              month: { $month: "$date" },
            },
            avgAccuracy: { $avg: "$summary.accuracyRate" },
            totalQuizzes: { $sum: 1 },
            totalCorrect: { $sum: "$summary.correctAnswers" },
            totalQuestions: { $sum: "$summary.totalQuestions" },
            totalPoints: { $sum: "$summary.pointsEarned" },
          },
        },
        {
          $addFields: {
            monthLabel: {
              $concat: [
                { $toString: "$_id.year" },
                "-",
                {
                  $cond: [
                    { $lt: ["$_id.month", 10] },
                    { $concat: ["0", { $toString: "$_id.month" }] },
                    { $toString: "$_id.month" },
                  ],
                },
              ],
            },
          },
        },
        {
          $project: {
            monthLabel: 1,
            avgAccuracy: { $round: ["$avgAccuracy", 2] },
            totalQuizzes: 1,
            totalCorrect: 1,
            totalQuestions: 1,
            totalPoints: 1,
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      // ── 2H. CLASS PEERS ACCURACY (for percentile ranking) ────────────────
      // Only run if we know the student's class and school
      schoolObjId && classLevel
        ? Quiz.aggregate([
            {
              $match: {
                school: schoolObjId,
                classLevel,
                user: { $ne: userObjId },
              },
            },
            {
              $group: {
                _id: "$user",
                avgAccuracy: { $avg: "$summary.accuracyRate" },
                totalCorrect: { $sum: "$summary.correctAnswers" },
                totalQ: { $sum: "$summary.totalQuestions" },
              },
            },
            {
              $addFields: {
                overallAccuracy: {
                  $cond: [
                    { $gt: ["$totalQ", 0] },
                    {
                      $multiply: [
                        { $divide: ["$totalCorrect", "$totalQ"] },
                        100,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
            { $project: { overallAccuracy: 1 } },
          ])
        : Promise.resolve([]),

      // ── 2I. SCHOOL PEERS ACCURACY ─────────────────────────────────────────
      schoolObjId
        ? Quiz.aggregate([
            {
              $match: {
                school: schoolObjId,
                user: { $ne: userObjId },
              },
            },
            {
              $group: {
                _id: "$user",
                totalCorrect: { $sum: "$summary.correctAnswers" },
                totalQ: { $sum: "$summary.totalQuestions" },
              },
            },
            {
              $addFields: {
                overallAccuracy: {
                  $cond: [
                    { $gt: ["$totalQ", 0] },
                    {
                      $multiply: [
                        { $divide: ["$totalCorrect", "$totalQ"] },
                        100,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
            { $project: { overallAccuracy: 1 } },
          ])
        : Promise.resolve([]),

      // ── 2J. SOLO vs FRIENDS MODE SPLIT ───────────────────────────────────
      Quiz.aggregate([
        { $match: { user: userObjId } },
        {
          $group: {
            _id: "$mode",
            count: { $sum: 1 },
            avgAccuracy: { $avg: "$summary.accuracyRate" },
            totalPoints: { $sum: "$summary.pointsEarned" },
            wins: {
              $sum: {
                $cond: [{ $eq: ["$mode", "friends"] }, 0, 0], // placeholder — wins tracked in quizHistory
              },
            },
          },
        },
      ]),

      // ── 2K. ACTIVITY BY DAY OF WEEK (last 90 days) ───────────────────────
      Quiz.aggregate([
        {
          $match: {
            user: userObjId,
            date: { $gte: new Date(now - 90 * 86_400_000) },
          },
        },
        {
          $group: {
            _id: { $dayOfWeek: "$date" }, // 1=Sun … 7=Sat
            quizCount: { $sum: 1 },
            avgAccuracy: { $avg: "$summary.accuracyRate" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. POST-PROCESS
    // ─────────────────────────────────────────────────────────────────────────

    // ── 3A. ALL-TIME OVERVIEW ─────────────────────────────────────────────────
    const ov = allTimeAgg[0] || {};
    const overallAccuracy =
      ov.totalQuestions > 0
        ? r2((ov.totalCorrect / ov.totalQuestions) * 100)
        : 0;

    // ── 3B. READINESS INDEX ───────────────────────────────────────────────────
    const r30 = last30dAgg[0] || {};
    const prev = prior30dAgg[0] || {};

    // Accuracy component
    const accuracyScore = Math.min(r30.accuracy ?? 0, 100);

    // Consistency — quizzes taken in 30d vs target
    const consistencyScore = Math.min(
      ((r30.quizCount ?? 0) / TARGET_QUIZZES_MONTH) * 100,
      100,
    );

    // Volume — questions answered in 30d vs target
    const volumeScore = Math.min(
      ((r30.totalQuestions ?? 0) / TARGET_QUESTIONS_MONTH) * 100,
      100,
    );

    // Speed — avg ms per question (lower = better)
    const avgMsPerQ =
      (r30.totalQuestions ?? 0) > 0 && (r30.totalDuration ?? 0) > 0
        ? r30.totalDuration / r30.totalQuestions
        : TARGET_MS_PER_QUESTION;
    const speedScore = Math.min(
      (TARGET_MS_PER_QUESTION / Math.max(avgMsPerQ, 1)) * 100,
      100,
    );

    // Breadth — how many distinct subjects covered in 30d
    // r30.distinctSubjects is an array of arrays (subjects per quiz), flatten and deduplicate
    const distinctSubjectIds = new Set(
      (r30.distinctSubjects ?? []).flat().map((id) => id?.toString()),
    );
    const breadthScore = Math.min(
      (distinctSubjectIds.size / TARGET_SUBJECTS) * 100,
      100,
    );

    // Improvement bonus (±5 points added to final score)
    const improvementDelta =
      prev.accuracy != null ? r2((r30.accuracy ?? 0) - prev.accuracy) : null;

    const readinessRaw =
      accuracyScore * W_ACCURACY +
      consistencyScore * W_CONSISTENCY +
      volumeScore * W_VOLUME +
      speedScore * W_SPEED +
      breadthScore * W_BREADTH;

    // Apply improvement bonus: +2.5 if improving, -2.5 if declining, cap at 100
    const improvementBonus =
      improvementDelta == null
        ? 0
        : improvementDelta > 5
          ? 2.5
          : improvementDelta < -5
            ? -2.5
            : 0;

    const readinessScore = Math.min(
      Math.max(r2(readinessRaw + improvementBonus), 0),
      100,
    );

    const readinessLabel =
      readinessScore >= 75
        ? "Exam Ready"
        : readinessScore >= 55
          ? "On Track"
          : readinessScore >= 35
            ? "Needs Attention"
            : "At Risk";

    const examReadiness = {
      score: readinessScore,
      label: readinessLabel,
      examTarget: examLabel,
      components: {
        accuracy: r2(accuracyScore),
        consistency: r2(consistencyScore),
        volume: r2(volumeScore),
        speed: r2(speedScore),
        breadth: r2(breadthScore),
      },
      improvementDelta,
      last30d: {
        quizzesTaken: r30.quizCount ?? 0,
        questionsAnswered: r30.totalQuestions ?? 0,
        accuracy: r2(r30.accuracy ?? 0),
        avgSessionMs:
          r30.totalDuration && r30.quizCount
            ? Math.round(r30.totalDuration / r30.quizCount)
            : 0,
        subjectsExplored: distinctSubjectIds.size,
      },
    };

    // ── 3C. SUBJECT PERFORMANCE — tag each subject ────────────────────────────
    const subjectCount = subjectAgg.length;
    const subjectPerformance = subjectAgg.map((s, idx) => {
      // Trend arrow: compare all-time accuracy vs recent 30d accuracy
      const trend =
        s.recentTotal === 0
          ? "neutral"
          : s.recentAccuracy > s.accuracyRate + 3
            ? "improving"
            : s.recentAccuracy < s.accuracyRate - 3
              ? "declining"
              : "stable";

      // Tag based on position in ranked list
      const tag =
        idx === 0
          ? "strongest"
          : idx === subjectCount - 1
            ? "weakest"
            : s.accuracyRate >= 70
              ? "strong"
              : s.accuracyRate >= 50
                ? "average"
                : "weak";

      return {
        subjectId: s.subjectId,
        name: s.name,
        rank: idx + 1,
        tag,
        trend,
        accuracyRate: s.accuracyRate,
        recentAccuracy: s.recentAccuracy,
        masteryPct: s.masteryPct,
        totalQuestions: s.totalQuestions,
        totalCorrect: s.totalCorrect,
        quizCount: s.quizCount,
      };
    });

    // ── 3D. TOPIC PERFORMANCE — nest under subjects, tag each topic ──────────
    // Build a map subjectId → [ topics ]
    const topicBySubject = {};
    topicAgg.forEach((t) => {
      const key = t.subjectId?.toString();
      if (!key) return;
      if (!topicBySubject[key]) topicBySubject[key] = [];
      topicBySubject[key].push(t);
    });

    // Attach topics to each subject, add rank + tag within that subject's topic list
    const topicPerformance = subjectPerformance.map((subj) => {
      const rawTopics = topicBySubject[subj.subjectId?.toString()] ?? [];
      const sorted = [...rawTopics].sort(
        (a, b) => b.accuracyRate - a.accuracyRate,
      );
      const tc = sorted.length;

      const topics = sorted.map((t, tidx) => {
        const topicTrend =
          t.recentAttempts === 0
            ? "neutral"
            : t.recentAccuracy > t.accuracyRate + 5
              ? "improving"
              : t.recentAccuracy < t.accuracyRate - 5
                ? "declining"
                : "stable";

        const topicTag =
          tidx === 0
            ? "strongest"
            : tidx === tc - 1
              ? "weakest"
              : t.accuracyRate >= 70
                ? "strong"
                : t.accuracyRate >= 50
                  ? "average"
                  : "weak";

        return {
          topicId: t.topicId,
          name: t.topicName,
          rank: tidx + 1,
          tag: topicTag,
          trend: topicTrend,
          accuracyRate: t.accuracyRate,
          recentAccuracy: t.recentAccuracy,
          totalAttempts: t.totalAttempts,
          totalCorrect: t.totalCorrect,
        };
      });

      return {
        subjectId: subj.subjectId,
        subjectName: subj.name,
        subjectTag: subj.tag,
        topics,
      };
    });

    // ── 3E. WEAK & STRONG SPOT DIGESTS (flat across all topics) ─────────────
    const allTopicsFlat = topicAgg
      .filter((t) => t.totalAttempts >= 3) // minimum sample threshold
      .map((t) => {
        // Find parent subject name from subjectPerformance
        const parent = subjectPerformance.find(
          (s) => s.subjectId?.toString() === t.subjectId?.toString(),
        );
        return {
          topicId: t.topicId,
          topicName: t.topicName,
          subjectId: t.subjectId,
          subjectName: parent?.name ?? "Unknown",
          accuracyRate: t.accuracyRate,
          totalAttempts: t.totalAttempts,
          trend:
            t.recentAttempts > 0
              ? t.recentAccuracy > t.accuracyRate + 5
                ? "improving"
                : t.recentAccuracy < t.accuracyRate - 5
                  ? "declining"
                  : "stable"
              : "neutral",
        };
      });

    const weakSpotsDigest = [...allTopicsFlat]
      .sort((a, b) => a.accuracyRate - b.accuracyRate)
      .slice(0, 10);

    const strongSpotsDigest = [...allTopicsFlat]
      .sort((a, b) => b.accuracyRate - a.accuracyRate)
      .slice(0, 10);

    // ── 3F. CLASS & SCHOOL PERCENTILE ─────────────────────────────────────────
    const myOverallAccuracy = overallAccuracy;

    const calcPercentile = (peers, myScore) => {
      if (!peers.length) return null;
      const below = peers.filter((p) => p.overallAccuracy < myScore).length;
      return r2((below / peers.length) * 100);
    };

    const classPercentile = calcPercentile(classPeersAgg, myOverallAccuracy);
    const schoolPercentile = calcPercentile(schoolPeersAgg, myOverallAccuracy);

    const classRank =
      classPeersAgg.length > 0
        ? classPeersAgg.filter((p) => p.overallAccuracy > myOverallAccuracy)
            .length + 1
        : null;
    const schoolRank =
      schoolPeersAgg.length > 0
        ? schoolPeersAgg.filter((p) => p.overallAccuracy > myOverallAccuracy)
            .length + 1
        : null;

    const classComparison = {
      classLevel,
      myAccuracy: myOverallAccuracy,
      classSize: classPeersAgg.length + 1, // +1 for self
      rank: classRank,
      percentile: classPercentile, // e.g. 82 means "better than 82% of class"
      avgClassAccuracy: classPeersAgg.length
        ? r2(
            classPeersAgg.reduce((s, p) => s + p.overallAccuracy, 0) /
              classPeersAgg.length,
          )
        : null,
      aboveClassAvg: classPeersAgg.length
        ? myOverallAccuracy >
          classPeersAgg.reduce((s, p) => s + p.overallAccuracy, 0) /
            classPeersAgg.length
        : null,
    };

    const schoolComparison = {
      schoolName: schoolDoc?.name ?? null,
      schoolSize: schoolPeersAgg.length + 1,
      rank: schoolRank,
      percentile: schoolPercentile,
      avgSchoolAccuracy: schoolPeersAgg.length
        ? r2(
            schoolPeersAgg.reduce((s, p) => s + p.overallAccuracy, 0) /
              schoolPeersAgg.length,
          )
        : null,
      aboveSchoolAvg: schoolPeersAgg.length
        ? myOverallAccuracy >
          schoolPeersAgg.reduce((s, p) => s + p.overallAccuracy, 0) /
            schoolPeersAgg.length
        : null,
    };

    // ── 3G. STREAK & ACTIVE DAYS HEATMAP (last 60 days) ──────────────────────
    const activeDays = (userDoc.activeDays ?? [])
      .filter((d) => new Date(d) >= new Date(now - last60dMs))
      .map((d) => new Date(d).toISOString().split("T")[0]);

    const streakHistory = {
      currentStreak: userDoc.streak ?? 0,
      longestStreak: userDoc.quizStats?.longestStreak ?? userDoc.streak ?? 0,
      lastActive: userDoc.quizStats?.lastStreakDate ?? null,
      activeDaysLast60: activeDays, // array of "YYYY-MM-DD" strings for heatmap
      activeDayCount: activeDays.length,
    };

    // ── 3H. MULTIPLAYER STATS ─────────────────────────────────────────────────
    const mpStats = userDoc.quizStats?.multiplayerStats ?? {};
    const qHistory = userDoc.quizHistory ?? [];

    const friendsGames = qHistory.filter((q) => q.mode === "friends");
    const wins = friendsGames.filter((q) => q.isWinner).length;
    const avgRankMP = friendsGames.length
      ? r2(
          friendsGames.reduce((s, q) => s + (q.rank ?? q.participantCount), 0) /
            friendsGames.length,
        )
      : null;

    const multiplayerStats = {
      totalGames: mpStats.totalGames ?? friendsGames.length,
      wins: mpStats.wins ?? wins,
      winRate:
        mpStats.winRate ??
        (friendsGames.length ? r2((wins / friendsGames.length) * 100) : 0),
      secondPlace:
        mpStats.secondPlace ?? friendsGames.filter((q) => q.rank === 2).length,
      thirdPlace:
        mpStats.thirdPlace ?? friendsGames.filter((q) => q.rank === 3).length,
      avgRank: avgRankMP,
    };

    // ── 3I. RECENT ACTIVITY (last 10 quiz sessions) ───────────────────────────
    const recentQuizzes = await Quiz.find({ user: userObjId })
      .sort({ date: -1 })
      .limit(10)
      .select("date mode type summary classLevel subjects")
      .populate("subjects", "name")
      .lean();

    const recentActivity = recentQuizzes.map((q) => ({
      quizId: q._id,
      date: q.date,
      mode: q.mode,
      type: q.type,
      classLevel: q.classLevel,
      subjects: (q.subjects ?? []).map((s) => ({ id: s._id, name: s.name })),
      totalQuestions: q.summary?.totalQuestions ?? 0,
      correctAnswers: q.summary?.correctAnswers ?? 0,
      accuracyRate: q.summary?.accuracyRate ?? 0,
      pointsEarned: q.summary?.pointsEarned ?? 0,
      durationMs: q.summary?.duration ?? 0,
    }));

    // ── 3J. STUDY CONSISTENCY ─────────────────────────────────────────────────
    // Day-of-week labels
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const activityByDay = dayOfWeekAgg.map((d) => ({
      day: DOW[(d._id ?? 1) - 1] ?? "Unknown",
      quizCount: d.quizCount,
      avgAccuracy: r2(d.avgAccuracy),
    }));

    const bestDay = activityByDay.length
      ? activityByDay.reduce(
          (best, d) => (d.quizCount > best.quizCount ? d : best),
          activityByDay[0],
        )
      : null;

    // Avg quizzes per active day (last 30d)
    const activeDaysLast30 = new Set(
      recentQuizzes
        .filter((q) => new Date(q.date) >= last30d)
        .map((q) => new Date(q.date).toISOString().split("T")[0]),
    ).size;

    const mostPracticedSubject = subjectPerformance.length
      ? [...subjectPerformance].sort(
          (a, b) => b.totalQuestions - a.totalQuestions,
        )[0]
      : null;

    const studyConsistency = {
      activeDaysLast30,
      avgQuizzesPerActiveDay:
        activeDaysLast30 > 0 ? r2((r30.quizCount ?? 0) / activeDaysLast30) : 0,
      activityByDay,
      bestDay,
      mostPracticedSubject: mostPracticedSubject
        ? {
            name: mostPracticedSubject.name,
            questionsAnswered: mostPracticedSubject.totalQuestions,
          }
        : null,
    };

    // ── 3K. MODE BREAKDOWN ────────────────────────────────────────────────────
    const modeBreakdown = modeBreakdownAgg.reduce((acc, m) => {
      acc[m._id] = {
        count: m.count,
        avgAccuracy: r2(m.avgAccuracy),
        totalPoints: m.totalPoints,
      };
      return acc;
    }, {});

    // ── 3L. SMART RECOMMENDATIONS ────────────────────────────────────────────
    // Auto-generated action items based on analytics data
    const recommendations = [];

    // Weak topics that are declining
    const criticalTopics = weakSpotsDigest
      .filter((t) => t.trend === "declining" || t.accuracyRate < 40)
      .slice(0, 3);
    criticalTopics.forEach((t) => {
      recommendations.push({
        type: "critical_topic",
        priority: "high",
        message: `Urgently review "${t.topicName}" in ${t.subjectName} — accuracy is ${r2(t.accuracyRate)}% and declining.`,
        targetId: t.topicId,
        targetType: "topic",
      });
    });

    // Weak subjects
    const weakSubjects = subjectPerformance.filter(
      (s) => s.tag === "weakest" || s.accuracyRate < 45,
    );
    weakSubjects.slice(0, 2).forEach((s) => {
      recommendations.push({
        type: "weak_subject",
        priority: "high",
        message: `"${s.name}" needs focused practice — your accuracy is only ${s.accuracyRate}%.`,
        targetId: s.subjectId,
        targetType: "subject",
      });
    });

    // Low consistency nudge
    if (consistencyScore < 40) {
      recommendations.push({
        type: "consistency",
        priority: "medium",
        message: `You've taken ${r30.quizCount ?? 0} quizzes this month. Aim for at least ${TARGET_QUIZZES_MONTH} to stay on track for ${examLabel}.`,
        targetType: "habit",
      });
    }

    // Readiness-based nudge
    if (readinessLabel === "At Risk") {
      recommendations.push({
        type: "readiness",
        priority: "high",
        message: `Your exam readiness score is ${readinessScore}/100. Daily practice across multiple subjects will move you to "On Track" within 2 weeks.`,
        targetType: "readiness",
      });
    }

    // Improving strong topics — reinforce
    const improvingStrong = strongSpotsDigest
      .filter((t) => t.trend === "improving")
      .slice(0, 2);
    improvingStrong.forEach((t) => {
      recommendations.push({
        type: "reinforce",
        priority: "low",
        message: `Great progress in "${t.topicName}"! Keep it up to maintain your lead.`,
        targetId: t.topicId,
        targetType: "topic",
      });
    });

    // Breadth nudge
    if (breadthScore < 60 && distinctSubjectIds.size < TARGET_SUBJECTS) {
      recommendations.push({
        type: "breadth",
        priority: "medium",
        message: `You've only practiced ${distinctSubjectIds.size} subject(s) this month. ${examLabel} covers multiple subjects — broaden your sessions.`,
        targetType: "habit",
      });
    }

    // Sort: high → medium → low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ASSEMBLE RESPONSE
    // ─────────────────────────────────────────────────────────────────────────
    return res.json({
      success: true,
      generatedAt: now,
      data: {
        // ── 1. Profile snapshot ──────────────────────────────────────────────
        profile: {
          userId: userDoc._id,
          firstName: userDoc.firstName,
          lastName: userDoc.lastName,
          username: userDoc.username,
          preffix: userDoc.preffix,
          avatar: userDoc.avatar,
          classLevel,
          schoolLevel: userDoc.schoolLevel,
          examTarget: examLabel,
          school: schoolDoc
            ? { id: schoolDoc._id, name: schoolDoc.name, type: schoolDoc.type }
            : null,
          subscription: userDoc.subscription,
          rank: userDoc.rank,
          points: userDoc.points,
          totalPoints: userDoc.totalPoints,
          schoolPoints: userDoc.schoolPoints,
          streak: userDoc.streak,
        },

        // ── 2. All-time overview ─────────────────────────────────────────────
        overview: {
          overallAccuracy,
          totalQuizzes: ov.totalQuizzes ?? 0,
          totalQuestionsAnswered: ov.totalQuestions ?? 0,
          totalCorrectAnswers: ov.totalCorrect ?? 0,
          totalPointsEarned: ov.totalPoints ?? 0,
          avgAccuracy: r2(ov.avgAccuracy ?? 0),
          avgSessionDurationMs: Math.round(ov.avgDuration ?? 0),
          firstQuizDate: ov.firstQuizDate ?? null,
          lastQuizDate: ov.lastQuizDate ?? null,
          // From stored quizStats
          totalWins: userDoc.quizStats?.totalWins ?? 0,
          modeBreakdown,
        },

        // ── 3. Exam Readiness ────────────────────────────────────────────────
        examReadiness,

        // ── 4. Subject performance (sorted strongest → weakest) ──────────────
        subjectPerformance,

        // ── 5. Topic performance (nested under subjects) ─────────────────────
        topicPerformance,

        // ── 6. Weak spots (flat, ranked weakest first, min 3 attempts) ───────
        weakSpotsDigest,

        // ── 7. Strong spots (flat, ranked strongest first) ───────────────────
        strongSpotsDigest,

        // ── 8. Class comparison ──────────────────────────────────────────────
        classComparison,

        // ── 9. School comparison ─────────────────────────────────────────────
        schoolComparison,

        // ── 10. Trends ───────────────────────────────────────────────────────
        trends: {
          weekly: weeklyTrendAgg,
          monthly: monthlyTrendAgg,
        },

        // ── 11. Streak & activity heatmap ────────────────────────────────────
        streakHistory,

        // ── 12. Multiplayer stats ────────────────────────────────────────────
        multiplayerStats,

        // ── 13. Recent activity (last 10 sessions) ───────────────────────────
        recentActivity,

        // ── 14. Study consistency ────────────────────────────────────────────
        studyConsistency,

        // ── 15. Smart recommendations ────────────────────────────────────────
        recommendations,
      },
    });
  } catch (error) {
    console.error("User analytics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load analytics",
      error: error.message,
    });
  }
});

module.exports = router;
