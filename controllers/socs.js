const uuid = require("uuid");
const { User } = require("../models/User");
const { Quiz } = require("../models/Quiz");
const expoNotifications = require("./expoNotifications");

const sessions = {};
const nanoid = uuid.v4;

const areAllNonHostReady = (session) => {
  // Check only accepted users
  const acceptedUsers =
    session?.users?.filter((u) => u.status === "accepted") || [];
  if (acceptedUsers.length === 0) return false;
  return acceptedUsers.every((u) => u.isReady === true);
};

const buildLeaderboard = (session) => {
  const players = [];

  // Include host in the players array consistently
  if (session.host) {
    players.push({
      ...session.host,
      isHost: true,
      points: session.host.points || 0,
      correctCount: session.host.correctCount || 0,
    });
  }

  // Include all users
  session.users.forEach((u) => {
    // Only include accepted users in leaderboard
    if (u.status === "accepted") {
      players.push({
        ...u,
        isHost: false,
        points: u.points || 0,
        correctCount: u.correctCount || 0,
      });
    }
  });

  return players.sort((a, b) => (b.points || 0) - (a.points || 0));
};

const updatePlayerPoints = (session, user, point, isCorrect) => {
  // Try to find in users array first
  const userIdx = session.users.findIndex((u) => u._id === user._id);

  if (userIdx >= 0) {
    session.users[userIdx].points =
      (session.users[userIdx].points || 0) + point;
    if (isCorrect) {
      session.users[userIdx].correctCount =
        (session.users[userIdx].correctCount || 0) + 1;
    }
    return session.users[userIdx];
  }

  // Check if it's the host
  if (session.host && user._id === session.host._id) {
    session.host.points = (session.host.points || 0) + point;
    if (isCorrect) {
      session.host.correctCount = (session.host.correctCount || 0) + 1;
    }
    return session.host;
  }

  return null;
};

const checkIfAllFinished = (session) => {
  const hostFinished = session.host?.hasFinished === true;
  const acceptedUsers = session.users.filter((u) => u.status === "accepted");
  const allUsersFinished = acceptedUsers.every((u) => u.hasFinished === true);

  return hostFinished && allUsersFinished && acceptedUsers.length > 0;
};

// Extract unique subjects and topics from quizData
const extractMetadata = (quizData) => {
  const subjects = new Set();
  const topics = new Set();

  if (Array.isArray(quizData)) {
    quizData.forEach((item) => {
      if (item.subject) subjects.add(item.subject?._id.toString());

      if (item.questions && Array.isArray(item.questions)) {
        item.questions.forEach((q) => {
          if (q.subject) subjects.add(q.subject.toString());
          if (q.topic) topics.add(q.topic.toString());
        });
      }
    });
  }

  return {
    subjects: Array.from(subjects),
    topics: Array.from(topics),
  };
};

