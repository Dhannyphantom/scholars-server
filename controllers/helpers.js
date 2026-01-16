const _NET = process.env.NET_DEV;
// const image_exts = ["jpg", "jpeg", "png", "gif"];
const fs = require("fs");
const path = require("path");
const expoNotifications = require("./expoNotifications");

const ADDRESS = process.env.ADDRESS;
const PORT = process.env.PORT;
const GT_VALUE = 1000;

const classsSchoolEnums = [
  "jss 1",
  "jss 2",
  "jss 3",
  "sss 1",
  "sss 2",
  "sss 3",
  "grad",
];
const userSelector =
  "avatar firstName lastName username class gender preffix state lga points rank verified accountType";
const fullUserSelector = "-password -__v";

const A_DAY = 1000 * 60 * 60 * 24; // A DAY
const A_WEEK = 1000 * 60 * 60 * 24 * 7; // A WEEK

const getUploadUri = (images, bucketName) => {
  let imgUri, thumbUri;

  if (Array.isArray(images)) {
    //   an array of images
    if (_NET === "offline") {
      const imgUris = images.map((obj) => {
        return {
          ...obj,
          uri: `${
            ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + obj.uri
          }`,
          key: obj.uri,
          assetId: obj.assetId ?? obj.uri,
          type: obj.type ?? "image/jpg",
          thumb: `${
            ADDRESS +
            ":" +
            PORT +
            "/uploads/thumbs" +
            "/" +
            (obj.thumb ? obj.thumb : obj.uri)
          }`,
        };
      });

      return imgUris;
    } else if (_NET === "online") {
      return images;
    }
  } else {
    // Single upload
    if (_NET === "offline") {
      let thumber;

      thumber = images?.thumb ?? images.uri;

      imgUri = `${
        ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + images.uri
      }`;
      thumbUri = `${ADDRESS + ":" + PORT + "/uploads/thumbs" + "/" + thumber}`;
    } else {
      imgUri = images.uri;
      thumbUri = images.thumb;
    }

    return {
      uri: imgUri,
      type: images.type,
      thumb: thumbUri,
      width: images.width,
      height: images.height,
    };
  }
};

const capFirstLetter = (str) => {
  if (!str) return null;
  return str[0].toUpperCase() + str.slice(1);
};

const writeToJSONConsole = (data) => {
  if (!data) return;

  // Convert to JSON string
  const jsonString = JSON.stringify(data, null, 2); // Pretty-printed JSON

  // Write JSON data to a file
  fs.writeFile("console.json", jsonString, (err) => {
    if (err) {
      console.error("Error writing JSON to file:", err);
    } else {
      console.log("JSON data saved to data.json");
    }
  });
};

const getUserPoint = (point) => {
  return Math.max(0, point);
};

const capCapitalize = (str) => {
  let capitalized = capFirstLetter(str);
  for (let i = 0; i < str.length; i++) {
    const letter = capitalized[i];
    if (letter === " " && capitalized[i + 1]) {
      capitalized =
        capitalized.slice(0, i + 1) +
        capitalized[i + 1].toUpperCase() +
        capitalized.slice(i + 2);
    }
  }
  return capitalized;
};

const createDir = (path) => {
  let obj = null;
  fs.access(path, (error) => {
    // To check if the given directory
    // already exists or not
    if (error) {
      // If current directory does not exist
      // then create it
      fs.mkdirSync(path, { recursive: true });
      // fs.mkdirSync(path, (error) => {
      //   if (error) {
      //     obj = { error, path: null };
      //     console.log("Path Error", error);
      //   } else {
      //     obj = { path, error: null };
      //   }
      // });
    }
  });

  return obj;
};

const ensureDirectory = (dir) => {
  console.log({ dir });
  if (!fs.existsSync(dir)) {
    console.log("Does not exist");
    fs.mkdir(dir, { recursive: true });
  } else {
    console.log("Exists");
  }
};

const getCurrencyAmount = (number) => {
  if (number && typeof number == "number") {
    return `₦${Number(number).toLocaleString()}`;
  } else {
    return null;
  }
};

const formatPoints = (number) => {
  // if (number && typeof number == "number") {
  return `${number} GT`;
  // return `${Number(number).toLocaleString()} TK`;
  // } else {
  //   return null;
  // }
};

