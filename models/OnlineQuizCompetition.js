const mongoose = require("mongoose");

const schema = mongoose.Schema;

// ─── Prize entry ──────────────────────────────────────────────────────────────
const prizeEntrySchema = {
  title: { type: String, required: true },
  type: { type: String, enum: ["points", "cash"], default: "points" },
  reward: { type: Number, required: true },
  currency: { type: String, default: null },
  description: { type: String, default: null },
};

// ─── Custom question answer option ───────────────────────────────────────────
const customAnswerSchema = new schema(
  {
    name: { type: String, required: true },
    correct: { type: Boolean, default: false },
  },
  { _id: true }, // answers are small; auto ObjectId is fine here
);

// ─── Custom question (lives only on the competition document) ─────────────────
// _id is stored as String so the frontend's local timestamp+random keys
// (e.g. "1780180529222evgfr2gxuvm") pass through without ObjectId casting errors.
// Shape mirrors what QuestionDisplay expects — quiz screen needs zero changes.
const customQuestionSchema = new schema(
  {
    _id: { type: String }, // ← String, not ObjectId
    question: { type: String, required: true, trim: true },
    answers: [customAnswerSchema],
    explanation: { type: String, default: "" },
    point: { type: Number, default: 5 },
    timer: { type: Number, default: 40 },
    isLatex: { type: Boolean, default: false },
    isTheory: { type: Boolean, default: false },
  },
  { _id: false }, // we manage _id ourselves via the field above
);

// ─── Custom subject (standalone — no DB Subject/Topic reference) ──────────────
// Same treatment: _id stored as String.
const customSubjectSchema = new schema(
  {
    _id: { type: String }, // ← String, not ObjectId
    name: { type: String, required: true, trim: true },
    questionsCount: { type: Number, required: true, min: 1, max: 50 },
    timePerQuestion: { type: Number, default: 40 },
    // Full pool — participant gets a random questionsCount-sized slice at quiz time
    questions: [customQuestionSchema],
  },
  { _id: false }, // we manage _id ourselves via the field above
);

// ─── Main competition schema ──────────────────────────────────────────────────
const competitionSchema = new schema({
  title: { type: String, default: "Monthly Guru Quiz Tournament" },
  rules: { type: String, default: "" },

  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },

  // DB-backed subjects: questions fetched from Question collection at quiz time
  subjects: [
    {
      subject: {
        type: mongoose.Types.ObjectId,
        ref: "Subject",
        required: true,
      },
      // Empty = all topics for that subject; populated = filter by these topics
      topics: [{ type: mongoose.Types.ObjectId, ref: "Topic" }],
      questionsCount: { type: Number, required: true, min: 5, max: 50 },
      timePerQuestion: { type: Number, default: 40 },
    },
  ],

  // Standalone custom subjects — questions stored inline, never touch Question collection
  customSubjects: [customSubjectSchema],

  prizes: {
    first: prizeEntrySchema,
    second: prizeEntrySchema,
    third: prizeEntrySchema,
  },

  status: {
    type: String,
    enum: ["draft", "active", "finished"],
    default: "draft",
  },
  resultsPublished: { type: Boolean, default: false },

  participants: [
    {
      user: { type: mongoose.Types.ObjectId, ref: "User", required: true },
      score: { type: Number, default: 0 },
      rank: { type: Number, default: null },
      duration: { type: Number, default: 0 },
      submittedAt: { type: Date, default: null },
      hasParticipated: { type: Boolean, default: false },
    },
  ],

  finalRankings: [
    {
      user: { type: mongoose.Types.ObjectId, ref: "User" },
      rank: { type: Number, enum: [1, 2, 3] },
      score: { type: Number },
      prizeAwarded: { type: Boolean, default: false },
    },
  ],

  // Auto-calculated (DB subjects + custom subjects combined)
  totalQuestions: { type: Number, default: 0 },
  approxDuration: { type: Number, default: 0 },
  totalParticipants: { type: Number, default: 0 },

  createdBy: { type: mongoose.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

competitionSchema.index({ month: 1, year: 1 }, { unique: true });
competitionSchema.index({ status: 1 });
competitionSchema.index({ startTime: 1, endTime: 1 });
competitionSchema.index({ "participants.user": 1 });
competitionSchema.index({ createdAt: -1 });

const OnlineQuizCompetition = mongoose.model(
  "OnlineQuizCompetition",
  competitionSchema,
);

module.exports.OnlineQuizCompetition = OnlineQuizCompetition;
