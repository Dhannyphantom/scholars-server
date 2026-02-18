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
  syncSchoolClassesWithStudents,
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
    "firstName lastName preffix",
  );
  const instanceInfo = await User.findById(instanceId).select(
    "firstName lastName expoPushToken preffix",
  );

  const school = await School.findOne({
    _id: schoolId,
    "teachers.user": userId,
  });

  const teacherData = school.teachers.find(
    (item) => item.user?.toString() == userId,
  );

  if (!teacherData?.verified) {
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });
  }

  let title, body;

  if (type === "accept") {
    if (instance == "teacher") {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has verified ${capFirstLetter(
        instanceInfo?.preffix,
      )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
        instanceInfo?.lastName,
      )} as a fellow colleaque`;

      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $set: {
            "teachers.$.verified": true,
          },
          $push: {
            announcements: {
              type: "system",
              message,
              visibility: "all",
            },
          },
        },
      );

      instanceInfo.verified = true;
      await instanceInfo.save();
      title = "Account Verified";
      body = message;
    } else if (instance === "student") {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has verified ${capFirstLetter(
        instanceInfo.firstName,
      )} ${capFirstLetter(instanceInfo?.lastName)} as a valid student`;
      await School.updateOne(
        { _id: schoolId, "students.user": instanceId },
        {
          $set: {
            "students.$.verified": true,
          },
          $push: {
            announcements: {
              type: "system",
              message,
              visibility: "all",
            },
          },
        },
      );
      instanceInfo.verified = true;
      await instanceInfo.save();
      title = "Account Verified";
      body = message;
    }
  } else if (type == "reject") {
    if (instance == "teacher") {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has rejected ${capFirstLetter(
        instanceInfo?.preffix,
      )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
        instanceInfo?.lastName,
      )} as a fellow colleaque`;
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $pull: {
            teachers: { user: instanceId },
          },
          $push: {
            announcements: {
              type: "system",
              message,
              visibility: "all",
            },
          },
        },
      );
      instanceInfo.verified = true;
      await instanceInfo.save();
      title = "Account Rejected";
      body = message;
    } else if (instance == "student") {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has rejected ${capFirstLetter(
        instanceInfo.firstName,
      )} ${capFirstLetter(instanceInfo?.lastName)} as a invalid student`;
      await School.updateOne(
        { _id: schoolId, "students.user": instanceId },
        {
          $pull: {
            students: { user: instanceId },
          },
          $push: {
            announcements: {
              type: "system",
              message,
              visibility: "all",
            },
          },
        },
      );
      instanceInfo.verified = false;
      await instanceInfo.save();
      title = "Account Rejected";
      body = message;
    }
  } else if (type == "unverify") {
    if (instance == "teacher") {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has un-verified ${capFirstLetter(
        instanceInfo?.preffix,
      )} ${capFirstLetter(instanceInfo.firstName)} ${capFirstLetter(
        instanceInfo?.lastName,
      )} as a fellow colleaque`;
      await School.updateOne(
        { _id: schoolId, "teachers.user": instanceId },
        {
          $set: {
            "teachers.$.verified": false,
          },
          $push: {
            announcements: {
              type: "system",
              message,
              visibility: "all",
            },
          },
        },
      );
      instanceInfo.verified = false;
      await instanceInfo.save();
      title = "Teacher Account Suspended";
      body = message;
    } else if (instance === "student") {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has un-verified ${capFirstLetter(
        instanceInfo.firstName,
      )} ${capFirstLetter(instanceInfo?.lastName)} as a student in probation`;

      await School.updateOne(
        { _id: schoolId, "students.user": instanceId },
        {
          $set: {
            "students.$.verified": false,
          },
          $push: {
            announcements: {
              type: "system",
              message,
              visibility: "all",
            },
          },
        },
      );
      instanceInfo.verified = false;
      await instanceInfo.save();
      title = "Student Account Suspended";
      body = message;
    }
  }

  res.send({ status: "success" });
  await expoNotifications([instanceInfo.expoPushToken], {
    title,
    message: body,
    data: {},
    // image: userInfo?.avatar?.image?.uri
  });
});

