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

const quizQuestionsSchema = new schema({
  question: {
    type: String,
    required: true,
    trim: true,
  },
  answers: [answerSchema],
  answered: answerSchema,
  topic: {
    type: mongoose.Types.ObjectId,
    ref: "Topic",
  },
  subject: {
    type: mongoose.Types.ObjectId,
    ref: "Subject",
  },
  categories: {
    type: [mongoose.Types.ObjectId],
    ref: "Category",
  },

  point: {
    type: Number,
    default: 40,
  },
  timer: {
    type: Number,
    default: 40,
  },
});

const QuizSchema = new schema({
  mode: {
    type: String,
    enum: ["solo", "friends"],
    default: "solo",
  },
  type: {
    type: String,
    enum: ["premium", "freemium"],
  },
  user: {
    type: mongoose.Types.ObjectId,
    ref: "User",
    required: true,
  },
  subjects: [{ type: mongoose.Types.ObjectId, ref: "Subject" }],
  topics: [{ type: mongoose.Types.ObjectId, ref: "Topic" }],
  questions: [quizQuestionsSchema],
  date: {
    type: Date,
    default: Date.now,
  },
  participants: {
    type: [
      {
        user: {
          type: mongoose.Types.ObjectId,
          ref: "User",
        },
        point: {
          type: Number,
          default: 0,
        },
      },
    ],
  },
});

QuizSchema.index({ date: -1 });
QuizSchema.index({ mode: 1, type: 1 });

const Quiz = mongoose.model("Quiz", QuizSchema);

module.exports.Quiz = Quiz;
