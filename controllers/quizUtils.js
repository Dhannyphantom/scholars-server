// utils/quizUtils.js

const { User } = require("../models/User");

/**
 * Get user's quiz statistics
 */
async function getUserQuizStats(userId) {
  try {
    const user = await User.findById(userId)
      .select("quizStats username avatar")
      .lean();

    if (!user) {
      throw new Error("User not found");
    }

    return {
      username: user.username,
      avatar: user.avatar,
      stats: user.quizStats || {},
    };
  } catch (error) {
    console.error("Error fetching user quiz stats:", error);
    throw error;
  }
}

/**
 * Get user's quiz history with pagination
 */
async function getUserQuizHistory(
  userId,
  { page = 1, limit = 10, mode = null } = {}
) {
  try {
    const user = await User.findById(userId).select("quizHistory").lean();

    if (!user) {
      throw new Error("User not found");
    }

    let history = user.quizHistory || [];

    // Filter by mode if specified
    if (mode) {
      history = history.filter((h) => h.mode === mode);
    }

    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedHistory = history.slice(startIndex, endIndex);

    return {
      history: paginatedHistory,
      total: history.length,
      page,
      totalPages: Math.ceil(history.length / limit),
      hasMore: endIndex < history.length,
    };
  } catch (error) {
    console.error("Error fetching user quiz history:", error);
    throw error;
  }
}

/**
 * Get user's active invites (pending/active)
 */
async function getUserActiveInvites(userId) {
  try {
    const user = await User.findById(userId).select("invites").lean();

    if (!user) {
      throw new Error("User not found");
    }

    const activeInvites = (user.invites || []).filter(
      (invite) =>
        invite.status === "pending" ||
        (invite.status === "active" &&
          invite.quizCompleted === false &&
          new Date(invite.expiresAt) > new Date())
    );

    return activeInvites;
  } catch (error) {
    console.error("Error fetching active invites:", error);
    throw error;
  }
}

/**
 * Get user's completed invites (quiz history)
 */
async function getUserCompletedInvites(userId, { page = 1, limit = 10 } = {}) {
  try {
    const user = await User.findById(userId)
      .select("invites")
      .populate({
        path: "invites.quizId",
        select: "date mode type",
      })
      .lean();

    if (!user) {
      throw new Error("User not found");
    }

    const completedInvites = (user.invites || []).filter(
      (invite) => invite.status === "completed" && invite.quizCompleted === true
    );

    // Sort by completion date (most recent first)
    completedInvites.sort(
      (a, b) => new Date(b.completedAt) - new Date(a.completedAt)
    );

    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedInvites = completedInvites.slice(startIndex, endIndex);

    return {
      invites: paginatedInvites,
      total: completedInvites.length,
      page,
      totalPages: Math.ceil(completedInvites.length / limit),
      hasMore: endIndex < completedInvites.length,
    };
  } catch (error) {
    console.error("Error fetching completed invites:", error);
    throw error;
  }
}

/**
 * Get leaderboard across all users
 */
async function getGlobalLeaderboard({ limit = 10, timeRange = "all" } = {}) {
  try {
    let dateFilter = {};

    // Filter by time range
    if (timeRange === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      dateFilter = { "quizStats.lastQuizDate": { $gte: weekAgo } };
    } else if (timeRange === "month") {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = { "quizStats.lastQuizDate": { $gte: monthAgo } };
    }

    const leaderboard = await User.find(dateFilter)
      .select(
        "username avatar totalPoints quizStats.totalWins quizStats.totalQuizzes quizStats.averageScore"
      )
      .sort({ totalPoints: -1 })
      .limit(limit)
      .lean();

    return leaderboard.map((user, index) => ({
      rank: index + 1,
      userId: user._id,
      username: user.username,
      avatar: user.avatar,
      totalPoints: user.totalPoints || 0,
      totalWins: user.quizStats?.totalWins || 0,
      totalQuizzes: user.quizStats?.totalQuizzes || 0,
      averageScore: user.quizStats?.averageScore || 0,
    }));
  } catch (error) {
    console.error("Error fetching global leaderboard:", error);
    throw error;
  }
}