router.post("/join", auth, async (req, res) => {
  const userId = req.user.userId;
  const { schoolId } = req.body;

  const userInfo = await User.findById(userId).select(
    "accountType preffix firstName lastName username",
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

  let title, body;

  if (isTeacher) {
    // check if teacher has joined other schools
    const teachSchool = await School.findOne({
      _id: { $ne: schoolId },
      "teachers.user": userId,
    });

    if (teachSchool) {
      // remove teacher from other school previously joined
      teachSchool.teachers = teachSchool.teachers.filter(
        (item) => item?.user?.toString() != userId,
      );
      await teachSchool.save();
    }

    // Check if school already has this teacher
    const checker = school.teachers.findIndex(
      (item) => item?.user?.toString() == userId,
    );
    if (checker < 0) {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has requested to join ${
        school.name
      } as a teacher, you may verify or decline this request`;
      school.teachers.push({ user: userId });
      school.announcements.push({
        type: "system",
        message,
        visibility: "all",
      });
      await school.save();
      title = "New Teacher Join Request";
      body = message;
    }
  } else if (isStudent) {
    // check if student has joined other schools
    const stdSchool = await School.findOne({
      _id: { $ne: schoolId },
      "students.user": userId,
    });

    if (stdSchool) {
      stdSchool.students = stdSchool.students.filter(
        (item) => item?.user?.toString() != userId,
      );
      await stdSchool.save();
    }

    // Check if school already has this student
    const checker = school.students.findIndex(
      (item) => item?.user?.toString() == userId,
    );
    if (checker < 0) {
      const message = `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo.firstName,
      )} ${capFirstLetter(userInfo?.lastName)} has requested to join ${
        school.name
      } as a student, you may verify or decline this request`;
      school.students.push({ user: userId });
      school.announcements.push({
        type: "system",
        message,
        visibility: "all",
      });
      await school.save();
      title = "New Student Join Request";
      body = message;
    }
  }

  res.send({ status: "success" });
  const schoolObject = school.toObject();
  const verifiedTeachers = schoolObject.teachers
    .filter((teach) => teach.verified)
    .map((teach) => teach.user);
  const teachersArr = await User.findMany({ _id: { $in: verifiedTeachers } })
    .select("expoPushToken")
    .lean();
  const tokens = teachersArr.map((teach) => teach.expoPushToken);

  await expoNotifications(tokens, {
    title,
    message: body,
    data: {},
    // image: userInfo?.avatar?.image?.uri
  });
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

  await syncSchoolClassesWithStudents();

  res.send({ status: "success" });
});

router.post("/announcement", auth, async (req, res) => {
  const userId = req.user.userId;
  const { title, classes = [], schoolId } = req.body;

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
            classes: classes.map((c) => c.name?.toLowerCase()),
          },
        },
      },
    );

    res.send({ status: "success" });

    /**
     * 3. Fetch school (classes + teachers)
     */
    const school = await School.findById(schoolId)
      .select("classes teachers")
      .lean();

    if (!school) return;

    /**
     * 4. Collect students from ALL classes
     *    that match the selected levels
     */
    const studentIds = [];

    school.classes.forEach((cls) => {
      if (levels.includes(cls.level)) {
        studentIds.push(...cls.students);
      }
    });

    const uniqueStudentIds = [...new Set(studentIds.map(String))];

    /**
     * 5. Collect verified teachers
     */
    const verifiedTeacherIds = school.teachers
      .filter((t) => t.verified)
      .map((t) => t.user?.toString())
      .filter(Boolean);

    /**
     * 6. Fetch Expo push tokens
     */
    const usersToNotify = await User.find({
      _id: {
        $in: [...verifiedTeacherIds, ...uniqueStudentIds],
      },
      expoPushToken: { $exists: true, $ne: null },
    })
      .select("expoPushToken")
      .lean();

    const tokens = usersToNotify.map((u) => u.expoPushToken).filter(Boolean);

    if (!tokens.length) return;

    /**
     * 7. Send notification
     */
    await expoNotifications(tokens, {
      title: "School Announcement",
      message: title,
      data: {
        type: "announcement",
        schoolId,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send({
      status: "failed",
      message: error?.message ?? "Server error",
    });
  }
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
    "accountType schoolPoints",
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
        (item) => item?.correct == true,
      );
      if (correctAnswer?._id == question?.answered?._id) {
        point += question.point;
        total += question.point;
      } else {
        total += question.point;
        point -= 2;
        // setStat({ ...stat, point: statPoints });
      }
    });
  });

  if (type == "school") {
    const getQuiz = school.quiz?.find(
      (item) => item?._id?.toString() == quizId,
    );
    const checkUser = getQuiz.currentSubmissions.findIndex(
      (item) => item?.toString() == userId,
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
        (item) => item?._id?.toString() == getQuiz.currentSession?.toString(),
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
    (item) => item?._id?.toString() == quiz?._id,
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
    "accountType preffix firstName lastName",
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
          userInfo?.firstName,
        )} ${capFirstLetter(
          userInfo?.lastName,
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
      },
    );
  } else if (status === "inactive") {
    await School.updateOne(
      { _id: schoolId, "quiz._id": quizId },
      {
        $set: {
          "quiz.$.status": status,
          "quiz.$.class": schoolClass,
        },
      },
    );
  } else if (status === "review") {
    // Close quiz session
    // set quiz obj to false
    const quiz = school.quiz.find((item) => item._id === quizId);
    const session = quiz.sessions.find(
      (item) => item._id == quiz.currentSession,
    );

    school.announcements.push({
      teacher: userId,
      message: `${capFirstLetter(userInfo?.preffix)} ${capFirstLetter(
        userInfo?.firstName,
      )} ${capFirstLetter(
        userInfo?.lastName,
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
          "quiz.title quiz.date quiz.currentSession quiz.subject quiz._id quiz.status quiz.teacher",
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
            (usr) => usr?.toString() == userId,
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
          "quiz.title quiz.currentSession quiz.subject quiz.status quiz._id",
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
                  (participant.score / sess.total_score) * 100,
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
    },
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
        (item) => item.user?._id?.toString() == userId,
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
        (item) => item.user?._id?.toString() == userId,
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
      (item) => item.status == "ongoing",
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
    .select("assignments subscription teachers assignments classes");

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
        assignment.status === "ongoing",
    );

    // Group assignments by teacher
    const teacherMap = new Map();

    studentAssignments.forEach((assignment) => {
      const teacherId = assignment.teacher._id.toString();

      // Find student's submission for this assignment
      const userSubmission = assignment.submissions.find(
        (sub) => sub.student.toString() === userId,
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
    (a) => a._id.toString() === assignmentId,
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
    (a) => a._id.toString() === assignmentId,
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
    (sub) => sub.student?.toString() === user,
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
        submission.score?.value === null,
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
    (a) => a._id.toString() === assignmentId,
  );

  // Check if user has already submitted
  const existingSubmission = assignment.submissions.find(
    (sub) => sub.student.toString() === userId,
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
      (a) => a._id.toString() === assignmentId,
    );

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
      });
    }

    // Find the specific history entry
    const historyEntry = assignment.history.find(
      (h) => h._id.toString() === historyId,
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
      (a) => a._id.toString() === assignmentId,
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
      { new: true },
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
      (a) => a._id.toString() === assignmentId,
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
          classItm?.name?.toLowerCase(),
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
      { new: true },
    );

    // Find the updated assignment to return
    const updatedAssignment = updatedSchool.assignments.find(
      (a) => a._id.toString() === assignmentId,
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
      (a) => a._id.toString() === assignmentId,
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
      { new: true },
    );

    // Find the updated assignment to return
    const updatedAssignment = updatedSchool.assignments.find(
      (a) => a._id.toString() === assignmentId,
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

router.get("/leaderboard", auth, async (req, res) => {
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

    // Find which school the current user belongs to
    const userSchool = await School.findOne({
      "students.user": currentUserObjectId,
    })
      .select("_id name type state")
      .lean();

    if (!userSchool) {
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
          ...dateFilter,
          ...classFilter,
        },
      },

      // Verify student is in school's student list and get verification status
      {
        $lookup: {
          from: "schools",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", userSchool._id] },
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

      // Only verified students who are in this school
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
          sortBy:
            sortBy === "points"
              ? { points: -1 }
              : sortBy === "streak"
                ? { streak: -1 }
                : sortBy === "schoolPoints"
                  ? { schoolPoints: -1 }
                  : { totalPoints: -1 },
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
          ...dateFilter,
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
                    { $eq: ["$_id", userSchool._id] },
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
          sortBy:
            sortBy === "points"
              ? { points: -1 }
              : sortBy === "streak"
                ? { streak: -1 }
                : sortBy === "schoolPoints"
                  ? { schoolPoints: -1 }
                  : { totalPoints: -1 },
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

    // Get total count
    const totalResult = await User.aggregate([
      {
        $match: {
          accountType: "student",
          ...dateFilter,
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
                    { $eq: ["$_id", userSchool._id] },
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
        school: userSchool,
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
router.get("/leaderboard/:schoolId", auth, async (req, res) => {
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
          sortBy:
            sortBy === "points"
              ? { points: -1 }
              : sortBy === "streak"
                ? { streak: -1 }
                : sortBy === "schoolPoints"
                  ? { schoolPoints: -1 }
                  : { totalPoints: -1 },
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

// ==========================================
// FETCH ALL CLASSES FOR A SCHOOL
// ==========================================

/**
 * GET /api/school/:schoolId/classes
 * Fetch all classes for a specific school
 */
router.get("/:schoolId/classes", auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const userId = req.user.userId;

    await syncSchoolClassesWithStudents(schoolId);

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    const school = await School.findById(schoolId)
      .select("classes teachers students")
      .populate({
        path: "classes.students",
        select: "firstName lastName avatar class username email",
      })
      .populate({
        path: "classes.teachers",
        select: "firstName lastName avatar username email",
      });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Check if user is authorized (teacher, rep, or student of this school)
    // const user = await User.findById(userId);
    const isRep = school.rep?.toString() === userId;

    const isTeacher = school?.teachers?.some(
      (t) => t.user?.toString() === userId,
    );

    const isStudent = school?.students?.some(
      (s) => s.user?.toString() === userId,
    );

    if (!isRep && !isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this school's classes",
      });
    }

    res.json({
      success: true,
      data: {
        classes: school.classes || [],
        totalClasses: school.classes?.length || 0,
      },
    });
  } catch (error) {
    console.error("Fetch classes error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch classes",
      error: error.message,
    });
  }
});

// ==========================================
// FETCH SINGLE CLASS DETAILS
// ==========================================

/**
 * GET /api/school/:schoolId/classes/:classId
 * Fetch details for a specific class
 */
router.get("/:schoolId/classes/:classId", auth, async (req, res) => {
  try {
    const { schoolId, classId } = req.params;
    const userId = req.user.userId;

    if (
      !mongoose.Types.ObjectId.isValid(schoolId) ||
      !mongoose.Types.ObjectId.isValid(classId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID or class ID",
      });
    }

    const school = await School.findById(schoolId)
      .populate({
        path: "classes.students",
        select: "firstName lastName avatar username email accountType",
      })
      .populate({
        path: "classes.teachers",
        select: "firstName lastName avatar username email accountType",
      });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    const classData = school.classes.id(classId);

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: "Class not found",
      });
    }

    res.json({
      success: true,
      data: classData,
    });
  } catch (error) {
    console.error("Fetch class error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch class details",
      error: error.message,
    });
  }
});

// ==========================================
// CREATE NEW CLASS
// ==========================================

/**
 * POST /api/school/:schoolId/classes
 * Create a new class for a school
 */
router.post("/:schoolId/classes", auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const userId = req.user.userId;
    const { name, class: classLevel, type } = req.body;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Check if user is authorized (only rep or teachers can create classes)
    const isRep = school.rep?.toString() === userId;
    const isTeacher = school.teachers.some(
      (t) => t.user?.toString() === userId,
    );

    if (!isRep && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to create classes for this school",
      });
    }

    // Handle "all" type - create all class levels
    if (type === "all") {
      const allLevels = ["jss1", "jss2", "jss3", "sss1", "sss2", "sss3"];

      // Check which classes already exist
      const existingLevels = school.classes.map((c) => c.level);
      const newLevels = allLevels.filter(
        (level) => !existingLevels.includes(level),
      );

      if (newLevels.length === 0) {
        return res.status(400).json({
          success: false,
          message: "All class levels already exist",
        });
      }

      // Create all missing class levels
      newLevels.forEach((level) => {
        school.classes.push({
          level,
          alias: null,
          teachers: [],
          students: [],
        });
      });

      await school.save();

      return res.status(201).json({
        status: "success",
        success: true,
        message: `${newLevels.length} classes created successfully`,
        data: {
          classesCreated: newLevels.length,
          classes: school.classes,
        },
      });
    }

    // Handle single class creation
    if (!classLevel) {
      return res.status(400).json({
        success: false,
        message: "Class level is required",
      });
    }

    // Check if class already exists
    const existingClass = school.classes.find(
      (c) => c.alias?.toLowerCase() === name.toLowerCase(),
    );

    if (existingClass) {
      return res.status(400).json({
        success: false,
        message: `${classLevel.toUpperCase()} already exists`,
      });
    }

    // Create new class
    const newClass = {
      level: classLevel.toLowerCase(),
      alias: name || null,
      teachers: [],
      students: [],
    };

    school.classes.push(newClass);
    await school.save();

    // Get the newly created class
    const createdClass = school.classes[school.classes.length - 1];

    res.status(201).json({
      status: "success",
      success: true,
      message: "Class created successfully",
      data: createdClass,
    });
  } catch (error) {
    console.error("Create class error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create class",
      error: error.message,
    });
  }
});

