const mongoose = require("mongoose");
const Joi = require("joi");
const { mediaSchema } = require("./User");

const schema = mongoose.Schema;

const SubjectSchema = new schema({
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  topics: [{ type: schema.Types.ObjectId, ref: "Topic" }],
  image: mediaSchema,
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // JAMB Score Predictor flags
  jambEligible: { type: Boolean, default: false }, // appears in the selector
  jambCompulsory: { type: Boolean, default: false }, // true ONLY for English Language
});

const Subject = mongoose.model("Subject", SubjectSchema);

module.exports.Subject = Subject;
