const mongoose = require("mongoose");
const Joi = require("joi");

const schema = mongoose.Schema;

const answerSchema = new schema({
  name: {
    type: String,
    required: false,
  },

  // NEW: LaTeX version of the option
  latex: {
    type: String,
    required: false,
  },

  // NEW: Flag to know if this option should be rendered as LaTeX
  isLatex: {
    type: Boolean,
    default: false,
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

  // NEW: LaTeX version of question
  questionLatex: {
    type: String,
    trim: true,
  },

  // NEW: Flag to determine rendering mode
  isLatex: {
    type: Boolean,
    default: false,
  },

  answers: [answerSchema],

  explanation: {
    type: String,
    trim: true,
  },

  // NEW: LaTeX explanation support
  explanationLatex: {
    type: String,
    trim: true,
  },

  point: {
    type: Number,
    default: 5,
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

  // ── JAMB Score Predictor ─────────────────────────────────────────────────
  // Optional difficulty used to balance JAMB papers (30% easy / 50% medium / 20% hard).
  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"],
  },

  // Soft-disable a question everywhere. The JAMB module treats a MISSING value as
  // true, so existing questions keep working without a data migration.
  active: {
    type: Boolean,
    default: true,
  },

  // Set to false to keep a question out of JAMB papers only (missing = eligible).
  jambEligible: {
    type: Boolean,
    default: true,
  },
});

// JAMB paper building / bank counts
QuestionSchema.index({ subject: 1, active: 1, jambEligible: 1 });
QuestionSchema.index({ subject: 1, topic: 1 });

const Question = mongoose.model("Question", QuestionSchema);

module.exports.Question = Question;