const calculatePointsAmount = (value) => {
  // reverse is false, value = "points"
  // reverse is true, value = "amount"
  // N1 = 1000 GT;
  // x = points;
  const amount = (value / GT_VALUE).toPrecision(2);
  const pointsVal = Math.floor(value * GT_VALUE);
  return {
    amount,
    format: getCurrencyAmount(Number(amount)),
    point: pointsVal,
    pointFormat: formatPoints(pointsVal),
  };
};

const getClasses = () => {
  return classsSchoolEnums.map((item) => ({ level: item, alias: "Class" }));
};

module.exports.sendPushInBatches = async (
  userFilter,
  { title, message, image }
) => {
  const cursor = User.find(userFilter)
    .select("_id expoPushToken")
    .lean()
    .cursor();

  let batch = [];

  for await (const user of cursor) {
    if (user.expoPushToken) {
      batch.push(user.expoPushToken);
    }

    if (batch.length === 100) {
      await expoNotifications(batch, { title, message, image });
      batch = [];
    }
  }

  if (batch.length) {
    await expoNotifications(batch, { title, message, image });
  }
};

module.exports.checkUserSub = async (userInfo) => {
  console.log("eh");
  const today = new Date();
  const expiryDate = new Date(userInfo?.subscription?.expiry);
  console.log({ today, expiryDate });

  if (expiryDate < today && userInfo?.subscription?.isActive) {
    // subscription expired
    userInfo.subscription.isActive = false;
    await userInfo.save();
    console.log("SUb Updated!!!");
  }
};

const reconcileSchool = async (school) => {
  // CHECK AND UPDATE ASSIGNMENT SUBMISSINOS;
  try {
    const schoolObj = school?.toObject();
    const today = new Date();
    school.assignments = schoolObj.assignments.map((assignment) => {
      if (
        today > new Date(assignment?.expiry) &&
        assignment?.status === "ongoing"
      ) {
        return {
          ...assignment,
          status: "finished",
        };
      } else {
        return assignment;
      }
    });

    await school.save();
  } catch (errr) {
    console.log("Reconcile school Err: ", errr);
  }
};

module.exports.getFullName = (user, usernameFallback) => {
  if (user?.firstName && user?.lastName) {
    return `${user?.firstName} ${user?.lastName}`;
  } else if (usernameFallback) {
    return user?.username;
  } else {
    return null;
  }
};

const getGrade = (score) => {
  let grade = "";
  if (score >= 95) {
    grade = "A+";
  } else if (score >= 70 && score < 95) {
    grade = "A";
  } else if (score >= 60 && score < 70) {
    grade = "B";
  } else if (score >= 50 && score < 60) {
    grade = "C";
  } else if (score >= 40 && score < 50) {
    grade = "D";
  } else if (score >= 30 && score < 40) {
    grade = "E";
  } else if (score < 30) {
    grade = "F";
  }
  return {
    value: score,
    grade,
  };
};

/**
 * Check if user has exceeded daily limits
 * @param {Object} userInfo - User document
 * @param {Array} newQuestions - Questions to be submitted
 * @returns {Object} - { allowed: boolean, message: string, remaining: number }
 */
