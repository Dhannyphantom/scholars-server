const mongoose = require("mongoose");
const Joi = require("joi");

const schema = mongoose.Schema;

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

const QuestionSchema = new schema({
  question: {
    type: String,
    required: true,
    trim: true,
  },
  answers: [answerSchema],
  // answer: {
  //   type: String,
  //   required: true,
  // },
  point: {
    type: Number,
    default: 40,
  },
  topic: {
    type: schema.Types.ObjectId,
    ref: "Topic",
    required: true,
  },
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
    required: true,
  },
  categories: {
    type: [schema.Types.ObjectId],
    ref: "Category",
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
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

const Question = mongoose.model("Question", QuestionSchema);

module.exports.Question = Question;