// ==========================================
// UPDATE CLASS
// ==========================================

/**
 * PUT /api/school/:schoolId/classes/:classId
 * Update a class (alias, level, etc.)
 */
router.put("/:schoolId/classes/:classId", auth, async (req, res) => {
  try {
    const { schoolId, classId } = req.params;
    const userId = req.user.userId;
    const { alias, level } = req.body;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Check if user is authorized
    const isRep = school.rep?.toString() === userId;
    const isTeacher = school.teachers.some(
      (t) => t.user?.toString() === userId,
    );

    if (!isRep && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update classes for this school",
      });
    }

    const classData = school.classes.id(classId);

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: "Class not found",
      });
    }

    // Update alias if provided
    if (alias !== undefined) {
      classData.alias = alias.trim() || null;
    }

    // Update level if provided and different
    if (level && level !== classData.level) {
      // Check if new level already exists
      const levelExists = school.classes.some(
        (c) => c.level === level.toLowerCase() && c._id.toString() !== classId,
      );

      if (levelExists) {
        return res.status(400).json({
          success: false,
          message: `${level.toUpperCase()} already exists`,
        });
      }

      classData.level = level.toLowerCase();
    }

    await school.save();

    res.json({
      success: true,
      message: "Class updated successfully",
      data: classData,
    });
  } catch (error) {
    console.error("Update class error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update class",
      error: error.message,
    });
  }
});

