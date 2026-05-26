const mongoose = require("mongoose");

const schema = mongoose.Schema;

const prizeEntrySchema = {
  title: {
    type: String,
    required: true,
  },
  // "points" = automated GT points; "cash" = manual payout by admin
  type: {
    type: String,
    enum: ["points", "cash"],
    default: "points",
  },
  // Primary reward amount (GT points for "points" type; cash value for "cash" type)
  reward: {
    type: Number,
    required: true,
  },
  // Only meaningful when type === "cash" (e.g. "NGN", "USD")
  currency: {
    type: String,
    default: null,
  },
  // Optional human-readable note (e.g. "Paid via bank transfer within 7 days")
  description: {
    type: String,
    default: null,
  },
};

const competitionSchema = new schema({
  title: {
    type: String,
    default: "Monthly Guru Quiz Tournament",
  },
  rules: {
    type: String,
    default: "",
  },

  // Month/year identifier and time window
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
  },
  year: {
    type: Number,
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },

  // Configuration
  subjects: [
    {
      subject: {
        type: mongoose.Types.ObjectId,
        ref: "Subject",
        required: true,
      },
      topics: [
        {
          type: mongoose.Types.ObjectId,
          ref: "Topic",
        },
      ],
      questionsCount: {
        type: Number,
        required: true,
        min: 5,
        max: 50,
      },
      timePerQuestion: {
        type: Number,
        default: 40,
      },
    },
  ],

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

  // Manager explicitly releases results to participants
  // Managers can always view; participants only see after this is true
  resultsPublished: {
    type: Boolean,
    default: false,
  },

  // Tracking participants
  participants: [
    {
      user: {
        type: mongoose.Types.ObjectId,
        ref: "User",
        required: true,
      },
      score: {
        type: Number,
        default: 0,
      },
      rank: {
        type: Number,
        default: null,
      },
      duration: {
        type: Number,
        default: 0,
      },
      submittedAt: {
        type: Date,
        default: null,
      },
      hasParticipated: {
        type: Boolean,
        default: false,
      },
    },
  ],

  // Final rankings (populated after endTime)
  finalRankings: [
    {
      user: {
        type: mongoose.Types.ObjectId,
        ref: "User",
      },
      rank: {
        type: Number,
        enum: [1, 2, 3],
      },
      score: {
        type: Number,
      },
      prizeAwarded: {
        type: Boolean,
        default: false,
      },
    },
  ],

  // Auto-calculated values
  totalQuestions: {
    type: Number,
    default: 0,
  },
  approxDuration: {
    type: Number,
    default: 0,
  },
  totalParticipants: {
    type: Number,
    default: 0,
  },

  // Metadata
  createdBy: {
    type: mongoose.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for faster queries
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
