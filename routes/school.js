const express = require("express");
const uuid = require("uuid");
// const nodemailer = require("nodemailer");
// const mediaUploader = require("../middlewares/mediaUploader");
// const multer = require("multer");
// const { getUploadUri } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
// const { Category } = require("../models/Category");
// const { Subject } = require("../models/Subject");
// const { Topic } = require("../models/Topic");
const { School } = require("../models/School");
const { User } = require("../models/User");
const {
  capFirstLetter,
  userSelector,
  getClasses,
  reconcileSchool,
  getGrade,
} = require("../controllers/helpers");
const { default: mongoose } = require("mongoose");
const nanoid = uuid.v4;

const selectQuiz =
  "quiz._id quiz.questions quiz.currentSession quiz.currentSubmissions quiz.sessions quiz.subject quiz.teacher";

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     return cb(null, "./uploads/assets/");
//   },
//   filename: (req, file, cb) => {
//     return cb(null, `${file.originalname}`);
//   },
// });

// const uploader = multer({ storage, limits: { fieldSize: 2 * 1024 * 1024 } }); // 2MB

const router = express.Router();

// MAKE A SEPERATE AUTH ROUTE CHECKER FOR TEACHERS ONLY

router.post("/create", auth, async (req, res) => {
  const data = req.body;
  const userId = req.user.userId;

  const school = new School({
    contact: data.contact,
    email: data.email,
    levels: data.levels?.map((obj) => ({ name: obj.name })),
    name: data.name,
    lga: data?.lga?.name,
    state: data?.state?.name,
    type: data?.type?.name,
    rep: userId,
    createdAt: new Date(),
    teachers: [{ user: userId }],
  });

  await school.save();

  res.send({ status: "success", data: school });
});

router.post("/verify", auth, async (req, res) => {
  const userId = req.user.userId;
  const { instanceId, instance, type, schoolId } = req.body;

  const userInfo = await User.findById(userId).select(
    "firstName lastName preffix"
  );
  const instanceInfo = await User.findById(instanceId).select(
    "firstName lastName preffix"
  );

  const school = await School.findOne({
    _id: schoolId,
    "teachers.user": userId,
  });

  const teacherData = school.teachers.find(
    (item) => item.user?.toString() == userId
  );

  if (!teacherData?.verified) {
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });
  }

  if (type === "accept") {
    if (instance == "teacher") {
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $set: {
            "teachers.$.verified": true,
          },
          $push: {
            announcements: {
              type: "system",
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has verified ${capFirstLetter(
                instanceInfo?.preffix
              )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a fellow colleaque`,
              visibility: "all",
            },
          },
        }
      );
      instanceInfo.verified = true;
      await instanceInfo.save();
    } else if (instance === "student") {
      await School.updateOne(
        { _id: schoolId, "students.user": instanceId },
        {
          $set: {
            "students.$.verified": true,
          },
          $push: {
            announcements: {
              type: "system",
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has verified ${capFirstLetter(
                instanceInfo.firstName
              )} ${capFirstLetter(instanceInfo?.lastName)} as a valid student`,
              visibility: "all",
            },
          },
        }
      );
      instanceInfo.verified = true;
      await instanceInfo.save();
    }
  } else if (type == "reject") {
    if (instance == "teacher") {
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $pull: {
            teachers: { user: instanceId },
          },
          $push: {
            announcements: {
              type: "system",
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has rejected ${capFirstLetter(
                instanceInfo?.preffix
              )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a fellow colleaque`,
              visibility: "all",
            },
          },
        }
      );
      instanceInfo.verified = true;
      await instanceInfo.save();
    } else if (instance == "student") {
      await School.updateOne(
        { _id: schoolId, "students.user": instanceId },
        {
          $pull: {
            students: { user: instanceId },
          },
          $push: {
            announcements: {
              type: "system",
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has rejected ${capFirstLetter(
                instanceInfo.firstName
              )} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a invalid student`,
              visibility: "all",
            },
          },
        }
      );
      instanceInfo.verified = false;
      await instanceInfo.save();
    }
  } else if (type == "unverify") {
    if (instance == "teacher") {
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $set: {
            "teachers.$.verified": false,
          },
          $push: {
            announcements: {
              type: "system",
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has un-verified ${capFirstLetter(
                instanceInfo?.preffix
              )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a fellow colleaque`,
              visibility: "all",
            },
          },
        }
      );
      instanceInfo.verified = false;
      await instanceInfo.save();
    } else if (instance === "student") {
      await School.updateOne(
        { _id: schoolId, "students.user": instanceId },
        {
          $set: {
            "students.$.verified": false,
          },
          $push: {
            announcements: {
              type: "system",
              message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
                userInfo.firstName
              )} ${capFirstLetter(
                userInfo?.lastName
              )} has un-verified ${capFirstLetter(
                instanceInfo.firstName
              )} ${capFirstLetter(
                instanceInfo?.lastName
              )} as a student in probation`,
              visibility: "all",
            },
          },
        }
      );
      instanceInfo.verified = false;
      await instanceInfo.save();
    }
  }

  res.send({ status: "success" });
});

