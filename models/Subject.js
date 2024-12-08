const mongoose = require("mongoose");
const Joi = require("joi");

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
});

const Subject = mongoose.model("Subject", SubjectSchema);

module.exports.Subject = Subject;