const checkDailyLimits = (userInfo, newQuestions) => {
  const A_DAY = 1000 * 60 * 60 * 24;
  const MAX_DAILY_QUESTIONS = 100;
  const MAX_QUESTIONS_PER_SUBJECT = 50;
  const MAX_DAILY_SUBJECTS = 2;

  const currentQuota = userInfo.quota;

  // Check if quota exists and if it's still the same day
  const isToday =
    currentQuota && new Date() - new Date(currentQuota.daily_update) < A_DAY;

  let dailyQuestionsCount = isToday
    ? currentQuota.daily_questions_count || 0
    : 0;
  let dailySubjects = isToday ? currentQuota.daily_subjects || [] : [];

  // Count new questions
  const newQuestionsCount = newQuestions.reduce(
    (total, subj) => total + subj.questions.length,
    0
  );

  // Check total daily limit
  if (dailyQuestionsCount + newQuestionsCount > MAX_DAILY_QUESTIONS) {
    return {
      allowed: false,
      message: `Daily limit exceeded. You can only answer ${MAX_DAILY_QUESTIONS} questions per day. Remaining: ${
        MAX_DAILY_QUESTIONS - dailyQuestionsCount
      }`,
      remaining: MAX_DAILY_QUESTIONS - dailyQuestionsCount,
      dailyQuestionsCount,
    };
  }

  // Check subject limits
  const subjectCounts = new Map(
    dailySubjects.map((s) => [s.subject.toString(), s.questions_count])
  );

  for (const subj of newQuestions) {
    const subjId = subj.subject._id.toString();
    const currentCount = subjectCounts.get(subjId) || 0;
    const newCount = subj.questions.length;

    if (currentCount + newCount > MAX_QUESTIONS_PER_SUBJECT) {
      return {
        allowed: false,
        message: `Subject limit exceeded. You can only answer ${MAX_QUESTIONS_PER_SUBJECT} questions per subject per day. Remaining for this subject: ${
          MAX_QUESTIONS_PER_SUBJECT - currentCount
        }`,
        remaining: MAX_QUESTIONS_PER_SUBJECT - currentCount,
        dailyQuestionsCount,
      };
    }

    subjectCounts.set(subjId, currentCount + newCount);
  }

  // Check maximum subjects per day (2 subjects)
  const uniqueNewSubjects = new Set(
    newQuestions.map((s) => s.subject._id.toString())
  );
  const existingSubjects = new Set(
    dailySubjects.map((s) => s.subject.toString())
  );

  uniqueNewSubjects.forEach((s) => existingSubjects.add(s));

  if (existingSubjects.size > MAX_DAILY_SUBJECTS) {
    return {
      allowed: false,
      message: `You can only practice ${MAX_DAILY_SUBJECTS} subjects per day.`,
      remaining: 0,
      dailyQuestionsCount,
    };
  }

  return {
    allowed: true,
    message: "Limits check passed",
    remaining: MAX_DAILY_QUESTIONS - dailyQuestionsCount,
    dailyQuestionsCount,
  };
};

/**
 * Calculate points based on qBank (award full points for new, 0.2 for repeated)
 * @param {Array} questions - Questions array
 * @param {Array} userQBank - User's question bank (answered questions)
 * @param {Object} appInfo - App configuration
 * @returns {Object} - { totalPoints, newQuestions, answeredQuestions }
 */
const calculatePoints = (questions, userQBank, appInfo) => {
  const REPEATED_QUESTION_POINTS = 0.2;
  let totalPoints = 0;
  const newQuestionIds = [];
  const answeredQuestionIds = [];
  const qBankSet = new Set(userQBank.map((q) => q.toString()));

  questions.forEach((quest) => {
    quest.questions.forEach((question) => {
      const questionId = question._id.toString();
      const isNewQuestion = !qBankSet.has(questionId);

      if (question.answered?.correct) {
        if (isNewQuestion) {
          // Award full points for new correct answers
          totalPoints += question.point;
          newQuestionIds.push(question._id);
        } else {
          // Award 0.2 points for repeated correct answers
          totalPoints += REPEATED_QUESTION_POINTS;
          answeredQuestionIds.push(question._id);
        }
      } else {
        // Wrong answer - deduct points regardless
        totalPoints -= appInfo.POINT_FAIL;
        if (isNewQuestion) {
          newQuestionIds.push(question._id);
        } else {
          answeredQuestionIds.push(question._id);
        }
      }
    });
  });

  return {
    totalPoints: Math.max(0, totalPoints), // Don't go below 0
    newQuestionIds,
    answeredQuestionIds,
    newQuestionsCount: newQuestionIds.length,
    repeatedQuestionsCount: answeredQuestionIds.length,
  };
};

module.exports = {
  formatPoints,
  calculatePointsAmount,
  getCurrencyAmount,
  classsSchoolEnums,
  getGrade,
  updateUserQuota,
  getUploadUri,
  checkDailyLimits,
  calculatePoints,
  getUserPoint,
  reconcileSchool,
  getClasses,
  userSelector,
  ensureDirectory,
  fullUserSelector,
  writeToJSONConsole,
  capFirstLetter,
  createDir,
  capCapitalize,
};
