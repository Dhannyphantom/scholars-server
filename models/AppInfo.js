const mongoose = require("mongoose");

const schema = mongoose.Schema;

const AppInfoSchema = new schema({
  NAME: {
    type: String,
    default: "Guru",
    unique: true,
  },
  POINT_VALUE: {
    type: Number,
    default: 10,
  },
  VERSION: {
    type: {
      latestVersion: {
        type: String,
        default: "1.0.0",
      },
      minimumSupportedVersion: {
        type: String,
        default: "1.0.0",
      },
      otaEnabled: {
        type: Boolean,
        default: true,
      },
      updateMessage: {
        type: String,
        default:
          "A new version of the app is available. Please update to continue.",
      },
      forceMessage: {
        type: String,
        default:
          "Your app version is no longer supported. Please update to continue.",
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
    default: "mosdan@gurupro1234567890",
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