// ==========================================
// DELETE CLASS
// ==========================================

/**
 * DELETE /api/school/:schoolId/classes/:classId
 * Delete a class from a school
 */
router.delete("/:schoolId/classes/:classId", auth, async (req, res) => {
  try {
    const { schoolId, classId } = req.params;
    const userId = req.user.userId;

    if (
      !mongoose.Types.ObjectId.isValid(schoolId) ||
      !mongoose.Types.ObjectId.isValid(classId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID",
      });
    }

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Only rep can delete classes
    if (school.rep?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Only school representative can delete classes",
      });
    }

    const classExists = school.classes.some(
      (c) => c._id.toString() === classId,
    );

    if (!classExists) {
      return res.status(404).json({
        success: false,
        message: "Class not found",
      });
    }

    // ✅ Proper subdocument removal
    school.classes = school.classes.filter((c) => c._id.toString() !== classId);

    await school.save();

    res.json({
      success: true,
      message: "Class deleted successfully",
    });
  } catch (error) {
    console.error("Delete class error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete class",
      error: error.message,
    });
  }
});

// ==========================================
// ADD STUDENT TO CLASS
// ==========================================

/**
 * POST /api/school/:schoolId/classes/:classId/students
 * Add a student to a class
 */
router.post("/:schoolId/classes/:classId/students", auth, async (req, res) => {
  try {
    const { schoolId, classId } = req.params;
    const userId = req.user.userId;
    const { studentId } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(schoolId) ||
      !mongoose.Types.ObjectId.isValid(studentId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID",
      });
    }

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Check authorization
    const isRep = school.rep?.toString() === userId;
    const isTeacher = school.teachers.some(
      (t) => t.user?.toString() === userId,
    );

    if (!isRep && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const classData = school.classes.id(classId);

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: "Class not found",
      });
    }

    // Check if student already in class
    const alreadyInClass = classData.students.some(
      (s) => s.toString() === studentId,
    );

    if (alreadyInClass) {
      return res.status(400).json({
        success: false,
        message: "Student already in this class",
      });
    }

    classData.students.push(studentId);
    await school.save();

    res.json({
      success: true,
      message: "Student added to class successfully",
      data: classData,
    });
  } catch (error) {
    console.error("Add student error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add student",
      error: error.message,
    });
  }
});

