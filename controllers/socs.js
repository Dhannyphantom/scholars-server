const uuid = require("uuid");

const sessions = {};
const nanoid = uuid.v4;

const areAllNonHostReady = (session) => {
  return session?.users?.every((u) => u.isReady === true);
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

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

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
          isReady: true,
          hasFinished: false,
        },
        users: [],
        mode: {},
        hasStarted: false,
        createdAt: Date.now(),
      };

      socket.join(sessionId);

      io.to(host._id).emit("session_created", sessions[sessionId]);
    });

    socket.on("join_session", ({ sessionId, user }) => {
      socket.join(sessionId);

      if (!sessions[sessionId]) {
        sessions[sessionId] = {
          sessionId,
          users: [],
          mode: {},
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
          mode: {},
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

      // Build message
      const message = isCorrect
        ? `${user?.username} got ${point}GT`
        : `${user?.username} lost ${Math.abs(point)}GT`;

      // Emit answer notification
      io.to(sessionId).emit("session_answers", {
        message,
        userId: user._id,
      });

      // Build and emit consistent leaderboard to all clients
      // const leaderboard = buildLeaderboard(session);
      // io.to(sessionId).emit("leaderboard_update", {
      //   leaderboard,
      //   timestamp: Date.now(), // Add timestamp for debugging
      // });

      // Emit session snapshot for state sync
      io.to(sessionId).emit("session_snapshots", session);
    });

    socket.on("quiz_end", ({ sessionId, user }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      const userIdx = session.users.findIndex((u) => u._id === user._id);

      if (userIdx >= 0) {
        session.users[userIdx].hasFinished = true;
      } else if (user?._id === session.host?._id) {
        session.host.hasFinished = true;
      }

      // Build final leaderboard
      const leaderboard = buildLeaderboard(session);

      // Emit final leaderboard to all players
      io.to(sessionId).emit("leaderboard_update", {
        leaderboard,
      });
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
      if (session.hasStarted) return;

      if (areAllNonHostReady(session)) {
        session.hasStarted = true;
        io.to(sessionId).emit("quiz_start", {
          sessionId,
          qBank: session.quizData,
        });
      }
    });

    socket.on("remove_invite", ({ toUserId, session }) => {
      const sessionData = sessions[session.sessionId];
      if (sessionData) {
        sessionData.users = sessionData.users.filter((u) => u._id !== toUserId);
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
