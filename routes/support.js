const express = require("express");
const router = express.Router();
const { SupportTicket } = require("../models/SupportTicket");
const { User } = require("../models/User");
const auth = require("../middlewares/authRoutes");
const adminAuth = require("../middlewares/adminRoutes");
const mongoose = require("mongoose");
const { capCapitalize, getFullName } = require("../controllers/helpers");

// ==========================================
// USER ROUTES
// ==========================================

/**
 * POST /api/support/ticket
 * Create a new support ticket
 */
router.post("/ticket", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      category,
      categoryIcon,
      categoryColor,
      categoryTitle,
      categoryDescription,
      subject,
      description,
      metadata,
    } = req.body;

    // Validate required fields
    if (!category || !categoryTitle) {
      return res.status(400).json({
        success: false,
        message: "Category and title are required",
      });
    }

    // Get user info
    const user = await User.findById(userId).select("firstName lastName email");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userMessage = {
      sender: "user",
      senderId: userId,
      text: `${subject?.toUpperCase()}\n\n${description}`,
      status: "delivered",
      timestamp: new Date(),
      isHeader: true,
    };

    // Create welcome message
    const welcomeMessage = {
      sender: "system",
      timestamp: new Date(),
      senderId: null, // System message
      text: `Thank you ${capCapitalize(
        getFullName(user),
      )}.\nWe apologise you're experiencing such issue.\n\nA member of our support team has been notified and will assist you shortly`,
      status: "delivered",
    };

    // Create ticket
    const ticket = new SupportTicket({
      user: userId,
      category,
      categoryTitle,
      categoryDescription,
      description,
      categoryIcon,
      categoryColor,
      subject,
      messages: [userMessage, welcomeMessage],
      metadata: metadata || {},
      status: "open",
    });

    await ticket.save();

    // Populate user data
    await ticket.populate("user", "firstName lastName email avatar username");

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Create ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create support ticket",
      error: error.message,
    });
  }
});

/**
 * GET /api/support/tickets
 * Get user's support tickets
 */
router.get("/tickets", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, category, page = 1, limit = 20 } = req.query;

    const query = { user: userId };

    if (status) {
      query.status = status;
    }

    if (category) {
      query.category = category;
    }

    const skip = (page - 1) * limit;

    const tickets = await SupportTicket.find(query)
      .sort({ lastMessageAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate("assignedTo", "firstName lastName avatar")
      .lean();

    const total = await SupportTicket.countDocuments(query);

    // Add unread count and last message preview
    const enhancedTickets = tickets.map((ticket) => {
      const lastMessage = ticket.messages[ticket.messages.length - 1];
      const unreadCount = ticket.messages.filter(
        (msg) => msg.sender === "support" && msg.status !== "read",
      ).length;

      return {
        ...ticket,
        lastMessage: {
          text:
            lastMessage.text.length > 100
              ? lastMessage.text.substring(0, 100) + "..."
              : lastMessage.text,
          timestamp: lastMessage.timestamp,
          sender: lastMessage.sender,
        },
        unreadCount,
        messageCount: ticket.messages.length,
      };
    });

    res.json({
      success: true,
      data: {
        tickets: enhancedTickets,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
      error: error.message,
    });
  }
});

/**
 * GET /api/support/ticket/:ticketId
 * Get single ticket with all messages
 */
router.get("/ticket/:ticketId", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;

    const io = req.app.get("io");

    const userInfo = await User.findById(userId).select("accountType");
    const isStudent = userInfo.accountType === "student";

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const filter = { _id: ticketId };
    if (isStudent) {
      filter.user = userId;
    }

    const ticket = await SupportTicket.findOne(filter)
      .populate("user", "firstName lastName email avatar username")
      .populate("assignedTo", "firstName lastName avatar");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Mark support messages as read
    await ticket.markMessagesAsRead(userId);

    io.to(ticketId).emit("message_read", {
      ticketId,
      reader: userId,
    });

    res.json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("Get ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ticket",
      error: error.message,
    });
  }
});

/**
 * POST /api/support/ticket/:ticketId/message
 * Send a message in a ticket
 */