router.post("/join", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.body;

  const userInfo = await User.findById(userId).select(
    "accountType preffix firstName lastName username"
  );
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "Invalid user account" });

  const school = await School.findById(schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  if (!school?.subscription?.isActive) {
    return res.status(422).send({
      status: "failed",
      message: "School does not have an active subscription",
    });
  }

  const isTeacher = userInfo?.accountType == "teacher";
  const isStudent = userInfo?.accountType == "student";

  if (isTeacher) {
    // check if teacher has joined other schools
    const teachSchool = await School.findOne({
      _id: { $ne: schoolId },
      "teachers.user": userId,
    });

    if (teachSchool) {
      // remove teacher from other school previously joined
      teachSchool.teachers = teachSchool.teachers.filter(
        (item) => item?.user?.toString() != userId
      );
      await teachSchool.save();
    }

    // Check if school already has this teacher
    const checker = school.teachers.findIndex(
      (item) => item?.user?.toString() == userId
    );
    if (checker < 0) {
      school.teachers.push({ user: userId });
      school.announcements.push({
        type: "system",
        message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
          userInfo.firstName
        )} ${capFirstLetter(userInfo?.lastName)} has requested to join ${
          school.name
        } as a teacher, you may verify or decline this request`,
        visibility: "all",
      });
      await school.save();
    }
  } else if (isStudent) {
    // check if student has joined other schools
    const stdSchool = await School.findOne({
      _id: { $ne: schoolId },
      "students.user": userId,
    });

    if (stdSchool) {
      stdSchool.students = stdSchool.students.filter(
        (item) => item?.user?.toString() != userId
      );
      await stdSchool.save();
    }

    // Check if student already has this teacher
    const checker = school.students.findIndex(
      (item) => item?.user?.toString() == userId
    );
    if (checker < 0) {
      school.students.push({ user: userId });
      await school.save();
    }
  }

  res.send({ status: "success" });
});

router.post("/class", auth, async (req, res) => {
  const data = req.body;
  const school = await School.findById(data?.schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  if (data.type === "all") {
    school.classes = school.classes.concat(getClasses());
  } else {
    school.classes.push({ alias: data.name, level: data.class?.name });
  }

  await school.save();

  res.send({ status: "success" });
});

router.post("/announcement", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  const { title, classes, schoolId } = data;

  if (!schoolId) {
    return res.status(422).send({ status: "failed", message: "No school ID" });
  }

  try {
    await School.updateOne(
      { _id: schoolId },
      {
        $addToSet: {
          announcements: {
            teacher: userId,
            message: title,
            visibility: "class",
            classes: classes.map((item) => item.name?.toLowerCase()),
          },
        },
      }
    );
  } catch (error) {
    return res
      .status(422)
      .send({ status: "failed", message: error?.data ?? error?.message });
  }

  res.send({ status: "success" });
});

router.post("/get_quiz", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId, quizId, type } = req.body;

  // if (!quizId)
  //   return res
  //     .status(422)
  //     .send({ status: "failed", message: "Invalid quiz info" });

  const userInfo = await User.findById(userId).select("accountType");
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });
  if (userInfo.accountType !== "student")
    return res
      .status(422)
      .send({ status: "failed", message: "User not authorized" });

  const school = await School.findById(schoolId)
    .populate([
      {
        path: "quiz.subject",
        model: "Subject",
        select: "name",
      },
    ])
    .select("quiz._id quiz.questions quiz.subject quiz.teacher");
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  let quiz;
  if (type === "school") {
    quiz = school.quiz.find((item) => item._id?.toString() == quizId);
    quiz = [quiz];
  } else {
    return res
      .status(422)
      .send({ status: "failed", message: "Invalid type info" });
  }

  return res.send({ status: "success", data: quiz });
});

router.post("/submit_quiz", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  const { schoolId, type, questions, quizId } = data;

  const userInfo = await User.findById(userId).select(
    "accountType schoolPoints"
  );
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });
  if (userInfo.accountType !== "student")
    return res
      .status(422)
      .send({ status: "failed", message: "User not authorized" });

  const school = await School.findById(schoolId)
    .populate([
      {
        path: "quiz.subject",
        model: "Subject",
        select: "name",
      },
    ])
    .select(selectQuiz);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  // Get stats

  let point = 0,
    total = 0;

  questions.forEach((quest) => {
    quest.questions.forEach((question) => {
      const correctAnswer = question?.answers?.find(
        (item) => item?.correct == true
      );
      if (correctAnswer?._id == question?.answered?._id) {
        point += question.point;
        total += question.point;
      } else {
        total += question.point;
        point -= 15;
        // setStat({ ...stat, point: statPoints });
      }
    });
  });

  if (type == "school") {
    const getQuiz = school.quiz?.find(
      (item) => item?._id?.toString() == quizId
    );
    const checkUser = getQuiz.currentSubmissions.findIndex(
      (item) => item?.toString() == userId
    );
    if (checkUser > -1) {
      return res.status(422).send({
        status: "failed",
        message: "You have already this attempted this quiz, No points added",
      });
    }
    getQuiz.currentSubmissions.push(userId);
    if (Boolean(getQuiz)) {
      const sess = getQuiz.sessions?.find(
        (item) => item?._id?.toString() == getQuiz.currentSession?.toString()
      );
      if (sess) {
        sess.participants.addToSet({
          student: userId,
          quiz: questions,
          score: point,
        });
        sess.total_score = total;
        sess.average_score =
          sess.participants.reduce((acc, curr) => acc + curr.score, 0) /
          sess.participants.length;

        // give school points
        userInfo.schoolPoints += point;

        await school.save();
        await userInfo.save();
      } else {
        return res
          .status(422)
          .send({ status: "failed", message: "Session not found" });
      }
    } else {
      return res
        .status(422)
        .send({ status: "failed", message: "Quiz not found" });
    }
  }

  res.send({ status: "success" });
});

router.post("/quiz", auth, async (req, res) => {
  const userId = req.user.userId;
  const {
    questions,
    subject,
    class: schoolClass,
    title,
    schoolId,
    save,
  } = req.body;

  const school = await School.findById(schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  const userInfo = await User.findById(userId).select(userSelector);
  if (!userInfo)
    return res.status(422).send({ status: "failed", message: "Invalid User" });

  const sessionId = new mongoose.Types.ObjectId();

  const pushObj = {
    class: schoolClass?.name?.toLowerCase(),
    teacher: userId,
    questions: [],
    subject: subject?._id,
    sessions: [{ _id: sessionId }],
    currentSession: sessionId,
    title,
    status: save ? "inactive" : "active",
  };

  const quizQuestions = questions.map((item) => ({
    ...item,
    answers: item?.answers?.map((ans) => ({
      name: ans.name,
      correct: ans.correct,
    })),
  }));

  pushObj.questions = quizQuestions;

  school.quiz.push(pushObj);

  if (save === false) {
    school.announcements.push({
      classes: [schoolClass?.name?.toLowerCase()],
      teacher: userId,
      message: `${capFirstLetter(subject?.name)} quiz is now active by ${
        userInfo.preffix
      } ${userInfo.firstName} ${userInfo.lastName} `,
      visibility: "class",
    });
  }

  await school.save();
  // START A QUIZ SESSION

  res.send({ status: "success" });
});

router.put("/quiz", auth, async (req, res) => {
  const userId = req.user.userId;
  const quiz = req.body;
  const { schoolId } = quiz;

  if (!quiz)
    return res
      .status(422)
      .send({ status: "failed", message: "Please provide info" });

  const school = await School.findById(schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  const quizIdx = school.quiz.findIndex(
    (item) => item?._id?.toString() == quiz?._id
  );

  if (quizIdx > -1) {
    const quizData = { ...quiz };
    delete quizData.schoolId;
    quizData.subject = quizData?.subject?._id;
    quizData.class = quizData?.class?.name?.toLowerCase();
    quizData.status = "inactive";
    school.quiz[quizIdx] = {
      ...school.quiz[quizIdx],
      title: quizData?.title,
      status: quizData?.status,
      subject: quizData?.subject,
      class: quizData?.class,
      title: quizData?.title,
      date: new Date(),
      teacher: userId,
    };
    // update questions
    school.quiz[quizIdx].questions = quizData?.questions;
    school.quiz[quizIdx]._id = quizData?._id;

    await school.save();
  } else {
    return res
      .status(422)
      .send({ status: "failed", message: "Quiz data not found" });
  }

  res.send({ status: "success" });
});

router.put("/quiz_status", auth, async (req, res) => {
  const userId = req.user.userId;

  const { schoolId, quizId, status, class: schoolClass } = req.body;

  if (!schoolId && !quizId && !status)
    return res.status(422).send({ status: "failed", message: "Invalid info" });

  const userInfo = await User.findById(userId).select(
    "accountType preffix firstName lastName"
  );
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  if (userInfo.accountType !== "teacher") {
    return res
      .status(422)
      .send({ status: "failed", message: "User not authorized" });
  }

  const school = await School.findById(schoolId);
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  let pusher = {};

  console.log({ status });

  if (status === "active") {
    pusher.$push = {
      announcements: {
        teacher: userId,
        message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
          userInfo?.firstName
        )} ${capFirstLetter(
          userInfo?.lastName
        )} has started a new quiz session for your class\nParticipate Now`,
        classes: [schoolClass],
      },
    };

    await School.updateOne(
      { _id: schoolId, "quiz._id": quizId },
      {
        $set: {
          "quiz.$.status": status,
          "quiz.$.class": schoolClass,
        },
        ...pusher,
      }
    );
  } else if (status === "inactive") {
    await School.updateOne(
      { _id: schoolId, "quiz._id": quizId },
      {
        $set: {
          "quiz.$.status": status,
          "quiz.$.class": schoolClass,
        },
      }
    );
  } else if (status === "review") {
    // Close quiz session
    // set quiz obj to false
    const quiz = school.quiz.find((item) => item._id === quizId);
    const session = quiz.sessions.find(
      (item) => item._id == quiz.currentSession
    );

    school.announcements.push({
      teacher: userId,
      message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo?.firstName
      )} ${capFirstLetter(
        userInfo?.lastName
      )} has closed the quiz session for your class\nWait for your scores to be released`,
      classes: [schoolClass],
    });
    quiz.currentSubmissions = [];
    quiz.currentSession = quiz._id;
    session.ended = true;

    await school.save();
  }

  res.send({ status: "success" });
});

router.get("/quiz", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId, type, quizId } = req.query;

  if (!schoolId && !type)
    return res.status(422).send({ status: "failed", message: "Invalid info" });

  const userInfo = await User.findById(userId).select("accountType");

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  let school,
    quizzes = [];

  if (type == "detail") {
    if (userInfo.accountType === "student") {
      school = await School.findById(schoolId)
        .select(
          "quiz.title quiz.date quiz.currentSession quiz.subject quiz._id quiz.status quiz.teacher"
        )
        .populate([
          {
            path: "quiz.subject",
            model: "Subject",
            select: "name",
          },
          {
            path: "quiz.teacher",
            model: "User",
            select: "firstName lastName avatar preffix",
          },
        ]);
      if (!school)
        return res
          .status(422)
          .send({ status: "failed", message: "School not found" });

      const quizz = school.quiz
        .filter((item) => item?.status != "inactive")
        .map((item) => {
          const checkUser = item.currentSubmissions?.findIndex(
            (usr) => usr?.toString() == userId
          );
          if (checkUser > -1) {
            return {
              ...item._doc,
              status: "submitted",
            };
          } else {
            return item;
          }
        });

      return res.status(200).send({ status: "success", data: quizz });
    } else if (userInfo.accountType === "teacher") {
      school = await School.findById(schoolId)
        .select(
          "quiz.title quiz.currentSession quiz.subject quiz.status quiz._id"
        )
        .populate([
          {
            path: "quiz.subject",
            model: "Subject",
            select: "name",
          },
        ]);
      if (!school)
        return res
          .status(422)
          .send({ status: "failed", message: "School not found" });
    }
  } else if (type === "full") {
    if (userInfo.accountType === "student") {
      school = await School.findById(schoolId)
        .select("quiz")
        .populate([
          {
            path: "quiz.subject",
            model: "Subject",
            select: "name",
          },
          {
            path: "quiz.teacher",
            model: "User",
            select: "firstName lastName preffix",
          },
        ]);

      school.quiz.forEach((quizItem) => {
        quizItem.sessions.forEach((sess) => {
          sess.participants.forEach((participant) => {
            if (participant.student.toString() == userId) {
              quizzes.push({
                _id: nanoid(),
                score: participant.score,
                total: sess.total_score,
                date: sess.date,
                teacher: quizItem.teacher,
                average_score: Math.round(
                  (participant.score / sess.total_score) * 100
                ),
                subject: quizItem.subject,
              });
            }
          });
        });
      });

      if (!school)
        return res
          .status(422)
          .send({ status: "failed", message: "School not found" });

      return res.status(200).send({ status: "success", data: quizzes });
    } else if (userInfo.accountType === "teacher") {
      school = await School.findOne({ _id: schoolId })
        .select("quiz")
        .populate([
          {
            path: "quiz.subject",
            model: "Subject",
            select: "name",
          },
        ]);

      if (!school)
        return res
          .status(422)
          .send({ status: "failed", message: "School not found" });

      const getQuiz = school.quiz.find((item) => item._id == quizId);
      const sessions = getQuiz.sessions
        .filter((item) => item.ended == true)
        .map((item) => {
          return {
            date: item.date,
            average_score: item.average_score,
            percentage: item.participants?.length,
          };
        });
      return res.status(200).send({
        status: "success",
        data: sessions,
        extra: {
          title: getQuiz.title,
          status: getQuiz.status,
          questions: getQuiz.questions,
          class: getQuiz.class,
          subject: getQuiz.subject,
        },
      });
    }
  }

  res.send({ status: "success", data: school?.quiz });
});

router.get("/announcements", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.query;

  console.log({ schoolId });
  if (!Boolean(schoolId) || schoolId == "undefined") {
    return res.status(422).send({ status: "failed", message: "No school ID" });
  }

  const userInfo = await User.findById(userId).select("accountType");

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  const school = await School.findById(schoolId)
    .populate([
      {
        path: "announcements.teacher",
        model: "User",
        select: userSelector,
      },
    ])
    .select("announcements");

  const prevAnnouncements = school.announcements;

  await School.updateOne(
    { _id: schoolId, "announcements.read": false },
    {
      $addToSet: {
        "announcements.$.reads": userId,
      },
    }
  );

  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  res.send({ status: "success", data: prevAnnouncements.reverse() });
});

router.get("/fetch", auth, async (req, res) => {
  const userId = req.user.userId;

  const userInfo = await User.findById(userId).select("accountType");
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  const isTeacher = userInfo?.accountType == "teacher";
  const isStudent = userInfo?.accountType == "student";

  let school, isVerified;
  if (isTeacher) {
    school = await School.findOne({ "teachers.user": userId })
      .select("-__v -tx_history")
      .populate([
        {
          path: "teachers.user",
          model: "User",
          select: userSelector,
        },
        {
          path: "students.user",
          model: "User",
          select: userSelector,
        },
        {
          path: "rep",
          model: "User",
          select: userSelector,
        },
      ]);
    if (school) {
      const teacherData = school.teachers.find(
        (item) => item.user?._id?.toString() == userId
      );
      isVerified = teacherData?.verified;
    }
  } else if (isStudent) {
    school = await School.findOne({ "students.user": userId })
      .select("-__v -tx_history")
      .populate([
        {
          path: "teachers.user",
          model: "User",
          select: userSelector,
        },
        {
          path: "students.user",
          model: "User",
          select: userSelector,
        },
        {
          path: "rep",
          model: "User",
          select: userSelector,
        },
      ]);
    if (school) {
      const stdData = school.students.find(
        (item) => item.user?._id?.toString() == userId
      );
      isVerified = stdData?.verified;
    }
  }
  let assignmentCount, announcementCount, classCount, quizCount;

  if (school) {
    await reconcileSchool(school);
    school.students = school.students.filter((item) => item.verified);
    school.teachers = school.teachers.filter((item) => item.verified);

    // Get Counts
    assignmentCount = (school.assignments?.filter(
      (item) => item.status == "ongoing"
    )).length;
    // announcementCount = school.announcements?.filter()
    classCount = school.classes.length;
    quizCount = school.quiz.filter((item) => item.status == "active").length;
    return res.send({
      status: "success",
      data: { ...school?._doc, classCount, assignmentCount, quizCount },
      isVerified,
    });
  } else {
    return res.send({
      status: "success",
      data: {},
      isVerified,
    });
  }
});

router.get("/classes", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.query;
  const school = await School.findById(schoolId).select("classes");
  const userInfo = await User.findById(userId);

  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  res.send({
    status: "success",
    data: school.classes,
  });
});

router.get("/search", auth, async (req, res) => {
  const { q } = req.query;
  // Split query into words, escaping special regex characters
  const regex = new RegExp(q.split(/\s+/).join(".*"), "i");

  const search = await School.find({ name: regex })
    .select("name state lga subscription rep")
    .populate([
      {
        path: "rep",
        model: "User",
        select: "avatar username firstName lastName preffix",
      },
    ]);

  res.send({ status: "success", data: search });
});

router.get("/instances", auth, async (req, res) => {
  const { type, schoolId } = req.query;
  let data, school;

  if (type === "teacher") {
    school = await School.findById(schoolId)
      .select("teachers")
      .populate([
        {
          path: "teachers.user",
          model: "User",
          select: userSelector,
        },
      ]);

    data = school.teachers.sort((a, b) => a.verified - b.verified);
  } else if (type == "student") {
    school = await School.findById(schoolId)
      .select("students")
      .populate([
        {
          path: "students.user",
          model: "User",
          select: userSelector,
        },
      ]);

    data = school.students.sort((a, b) => a.verified - b.verified);
  } else {
    return res
      .status(422)
      .send({ status: "failed", message: "Invalid instance" });
  }
  res.send({ status: "success", data });
});

router.get("/assignments", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.query;

  const userInfo = await User.findById(userId).select("accountType class");
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found" });

  const school = await School.findById(schoolId)
    .populate([
      {
        path: "assignments.subject",
        model: "Subject",
        select: "name",
      },
      {
        path: "assignments.teacher",
        model: "User",
        select: "preffix firstName lastName username avatar",
      },
    ])
    .select("assignments classes");

  await reconcileSchool(school);

  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  let data;
  if (userInfo.accountType == "teacher") {
    data = school.assignments
      .filter((item) => item?.teacher?._id.toString() == userId)
      .map((item) => {
        let len = 0;
        item.classes.forEach((classItem) => {
          const finder = school.classes?.find((classObj) => {
            return classObj.level == classItem;
          });
          if (finder) {
            len += finder?.students?.length;
          }
        });

        return {
          ...item._doc,
          submissions: null,
          history: null,
          total: len,
          submissionsCount: item?.submissions?.length,
        };
      });
  } else {
    // Filter assignments for the student's class
    const studentAssignments = school.assignments.filter(
      (assignment) =>
        assignment.classes.includes(userInfo.class.level) &&
        assignment.status === "ongoing"
    );

    // Group assignments by teacher
    const teacherMap = new Map();

    studentAssignments.forEach((assignment) => {
      const teacherId = assignment.teacher._id.toString();

      // Find student's submission for this assignment
      const userSubmission = assignment.submissions.find(
        (sub) => sub.student.toString() === userId
      );

      // Determine user status
      let userStatus = "pending";
      if (userSubmission) {
        if (userSubmission.score?.grade) {
          // Has been graded
          const gradeValue = userSubmission.score.value || 0;
          userStatus = gradeValue >= 50 ? "passed" : "failed";
        } else {
          userStatus = "submitted";
        }
      }

      // Create assignment item
      const assignmentItem = {
        _id: assignment._id,
        title: assignment.title,
        subject: assignment.subject,
        question: assignment.question,
        date: assignment.date,
        expiry: assignment.expiry,
        status: assignment.status,
        userStatus,
      };

      // Add to teacher's group
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          teacher: {
            _id: assignment.teacher._id,
            firstName: assignment.teacher.firstName,
            lastName: assignment.teacher.lastName,
            preffix: assignment.teacher.preffix,
            avatar: assignment.teacher.avatar,
            username: assignment.teacher.username,
          },
          pendingCount: 0,
          list: [],
        });
      }

      const teacherGroup = teacherMap.get(teacherId);
      teacherGroup.list.push(assignmentItem);

      if (userStatus === "pending") {
        teacherGroup.pendingCount++;
      }
    });

    // Convert map to array
    data = Array.from(teacherMap.values());
  }

  res.send({ status: "success", data });
});

router.post("/assignment", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  const { classes, title, question, subject, date, status, schoolId } = data;

  const school = await School.findById(schoolId);

  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  school.assignments.addToSet({
    classes: classes.map((item) => item.name?.toLowerCase()),
    title,
    question,
    subject: subject?._id,
    expiry: date,
    teacher: userId,
    status,
  });

  await school.save();

  res.send({ status: "success" });
});

router.get("/assignment", auth, async (req, res) => {
  const userId = req.user.userId;

  const { assignmentId, schoolId } = req.query;
  // Validate user authentication
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. User not authenticated",
    });
  }

  // Validate required query parameters
  if (!schoolId || !assignmentId) {
    return res.status(400).json({
      success: false,
      message: "schoolId and assignmentId are required",
    });
  }

  // Validate IDs
  if (!mongoose.Types.ObjectId.isValid(schoolId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid school ID",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid assignment ID",
    });
  }

  // Find the school and check if user is the assignment teacher
  const school = await School.findOne({
    _id: schoolId,
    "assignments._id": assignmentId,
  }).populate([
    {
      path: "assignments.teacher",
      select: "username avatar firstName lastName",
    },
    {
      path: "assignments.submissions.student",
      select: "username avatar firstName class lastName",
    },
  ]);

  if (!school) {
    return res.status(404).json({
      success: false,
      message: "School or assignment not found",
    });
  }

  await reconcileSchool(school);

  // Find the specific assignment
  const assignment = school.assignments.find(
    (a) => a._id.toString() === assignmentId
  );

  // Format history
  const formattedHistory = assignment.history.map((historyEntry) => {
    const participants = historyEntry.participants || [];
    const participantCount = participants.length;

    // Calculate average percentage score
    let percentageScore = 0;
    if (participantCount > 0) {
      const totalScore = participants.reduce((sum, participant) => {
        return sum + (participant.score?.value || 0);
      }, 0);
      percentageScore = Math.round((totalScore / participantCount) * 100) / 100;
    }

    return {
      _id: historyEntry._id,
      percentageScore,
      participants: participantCount,
      createdAt: historyEntry.createdAt,
    };
  });

  // Create formatted assignment response
  const formattedAssignment = {
    ...assignment._doc,
    history: formattedHistory,
  };

  res.send({ success: true, data: formattedAssignment });
});

router.post("/assignment/grade", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId, assignmentId, score, user } = req.body;

  // Validate user authentication
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. User not authenticated",
    });
  }

  // Validate required query parameters
  if (!schoolId || !assignmentId || !score || !user) {
    return res.status(400).json({
      success: false,
      message: "Missing fields are required",
    });
  }

  // Validate IDs
  if (!mongoose.Types.ObjectId.isValid(schoolId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid school ID",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid assignment ID",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(user)) {
    return res.status(400).json({
      success: false,
      message: "Invalid student ID",
    });
  }

  // Find the school and check if user is the assignment teacher
  const school = await School.findOne({
    _id: schoolId,
    "assignments._id": assignmentId,
  });

  if (!school) {
    return res.status(404).json({
      success: false,
      message: "School or assignment not found",
    });
  }

  // Find the specific assignment
  const assignment = school.assignments.find(
    (a) => a._id.toString() === assignmentId
  );

  // Verify user is the teacher of this assignment
  if (assignment.teacher.toString() !== userId) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to delete this assignment",
    });
  }

  const userScore = getGrade(score);

  const submission = assignment.submissions.find(
    (sub) => sub.student?.toString() === user
  );

  if (!submission) {
    return res.status(404).send({
      success: false,
      message: "User assignment submission not found",
    });
  }

  submission.score = userScore;

  await school.save();

  res.send({
    success: true,
    message: "Assignment graded successfully",
    data: submission,
  });
});

router.post("/assignment/publish", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId, assignmentId } = req.body;

  try {
    // Validate input
    if (!schoolId || !assignmentId) {
      return res.status(400).send({
        status: "failed",
        message: "School ID and Assignment ID are required",
      });
    }

    // Check if user is a teacher
    const userInfo = await User.findById(userId).select("accountType name");
    if (!userInfo) {
      return res.status(422).send({
        status: "failed",
        message: "User not found",
      });
    }

    if (userInfo.accountType !== "teacher") {
      return res.status(403).send({
        status: "failed",
        message: "Only teachers can publish assignments",
      });
    }

    // Get school and assignment
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(422).send({
        status: "failed",
        message: "School not found",
      });
    }

    const assignment = school.assignments.id(assignmentId);
    if (!assignment) {
      return res.status(404).send({
        status: "failed",
        message: "Assignment not found",
      });
    }

    // Check if user is the owner of the assignment
    if (assignment.teacher.toString() !== userId) {
      return res.status(403).send({
        status: "failed",
        message: "You are not authorized to publish this assignment",
      });
    }

    // Check if assignment has expired
    if (assignment.expiry) {
      const currentDate = new Date();
      if (currentDate < assignment.expiry) {
        return res.status(400).send({
          status: "failed",
          message: "Cannot publish assignment before submission date",
        });
      }
    }

    // Check that all submissions have been scored
    const unscoredSubmissions = assignment.submissions.filter(
      (submission) =>
        submission.score?.value === undefined ||
        submission.score?.value === null
    );

    if (unscoredSubmissions.length > 0) {
      return res.status(400).send({
        status: "failed",
        message: `${unscoredSubmissions.length} submission(s) have not been scored yet`,
      });
    }

    // Push current submissions to history
    if (assignment.submissions.length > 0) {
      const historyEntry = {
        participants: assignment.submissions.map((submission) => ({
          student: submission.student,
          score: submission.score,
          solution: submission.solution,
          date: submission.date,
        })),
        createdAt: new Date(),
      };

      assignment.history.push(historyEntry);
    }

    // Reset submissions array
    assignment.submissions = [];

    // Set assignment status to inactive
    assignment.status = "inactive";

    // Create announcement
    const announcement = {
      teacher: userId,
      message: `${userInfo.name} has published scores for "${assignment.title}"`,
      type: "school",
      classes: assignment.classes,
      visibility: "class",
      date: new Date(),
    };

    school.announcements.push(announcement);

    // Save school
    await school.save();

    res.send({
      status: "success",
      message: "Assignment published successfully",
      data: {
        assignment: {
          _id: assignment._id,
          title: assignment.title,
          status: assignment.status,
        },
      },
    });
  } catch (error) {
    console.error("Error publishing assignment:", error);
    res.status(500).send({
      status: "failed",
      message: "An error occurred while publishing the assignment",
    });
  }
});

router.post("/assignment/submit", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId, assignmentId, solution } = req.body;

  // Validate user authentication
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. User not authenticated",
    });
  }

  // Validate required query parameters
  if (!schoolId || !assignmentId || !solution) {
    return res.status(400).json({
      success: false,
      message: "Missing fields are required",
    });
  }

  // Validate IDs
  if (!mongoose.Types.ObjectId.isValid(schoolId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid school ID",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid assignment ID",
    });
  }

  // Find the school and check if user is the assignment teacher
  const school = await School.findOne({
    _id: schoolId,
    "assignments._id": assignmentId,
  });

  if (!school) {
    return res.status(404).json({
      success: false,
      message: "School or assignment not found",
    });
  }
  // Find the specific assignment
  const assignment = school.assignments.find(
    (a) => a._id.toString() === assignmentId
  );

  // Check if user has already submitted
  const existingSubmission = assignment.submissions.find(
    (sub) => sub.student.toString() === userId
  );

  if (existingSubmission) {
    return res.status(400).json({
      success: false,
      message: "You have already submitted this assignment",
    });
  }

  // Add the submission
  assignment.submissions.push({
    student: userId,
    solution,
    date: new Date(),
  });

  await school.save();

  res.send({ success: true, message: "Assignment submitted successfully" });
});

router.get("/assignment/history", auth, async (req, res) => {
  const userId = req.user.userId;
  const { assignmentId, schoolId, historyId } = req.query;

  try {
    // Validate user authentication
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. User not authenticated",
      });
    }

    // Validate required query parameters
    if (!schoolId || !assignmentId) {
      return res.status(400).json({
        success: false,
        message: "schoolId and assignmentId are required",
      });
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(historyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid history ID",
      });
    }

    // Find the school and populate student details
    const school = await School.findOne({
      _id: schoolId,
      "assignments._id": assignmentId,
    }).populate({
      path: "assignments.history.participants.student",
      select: "username avatar firstName lastName class",
    });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School or assignment not found",
      });
    }

    // Find the specific assignment
    const assignment = school.assignments.find(
      (a) => a._id.toString() === assignmentId
    );

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
      });
    }

    // Find the specific history entry
    const historyEntry = assignment.history.find(
      (h) => h._id.toString() === historyId
    );

    if (!historyEntry) {
      return res.status(404).json({
        success: false,
        message: "History entry not found",
      });
    }

    // Format participants data without solution
    const participants = historyEntry.participants.map((participant) => ({
      _id: participant._id,
      student: participant.student,
      score: participant.score,
      date: participant.date,
      solution: participant.solution,
    }));

    res.send({
      success: true,
      data: {
        historyId: historyEntry._id,
        createdAt: historyEntry.createdAt,
        participants,
      },
    });
  } catch (error) {
    console.error("Error fetching history participants:", error);
    res.status(500).send({
      success: false,
      message: "An error occurred while fetching history participants",
    });
  }
});

// DELETE /api/assignment?schoolId=xxx&assignmentId=xxx
router.delete("/assignment", auth, async (req, res) => {
  try {
    const { schoolId, assignmentId } = req.query;
    const userId = req.user?.userId;

    // Validate user authentication
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. User not authenticated",
      });
    }

    // Validate required query parameters
    if (!schoolId || !assignmentId) {
      return res.status(400).json({
        success: false,
        message: "schoolId and assignmentId are required",
      });
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID",
      });
    }

    // Find the school and check if user is the assignment teacher
    const school = await School.findOne({
      _id: schoolId,
      "assignments._id": assignmentId,
    });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School or assignment not found",
      });
    }

    // Find the specific assignment
    const assignment = school.assignments.find(
      (a) => a._id.toString() === assignmentId
    );

    // Verify user is the teacher of this assignment
    if (assignment.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete this assignment",
      });
    }

    // Remove the assignment
    const updatedSchool = await School.findOneAndUpdate(
      { _id: schoolId, "assignments._id": assignmentId },
      { $pull: { assignments: { _id: assignmentId } } },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Assignment deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting assignment:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting assignment",
      error: error.message,
    });
  }
});

// PATCH /api/assignment?schoolId=xxx&assignmentId=xxx
router.put("/assignment", auth, async (req, res) => {
  try {
    const { data, schoolId, assignmentId } = req.body;
    const userId = req.user?.userId;

    // Validate user authentication
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. User not authenticated",
      });
    }

    // Validate required parameters
    if (!schoolId || !assignmentId) {
      return res.status(400).json({
        success: false,
        message: "schoolId and assignmentId are required",
      });
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID",
      });
    }

    // Find the school and check if user is the assignment teacher
    const school = await School.findOne({
      _id: schoolId,
      "assignments._id": assignmentId,
    });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School or assignment not found",
      });
    }

    // Find the specific assignment
    const assignment = school.assignments.find(
      (a) => a._id.toString() === assignmentId
    );

    // Verify user is the teacher of this assignment
    if (assignment.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this assignment",
      });
    }

    let updater = {};
    console.log(data?.classes);

    for (const key in data) {
      if (key === "classes") {
        updater[key] = data[key]?.map((classItm) =>
          classItm?.name?.toLowerCase()
        );
        console.log({ updater });
      } else if (key === "subject") {
        updater[key] = data[key]?._id;
      } else if (key === "date") {
        updater["expiry"] = data[key];
      } else {
        updater[key] = data[key];
      }
    }

    // Update the assignment status
    const updatedSchool = await School.findOneAndUpdate(
      { _id: schoolId, "assignments._id": assignmentId },
      { $set: { "assignments.$": updater } },
      { new: true }
    );

    // Find the updated assignment to return
    const updatedAssignment = updatedSchool.assignments.find(
      (a) => a._id.toString() === assignmentId
    );

    res.status(200).json({
      success: true,
      message: "Assignment status updated successfully",
      data: updatedAssignment,
    });
  } catch (error) {
    console.error("Error updating assignment:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating assignment",
      error: error.message,
    });
  }
});

router.patch("/assignment", auth, async (req, res) => {
  try {
    const { status, schoolId, assignmentId } = req.body;
    const userId = req.user?.userId;

    // Validate user authentication
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. User not authenticated",
      });
    }

    // Validate required parameters
    if (!schoolId || !assignmentId) {
      return res.status(400).json({
        success: false,
        message: "schoolId and assignmentId are required",
      });
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID",
      });
    }

    // Validate status
    const validStatuses = ["ongoing", "inactive"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be 'ongoing' or 'inactive'",
      });
    }

    // Find the school and check if user is the assignment teacher
    const school = await School.findOne({
      _id: schoolId,
      "assignments._id": assignmentId,
    });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School or assignment not found",
      });
    }

    // Find the specific assignment
    const assignment = school.assignments.find(
      (a) => a._id.toString() === assignmentId
    );

    // Verify user is the teacher of this assignment
    if (assignment.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this assignment",
      });
    }

    // Update the assignment status
    const updatedSchool = await School.findOneAndUpdate(
      { _id: schoolId, "assignments._id": assignmentId },
      { $set: { "assignments.$.status": status } },
      { new: true }
    );

    // Find the updated assignment to return
    const updatedAssignment = updatedSchool.assignments.find(
      (a) => a._id.toString() === assignmentId
    );

    res.status(200).json({
      success: true,
      message: "Assignment status updated successfully",
      data: {
        assignmentId: updatedAssignment._id,
        status: updatedAssignment.status,
        title: updatedAssignment.title,
      },
    });
  } catch (error) {
    console.error("Error updating assignment status:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating assignment status",
      error: error.message,
    });
  }
});

/**
 * GET /api/leaderboard/school
 * School-specific leaderboard for current user's school
 * Only shows verified students from the same school
 */
router.get("leaderboard", auth, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const {
      limit = 50,
      offset = 0,
      timeframe = "all-time", // 'all-time', 'weekly', 'monthly'
      sortBy = "totalPoints", // 'totalPoints', 'points', 'streak', 'schoolPoints'
      classLevel, // Optional: filter by specific class level
    } = req.query;

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Get current user's school
    const currentUser = await User.findById(currentUserId)
      .select("school class.level")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!currentUser.school) {
      return res.status(400).json({
        error: "No school affiliation",
        message:
          "You must be affiliated with a school to view school leaderboard",
      });
    }

    // Determine date filter
    let dateFilter = {};
    const now = new Date();

    switch (timeframe) {
      case "weekly":
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { "quota.weekly_update": { $gte: weekAgo } };
        break;
      case "monthly":
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateFilter = { "quota.last_update": { $gte: monthAgo } };
        break;
      case "all-time":
      default:
        dateFilter = {};
    }

    // Determine sort field
    let sortField = {};
    switch (sortBy) {
      case "points":
        sortField = { points: -1, totalPoints: -1 };
        break;
      case "streak":
        sortField = { streak: -1, totalPoints: -1 };
        break;
      case "schoolPoints":
        sortField = { schoolPoints: -1, totalPoints: -1 };
        break;
      case "totalPoints":
      default:
        sortField = { totalPoints: -1, points: -1 };
    }

    // Add class level filter if specified
    const classFilter = classLevel ? { "class.level": classLevel } : {};

    const schoolLeaderboardPipeline = [
      // Match students from the same school
      {
        $match: {
          accountType: "student",
          school: currentUser.school,
          ...dateFilter,
          ...classFilter,
        },
      },

      // Verify student is in school's student list
      {
        $lookup: {
          from: "schools",
          let: { userId: "$_id", schoolId: "$school" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$schoolId"] },
                    { $in: ["$$userId", "$students.user"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                type: 1,
                studentRecord: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$students",
                        as: "s",
                        cond: { $eq: ["$$s.user", "$$userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          ],
          as: "schoolData",
        },
      },

      // Transform school data
      {
        $addFields: {
          schoolInfo: {
            $cond: [
              { $gt: [{ $size: "$schoolData" }, 0] },
              {
                _id: { $arrayElemAt: ["$schoolData._id", 0] },
                name: { $arrayElemAt: ["$schoolData.name", 0] },
                type: { $arrayElemAt: ["$schoolData.type", 0] },
                verified: {
                  $arrayElemAt: ["$schoolData.studentRecord.verified", 0],
                },
              },
              null,
            ],
          },
        },
      },

      // Only verified students
      {
        $match: {
          "schoolInfo.verified": true,
        },
      },

      // Calculate additional stats
      {
        $addFields: {
          isCurrentUser: { $eq: ["$_id", currentUserObjectId] },
          followersCount: { $size: { $ifNull: ["$followers", []] } },
          followingCount: { $size: { $ifNull: ["$following", []] } },
        },
      },

      // Sort
      { $sort: { ...sortField, _id: 1 } },

      // Add rank
      {
        $setWindowFields: {
          sortBy: sortField,
          output: {
            schoolRank: {
              $rank: {},
            },
          },
        },
      },

      // Pagination
      { $skip: parseInt(offset) },
      { $limit: parseInt(limit) },

      // Project final fields
      {
        $project: {
          username: 1,
          firstName: 1,
          lastName: 1,
          avatar: 1,
          points: 1,
          totalPoints: 1,
          schoolPoints: 1,
          streak: 1,
          verified: 1,
          "class.level": 1,
          schoolRank: 1,
          isCurrentUser: 1,
          followersCount: 1,
          followingCount: 1,
          quizStats: {
            totalQuizzes: "$quizStats.totalQuizzes",
            totalWins: "$quizStats.totalWins",
            averageScore: "$quizStats.averageScore",
            accuracyRate: "$quizStats.accuracyRate",
          },
        },
      },
    ];

    const leaderboard = await User.aggregate(schoolLeaderboardPipeline);

    // Get current user's school rank
    const currentUserRankPipeline = [
      {
        $match: {
          accountType: "student",
          school: currentUser.school,
          ...dateFilter,
          ...classFilter,
        },
      },
      {
        $lookup: {
          from: "schools",
          let: { userId: "$_id", schoolId: "$school" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$schoolId"] },
                    { $in: ["$$userId", "$students.user"] },
                  ],
                },
              },
            },
            {
              $project: {
                studentRecord: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$students",
                        as: "s",
                        cond: { $eq: ["$$s.user", "$$userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          ],
          as: "schoolData",
        },
      },
      {
        $addFields: {
          isVerified: {
            $cond: [
              { $gt: [{ $size: "$schoolData" }, 0] },
              { $arrayElemAt: ["$schoolData.studentRecord.verified", 0] },
              false,
            ],
          },
        },
      },
      {
        $match: {
          isVerified: true,
        },
      },
      { $sort: { ...sortField, _id: 1 } },
      {
        $setWindowFields: {
          sortBy: sortField,
          output: {
            schoolRank: {
              $rank: {},
            },
          },
        },
      },
      {
        $match: {
          _id: currentUserObjectId,
        },
      },
      {
        $project: {
          schoolRank: 1,
          points: 1,
          totalPoints: 1,
          schoolPoints: 1,
          streak: 1,
        },
      },
    ];

    const currentUserRank = await User.aggregate(currentUserRankPipeline);

    // Get total count and school info
    const [totalResult, schoolInfo] = await Promise.all([
      User.aggregate([
        {
          $match: {
            accountType: "student",
            school: currentUser.school,
            ...dateFilter,
            ...classFilter,
          },
        },
        {
          $lookup: {
            from: "schools",
            let: { userId: "$_id", schoolId: "$school" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$_id", "$$schoolId"] },
                      { $in: ["$$userId", "$students.user"] },
                    ],
                  },
                },
              },
              {
                $project: {
                  studentRecord: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$students",
                          as: "s",
                          cond: { $eq: ["$$s.user", "$$userId"] },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            ],
            as: "schoolData",
          },
        },
        {
          $addFields: {
            isVerified: {
              $cond: [
                { $gt: [{ $size: "$schoolData" }, 0] },
                { $arrayElemAt: ["$schoolData.studentRecord.verified", 0] },
                false,
              ],
            },
          },
        },
        {
          $match: {
            isVerified: true,
          },
        },
        { $count: "total" },
      ]),
      School.findById(currentUser.school).select("name type state").lean(),
    ]);

    const totalUsers = totalResult.length > 0 ? totalResult[0].total : 0;

    return res.json({
      success: true,
      data: {
        leaderboard,
        school: schoolInfo,
        currentUser: currentUserRank.length > 0 ? currentUserRank[0] : null,
        pagination: {
          total: totalUsers,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + leaderboard.length < totalUsers,
        },
        filters: {
          timeframe,
          sortBy,
          classLevel: classLevel || null,
        },
      },
    });
  } catch (error) {
    console.error("School leaderboard error:", error);
    return res.status(500).json({
      error: "Failed to fetch school leaderboard",
      message: error.message,
    });
  }
});

/**
 * GET /api/leaderboard/school/:schoolId
 * View any school's leaderboard (public)
 */
router.get("leaderboard/:schoolId", auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const currentUserId = req.user.userId;
    const {
      limit = 50,
      offset = 0,
      sortBy = "totalPoints",
      classLevel,
    } = req.query;

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
    const schoolObjectId = new mongoose.Types.ObjectId(schoolId);

    // Verify school exists
    const school = await School.findById(schoolObjectId)
      .select("name type state")
      .lean();

    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    let sortField = {};
    switch (sortBy) {
      case "points":
        sortField = { points: -1, totalPoints: -1 };
        break;
      case "streak":
        sortField = { streak: -1, totalPoints: -1 };
        break;
      case "schoolPoints":
        sortField = { schoolPoints: -1, totalPoints: -1 };
        break;
      case "totalPoints":
      default:
        sortField = { totalPoints: -1, points: -1 };
    }

    const classFilter = classLevel ? { "class.level": classLevel } : {};

    const leaderboard = await User.aggregate([
      {
        $match: {
          accountType: "student",
          school: schoolObjectId,
          ...classFilter,
        },
      },
      {
        $lookup: {
          from: "schools",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", schoolObjectId] },
                    { $in: ["$$userId", "$students.user"] },
                  ],
                },
              },
            },
            {
              $project: {
                studentRecord: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$students",
                        as: "s",
                        cond: { $eq: ["$$s.user", "$$userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          ],
          as: "schoolData",
        },
      },
      {
        $addFields: {
          isVerified: {
            $cond: [
              { $gt: [{ $size: "$schoolData" }, 0] },
              { $arrayElemAt: ["$schoolData.studentRecord.verified", 0] },
              false,
            ],
          },
        },
      },
      {
        $match: {
          isVerified: true,
        },
      },
      {
        $addFields: {
          isCurrentUser: { $eq: ["$_id", currentUserObjectId] },
        },
      },
      { $sort: { ...sortField, _id: 1 } },
      {
        $setWindowFields: {
          sortBy: sortField,
          output: {
            rank: {
              $rank: {},
            },
          },
        },
      },
      { $skip: parseInt(offset) },
      { $limit: parseInt(limit) },
      {
        $project: {
          username: 1,
          firstName: 1,
          lastName: 1,
          avatar: 1,
          points: 1,
          totalPoints: 1,
          schoolPoints: 1,
          streak: 1,
          verified: 1,
          "class.level": 1,
          rank: 1,
          isCurrentUser: 1,
        },
      },
    ]);

    const totalResult = await User.aggregate([
      {
        $match: {
          accountType: "student",
          school: schoolObjectId,
          ...classFilter,
        },
      },
      {
        $lookup: {
          from: "schools",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", schoolObjectId] },
                    { $in: ["$$userId", "$students.user"] },
                  ],
                },
              },
            },
            {
              $project: {
                studentRecord: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$students",
                        as: "s",
                        cond: { $eq: ["$$s.user", "$$userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          ],
          as: "schoolData",
        },
      },
      {
        $addFields: {
          isVerified: {
            $cond: [
              { $gt: [{ $size: "$schoolData" }, 0] },
              { $arrayElemAt: ["$schoolData.studentRecord.verified", 0] },
              false,
            ],
          },
        },
      },
      {
        $match: {
          isVerified: true,
        },
      },
      { $count: "total" },
    ]);

    const totalUsers = totalResult.length > 0 ? totalResult[0].total : 0;

    return res.json({
      success: true,
      data: {
        leaderboard,
        school,
        pagination: {
          total: totalUsers,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + leaderboard.length < totalUsers,
        },
        filters: {
          sortBy,
          classLevel: classLevel || null,
        },
      },
    });
  } catch (error) {
    console.error("School leaderboard by ID error:", error);
    return res.status(500).json({
      error: "Failed to fetch school leaderboard",
      message: error.message,
    });
  }
});

module.exports = router;
