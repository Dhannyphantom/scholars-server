const mongoose = require("mongoose");

const schema = mongoose.Schema;

// Message Schema
const messageSchema = new schema({
  sender: {
    type: String,
    enum: ["user", "support", "system"],
    required: true,
  },
  senderId: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: function () {
      return this.sender !== "system";
    },
  },
  text: {
    type: String,
    required: true,
    maxlength: 5000,
    trim: true,
  },
  status: {
    type: String,
    enum: ["sending", "sent", "delivered", "read", "failed"],
    default: "sent",
  },
  attachments: [
    {
      type: {
        type: String,
        enum: ["image", "document", "video"],
      },
      url: String,
      filename: String,
      size: Number,
    },
  ],
  isEdited: {
    type: Boolean,
    default: false,
  },
  isHeader: {
    type: Boolean,
    default: false,
  },
  editedAt: Date,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Support Ticket Schema
const supportTicketSchema = new schema(
  {
    user: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        "technical",
        "payment",
        "account",
        "points",
        "quiz",
        "school",
        "general",
        "other",
      ],
      required: true,
      default: "general",
    },
    categoryTitle: {
      type: String,
    },
    categoryDescription: {
      type: String,
    },
    categoryIcon: {
      type: String,
      required: true,
    },
    categoryColor: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    subject: {
      type: String,
      maxlength: 100,
      trim: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "waiting_user", "resolved", "closed"],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    messages: [messageSchema],
    assignedTo: {
      type: schema.Types.ObjectId,
      ref: "User", // Admin/Support user
    },
    tags: [String],
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    resolvedAt: Date,
    closedAt: Date,
    rating: {
      score: {
        type: Number,
        min: 1,
        max: 5,
      },
      feedback: String,
      ratedAt: Date,
    },
    metadata: {
      userAgent: String,
      appVersion: String,
      deviceInfo: String,
      ipAddress: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
supportTicketSchema.index({ user: 1, status: 1 });
supportTicketSchema.index({ category: 1, status: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ lastMessageAt: -1 });
supportTicketSchema.index({ createdAt: -1 });

// Virtual for unread messages count
supportTicketSchema.virtual("unreadCount").get(function () {
  return this.messages.filter(
    (msg) => msg.sender === "support" && msg.status !== "read"
  ).length;
});

// Method to add message
supportTicketSchema.methods.addMessage = function (messageData) {
  this.messages.push(messageData);
  this.lastMessageAt = new Date();

  // Auto-update status based on sender
  if (messageData.sender === "user" && this.status === "waiting_user") {
    this.status = "in_progress";
  } else if (messageData.sender === "support" && this.status === "open") {
    this.status = "in_progress";
  }

  return this.save();
};

// Method to mark messages as read
supportTicketSchema.methods.markMessagesAsRead = function (userId) {
  let updated = false;

  this.messages.forEach((msg) => {
    // Mark support messages as read by user
    if (msg.sender === "support" && msg.status !== "read") {
      msg.status = "read";
      updated = true;
    }
    // Mark user messages as read by support
    if (
      msg.sender === "user" &&
      msg.status !== "read" &&
      userId !== this.user.toString()
    ) {
      msg.status = "read";
      updated = true;
    }
  });

  if (updated) {
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to close ticket
supportTicketSchema.methods.closeTicket = function (resolution) {
  this.status = "closed";
  this.closedAt = new Date();

  if (resolution) {
    this.messages.push({
      sender: "system",
      text: `Ticket closed. Resolution: ${resolution}`,
      status: "delivered",
    });
  }

  return this.save();
};

// Static method to get user's active tickets
supportTicketSchema.statics.getUserActiveTickets = function (userId) {
  return this.find({
    user: userId,
    status: { $in: ["open", "in_progress", "waiting_user"] },
  })
    .sort({ lastMessageAt: -1 })
    .populate("assignedTo", "firstName lastName avatar")
    .lean();
};

// Static method to get support dashboard stats
supportTicketSchema.statics.getSupportStats = function () {
  return this.aggregate([
    {
      $facet: {
        statusCounts: [
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ],
        categoryCounts: [
          {
            $group: {
              _id: "$category",
              count: { $sum: 1 },
            },
          },
        ],
        priorityCounts: [
          {
            $group: {
              _id: "$priority",
              count: { $sum: 1 },
            },
          },
        ],
        averageResponseTime: [
          {
            $match: {
              "messages.1": { $exists: true }, // At least 2 messages
            },
          },
          {
            $project: {
              responseTime: {
                $subtract: [
                  { $arrayElemAt: ["$messages.timestamp", 1] },
                  { $arrayElemAt: ["$messages.timestamp", 0] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              avgResponseTime: { $avg: "$responseTime" },
            },
          },
        ],
        averageResolutionTime: [
          {
            $match: {
              status: { $in: ["resolved", "closed"] },
              resolvedAt: { $exists: true },
            },
          },
          {
            $project: {
              resolutionTime: {
                $subtract: ["$resolvedAt", "$createdAt"],
              },
            },
          },
          {
            $group: {
              _id: null,
              avgResolutionTime: { $avg: "$resolutionTime" },
            },
          },
        ],
        averageRating: [
          {
            $match: {
              "rating.score": { $exists: true },
            },
          },
          {
            $group: {
              _id: null,
              avgRating: { $avg: "$rating.score" },
              totalRatings: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);
};

// Pre-save middleware to update lastMessageAt
supportTicketSchema.pre("save", function (next) {
  if (this.isModified("messages") && this.messages.length > 0) {
    this.lastMessageAt = this.messages[this.messages.length - 1].timestamp;
  }
  next();
});

// Set toJSON to include virtuals
supportTicketSchema.set("toJSON", { virtuals: true });
supportTicketSchema.set("toObject", { virtuals: true });

const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);

module.exports = { SupportTicket };