router.post("/ticket/:ticketId/message", auth, async (req, res) => {
  const io = req?.app.get("io");
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;
    const { text, attachments } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message text is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      user: userId,
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Check if ticket is closed
    if (ticket.status === "closed") {
      return res.status(400).json({
        success: false,
        message: "Cannot send message to a closed ticket",
      });
    }

    // Add message
    const newMessage = {
      _id: new mongoose.Types.ObjectId(),
      sender: "user",
      senderId: userId,
      text: text.trim(),
      timestamp: new Date(),
      status: "sent",
      attachments: attachments || [],
    };

    await ticket.addMessage(newMessage);
    // Emit real-time event here if using Socket.io
    io.to(ticketId.toString()).emit("new_message", {
      ticketId,
      message: newMessage,
    });

    // Generate auto-response for common issues
    const autoResponse = generateAutoResponse(text);
    if (autoResponse) {
      setTimeout(async () => {
        const supportMessage = {
          sender: "support",
          timestamp: new Date(),
          senderId: null,
          text: autoResponse,
          status: "delivered",
        };

        await ticket.addMessage(supportMessage);

        // Emit real-time event here if using Socket.io
        io.to(ticketId.toString()).emit("new_message", {
          ticketId,
          message: supportMessage,
        });
      }, 2000);
    }

    // Delivery confirmation
    io.to(ticketId).emit("message_delivered", {
      messageId: newMessage._id,
    });

    res.json({
      success: true,
      message: "Message sent successfully",
      data: {
        message: newMessage,
        ticket: {
          _id: ticket._id,
          status: ticket.status,
          lastMessageAt: ticket.lastMessageAt,
        },
      },
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
});

/**
 * PUT /api/support/ticket/:ticketId/messages/read
 * Mark messages as read
 */
router.put("/ticket/:ticketId/messages/read", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;
    const io = req.app.get("io");

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      user: userId,
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    await ticket.markMessagesAsRead(userId);

    io.to(ticketId).emit("message_read", {
      ticketId,
      reader: userId,
    });

    res.json({
      success: true,
      message: "Messages marked as read",
    });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark messages as read",
      error: error.message,
    });
  }
});

/**
 * POST /api/support/ticket/:ticketId/rate
 * Rate a resolved/closed ticket
 */
router.post("/ticket/:ticketId/rate", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;
    const { score, feedback } = req.body;

    if (!score || score < 1 || score > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating score must be between 1 and 5",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      user: userId,
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    if (!["resolved", "closed"].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: "Can only rate resolved or closed tickets",
      });
    }

    ticket.rating = {
      score,
      feedback: feedback || "",
      ratedAt: new Date(),
    };

    await ticket.save();

    res.json({
      success: true,
      message: "Thank you for your feedback!",
    });
  } catch (error) {
    console.error("Rate ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to rate ticket",
      error: error.message,
    });
  }
});

/**
 * DELETE /api/support/ticket/:ticketId
 * Delete a ticket (user can only delete their own tickets)
 */
router.delete("/ticket/:ticketId", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const ticket = await SupportTicket.findOneAndDelete({
      _id: ticketId,
      user: userId,
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.json({
      success: true,
      message: "Ticket deleted successfully",
    });
  } catch (error) {
    console.error("Delete ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete ticket",
      error: error.message,
    });
  }
});

// ==========================================
// ADMIN/SUPPORT ROUTES
// ==========================================

/**
 * GET /api/support/admin/tickets
 * Get all support tickets (admin only)
 */
