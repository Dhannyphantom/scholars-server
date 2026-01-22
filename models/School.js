const mongoose = require("mongoose");
const Joi = require("joi");
const { txHistorySchema } = require("./User");

const schema = mongoose.Schema;

const classsSchoolEnums = [
  "jss 1",
  "jss 2",
  "jss 3",
  "sss 1",
  "sss 2",
  "sss 3",
];
const DEFAULT_SUB_MILLI = 1000 * 60 * 60 * 24 * 2; // 2 DAYS

const classSchema = new schema({
  alias: {
    type: String,
    required: false,
  },
  level: {
    type: String,
    required: true,
    lowercase: true,
    enum: classsSchoolEnums,
  },
  teachers: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  students: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
});

const submissionSchema = new schema({
  student: {
    type: schema.Types.ObjectId,
    ref: "User",
    requied: true,
  },
  score: {
    // title: {
    //   type: String,
    //   maxlength: 50,
    // },
    grade: {
      type: String,
      maxlength: 3,
    },
    value: {
      type: Number,
      default: 0,
      max: 100,
    },
  },
  solution: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const answerSchema = new schema({
  name: {
    type: String,
    required: true,
  },
  correct: {
    type: Boolean,
    default: false,
  },
});

const quizQuestionsSchema = new schema({
  question: {
    type: String,
    required: true,
    trim: true,
  },
  answers: [answerSchema],

  point: {
    type: Number,
    default: 40,
  },

  timer: {
    type: Number,
    default: 40,
  },
});

const quizSessionSchema = new schema({
  subject: {
    _id: {
      type: schema.Types.ObjectId,
      ref: "Subject",
    },
    name: {
      type: String,
      required: false,
    },
  },
  teacher: {
    type: schema.Types.ObjectId,
    ref: "User",
  },
  questions: [quizQuestionsSchema],
});

const participantsSchema = new schema({
  student: {
    type: schema.Types.ObjectId,
    ref: "User",
  },
  score: {
    type: Number,
    default: 0,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  quiz: {
    type: [quizSessionSchema],
  },
});

const sessionSchema = new schema({
  date: {
    type: Date,
    default: Date.now,
  },
  participants: [participantsSchema],
  average_score: {
    type: Number,
    default: 0,
  },
  ended: {
    type: Boolean,
    default: false,
  },
  total_score: {
    type: Number,
    default: 0,
  },
});

const quizSchema = new schema({
  status: {
    type: String,
    enum: ["active", "review", "inactive", "result"],
    default: "inactive",
  },
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
    required: true,
  },
  title: {
    type: String,
    maxlength: 100,
    required: true,
  },
  questions: [quizQuestionsSchema],
  currentSession: {
    type: schema.Types.ObjectId,
  },
  currentSubmissions: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  teacher: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  class: {
    type: String,
    required: false,
    lowercase: true,
    enum: classsSchoolEnums,
  },
  sessions: [sessionSchema],
});

const announcementSchema = new schema({
  teacher: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  message: {
    type: String,
    maxlength: 180,
    required: true,
  },
  type: {
    type: String,
    enum: ["system", "school", "important", "alert"],
    default: "school",
  },
  reads: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  hides: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  date: {
    type: Date,
    default: Date.now,
  },
  classes: {
    type: [String],
    lowercase: true,
    enum: classsSchoolEnums,
  },
  visibility: {
    type: String,
    enum: ["class", "teacher", "all"],
    default: "all",
  },
});

const historySchema = new schema({
  participants: [submissionSchema],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const assignmentSchema = new schema({
  classes: {
    type: [String],
    enum: classsSchoolEnums,
    lowercase: true,
  },
  question: {
    type: String,
    required: true,
  },
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
    required: true,
  },
  title: {
    type: String,
    required: true,
    maxlength: 100,
  },
  status: {
    type: String,
    enum: ["ongoing", "finished", "inactive"],
    default: "ongoing",
  },
  date: {
    type: Date,
    default: Date.now,
  },
  expiry: {
    type: Date,
    required: false,
  },
  teacher: {
    type: schema.Types.ObjectId,
    ref: "User",
  },
  submissions: [submissionSchema],
  history: [historySchema],
});

const userSchema = new schema({
  verified: {
    type: Boolean,
    default: false,
  },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

const schLevelSchema = new schema({
  name: {
    type: String,
  },
});

const SchoolSchema = new schema({
  announcements: [announcementSchema],
  assignments: [assignmentSchema],
  classes: [classSchema],
  country: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  contact: {
    type: String,
    minlength: 4,
    maxlength: 15,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lga: {
    type: String,
    required: true,
  },
  rep: {
    type: schema.Types.ObjectId,
    ref: "User",
  },
  subscription: {
    current: {
      type: Date,
      default: new Date(new Date().getTime() - DEFAULT_SUB_MILLI),
    },
    expiry: {
      type: Date,
      default: new Date(new Date().getTime() - DEFAULT_SUB_MILLI),
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  state: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  students: [userSchema],
  tx_history: [txHistorySchema],
  teachers: [userSchema],
  type: {
    type: String,
    enum: ["private", "public"],
    required: true,
    lowercase: true,
  },
  levels: [schLevelSchema],
  quiz: [quizSchema],
});

const School = mongoose.model("School", SchoolSchema);

module.exports.School = School;
