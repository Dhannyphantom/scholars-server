const uuid = require("uuid");

const sessions = {};
const nanoid = uuid.v4;

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

    socket.on("ready_player", ({ sessionId, user }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("bad session", sessionId);

      const idx = session.users.findIndex((u) => u._id === user._id);
      if (idx >= 0) {
        session.users[idx].isReady = true;
      }

      io.to(sessionId).emit("player_ready", user);
      io.to(sessionId).emit("session_snapshot", session);
    });

    socket.on("remove_invite", ({ toUserId, session }) => {
      io.to(toUserId).emit("un_invite", session);
      io.to(session?.sessionId).emit("remove_invited", session);
    });

    socket.on("mode_category", ({ category, sessionId }) => {
      console.log({ sessionId, category });
      sessions[sessionId].category = category;
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);
      io.to(sessionId).emit("set_category", category);
    });

    socket.on("mode_subjects", ({ subjects, sessionId }) => {
      sessions[sessionId].subjects = subjects;
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);
      io.to(sessionId).emit("set_subjects", subjects);
    });

    socket.on("mode_topics", ({ subjects, quizData, sessionId }) => {
      sessions[sessionId].subjects = subjects;
      sessions[sessionId].quizData = quizData;
      io.to(sessionId).emit("session_snapshot", sessions[sessionId]);
      io.to(sessionId).emit("set_topics", { subjects, quizData });
    });

    socket.on("invite_response", ({ sessionId, user, status }) => {
      const session = sessions[sessionId];
      if (!session) return console.log("No session", sessions, sessionId);

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
