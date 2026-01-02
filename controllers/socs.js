module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    const sessions = {};

    socket.on("register_user", (userId) => {
      socket.join(userId);
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
      socket.emit("session_snapshot", sessions[sessionId].users);

      // notify others
      socket.to(sessionId).emit("user_joined", {
        ...user,
        status: "pending",
      });
    });

    socket.on("send_invite", ({ toUserId, session }) => {
      io.to(toUserId).emit("receive_invite", session);
      io.to(session?.sessionId).emit("new_invite", session);
    });

    socket.on("remove_invite", ({ toUserId, session }) => {
      io.to(toUserId).emit("un_invite", session);
      io.to(session?.sessionId).emit("remove_invited", session);
    });

    socket.on("mode_category", ({ category, sessionId }) => {
      io.to(sessionId).emit("set_category", category);
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
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });
};
