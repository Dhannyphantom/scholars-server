const mongoose = require("mongoose");
const Joi = require("joi");
const { txHistorySchema } = require("./User");
const { classEnums } = require("../controllers/helpers");

const schema = mongoose.Schema;

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
    enum: classEnums,
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

const quizSchema = new schema({
  status: {
    type: String,
    enum: ["active", "inactive"],
  },
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
  },
  title: {
    type: String,
    maxlength: 100,
  },
  sessions: [
    {
      date: {
        type: Date,
      },
      participants: {
        user: {
          type: [schema.Types.ObjectId],
          ref: "User",
        },
        score: {
          type: Number,
          default: 0,
        },
      },
    },
  ],
});

const announcementSchema = new schema({
  school: {
    type: schema.Types.ObjectId,
    ref: "School",
    required: true,
  },
  message: {
    type: String,
    maxlength: 180,
    required: true,
  },
  system: {
    type: Boolean,
    default: false,
  },
  class: {
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
    title: {
      type: String,
      maxlength: 50,
    },
    percent: {
      type: String,
      maxlength: 5,
    },
    grade: {
      type: String,
      maxlength: 3,
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

const assignmentSchema = new schema({
  class: {
    type: [String],
    enum: classEnums,
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
    enum: ["ongoing", "inactive"],
    default: "inactive",
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
  students: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  tx_history: [txHistorySchema],
  teachers: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
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
