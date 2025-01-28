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

const mediaSchema = {
  uri: {
    type: String,
    maxlength: 1024,
    required: false,
  },
  type: {
    type: String,
    // enum: ["image", "video", "text"],
    default: "image",
    maxlength: 255,
    required: false,
  },
  thumb: {
    type: String,
    maxlength: 1024,
    required: false,
  },
  width: {
    type: Number,
    required: false,
  },
  height: {
    type: Number,
    required: false,
  },
};

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
  image: mediaSchema,
  timer: {
    type: Number,
    default: 40,
  },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  edits: {
    type: [schema.Types.ObjectId],
    ref: "User",
  },
});

const Question = mongoose.model("Question", QuestionSchema);

module.exports.Question = Question;
