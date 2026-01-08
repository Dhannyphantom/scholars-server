const uuid = require("uuid");
const { Quiz } = require("../models/Quiz");
const { User } = require("../models/User");

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
      if (item.subject) subjects.add(item.subject.toString());

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
    console.log("User connected:", socket.id);

    socket.on("register_user", (userId) => {
      socket.join(userId);
      console.log(`User ${userId} registered to room`);
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

      console.log(`Session created: ${sessionId} by host: ${host.username}`);
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
        console.log(`Session ${sessionId} not found for send_invite`);
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
        console.log(`Invite sent to ${user.username} for session ${sessionId}`);
      }

      const leaderboard = buildLeaderboard(sessions[sessionId]);
      io.to(sessionId).emit("session_snapshot", {
        ...sessions[sessionId],
        leaderboard,
      });
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
        console.log("Player not found in session:", user._id);
        return;
      }

      console.log(
        `${user.username} answered: ${isCorrect ? "Correct" : "Wrong"} (${
          point >= 0 ? "+" : ""
        }${point}GT)`
      );

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
        console.log(
          `User ${user.username} finished quiz (${session.users[userIdx].points} points)`
        );
      } else if (user?._id === session.host?._id) {
        session.host.hasFinished = true;
        console.log(
          `Host ${user.username} finished quiz (${session.host.points} points)`
        );
      }

      // Check if ALL players have finished
      const allFinished = checkIfAllFinished(session);

      // Build current leaderboard
      const leaderboard = buildLeaderboard(session);

      if (allFinished && !session.hasEnded) {
        session.hasEnded = true;
        session.endedAt = Date.now();

        console.log(`🏁 Quiz completely ended for session ${sessionId}`);
        console.log(
          "Final Leaderboard:",
          leaderboard.map((p) => `${p.username}: ${p.points}pts`).join(", ")
        );

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
          console.log(`Session ${sessionId} cleaned up`);
        }, 300000);
      } else {
        // Just update leaderboard - not everyone finished yet
        console.log(
          `Waiting for other players... (${
            leaderboard.filter((p) => p.hasFinished).length
          }/${leaderboard.length} finished)`
        );

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
        console.log(`User ${user.username} is ready`);
      } else if (session.host && user._id === session.host._id) {
        session.host.isReady = true;
        console.log(`Host ${user.username} is ready`);
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

    socket.on("invite_response", ({ sessionId, user, status }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      console.log(`${user.username} responded to invite: ${status}`);

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

          console.log(`New host: ${nextUser.username}`);

          const leaderboard = buildLeaderboard(session);
          io.to(sessionId).emit("session_snapshots", {
            ...session,
            leaderboard,
          });
          return;
        } else {
          console.log("No users to transfer host to - session ending");
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
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
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

    // Create Quiz document for each participant
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

        console.log(`Quiz saved for ${player.username}: ${quizDoc._id}`);
      } catch (quizErr) {
        console.error(
          `Failed to save quiz for ${player.username}:`,
          quizErr.message
        );
      }
    }

    // Update User points and stats
    for (const player of leaderboard) {
      const pointsEarned = player.points || 0;

      try {
        await User.findByIdAndUpdate(
          player._id,
          {
            $inc: {
              points: pointsEarned, // Add to current points
              totalPoints: pointsEarned, // Add to lifetime total
            },
          },
          { new: true }
        );

        console.log(
          `✅ Updated ${player.username}: +${pointsEarned} points (Total: ${
            player.totalPoints || 0
          })`
        );
      } catch (userErr) {
        console.error(
          `Failed to update user ${player.username}:`,
          userErr.message
        );
      }
    }

    console.log("✅ All quiz results persisted successfully");
  } catch (error) {
    console.error("❌ Error persisting quiz results:", error);
    throw error;
  }
}
