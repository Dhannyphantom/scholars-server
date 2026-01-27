const express = require("express");
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

// const cache = require("node-cac")

/**
 * GET /api/analytics
 * Comprehensive analytics endpoint that aggregates statistics from all models
 */
router.get("/", async (req, res) => {
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

module.exports = router;
