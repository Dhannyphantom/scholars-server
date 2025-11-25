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

  const userInfo = await User.findById(userId).select("accountType");
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

router.post("/assignment", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  const { classes, title, question, subject, date, schoolId } = data;

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
  });

  await school.save();

  res.send({ status: "success" });
});

router.post("/announcement", auth, async (req, res) => {
  const userId = req.user.userId;
  const data = req.body;
  const { title, classes, schoolId } = data;

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

  const userInfo = await User.findById(userId).select("accountType");
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
    ])
    .select("assignments classes");
  if (!school)
    return res
      .status(422)
      .send({ status: "failed", message: "School not found" });

  let data;
  if (userInfo.accountType == "teacher") {
    data = school.assignments
      .filter((item) => item.teacher.toString() == userId)
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
          total: len,
          submissionsCount: item?.submissions?.length,
        };
      });
  }

  res.send({ status: "success", data });
});

module.exports = router;