router.get("/admin/tickets", adminAuth, async (req, res) => {
  try {
    const {
      status,
      category,
      priority,
      assignedTo,
      page = 1,
      limit = 50,
      search,
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (category) query.category = category;
    if (priority) query.priority = priority;
    if (assignedTo) query.assignedTo = assignedTo;

    // Search by user email or subject
    if (search) {
      const users = await User.find({
        $or: [
          { email: { $regex: search, $options: "i" } },
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const userIds = users.map((u) => u._id);

      query.$or = [
        { user: { $in: userIds } },
        { subject: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const tickets = await SupportTicket.find(query)
      .sort({ lastMessageAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate("user", "firstName lastName email avatar username")
      .populate("assignedTo", "firstName lastName avatar");

    const total = await SupportTicket.countDocuments(query);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Admin get tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
      error: error.message,
    });
  }
});

/**
 * POST /api/support/admin/ticket/:ticketId/reply
 * Admin reply to a ticket
 */
router.post("/admin/ticket/:ticketId/reply", adminAuth, async (req, res) => {
  try {
    const io = req.app.get("io");
    const adminId = req.user.userId;
    const { ticketId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply text is required",
      });
    }

    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Add support message
    const supportMessage = {
      _id: new mongoose.Types.ObjectId(),
      sender: "support",
      senderId: adminId,
      text: text.trim(),
      status: "delivered",
      timestamp: new Date(),
    };

    await ticket.addMessage(supportMessage);

    io.to(ticketId.toString()).emit("new_message", {
      ticketId,
      message: supportMessage,
    });

    // Auto-assign if not assigned
    if (!ticket.assignedTo) {
      ticket.assignedTo = adminId;
      await ticket.save();
    }

    // Emit real-time event
    // io.to(ticketId.toString()).emit('new_message', supportMessage);

    res.json({
      success: true,
      message: "Reply sent successfully",
      data: supportMessage,
    });
  } catch (error) {
    console.error("Admin reply error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send reply",
      error: error.message,
    });
  }
});

/**
 * PUT /api/support/admin/ticket/:ticketId/assign
 * Assign ticket to support agent
 */
router.put("/admin/ticket/:ticketId/assign", adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { assignedTo } = req.body;

    if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const ticket = await SupportTicket.findByIdAndUpdate(
      ticketId,
      { assignedTo },
      { new: true },
    ).populate("assignedTo", "firstName lastName avatar");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.json({
      success: true,
      message: "Ticket assigned successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Assign ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to assign ticket",
      error: error.message,
    });
  }
});

/**
 * PUT /api/support/admin/ticket/:ticketId/status
 * Update ticket status
 */
router.put("/admin/ticket/:ticketId/status", adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, resolution } = req.body;

    const validStatuses = [
      "open",
      "in_progress",
      "waiting_user",
      "resolved",
      "closed",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    if (status === "resolved" || status === "closed") {
      ticket.status = status;
      ticket.resolvedAt = new Date();

      if (status === "closed") {
        ticket.closedAt = new Date();
      }

      if (resolution) {
        ticket.messages.push({
          sender: "system",
          text: `Ticket ${status}. ${resolution}`,
          status: "delivered",
        });
      }
    } else {
      ticket.status = status;
    }

    await ticket.save();

    res.json({
      success: true,
      message: "Ticket status updated successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update ticket status",
      error: error.message,
    });
  }
});

/**
 * PUT /api/support/admin/ticket/:ticketId/priority
 * Update ticket priority
 */
router.put("/admin/ticket/:ticketId/priority", adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { priority } = req.body;

    const validPriorities = ["low", "medium", "high", "urgent"];

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority",
      });
    }

    const ticket = await SupportTicket.findByIdAndUpdate(
      ticketId,
      { priority },
      { new: true },
    );

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.json({
      success: true,
      message: "Priority updated successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Update priority error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update priority",
      error: error.message,
    });
  }
});

/**
 * GET /api/support/admin/stats
 * Get support dashboard statistics
 */
router.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const stats = await SupportTicket.getSupportStats();

    // Format the stats
    const formattedStats = {
      statusCounts: stats[0].statusCounts,
      categoryCounts: stats[0].categoryCounts,
      priorityCounts: stats[0].priorityCounts,
      averageResponseTime:
        stats[0].averageResponseTime[0]?.avgResponseTime || 0,
      averageResolutionTime:
        stats[0].averageResolutionTime[0]?.avgResolutionTime || 0,
      averageRating: stats[0].averageRating[0]?.avgRating || 0,
      totalRatings: stats[0].averageRating[0]?.totalRatings || 0,
    };

    res.json({
      success: true,
      data: formattedStats,
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message,
    });
  }
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Generate auto-response based on message content
 */
function generateAutoResponse(text) {
  const lowerText = text.toLowerCase();

  if (lowerText.includes("payment") || lowerText.includes("subscription")) {
    return "I understand you're having payment issues. Let me help you with that.\n\nCould you please provide:\n1. Your transaction reference\n2. The date of the transaction\n3. The amount charged\n\nThis will help me investigate and resolve the issue quickly.";
  }

  if (lowerText.includes("points") || lowerText.includes("withdraw")) {
    return "I can help with your points and withdrawal concerns.\n\nPlease note:\n• Minimum withdrawal is 1000 GT (₦100)\n• Ensure your bank details are correct\n• Withdrawals process within 24 hours\n\nWhat specific issue are you experiencing?";
  }

  if (lowerText.includes("question") || lowerText.includes("loading")) {
    return "If questions aren't loading, please check:\n\n1. Your internet connection\n2. Daily limits (100 questions/day)\n3. Your subscription status\n4. App version (update if needed)\n\nHave you checked these already?";
  }

  if (lowerText.includes("account") || lowerText.includes("profile")) {
    return "I'm here to help with your account.\n\nWhat specifically do you need help with?\n• Reset password\n• Update profile\n• Verification issues\n• Other account concerns";
  }

  // Return null if no auto-response is needed
  return null;
}

module.exports = router;
