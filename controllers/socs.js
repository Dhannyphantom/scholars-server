const uuid = require("uuid");
const { User } = require("../models/User");
const { Quiz } = require("../models/Quiz");
const expoNotifications = require("./expoNotifications");
const { AppInfo } = require("../models/AppInfo");

const sessions = {};
const nanoid = uuid.v4;

const areAllNonHostReady = (session) => {
  const acceptedUsers =
    session?.users?.filter((u) => u.status === "accepted") || [];
  if (acceptedUsers.length === 0) return false;
  return acceptedUsers.every((u) => u.isReady === true);
};

const buildLeaderboard = (session) => {
  const players = [];

  if (session.host) {
    players.push({
      ...session.host,
      isHost: true,
      points: session.host.points || 0,
      correctCount: session.host.correctCount || 0,
      answeredQuestions: session.host.answeredQuestions || [],
    });
  }

  session.users.forEach((u) => {
    if (u.status === "accepted") {
      players.push({
        ...u,
        isHost: false,
        points: u.points || 0,
        correctCount: u.correctCount || 0,
        answeredQuestions: u.answeredQuestions || [],
      });
    }
  });

  return players.sort((a, b) => (b.points || 0) - (a.points || 0));
};

const updatePlayerPoints = (session, user, question, isCorrect) => {
  const point = isCorrect ? question?.point : -2;
  const userIdx = session.users.findIndex((u) => u._id === user._id);

  // Create answered question object
  const answeredQuestion = {
    questionId: question._id,
    answered: question.answered,
    isCorrect: isCorrect,
    point: point,
    timestamp: Date.now(),
  };

  if (userIdx >= 0) {
    session.users[userIdx].points =
      (session.users[userIdx].points || 0) + point;

    if (isCorrect) {
      session.users[userIdx].correctCount =
        (session.users[userIdx].correctCount || 0) + 1;
    }

    // Track answered questions
    if (!session.users[userIdx].answeredQuestions) {
      session.users[userIdx].answeredQuestions = [];
    }
    session.users[userIdx].answeredQuestions.push(answeredQuestion);

    return session.users[userIdx];
  }

  // Check if it's the host
  if (session.host && user._id === session.host._id) {
    session.host.points = (session.host.points || 0) + point;

    if (isCorrect) {
      session.host.correctCount = (session.host.correctCount || 0) + 1;
    }

    // Track answered questions
    if (!session.host.answeredQuestions) {
      session.host.answeredQuestions = [];
    }
    session.host.answeredQuestions.push(answeredQuestion);

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
          answeredQuestions: [],
          isReady: true,
          hasFinished: false,
        },
        users: [],
        mode: "friends",
        hasStarted: false,
        hasEnded: false,
        createdAt: Date.now(),
      };

      socket.join(sessionId);

      io.to(host._id).emit("session_created", sessions[sessionId]);
    });

    socket.on("join_session", ({ sessionId, user }) => {
      if (!sessions[sessionId]) {
        console.log(`Session ${sessionId} not found for join_session`);
        io.to(user?._id).emit("active_session", { active: false });
        updateUserInvite({
          userId: user?._id,
          sessionId,
          status: "missed",
        }).catch((err) => console.log(err));
        // sessions[sessionId] = {
        //   sessionId,
        //   users: [],
        //   mode: "friends",
        // };
        return;
      }

      socket.join(sessionId);

      const exists = sessions[sessionId].users.find((u) => u._id === user._id);

      if (!exists) {
        sessions[sessionId].users.push({
          ...user,
          status: "pending",
          points: 0,
          correctCount: 0,
          answeredQuestions: [],
          isReady: false,
          hasFinished: false,
        });
        console.log(`User ${user.username} joined session ${sessionId}`);
      }

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
          answeredQuestions: [],
          isReady: false,
          hasFinished: false,
        });
      }

      const leaderboard = buildLeaderboard(sessions[sessionId]);
      io.to(sessionId).emit("session_snapshot", {
        ...sessions[sessionId],
        leaderboard,
      });

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
        io.to(user?._id).emit("active_session", { active: false });
        updateUserInvite({
          userId: user?._id,
          sessionId,
          status: "missed",
        }).catch((err) => console.log(err));
        return;
      }

      if (status === "accepted") {
        io.to(user?._id).emit("active_session", {
          active: true,
          sessionId,
          host: session?.host,
        });
      }

      if (session?.host?._id === user?._id && status === "rejected") {
        console.log("Host is leaving session - transferring to next user");

        const nextUser = session.users.find((u) => u.status === "accepted");
        if (nextUser) {
          session.host = {
            ...nextUser,
            status: "host",
            points: nextUser.points || 0,
            correctCount: nextUser.correctCount || 0,
            answeredQuestions: nextUser.answeredQuestions || [],
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

      session.users = session.users.map((u) =>
        u._id === user._id ? { ...u, status } : u,
      );

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("invite_status_update", {
        user,
        status,
        sessionId,
      });

      io.to(sessionId).emit("session_snapshot", {
        ...session,
        leaderboard,
      });

      updateUserInvite({
        userId: user?._id,
        sessionId,
        status,
      }).catch((err) => console.log(err));
    });

    socket.on("answer_question", ({ sessionId, question, user, row }) => {
      const session = sessions[sessionId];
      if (!session) {
        console.log("No session found:", sessionId);
        return;
      }

      const isCorrect = question?.answered?.correct === true;
      const point = isCorrect ? question?.point : -2;

      const updatedPlayer = updatePlayerPoints(
        session,
        user,
        question,
        isCorrect,
      );

      if (!updatedPlayer) {
        return;
      }

      const message = isCorrect
        ? `${user?.username} got ${point}GT`
        : `${user?.username} lost ${Math.abs(point)}GT`;

      io.to(sessionId).emit("session_answers", {
        message,
        userId: user._id,
      });

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("leaderboard_update", {
        leaderboard,
        timestamp: Date.now(),
      });

      io.to(sessionId).emit("session_snapshots", session);
    });

    socket.on("quiz_end", async ({ sessionId, user }) => {
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

      const allFinished = checkIfAllFinished(session);
      const leaderboard = buildLeaderboard(session);

      if (allFinished && !session.hasEnded) {
        session.hasEnded = true;
        session.endedAt = Date.now();

        persistQuizResults(session, leaderboard)
          .then((results) => {
            console.log({ results });

            if (results.success) {
              console.log("✅ Quiz results persisted");
              io.to(sessionId).emit("leaderboard_update", {
                stats: results?.results,
                leaderboard,
                isFinal: true,
                endedAt: session.endedAt,
              });
            } else {
              console.error("Failed:", results.error);
            }
          })
          .catch((err) => {
            console.error("Failed to persist quiz results:", err);
          });

        setTimeout(() => {
          delete sessions[sessionId];
        }, 300000);
      } else {
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

      const idx = session.users.findIndex((u) => u._id === user._id);
      if (idx >= 0) {
        session.users[idx].isReady = true;
      } else if (session.host && user._id === session.host._id) {
        session.host.isReady = true;
      }

      io.to(user._id).emit("player_ready", user);

      const leaderboard = buildLeaderboard(session);
      io.to(sessionId).emit("session_snapshots", {
        ...session,
        leaderboard,
      });

      if (session.hasStarted) {
        console.log("Quiz already started");
        return;
      }

      const allReady = areAllNonHostReady(session);
      const acceptedUsers = session.users.filter(
        (u) => u.status === "accepted",
      );
      const readyUsers = acceptedUsers.filter((u) => u.isReady);

      console.log(
        `Ready check for session ${sessionId}: ${readyUsers.length}/${acceptedUsers.length} ready`,
      );

      if (allReady && session.quizData) {
        session.hasStarted = true;
        session.startedAt = Date.now();

        console.log(
          `🚀 Starting quiz for session ${sessionId} with ${acceptedUsers.length} players`,
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
          }`,
        );
      }

      io.to(toUserId).emit("un_invite", session);
      io.to(session.sessionId).emit("remove_invited", session);

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
        subjects.map((s) => s.name).join(", "),
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

async function persistQuizResults(session, leaderboard) {
  const playerResults = {};

  try {
    console.log("💾 Persisting quiz results to database...");

    const appInfo = await AppInfo.findOne({ ID: "APP" });
    const { subjects, topics } = extractMetadata(session.quizData);

    // Flatten all questions with their IDs
    const allQuestions = [];
    const allQuestionIds = [];

    if (Array.isArray(session.quizData)) {
      session.quizData.forEach((subject) => {
        if (subject.questions && Array.isArray(subject.questions)) {
          subject.questions.forEach((q) => {
            allQuestions.push({
              question: q.question,
              answers: q.answers || [],
              answered: q.answered || null,
              topic: q.topic || null,
              subject: q.subject || subject.subject || null,
              categories: q.categories || [],
              point: q.point || 5,
              timer: q.timer || 40,
            });

            if (q._id) {
              allQuestionIds.push(q._id);
            }
          });
        }
      });
    }

    const totalQuestions = allQuestions.length;
    const quizDuration = session.endedAt - session.startedAt;
    const winner = leaderboard[0];
    const REPEATED_QUESTION_POINTS = 0.2;

    // Create Quiz documents
    const quizDocs = [];
    for (const player of leaderboard) {
      try {
        const quizDoc = await Quiz.create({
          mode: session.mode || "friends",
          type: "premium",
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
          quizErr.message,
        );
      }
    }

    // Update each player's data
    for (const [index, player] of leaderboard.entries()) {
      const rank = index + 1;
      const isWinner = player._id.toString() === winner._id.toString();

      try {
        const user = await User.findById(player._id).select(
          "qBank quizStats quizHistory points totalPoints invites quota quotas",
        );
        if (!user) continue;

        // ========================================
        // CALCULATE POINTS BASED ON ACTUAL ANSWERS & qBank
        // ========================================
        const userQBank = (user.qBank || []).map((q) => q.toString());
        const qBankSet = new Set(userQBank);

        let totalPoints = 0;
        const newQuestionIds = [];
        const answeredQuestionIds = [];
        let correctAnswers = 0;

        // Use player's tracked answered questions
        const playerAnsweredQuestions = player.answeredQuestions || [];

        playerAnsweredQuestions.forEach((answered) => {
          const questionId = answered.questionId.toString();
          const isNewQuestion = !qBankSet.has(questionId);
          const isCorrect = answered.isCorrect;

          if (isCorrect) {
            correctAnswers++;
            if (isNewQuestion) {
              // Award full points for NEW correct answers
              totalPoints += answered.point > 0 ? answered.point : 5;
              newQuestionIds.push(answered.questionId);
            } else {
              // Award 0.2 points for REPEATED correct answers
              totalPoints += REPEATED_QUESTION_POINTS;
              answeredQuestionIds.push(answered.questionId);
            }
          } else {
            // Wrong answer - already deducted in session, but track for qBank
            totalPoints += answered.point; // This will be negative (-2)
            if (isNewQuestion) {
              newQuestionIds.push(answered.questionId);
            } else {
              answeredQuestionIds.push(answered.questionId);
            }
          }
        });

        // ========================================
        // UPDATE USER POINTS & qBank
        // ========================================
        const updatedPoints = Math.max(0, totalPoints + user.points);
        const updatedTotalPoints = user.totalPoints + totalPoints;
        const updatedQBank = user.qBank.concat(newQuestionIds);

        const playerQuiz = quizDocs.find(
          (q) => q.playerId.toString() === player._id.toString(),
        );

        // ========================================
        // UPDATE QUOTA
        // ========================================
        const A_DAY = 1000 * 60 * 60 * 24;
        const A_WEEK = 1000 * 60 * 60 * 24 * 7;

        const currentQuota = user.quota || {};
        let updatedQuota;

        // Build subject data from session
        const studentSubjects = [];
        if (session.subjects) {
          session.subjects.forEach((subject) => {
            studentSubjects.push({
              subject: subject._id,
              questions: newQuestionIds, // Only new questions count
              date: Date.now(),
            });
          });
        }

        // Check if within same day
        if (
          currentQuota.daily_update &&
          new Date() - new Date(currentQuota.daily_update) < A_DAY
        ) {
          const dailySubjects = currentQuota.daily_subjects || [];

          // Update daily subjects
          if (session.subjects) {
            session.subjects.forEach((subject) => {
              const subjId = subject._id.toString();
              const existingSubj = dailySubjects.find(
                (s) => s.subject.toString() === subjId,
              );

              if (existingSubj) {
                existingSubj.questions_count += totalQuestions;
              } else {
                dailySubjects.push({
                  subject: subject._id,
                  questions_count: totalQuestions,
                  date: Date.now(),
                });
              }
            });
          }

          updatedQuota = {
            last_update: Date.now(),
            daily_update: currentQuota.daily_update,
            weekly_update: currentQuota.weekly_update || Date.now(),
            point_per_week: totalPoints + (currentQuota.point_per_week || 0),
            subjects: (currentQuota.subjects || []).concat(studentSubjects),
            daily_questions: (currentQuota.daily_questions || []).concat(
              newQuestionIds,
            ),
            daily_questions_count:
              (currentQuota.daily_questions_count || 0) + newQuestionIds.length,
            daily_subjects: dailySubjects,
          };

          // Check if we need to archive weekly quota
          if (
            currentQuota.weekly_update &&
            new Date() - new Date(currentQuota.weekly_update) > A_WEEK
          ) {
            if (!user.quotas) user.quotas = [];
            user.quotas.push(currentQuota);
            updatedQuota.weekly_update = Date.now();
            updatedQuota.point_per_week = totalPoints;
          }
        } else {
          // New day - reset daily counters
          const dailySubjects = [];
          if (session.subjects) {
            session.subjects.forEach((subject) => {
              dailySubjects.push({
                subject: subject._id,
                questions_count: totalQuestions,
                date: Date.now(),
              });
            });
          }

          updatedQuota = {
            last_update: Date.now(),
            daily_update: Date.now(),
            weekly_update: currentQuota.weekly_update || Date.now(),
            point_per_week: currentQuota.point_per_week
              ? totalPoints + currentQuota.point_per_week
              : totalPoints,
            subjects: studentSubjects,
            daily_questions: newQuestionIds,
            daily_questions_count: newQuestionIds.length,
            daily_subjects: dailySubjects,
          };

          // Check weekly archive
          if (
            currentQuota.weekly_update &&
            new Date() - new Date(currentQuota.weekly_update) > A_WEEK
          ) {
            if (!user.quotas) user.quotas = [];
            user.quotas.push(currentQuota);
            updatedQuota.weekly_update = Date.now();
            updatedQuota.point_per_week = totalPoints;
          }
        }

        // ========================================
        // CALCULATE QUIZ STATS
        // ========================================
        if (!user.quizStats) {
          user.quizStats = {};
        }

        const totalQuizzes = (user.quizStats.totalQuizzes || 0) + 1;
        const totalMultiplayerQuizzes =
          (user.quizStats.totalMultiplayerQuizzes || 0) + 1;
        const totalCorrect =
          (user.quizStats.totalCorrectAnswers || 0) + correctAnswers;
        const totalAnswered =
          (user.quizStats.totalQuestionsAnswered || 0) + totalQuestions;
        const newAverageScore =
          ((user.quizStats.averageScore || 0) * (totalQuizzes - 1) +
            totalPoints) /
          totalQuizzes;
        const newAccuracyRate =
          totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : 0;

        const multiplayerWins =
          (user.quizStats.multiplayerStats?.wins || 0) + (isWinner ? 1 : 0);
        const multiplayerGames = totalMultiplayerQuizzes;
        const winRate =
          multiplayerGames > 0 ? (multiplayerWins / multiplayerGames) * 100 : 0;

        // ========================================
        // BUILD QUIZ HISTORY ENTRY
        // ========================================
        const historyEntry = {
          quizId: playerQuiz?.quizId,
          sessionId: session.sessionId,
          mode: session.mode || "friends",
          type: "premium",
          pointsEarned: totalPoints,
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

        // ========================================
        // UPDATE OPERATIONS
        // ========================================
        const updateOps = {
          $set: {
            points: updatedPoints,
            totalPoints: updatedTotalPoints,
            qBank: updatedQBank,
            quota: updatedQuota,
            "quizStats.totalQuizzes": totalQuizzes,
            "quizStats.totalMultiplayerQuizzes": totalMultiplayerQuizzes,
            "quizStats.totalCorrectAnswers": totalCorrect,
            "quizStats.totalQuestionsAnswered": totalAnswered,
            "quizStats.averageScore": newAverageScore,
            "quizStats.accuracyRate": newAccuracyRate,
            "quizStats.lastQuizDate": new Date(),
            "quizStats.multiplayerStats.totalGames": multiplayerGames,
            "quizStats.multiplayerStats.winRate": winRate,
          },
          $push: {
            quizHistory: {
              $each: [historyEntry],
              $position: 0,
              $slice: 50,
            },
          },
        };

        if (isWinner) {
          updateOps.$set["quizStats.multiplayerStats.wins"] = multiplayerWins;
          updateOps.$set["quizStats.totalWins"] =
            (user.quizStats.totalWins || 0) + 1;
        } else if (rank === 2) {
          updateOps.$set["quizStats.multiplayerStats.secondPlace"] =
            (user.quizStats.multiplayerStats?.secondPlace || 0) + 1;
        } else if (rank === 3) {
          updateOps.$set["quizStats.multiplayerStats.thirdPlace"] =
            (user.quizStats.multiplayerStats?.thirdPlace || 0) + 1;
        }

        if (totalPoints > (user.quizStats?.bestScore?.points || 0)) {
          updateOps.$set["quizStats.bestScore"] = {
            points: totalPoints,
            quizId: playerQuiz?.quizId,
            sessionId: session.sessionId,
            date: new Date(),
          };
        }

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

        if (session.category) {
          const categoryIndex = user.quizStats?.categoryStats?.findIndex(
            (cs) =>
              cs.category._id.toString() === session.category._id.toString(),
          );

          if (categoryIndex >= 0) {
            const catStats = user.quizStats.categoryStats[categoryIndex];
            const newCatAvg =
              (catStats.averageScore * catStats.quizzesCompleted +
                totalPoints) /
              (catStats.quizzesCompleted + 1);

            updateOps.$set[
              `quizStats.categoryStats.${categoryIndex}.quizzesCompleted`
            ] = catStats.quizzesCompleted + 1;
            updateOps.$set[
              `quizStats.categoryStats.${categoryIndex}.averageScore`
            ] = newCatAvg;

            if (totalPoints > catStats.bestScore) {
              updateOps.$set[
                `quizStats.categoryStats.${categoryIndex}.bestScore`
              ] = totalPoints;
            }
          } else {
            updateOps.$push = updateOps.$push || {};
            updateOps.$push["quizStats.categoryStats"] = {
              category: {
                _id: session.category._id,
                name: session.category.name,
              },
              quizzesCompleted: 1,
              averageScore: totalPoints,
              bestScore: totalPoints,
            };
          }
        }

        // ========================================
        // UPDATE INVITE STATUS
        // ========================================
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
          },
        );

        // Apply all updates
        await User.findByIdAndUpdate(player._id, updateOps, { new: true });

        // ========================================
        // STORE PLAYER RESULT DATA
        // ========================================
        playerResults[player._id.toString()] = {
          userId: player._id,
          username: player.username,
          pointsEarned: totalPoints,
          newQuestionsAnswered: newQuestionIds.length,
          repeatedQuestions: answeredQuestionIds.length,
          correctAnswers,
          totalQuestions,
          accuracy: ((correctAnswers / totalQuestions) * 100).toFixed(2),
          rank,
          isWinner,
          quizId: playerQuiz?.quizId,
          totalPointsNow: updatedPoints,
          totalQuestionsInQBank: updatedQBank.length,
        };

        console.log(
          `✅ Updated ${player.username}: Points: ${totalPoints}, New Questions: ${newQuestionIds.length}, Correct: ${correctAnswers}/${totalQuestions}`,
        );
      } catch (userErr) {
        console.error(
          `Failed to update user ${player.username}:`,
          userErr.message,
        );
        playerResults[player._id.toString()] = {
          userId: player._id,
          username: player.username,
          error: userErr.message,
        };
      }
    }

    console.log("✅ Quiz results persisted successfully");

    return {
      success: true,
      sessionId: session.sessionId,
      totalPlayers: leaderboard.length,
      quizDuration,
      results: playerResults,
    };
  } catch (error) {
    console.error("❌ Error persisting quiz results:", error);
    return {
      success: false,
      error: error.message,
      sessionId: session?.sessionId,
    };
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
  updateObj.host = sessions[sessionId]?.host?._id;

  if (startedAt) updateObj.startedAt = startedAt;
  if (quizCompleted !== undefined) updateObj.quizCompleted = quizCompleted;

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
    },
  );

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
      },
    );
  }

  if (status === "pending") {
    const userInfo = await User.findById(userId).select("expoPushToken");
    if (userInfo) {
      await expoNotifications([userInfo.expoPushToken], {
        title: "New Quiz Invite",
        message: `${session?.host?.username} is inviting you for a quiz session`,
        data: updateObj,
      });
    }
  }
}