// ==========================================
// REMOVE STUDENT FROM CLASS
// ==========================================

/**
 * DELETE /api/school/:schoolId/classes/:classId/students/:studentId
 * Remove a student from a class
 */
router.delete(
  "/:schoolId/classes/:classId/students/:studentId",
  auth,
  async (req, res) => {
    try {
      const { schoolId, classId, studentId } = req.params;
      const userId = req.user.userId;

      const school = await School.findById(schoolId);

      if (!school) {
        return res.status(404).json({
          success: false,
          message: "School not found",
        });
      }

      // Check authorization
      const isRep = school.rep?.toString() === userId;
      const isTeacher = school.teachers.some(
        (t) => t.user?.toString() === userId,
      );

      if (!isRep && !isTeacher) {
        return res.status(403).json({
          success: false,
          message: "Not authorized",
        });
      }

      const classData = school.classes.id(classId);

      if (!classData) {
        return res.status(404).json({
          success: false,
          message: "Class not found",
        });
      }

      // Remove student
      classData.students = classData.students.filter(
        (s) => s.toString() !== studentId,
      );

      await school.save();

      res.json({
        success: true,
        message: "Student removed from class successfully",
      });
    } catch (error) {
      console.error("Remove student error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove student",
        error: error.message,
      });
    }
  },
);

