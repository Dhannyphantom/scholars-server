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
    enum: classEnums,
  },
});

const schLevelSchema = new schema({
  name: {
    type: String,
  },
});

const SchoolSchema = new schema({
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
  subjects: [{ type: schema.Types.ObjectId, ref: "Subject" }],
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
});

const School = mongoose.model("School", SchoolSchema);

module.exports.School = School;
