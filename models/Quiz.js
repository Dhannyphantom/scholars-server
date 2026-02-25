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

  // --- DASHBOARD ADDITIONS ---

  // Links this quiz session to a school.
  // Critical bridge: without this, every school dashboard query requires
  // a costly lookup (School.students → Quiz where user in list).
  // Populate when student belongs to a school at quiz submission time.
  school: {
    type: mongoose.Types.ObjectId,
    ref: "School",
    default: null,
  },

  // Denormalized summary computed at submission time.
  // Avoids re-scanning all questions on every dashboard load.
  // Powers: overall performance %, subject breakdown, readiness index.
  summary: {
    totalQuestions: {
      type: Number,
      default: 0,
    },
    correctAnswers: {
      type: Number,
      default: 0,
    },
    // Percentage: (correctAnswers / totalQuestions) * 100
    // Used for: overall school %, class comparisons, top students
    accuracyRate: {
      type: Number,
      default: 0,
    },
    // Total points earned in this session
    pointsEarned: {
      type: Number,
      default: 0,
    },
    // Time taken to complete the quiz in milliseconds.
    // Used for: WAEC readiness speed component
    duration: {
      type: Number,
      default: 0,
    },
    // Per-subject breakdown computed at submission time.
    // Powers: "JSS2 is weak in Algebra" insight without rescanning questions.
    // Used for: subject strength/weakness, class-by-class subject comparison
    subjectBreakdown: [
      {
        subject: {
          type: mongoose.Types.ObjectId,
          ref: "Subject",
        },
        totalQuestions: {
          type: Number,
          default: 0,
        },
        correctAnswers: {
          type: Number,
          default: 0,
        },
        // Percentage: (correctAnswers / totalQuestions) * 100
        accuracyRate: {
          type: Number,
          default: 0,
        },
      },
    ],
  },

  // Snapshot of student's class level at the time of this quiz.
  // User's class can change (e.g. JSS2 → JSS3) but historical quizzes
  // should still be attributed to the correct class for trend accuracy.
  // Used for: class-by-class comparison, "JSS2 weak in Algebra" detection
  classLevel: {
    type: String,
    enum: ["jss 1", "jss 2", "jss 3", "sss 1", "sss 2", "sss 3"],
    default: null,
  },
});

// Existing indexes
QuizSchema.index({ date: -1 });
QuizSchema.index({ mode: 1, type: 1 });

// --- DASHBOARD INDEXES ---
// Fast lookup of all quizzes for a school (school dashboard load)
QuizSchema.index({ school: 1, date: -1 });
// Fast filtering by school + class level (class-by-class comparison)
QuizSchema.index({ school: 1, classLevel: 1 });
// Fast filtering by school + subject (subject weakness detection)
QuizSchema.index({ school: 1, "summary.subjectBreakdown.subject": 1 });
// Fast user history lookup per school
QuizSchema.index({ user: 1, school: 1, date: -1 });

const Quiz = mongoose.model("Quiz", QuizSchema);

module.exports.Quiz = Quiz;
