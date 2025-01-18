const mongoose = require("mongoose");

const schema = mongoose.Schema;

const AppInfoSchema = new schema({
  NAME: {
    type: String,
    default: "Schola",
    unique: true,
  },
  POINT_VALUE: {
    type: Number,
    default: 10,
  },
  VERSION: {
    type: {
      SHOULD_UPDATE: {
        type: String,
        default: "0.0.0",
      },
      CURRENT: {
        type: String,
        default: "0.0.0",
      },
      MUST_UPDATE: {
        type: String,
        default: "0.0.0",
      },
    },
  },
  STUDENT_SUB: {
    type: Number,
    default: 2000,
  },
  SCHOOL_SUB: {
    type: Number,
    default: 10000,
  },
  MAX_WEEK_QUOTA: {
    type: Number,
    default: 40000,
  },
  POINT_VALUE_TEXT: {
    type: String,
    default: "GT",
  },
  PRO_TOKEN: {
    type: String,
    default: "mosdan@pro1234567890",
  },
  ID: {
    type: String,
    default: "APP",
    unique: true,
  },
  POINT_FAIL: {
    type: Number,
    default: 15,
  },
  MAX_SUBJECT_PER_WEEK: {
    type: Number,
    default: 5,
  },
});

const AppInfo = mongoose.model("AppInfo", AppInfoSchema);

module.exports.AppInfo = AppInfo;