// ==========================================
// ADD TEACHER TO CLASS
// ==========================================

/**
 * POST /api/school/:schoolId/classes/:classId/teachers
 * Add a teacher to a class
 */
router.post("/:schoolId/classes/:classId/teachers", auth, async (req, res) => {
  try {
    const { schoolId, classId } = req.params;
    const userId = req.user.userId;
    const { teacherId } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(schoolId) ||
      !mongoose.Types.ObjectId.isValid(teacherId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID",
      });
    }

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Only rep can add teachers to classes
    const isRep = school.rep?.toString() === userId;

    if (!isRep) {
      return res.status(403).json({
        success: false,
        message: "Only school representative can add teachers to classes",
      });
    }

    const classData = school.classes.id(classId);

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: "Class not found",
      });
    }

    // Check if teacher already in class
    const alreadyInClass = classData.teachers.some(
      (t) => t.toString() === teacherId,
    );

    if (alreadyInClass) {
      return res.status(400).json({
        success: false,
        message: "Teacher already assigned to this class",
      });
    }

    classData.teachers.push(teacherId);
    await school.save();

    res.json({
      success: true,
      message: "Teacher added to class successfully",
      data: classData,
    });
  } catch (error) {
    console.error("Add teacher error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add teacher",
      error: error.message,
    });
  }
});

// ==========================================
// REMOVE TEACHER FROM CLASS
// ==========================================

/**
 * DELETE /api/school/:schoolId/classes/:classId/teachers/:teacherId
 * Remove a teacher from a class
 */
router.delete(
  "/:schoolId/classes/:classId/teachers/:teacherId",
  auth,
  async (req, res) => {
    try {
      const { schoolId, classId, teacherId } = req.params;
      const userId = req.user.userId;

      const school = await School.findById(schoolId);

      if (!school) {
        return res.status(404).json({
          success: false,
          message: "School not found",
        });
      }

      // Only rep can remove teachers from classes
      const isRep = school.rep?.toString() === userId;

      if (!isRep) {
        return res.status(403).json({
          success: false,
          message:
            "Only school representative can remove teachers from classes",
        });
      }

      const classData = school.classes.id(classId);

      if (!classData) {
        return res.status(404).json({
          success: false,
          message: "Class not found",
        });
      }

      // Remove teacher
      classData.teachers = classData.teachers.filter(
        (t) => t.toString() !== teacherId,
      );

      await school.save();

      res.json({
        success: true,
        message: "Teacher removed from class successfully",
      });
    } catch (error) {
      console.error("Remove teacher error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove teacher",
        error: error.message,
      });
    }
  },
);

