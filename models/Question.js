const mongoose = require("mongoose");
const Joi = require("joi");

const schema = mongoose.Schema;

const QuestionSchema = new schema({
  question: {
    type: String,
    required: true,
    trim: true,
  },
  answers: [{ type: String, required: true }],
  answer: {
    type: String,
    required: true,
  },
  point: {
    type: Number,
    default: 50,
  },
  topic: {
    type: schema.Types.ObjectId,
    ref: "Topic",
  },
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
  },
  categories: {
    type: [String],
    required: true,
  },
  isTheory: {
    type: Boolean,
    default: false,
  },
  timer: {
    type: Number,
    default: 40,
  },
});

const Question = mongoose.model("Question", QuestionSchema);

module.exports.Question = Question;