module.exports = (io) => {
  io.on("connection", (socket) => {
    socket.on("register_user", (userId) => {
      socket.join(userId);
    });

    socket.on("create_session", ({ host }) => {
      const sessionId = nanoid();

      sessions[sessionId] = {
        sessionId,
        host: {
          ...host,
          points: 0,
          correctCount: 0,
          isReady: true, // Host is auto-ready
          hasFinished: false,
        },
        users: [],
        mode: "friends", // Set default mode
        hasStarted: false,
        hasEnded: false,
        createdAt: Date.now(),
      };

      socket.join(sessionId);

      io.to(host._id).emit("session_created", sessions[sessionId]);
    });

    socket.on("join_session", ({ sessionId, user }) => {
      socket.join(sessionId);

      if (!sessions[sessionId]) {
        console.log(`Session ${sessionId} not found for join_session`);
        sessions[sessionId] = {
          sessionId,
          users: [],
          mode: "friends",
        };
      }

      const exists = sessions[sessionId].users.find((u) => u._id === user._id);

      if (!exists) {
        sessions[sessionId].users.push({
          ...user,
          status: "pending",
          points: 0,
          correctCount: 0,
          isReady: false,
          hasFinished: false,
        });
        console.log(`User ${user.username} joined session ${sessionId}`);
      }

      // Send full session snapshot including current leaderboard
      const leaderboard = buildLeaderboard(sessions[sessionId]);
      io.to(sessionId).emit("session_snapshot", {
        ...sessions[sessionId],
        leaderboard,
      });

      socket.to(sessionId).emit("user_joined", {
        ...user,
        status: "pending",
      });
    });

    socket.on("send_invite", ({ toUserId, session }) => {
      const { sessionId, user } = session;

      io.to(toUserId).emit("receive_invite", session);

      if (!sessions[sessionId]) {
        sessions[sessionId] = {
          sessionId,
          users: [],
          mode: "friends",
        };
      }

      const exists = sessions[sessionId].users.find((u) => u._id === user._id);

      if (!exists) {
        sessions[sessionId].users.push({
          ...user,
          status: "pending",
          points: 0,
          correctCount: 0,
          isReady: false,
          hasFinished: false,
        });
      }

      const leaderboard = buildLeaderboard(sessions[sessionId]);
      io.to(sessionId).emit("session_snapshot", {
        ...sessions[sessionId],
        leaderboard,
      });

      // update DB
      updateUserInvite({
        userId: user?._id,
        sessionId,
        startedAt: new Date(),
        status: "pending",
      }).catch((err) => console.log(err));
    });

    socket.on("invite_response", ({ sessionId, user, status }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      // Handle host leaving
      if (session.host._id === user?._id && status === "rejected") {
        console.log("Host is leaving session - transferring to next user");

        const nextUser = session.users.find((u) => u.status === "accepted");
        if (nextUser) {
          session.host = {
            ...nextUser,
            status: "host",
            points: nextUser.points || 0,
            correctCount: nextUser.correctCount || 0,
            isReady: nextUser.isReady || false,
          };
          session.users = session.users.filter((u) => u._id !== nextUser._id);

          const leaderboard = buildLeaderboard(session);
          io.to(sessionId).emit("session_snapshots", {
            ...session,
            leaderboard,
          });
          return;
        } else {
          delete sessions[sessionId];
          return;
        }
      }

      // Update user status
      session.users = session.users.map((u) =>
        u._id === user._id ? { ...u, status } : u
      );

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("invite_status_update", {
        user,
        status,
        sessionId,
      });

      // Send updated session
      io.to(sessionId).emit("session_snapshot", {
        ...session,
        leaderboard,
      });

      // update DB
      updateUserInvite({
        userId: user?._id,
        sessionId,
        status,
      }).catch((err) => console.log(err));
    });

    socket.on("answer_question", ({ sessionId, answer, user, row, point }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      const isCorrect = answer?.correct === true;

      // Update player points consistently
      const updatedPlayer = updatePlayerPoints(session, user, point, isCorrect);

      if (!updatedPlayer) {
        return;
      }

      // Build message
      const message = isCorrect
        ? `${user?.username} got ${point}GT`
        : `${user?.username} lost ${Math.abs(point)}GT`;

      // Emit answer notification
      io.to(sessionId).emit("session_answers", {
        message,
        userId: user._id,
      });

      // Build and emit leaderboard after each answer
      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("leaderboard_update", {
        leaderboard,
        timestamp: Date.now(),
      });

      // Emit session snapshot for state sync
      io.to(sessionId).emit("session_snapshots", session);
    });

    socket.on("quiz_end", ({ sessionId, user }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      // Mark user as finished
      const userIdx = session.users.findIndex((u) => u._id === user._id);

      if (userIdx >= 0) {
        session.users[userIdx].hasFinished = true;
      } else if (user?._id === session.host?._id) {
        session.host.hasFinished = true;
      }

      // Check if ALL players have finished
      const allFinished = checkIfAllFinished(session);

      // Build current leaderboard
      const leaderboard = buildLeaderboard(session);

      if (allFinished && !session.hasEnded) {
        session.hasEnded = true;
        session.endedAt = Date.now();

        // Emit FINAL leaderboard
        io.to(sessionId).emit("leaderboard_update", {
          leaderboard,
          isFinal: true,
          endedAt: session.endedAt,
        });

        // Persist quiz results to database
        persistQuizResults(session, leaderboard).catch((err) => {
          console.error("Failed to persist quiz results:", err);
        });

        // Clean up session after 5 minutes
        setTimeout(() => {
          delete sessions[sessionId];
        }, 300000);
      } else {
        // Just update leaderboard - not everyone finished yet

        io.to(sessionId).emit("leaderboard_update", {
          leaderboard,
          timestamp: Date.now(),
        });
      }
    });

    socket.on("ready_player", ({ sessionId, user }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      // Update ready status
      const idx = session.users.findIndex((u) => u._id === user._id);
      if (idx >= 0) {
        session.users[idx].isReady = true;
      } else if (session.host && user._id === session.host._id) {
        session.host.isReady = true;
      }

      io.to(user._id).emit("player_ready", user);

      // Send updated session to all
      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("session_snapshots", {
        ...session,
        leaderboard,
      });

      // Start quiz if everyone is ready
      if (session.hasStarted) {
        console.log("Quiz already started");
        return;
      }

      const allReady = areAllNonHostReady(session);
      const acceptedUsers = session.users.filter(
        (u) => u.status === "accepted"
      );
      const readyUsers = acceptedUsers.filter((u) => u.isReady);

      console.log(
        `Ready check for session ${sessionId}: ${readyUsers.length}/${acceptedUsers.length} ready`
      );

      if (allReady && session.quizData) {
        session.hasStarted = true;
        session.startedAt = Date.now();

        console.log(
          `🚀 Starting quiz for session ${sessionId} with ${acceptedUsers.length} players`
        );

        io.to(sessionId).emit("quiz_start", {
          sessionId,
          qBank: session.quizData,
          startedAt: session.startedAt,
        });
      } else if (!session.quizData) {
        console.log(`⚠️ Quiz data not loaded yet for session ${sessionId}`);
      }
    });

    socket.on("remove_invite", ({ toUserId, session }) => {
      const sessionData = sessions[session.sessionId];
      if (sessionData) {
        const removedUser = sessionData.users.find((u) => u._id === toUserId);
        sessionData.users = sessionData.users.filter((u) => u._id !== toUserId);
        console.log(
          `User ${removedUser?.username || toUserId} removed from session ${
            session.sessionId
          }`
        );
      }

      io.to(toUserId).emit("un_invite", session);
      io.to(session.sessionId).emit("remove_invited", session);

      // Update leaderboard after removal
      if (sessionData) {
        const leaderboard = buildLeaderboard(sessionData);
        io.to(session.sessionId).emit("session_snapshot", {
          ...sessionData,
          leaderboard,
        });
      }
    });

    socket.on("mode_category", ({ category, sessionId }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      session.category = category;
      console.log(`Category set: ${category.name} for session ${sessionId}`);

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("session_snapshot", {
        ...session,
        leaderboard,
      });
    });

    socket.on("mode_subjects", ({ subjects, sessionId }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      session.subjects = subjects;
      console.log(
        `Subjects set for session ${sessionId}:`,
        subjects.map((s) => s.name).join(", ")
      );

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("session_snapshot", {
        ...session,
        leaderboard,
      });
    });

    socket.on("mode_topics", ({ subjects, quizData, sessionId }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      session.subjects = subjects;
      session.quizData = quizData;

      console.log(`Quiz data loaded for session ${sessionId}:`, {
        subjectsCount: subjects?.length || 0,
        totalQuestions:
          quizData?.reduce((sum, s) => sum + (s.questions?.length || 0), 0) ||
          0,
      });

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("session_snapshot", {
        ...session,
        leaderboard,
      });
    });

    //============== CAHTS SOCKETS ========================
    //============== CAHTS SOCKETS ========================
    //============== CAHTS SOCKETS ========================
    socket.on("join_ticket", (ticketId) => {
      socket.join(ticketId);
      console.log(`Joined ticket room: ${ticketId}`);
    });

    socket.on("typing_start", ({ ticketId, sender }) => {
      socket.to(ticketId).emit("typing_start", { sender });
    });

    socket.on("typing_stop", ({ ticketId, sender }) => {
      socket.to(ticketId).emit("typing_stop", { sender });
    });

    socket.on("leave_ticket", (ticketId) => {
      socket.leave(ticketId);
    });

    socket.on("disconnect", () => {
      // console.log("User disconnected:", socket.id);
    });
  });
};