// ==========================================
// TRANSFER STUDENT(S) TO HIGHER CLASS
// ==========================================

/**
 * POST /api/school/:schoolId/classes/:classId/upgrade
 * Upgrade a single student or all students to a higher class level
 * Body: { studentId?: string, targetLevel: string, upgradeAll?: boolean }
 */
router.post("/:schoolId/classes/:classId/transfer", auth, async (req, res) => {
  try {
    const { schoolId, classId } = req.params;
    const userId = req.user.userId;
    const { studentId, targetLevelId, upgradeAll } = req.body;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid school ID",
      });
    }

    if (!targetLevelId) {
      return res.status(400).json({
        success: false,
        message: "Target level is required",
      });
    }

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Check authorization
    const isRep = school.rep?.toString() === userId;
    const isTeacher = school.teachers.some(
      (t) => t.user?.toString() === userId,
    );

    if (!isRep && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to transfer students",
      });
    }

    const sourceClass = school.classes.id(classId);

    if (!sourceClass) {
      return res.status(404).json({
        success: false,
        message: "Source class not found",
      });
    }

    // Find target class
    const targetClass = school.classes.find(
      (c) => c._id?.toString() === targetLevelId,
    );

    if (!targetClass) {
      return res.status(404).json({
        success: false,
        message:
          "Transfer class not found. Please create the transfer class first.",
      });
    }

    // Validate that target level is higher than source level
    // const classLevels = ["jss1", "jss2", "jss3", "sss1", "sss2", "sss3"];
    // const sourceIndex = classLevels.indexOf(sourceClass.level);
    // const targetIndex = classLevels.indexOf(targetLevel.toLowerCase());

    // if (targetIndex <= sourceIndex) {
    //   return res.status(400).json({
    //     success: false,
    //     message:
    //       "Target level must be higher than current level. Use downgrade for lower levels.",
    //   });
    // }

    let studentsToUpgrade = [];
    let upgradeCount = 0;

    if (upgradeAll) {
      // Upgrade all students
      studentsToUpgrade = [...sourceClass.students];
      upgradeCount = studentsToUpgrade.length;

      if (upgradeCount === 0) {
        return res.status(400).json({
          success: false,
          message: "No students to transfer in this class",
        });
      }

      // Add all students to target class
      studentsToUpgrade.forEach((student) => {
        if (
          !targetClass.students.some((s) => s.toString() === student.toString())
        ) {
          targetClass.students.push(student);
        }
      });

      // Remove all students from source class
      sourceClass.students = [];
    } else {
      // Upgrade single student
      if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
        return res.status(400).json({
          success: false,
          message: "Valid student ID is required",
        });
      }

      const studentIndex = sourceClass.students.findIndex(
        (s) => s.toString() === studentId,
      );

      if (studentIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Student not found in this class",
        });
      }

      // Check if student already in target class
      const alreadyInTarget = targetClass.students.some(
        (s) => s.toString() === studentId,
      );

      if (alreadyInTarget) {
        return res.status(400).json({
          success: false,
          message: "Student is already in the target class",
        });
      }

      // Move student
      targetClass.students.push(studentId);
      sourceClass.students.splice(studentIndex, 1);
      upgradeCount = 1;
    }

    // Update student's class level in User model
    if (upgradeAll) {
      await User.updateMany(
        { _id: { $in: studentsToUpgrade } },
        { $set: { "class.level": targetClass?.level.toLowerCase() } },
      );
    } else {
      await User.findByIdAndUpdate(studentId, {
        $set: { "class.level": targetClass?.level.toLowerCase() },
      });
    }

    await school.save();

    res.json({
      success: true,
      message: `Successfully transferred ${upgradeCount} student${upgradeCount > 1 ? "s" : ""} from ${sourceClass.level.toUpperCase()} to ${targetClass?.level.toUpperCase()}(${targetClass?.alias})`,
      data: {
        studentsUpgraded: upgradeCount,
        sourceClass: {
          id: sourceClass._id,
          level: sourceClass.level,
          remainingStudents: sourceClass.students.length,
        },
        targetClass: {
          id: targetClass._id,
          level: targetClass.level,
          totalStudents: targetClass.students.length,
        },
      },
    });
  } catch (error) {
    console.error("Upgrade students error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upgrade students",
      error: error.message,
    });
  }
});

