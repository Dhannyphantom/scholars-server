const uuid = require("uuid");

const sessions = {};
const nanoid = uuid.v4;

const areAllNonHostReady = (session) => {
  return session?.users?.every((u) => u.isReady === true);
};

const buildLeaderboard = (session) => {
  const players = [];

  if (session.host) {
    players.push({
      ...session.host,
      isHost: true,
    });
  }

  session.users.forEach((u) => {
    players.push({
      ...u,
      isHost: false,
    });
  });

  return players.sort((a, b) => (b.points || 0) - (a.points || 0));
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
        host: host,
        users: [],
        mode: {},
        createdAt: Date.now(),
      };

      socket.join(sessionId);

      io.to(host._id).emit("session_created", sessions[sessionId]);
    });

    socket.on("join_session", ({ sessionId, user }) => {
      socket.join(sessionId);

      if (!sessions[sessionId]) {
        sessions[sessionId] = {
          users: [],
        };
      }

      const exists = sessions[sessionId].users.find((u) => u._id === user._id);

      if (!exists) {
        sessions[sessionId].users.push({
          ...user,
          status: "pending",
        });
      }

      // send full lobby to the joiner
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);

      // notify others
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
          users: [],
        };
      }

      const exists = sessions[sessionId].users.find((u) => u._id === user._id);

      if (!exists) {
        sessions[sessionId].users.push({
          ...user,
          status: "pending",
        });
      }

      // send full lobby to the joiner
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);

      // io.to(session?.sessionId).emit("new_invite", session);
    });

    socket.on(
      "answer_question",
      ({ sessionId, answer, user, nextQuestion, row, point }) => {
        const session = sessions[sessionId];
        if (!session) return console.log("No session", sessionId);

        let message;

        const idx = session.users.findIndex((u) => u._id === user._id);
        if (idx >= 0) {
          session.users[idx].points = (session.users[idx].points || 0) + point;
          session.users[idx].nextQuestion = Boolean(nextQuestion);
          if (answer?.correct) {
            session.users[idx].correctCount =
              (session.users[idx].correctCount || 0) + 1;
            message = `${user?.username} got ${point}GT`;
          } else {
            message = `${user?.username} lost ${point}GT`;
          }
        } else if (user?._id === session.host?._id) {
          session.host.points = (session.host.points || 0) + point;
          session.host.nextQuestion = Boolean(nextQuestion);
          if (answer?.correct) {
            session.host.correctCount = (session.host.correctCount || 0) + 1;
            message = `Host@${user?.username} got ${point}GT`;
          } else {
            message = `Host@${user?.username} lost ${point}GT`;
          }
        }

        io.to(sessionId).emit("session_answers", {
          message,
          userId: user?._id,
        });
        const leaderboard = buildLeaderboard(session);
        io.to(sessionId).emit("leaderboard_update", {
          leaderboard,
        });
      }
    );

    socket.on("quiz_end", ({ sessionId, answer, point, user }) => {
      const session = sessions[sessionId];
      if (!session) return;

      const idx = session.users.findIndex((u) => u._id === user._id);
      if (idx >= 0) {
        session.users[idx].points = (session.users[idx].points || 0) + point;
        session.users[idx].nextQuestion = false;
        if (answer?.correct) {
          session.users[idx].correctCount =
            (session.users[idx].correctCount || 0) + 1;
        }
      } else if (user?._id === session.host?._id) {
        session.host.points = (session.host.points || 0) + point;
        session.host.nextQuestion = false;
        if (answer?.correct) {
          session.host.correctCount = (session.host.correctCount || 0) + 1;
        }
      }

      const leaderboard = buildLeaderboard(session);

      console.log("Quiz Ended!!!!");

      io.to(sessionId).emit("leaderboard_update", {
        leaderboard,
        endedAt: Date.now(),
      });
    });

    socket.on("ready_player", ({ sessionId, user }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("No session", sessionId);

      const idx = session.users.findIndex((u) => u._id === user._id);
      if (idx >= 0) {
        session.users[idx].isReady = true;
      }

      io.to(user?._id).emit("player_ready", user);
      io.to(sessionId).emit("session_snapshots", session);

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
      io.to(toUserId).emit("un_invite", session);
      io.to(session?.sessionId).emit("remove_invited", session);
    });

    socket.on("mode_category", ({ category, sessionId }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("No session", sessionId);

      sessions[sessionId].category = category;
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);
    });

    socket.on("mode_subjects", ({ subjects, sessionId }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("No session", sessionId);

      sessions[sessionId].subjects = subjects;
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);
    });

    socket.on("mode_topics", ({ subjects, quizData, sessionId }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("No session", sessionId);

      sessions[sessionId].subjects = subjects;
      sessions[sessionId].quizData = quizData;
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);
    });

    socket.on("invite_response", ({ sessionId, user, status }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("No session", sessionId);

      session.users = session.users.map((u) =>
        u._id === user._id ? { ...u, status } : u
      );

      io.to(sessionId).emit("invite_status_update", {
        user,
        status,
        sessionId,
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });
};
