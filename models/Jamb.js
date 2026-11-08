const mongoose = require("mongoose");

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

// ─── JambProfile — one per user ──────────────────────────────────────────────
const JambProfileSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, unique: true },
    selection: { type: [ObjectId], default: [] }, // 0 or 4 subject ids
    cooldownUntil: { type: Date, default: null },
    cooldownNotified: { type: Boolean, default: false },
    // denormalised so the home banner is O(1)
    roundsCompleted: { type: Number, default: 0 },
    predictedSum: { type: Number, default: 0 },
    bestPredicted: { type: Number, default: 0 },
    // NOTE: lifetime correct answers are read from User.quizStats.totalCorrectAnswers
    // (the shared global counter) so levels stay consistent with normal quizzes.
  },
  { timestamps: true },
);
JambProfileSchema.index({ cooldownUntil: 1, cooldownNotified: 1 });

// ─── JambRound ───────────────────────────────────────────────────────────────
const SubjectResultSchema = new Schema(
  {
    subjectId: ObjectId,
    name: String,
    image: Schema.Types.Mixed,
    attemptId: ObjectId,
    total: Number,
    correct: Number,
    wrong: Number,
    skipped: Number,
    percent: Number, // integer 0..100
    completedAt: Date,
  },
  { _id: false },
);

const InsightPairSchema = new Schema(
  { name: String, percent: Number },
  { _id: false },
);

const JambRoundSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User" }, // indexed via compound/partial indexes below
    number: Number, // 1-based, per user
    subjectIds: [ObjectId],
    status: {
      type: String,
      enum: ["active", "completed", "abandoned"],
      default: "active",
    },
    results: [SubjectResultSchema],
    completedAt: Date,
    summary: {
      model: { type: String, default: "v1-sum" },
      predicted: Number,
      percent: Number,
      rangeLow: Number,
      rangeHigh: Number,
      rating: String,
      totalCorrect: Number,
      totalQuestions: Number,
      insights: {
        strongest: { type: InsightPairSchema, default: undefined },
        weakest: { type: InsightPairSchema, default: undefined },
        focus: { type: [InsightPairSchema], default: undefined },
        nextStep: String,
      },
    },
  },
  { timestamps: true },
);

// exactly ONE active round per user
JambRoundSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
// Round numbers are unique among COMPLETED rounds only (an abandoned round and
// its replacement legitimately share the same number).
JambRoundSchema.index(
  { userId: 1, number: 1 },
  { unique: true, partialFilterExpression: { status: "completed" } },
);
JambRoundSchema.index({ userId: 1, status: 1, completedAt: -1 });
JambRoundSchema.index({ status: 1, completedAt: -1 }); // recovery sweeper

// ─── JambAttempt — one quiz sitting (1–4 subjects) ───────────────────────────
const JambAttemptSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User" }, // indexed via compound/partial indexes below
    roundId: ObjectId,
    subjectIds: [ObjectId],
    status: {
      type: String,
      enum: ["issued", "submitting", "submitted", "abandoned", "expired"],
      default: "issued",
    },
    // immutable snapshot -> grading never drifts if a question is edited later
    paper: [
      {
        _id: false,
        subjectId: ObjectId,
        questions: [
          {
            _id: false,
            questionId: ObjectId,
            correctAnswerId: ObjectId,
            answerIds: [ObjectId], // shuffled display order; also used to validate answers
            point: Number,
          },
        ],
      },
    ],
    issuedAt: Date,
    expiresAt: Date,
    submittedAt: Date,
    durationMs: Number,
    idempotencyKey: String,
    graded: Schema.Types.Mixed, // server-graded result, stored so a half-finished submit can resume
    countersApplied: { type: Boolean, default: false },
    response: Schema.Types.Mixed, // cached submit response (idempotent replays)
    flags: [String],
  },
  { timestamps: true },
);
JambAttemptSchema.index({ userId: 1, status: 1 });
// one open attempt per user
JambAttemptSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: "issued" } },
);
JambAttemptSchema.index({ userId: 1, createdAt: -1 });
JambAttemptSchema.index({ status: 1, submittedAt: 1 });
// TTL: purge old attempts 30 days after they expire
JambAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// ─── JambSeen — de-duplication of questions across rounds ────────────────────
const JambSeenSchema = new Schema({
  userId: { type: ObjectId, ref: "User", required: true },
  subjectId: { type: ObjectId, ref: "Subject", required: true },
  questionIds: { type: [ObjectId], default: [] }, // oldest first
  cycle: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});
JambSeenSchema.index({ userId: 1, subjectId: 1 }, { unique: true });

module.exports = {
  JambProfile: mongoose.model("JambProfile", JambProfileSchema),
  JambRound: mongoose.model("JambRound", JambRoundSchema),
  JambAttempt: mongoose.model("JambAttempt", JambAttemptSchema),
  JambSeen: mongoose.model("JambSeen", JambSeenSchema),
};