/**
 * Persist quiz results to database using existing Quiz model
 * This is called when ALL players finish the quiz
 */
async function persistQuizResults(session, leaderboard) {
  try {
    console.log("💾 Persisting quiz results to database...");

    // Extract metadata from quiz data
    const { subjects, topics } = extractMetadata(session.quizData);

    // Flatten all questions from the quiz data
    const allQuestions = [];
    if (Array.isArray(session.quizData)) {
      session.quizData.forEach((subject) => {
        if (subject.questions && Array.isArray(subject.questions)) {
          allQuestions.push(
            ...subject.questions.map((q) => ({
              question: q.question,
              answers: q.answers || [],
              answered: q.answered || null,
              topic: q.topic || null,
              subject: q.subject || subject.subject || null,
              categories: q.categories || [],
              point: q.point || 40,
              timer: q.timer || 40,
            }))
          );
        }
      });
    }

    const totalQuestions = allQuestions.length;
    const quizDuration = session.endedAt - session.startedAt;
    const winner = leaderboard[0];

    // Create Quiz document for each participant
    const quizDocs = [];
    for (const player of leaderboard) {
      try {
        const quizDoc = await Quiz.create({
          mode: session.mode || "friends",
          type: "premium", // or determine based on your logic
          user: player._id,
          subjects: subjects,
          topics: topics,
          questions: allQuestions,
          date: new Date(),
          participants: leaderboard.map((p) => ({
            user: p._id,
            point: p.points || 0,
          })),
        });

        quizDocs.push({ playerId: player._id, quizId: quizDoc._id });
        console.log(`Quiz saved for ${player.username}: ${quizDoc._id}`);
      } catch (quizErr) {
        console.error(
          `Failed to save quiz for ${player.username}:`,
          quizErr.message
        );
      }
    }

    // Update User points, stats, history, and invites
    for (const [index, player] of leaderboard.entries()) {
      const pointsEarned = player.points || 0;
      const correctAnswers = player.correctCount || 0;
      const rank = index + 1;
      const isWinner = player._id.toString() === winner._id.toString();

      try {
        const user = await User.findById(player._id);
        if (!user) continue;

        // Find the quiz doc for this player
        const playerQuiz = quizDocs.find(
          (q) => q.playerId.toString() === player._id.toString()
        );

        // Calculate new stats
        const totalQuizzes = (user.quizStats?.totalQuizzes || 0) + 1;
        const totalSoloQuizzes = user.quizStats?.totalSoloQuizzes || 0;
        const totalMultiplayerQuizzes =
          (user.quizStats?.totalMultiplayerQuizzes || 0) + 1;
        const totalCorrect =
          (user.quizStats?.totalCorrectAnswers || 0) + correctAnswers;
        const totalAnswered =
          (user.quizStats?.totalQuestionsAnswered || 0) + totalQuestions;
        const newAverageScore =
          ((user.quizStats?.averageScore || 0) * (totalQuizzes - 1) +
            pointsEarned) /
          totalQuizzes;
        const newAccuracyRate =
          totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : 0;

        // Multiplayer stats
        const multiplayerWins =
          (user.quizStats?.multiplayerStats?.wins || 0) + (isWinner ? 1 : 0);
        const multiplayerGames = totalMultiplayerQuizzes;
        const winRate =
          multiplayerGames > 0 ? (multiplayerWins / multiplayerGames) * 100 : 0;

        // Build quiz history entry
        const historyEntry = {
          quizId: playerQuiz?.quizId,
          sessionId: session.sessionId,
          mode: session.mode || "friends",
          type: "premium",
          pointsEarned,
          correctAnswers,
          totalQuestions,
          rank,
          isWinner,
          participantCount: leaderboard.length,
          category: session.category
            ? {
                _id: session.category._id,
                name: session.category.name,
              }
            : undefined,
          subjects: session.subjects?.map((s) => ({
            _id: s._id,
            name: s.name,
          })),
          date: new Date(),
          duration: quizDuration,
        };

        // Update operations
        const updateOps = {
          $inc: {
            points: pointsEarned,
            totalPoints: pointsEarned,
            "quizStats.totalQuizzes": 1,
            "quizStats.totalMultiplayerQuizzes": 1,
            "quizStats.totalCorrectAnswers": correctAnswers,
            "quizStats.totalQuestionsAnswered": totalQuestions,
            "quizStats.multiplayerStats.totalGames": 1,
          },
          $set: {
            "quizStats.averageScore": newAverageScore,
            "quizStats.accuracyRate": newAccuracyRate,
            "quizStats.lastQuizDate": new Date(),
            "quizStats.multiplayerStats.winRate": winRate,
          },
          $push: {
            quizHistory: {
              $each: [historyEntry],
              $position: 0, // Add to beginning
              $slice: 50, // Keep only last 50 quizzes
            },
          },
        };

        // Conditionally increment win counters
        if (isWinner) {
          updateOps.$inc["quizStats.multiplayerStats.wins"] = 1;
          updateOps.$inc["quizStats.totalWins"] = 1;
        } else if (rank === 2) {
          updateOps.$inc["quizStats.multiplayerStats.secondPlace"] = 1;
        } else if (rank === 3) {
          updateOps.$inc["quizStats.multiplayerStats.thirdPlace"] = 1;
        }

        // Update best score if this is better
        if (pointsEarned > (user.quizStats?.bestScore?.points || 0)) {
          updateOps.$set["quizStats.bestScore"] = {
            points: pointsEarned,
            quizId: playerQuiz?.quizId,
            sessionId: session.sessionId,
            date: new Date(),
          };
        }

        // Update fastest completion if applicable
        if (
          !user.quizStats?.fastestCompletion?.duration ||
          quizDuration < user.quizStats.fastestCompletion.duration
        ) {
          updateOps.$set["quizStats.fastestCompletion"] = {
            duration: quizDuration,
            quizId: playerQuiz?.quizId,
            date: new Date(),
          };
        }

        // Update category stats
        if (session.category) {
          const categoryIndex = user.quizStats?.categoryStats?.findIndex(
            (cs) =>
              cs.category._id.toString() === session.category._id.toString()
          );

          if (categoryIndex >= 0) {
            // Update existing category stats
            const catStats = user.quizStats.categoryStats[categoryIndex];
            const newCatAvg =
              (catStats.averageScore * catStats.quizzesCompleted +
                pointsEarned) /
              (catStats.quizzesCompleted + 1);

            updateOps.$inc[
              `quizStats.categoryStats.${categoryIndex}.quizzesCompleted`
            ] = 1;
            updateOps.$set[
              `quizStats.categoryStats.${categoryIndex}.averageScore`
            ] = newCatAvg;

            if (pointsEarned > catStats.bestScore) {
              updateOps.$set[
                `quizStats.categoryStats.${categoryIndex}.bestScore`
              ] = pointsEarned;
            }
          } else {
            // Add new category stats
            updateOps.$push = updateOps.$push || {};
            updateOps.$push["quizStats.categoryStats"] = {
              category: {
                _id: session.category._id,
                name: session.category.name,
              },
              quizzesCompleted: 1,
              averageScore: pointsEarned,
              bestScore: pointsEarned,
            };
          }
        }

        // Update invite status to completed
        await User.updateOne(
          {
            _id: player._id,
            "invites.sessionId": session.sessionId,
          },
          {
            $set: {
              "invites.$.status": "completed",
              "invites.$.quizCompleted": true,
              "invites.$.quizId": playerQuiz?.quizId,
              "invites.$.completedAt": new Date(),
            },
          }
        );

        // Apply all updates
        await User.findByIdAndUpdate(player._id, updateOps, { new: true });
      } catch (userErr) {
        console.error(
          `Failed to update user ${player.username}:`,
          userErr.message
        );
      }
    }
  } catch (error) {
    throw error;
  }
}

async function updateUserInvite({
  userId,
  sessionId,
  startedAt,
  quizCompleted,
  status,
}) {
  const updateObj = { status };
  const session = sessions[sessionId];

  if (startedAt) updateObj.startedAt = startedAt;
  if (quizCompleted !== undefined) updateObj.quizCompleted = quizCompleted;

  // 1️⃣ Try to update existing invite
  const result = await User.updateOne(
    {
      _id: userId,
      "invites.sessionId": sessionId,
    },
    {
      $set: {
        "invites.$": {
          sessionId,
          ...updateObj,
        },
      },
    }
  );

  // 2️⃣ If no invite matched, push a new one
  if (result.matchedCount === 0) {
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          invites: {
            sessionId,
            ...updateObj,
          },
        },
      }
    );
  }

  if (status === "pending") {
    const userInfo = await User.findById(userId).select("expoPushToken");
    if (userInfo) {
      await expoNotifications([userInfo.expoPushToken], {
        title: "New Quiz Invite",
        message: `${session.host.username} is inviting you for a quiz session`,
        data: updateObj,
      });
    }
  }
}