/**
 * Get multiplayer leaderboard
 */
async function getMultiplayerLeaderboard({ limit = 10, sortBy = "wins" } = {}) {
  try {
    let sortField = {};

    switch (sortBy) {
      case "wins":
        sortField = { "quizStats.multiplayerStats.wins": -1 };
        break;
      case "winRate":
        sortField = { "quizStats.multiplayerStats.winRate": -1 };
        break;
      case "games":
        sortField = { "quizStats.multiplayerStats.totalGames": -1 };
        break;
      default:
        sortField = { "quizStats.multiplayerStats.wins": -1 };
    }

    const leaderboard = await User.find({
      "quizStats.multiplayerStats.totalGames": { $gt: 0 },
    })
      .select("username avatar quizStats.multiplayerStats totalPoints")
      .sort(sortField)
      .limit(limit)
      .lean();

    return leaderboard.map((user, index) => ({
      rank: index + 1,
      userId: user._id,
      username: user.username,
      avatar: user.avatar,
      totalPoints: user.totalPoints || 0,
      multiplayerStats: user.quizStats?.multiplayerStats || {},
    }));
  } catch (error) {
    console.error("Error fetching multiplayer leaderboard:", error);
    throw error;
  }
}

/**
 * Get category performance for a user
 */
async function getUserCategoryPerformance(userId, categoryId = null) {
  try {
    const user = await User.findById(userId)
      .select("quizStats.categoryStats")
      .lean();

    if (!user) {
      throw new Error("User not found");
    }

    const categoryStats = user.quizStats?.categoryStats || [];

    if (categoryId) {
      // Return specific category
      return categoryStats.find(
        (cs) => cs.category._id.toString() === categoryId.toString()
      );
    }

    // Return all categories sorted by best score
    return categoryStats.sort((a, b) => b.bestScore - a.bestScore);
  } catch (error) {
    console.error("Error fetching category performance:", error);
    throw error;
  }
}

/**
 * Clean up expired invites (can be run as a cron job)
 */
async function cleanupExpiredInvites() {
  try {
    const now = new Date();

    const result = await User.updateMany(
      { "invites.expiresAt": { $lt: now } },
      {
        $pull: {
          invites: {
            expiresAt: { $lt: now },
            quizCompleted: false,
          },
        },
      }
    );

    console.log(
      `Cleaned up expired invites: ${result.modifiedCount} users updated`
    );
    return result;
  } catch (error) {
    console.error("Error cleaning up expired invites:", error);
    throw error;
  }
}

/**
 * Get user's recent opponents
 */
async function getUserRecentOpponents(userId, limit = 10) {
  try {
    const user = await User.findById(userId).select("quizHistory").lean();

    if (!user) {
      throw new Error("User not found");
    }

    // Get recent multiplayer games
    const multiplayerGames = (user.quizHistory || [])
      .filter((h) => h.mode === "friends")
      .slice(0, limit);

    // Extract unique opponent IDs
    const opponentIds = new Set();
    multiplayerGames.forEach((game) => {
      game.participants?.forEach((p) => {
        if (p.user.toString() !== userId.toString()) {
          opponentIds.add(p.user.toString());
        }
      });
    });

    // Get opponent details
    const opponents = await User.find({ _id: { $in: Array.from(opponentIds) } })
      .select("username avatar quizStats.multiplayerStats")
      .lean();

    return opponents;
  } catch (error) {
    console.error("Error fetching recent opponents:", error);
    throw error;
  }
}

module.exports = {
  getUserQuizStats,
  getUserQuizHistory,
  getUserActiveInvites,
  getUserCompletedInvites,
  getGlobalLeaderboard,
  getMultiplayerLeaderboard,
  getUserCategoryPerformance,
  cleanupExpiredInvites,
  getUserRecentOpponents,
};