router.post("/:id/class-shift", auth, async (req, res) => {
  const { action } = req.body;

  if (!["upgrade", "downgrade"].includes(action))
    return res.status(400).send({
      success: false,
      message: "Invalid action. Must be 'upgrade' or 'downgrade'.",
    });

  try {
    const school = await School.findById(req.params.id);

    if (!school)
      return res
        .status(404)
        .send({ success: false, message: "School not found" });

    const CLASS_ORDER = ["jss 1", "jss 2", "jss 3", "sss 1", "sss 2", "sss 3"];

    const getStudentDocs = async (studentIds) => {
      if (!studentIds.length) return [];
      return await User.find(
        { _id: { $in: studentIds } },
        "_id firstName lastName",
      );
    };

    const updateUserClass = async (studentIds, newLevel) => {
      if (!studentIds.length) return;

      if (newLevel) {
        const targetClass = school.classes.find((c) => c.level === newLevel);
        await User.updateMany(
          { _id: { $in: studentIds } },
          {
            $set: {
              "class.level": newLevel,
              "class.id": targetClass?._id ?? null,
              "class.hasChanged": true,
              school: school._id,
            },
          },
        );
      } else {
        await User.updateMany(
          { _id: { $in: studentIds } },
          {
            $unset: {
              "class.level": "",
              "class.alias": "",
              "class.id": "",
              school: "",
            },
            $set: {
              "class.hasChanged": false,
            },
          },
        );
      }
    };

    const removeFromSchoolStudents = (school, studentIds) => {
      const idStrings = studentIds.map((id) => id.toString());
      school.students = school.students.filter(
        (s) => !idStrings.includes(s.user.toString()),
      );
    };

    // Returns only studentIds not already in any alumni entry
    const filterAlreadyInAlumni = (studentIds) => {
      const existingAlumniUserIds = new Set(
        school.alumni.flatMap((entry) =>
          entry.students.map((s) => s.user.toString()),
        ),
      );
      return studentIds.filter(
        (id) => !existingAlumniUserIds.has(id.toString()),
      );
    };

    const pushToAlumni = async (studentIds, type, fromClass) => {
      const newStudentIds = filterAlreadyInAlumni(studentIds);
      if (!newStudentIds.length) return;

      const studentDocs = await getStudentDocs(newStudentIds);

      school.alumni.push({
        type,
        fromClass,
        students: studentDocs.map((s) => ({
          user: s._id,
          name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
        })),
      });

      removeFromSchoolStudents(school, newStudentIds);
      await updateUserClass(newStudentIds, null);
    };

    if (action === "upgrade") {
      for (let i = CLASS_ORDER.length - 1; i >= 0; i--) {
        const level = CLASS_ORDER[i];
        const currentClass = school.classes.find((c) => c.level === level);
        if (!currentClass || !currentClass.students.length) continue;

        const studentIds = [...currentClass.students];

        if (level === "sss 3") {
          await pushToAlumni(studentIds, "graduated", level);
          currentClass.students = [];
          continue;
        }

        const nextLevel = CLASS_ORDER[i + 1];
        const nextClass = school.classes.find((c) => c.level === nextLevel);
        if (!nextClass) continue;

        nextClass.students.push(...studentIds);
        await updateUserClass(studentIds, nextLevel);
        currentClass.students = [];
      }
    }

    if (action === "downgrade") {
      for (let i = 0; i < CLASS_ORDER.length; i++) {
        const level = CLASS_ORDER[i];
        const currentClass = school.classes.find((c) => c.level === level);
        if (!currentClass || !currentClass.students.length) continue;

        const studentIds = [...currentClass.students];

        if (level === "jss 1") {
          await pushToAlumni(studentIds, "downgraded", level);
          currentClass.students = [];
          continue;
        }

        const prevLevel = CLASS_ORDER[i - 1];
        const prevClass = school.classes.find((c) => c.level === prevLevel);
        if (!prevClass) continue;

        prevClass.students.push(...studentIds);
        await updateUserClass(studentIds, prevLevel);
        currentClass.students = [];
      }
    }

    await school.save();
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: "Server error during class shift",
      error: err.message,
    });
  }

  res.send({
    success: true,
    message: `Classes successfully ${action}d and synced`,
  });
});

module.exports = router;
