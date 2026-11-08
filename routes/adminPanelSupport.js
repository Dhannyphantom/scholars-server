// /admin-panel/support (manager only — gate applied by parent)
const express = require("express");
const router = express.Router();
const { SupportTicket } = require("../models/SupportTicket");
const { User } = require("../models/User");
const { TicketNote } = require("../models/AdminMisc");
const expoNotifications = require("../controllers/expoNotifications");
const { record } = require("../controllers/auditService");
const { isId, oid, nameOf, esc, ok, fail, paging, ticketRef, sendCsv } = require("../controllers/adminHelpers");

const ACTIVE = ["open", "in_progress", "waiting_user"];
const STATUSES = ["open", "in_progress", "waiting_user", "resolved", "closed"];
const unreadExpr = { $size: { $filter: { input: "$messages", cond: { $and: [{ $eq: ["$$this.sender", "user"] }, { $ne: ["$$this.status", "read"] }] } } } };

const buildMatch = async (q) => {
  const m = { status: q.tab === "history" ? { $in: ["resolved", "closed"] } : { $in: ACTIVE } };
  if (q.status && STATUSES.includes(q.status)) m.status = q.status;
  if (q.priority) m.priority = q.priority;
  if (q.category) m.category = q.category;
  if (q.assignee === "none") m.assignedTo = null;
  else if (isId(q.assignee)) m.assignedTo = oid(q.assignee);
  if (q.q) {
    const text = String(q.q).trim();
    const rx = new RegExp(esc(text), "i");
    const users = await User.find({ $or: [{ firstName: rx }, { lastName: rx }, { username: rx }] }).select("_id").limit(50).lean();
    const hex = text.replace(/^tkt-/i, "");
    m.$or = [{ user: { $in: users.map((u) => u._id) } }, { subject: rx }, { categoryTitle: rx }, ...(/^[a-f0-9]{3,24}$/i.test(hex) ? [{ $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: `${hex}$`, options: "i" } } }] : [])];
  }
  return m;
};

router.get("/summary", async (req, res) => {
  const [open, inProgress, resolved, unassigned, unread, rated] = await Promise.all([
    SupportTicket.countDocuments({ status: "open" }), SupportTicket.countDocuments({ status: { $in: ["in_progress", "waiting_user"] } }),
    SupportTicket.countDocuments({ status: { $in: ["resolved", "closed"] } }), SupportTicket.countDocuments({ status: { $in: ACTIVE }, assignedTo: null }),
    SupportTicket.countDocuments({ status: { $in: ACTIVE }, messages: { $elemMatch: { sender: "user", status: { $ne: "read" } } } }),
    SupportTicket.aggregate([{ $match: { "rating.score": { $exists: true } } }, { $group: { _id: null, avg: { $avg: "$rating.score" }, n: { $sum: 1 } } }]),
  ]);
  ok(res, { open, inProgress, resolved, unassigned, unread, avgRating: rated[0] ? +rated[0].avg.toFixed(1) : 0, ratings: rated[0]?.n || 0 });
});

const listPipeline = (m, sort) => [
  { $match: m },
  { $addFields: { prioN: { $switch: { branches: [{ case: { $eq: ["$priority", "urgent"] }, then: 0 }, { case: { $eq: ["$priority", "high"] }, then: 1 }, { case: { $eq: ["$priority", "medium"] }, then: 2 }], default: 3 } }, unreadN: unreadExpr,
      lastMsg: { $arrayElemAt: [{ $filter: { input: "$messages", cond: { $in: ["$$this.sender", ["user", "support"]] } } }, -1] }, msgCount: { $size: "$messages" } } },
  { $sort: sort },
];
const SORTS = { recent: { lastMessageAt: -1 }, oldest: { createdAt: 1 }, priority: { prioN: 1, lastMessageAt: -1 }, unread: { unreadN: -1, lastMessageAt: -1 } };

const decorate = async (rows) => {
  const users = await User.find({ _id: { $in: [...rows.map((r) => r.user), ...rows.map((r) => r.assignedTo)].filter(Boolean) } }).select("firstName lastName username avatar accountType").lean();
  const um = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((t) => ({ id: t._id, ref: ticketRef(t._id), subject: t.subject, category: t.category, categoryTitle: t.categoryTitle, categoryIcon: t.categoryIcon, categoryColor: t.categoryColor, status: t.status, priority: t.priority,
    createdAt: t.createdAt, lastMessageAt: t.lastMessageAt, unread: t.unreadN ?? 0, messages: t.msgCount ?? 0, preview: t.lastMsg?.text?.slice(0, 110) || t.description || "", rating: t.rating?.score || null,
    user: um.get(String(t.user)) ? { id: t.user, name: nameOf(um.get(String(t.user))), username: um.get(String(t.user)).username, role: um.get(String(t.user)).accountType, avatar: um.get(String(t.user)).avatar?.image || null } : { name: "Deleted user" },
    assignee: t.assignedTo ? { id: t.assignedTo, name: nameOf(um.get(String(t.assignedTo))) } : null }));
};

router.get("/tickets", async (req, res) => {
  const { page, limit, skip } = paging(req.query, 10);
  const m = await buildMatch(req.query);
  const [r] = await SupportTicket.aggregate([...listPipeline(m, SORTS[req.query.sort] || SORTS.recent), { $facet: { items: [{ $skip: skip }, { $limit: limit }, { $project: { messages: 0, metadata: 0 } }], total: [{ $count: "n" }] } }]);
  const total = r.total[0]?.n || 0;
  ok(res, await decorate(r.items), { total, page, pages: Math.ceil(total / limit) });
});

router.get("/tickets/export", async (req, res) => {
  const m = await buildMatch(req.query);
  const rows = await decorate(await SupportTicket.aggregate([...listPipeline(m, SORTS.recent), { $limit: 10000 }, { $project: { messages: 0, metadata: 0 } }]));
  record(req, { action: "Exported support tickets", target: `${rows.length} rows`, cat: "export" });
  sendCsv(res, "guru-tickets.csv", ["Ref", "Subject", "Category", "User", "Status", "Priority", "Assignee", "Opened", "Last activity"], rows.map((t) => [t.ref, t.subject, t.categoryTitle || t.category, t.user.name, t.status, t.priority, t.assignee?.name || "", t.createdAt?.toISOString(), t.lastMessageAt?.toISOString()]));
});

router.get("/tickets/:id", async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id");
  const t = await SupportTicket.findById(req.params.id);
  if (!t) return fail(res, 404, "Ticket not found");
  await t.markMessagesAsRead(String(req.me._id));
  req.app.get("io")?.to(String(t._id)).emit("message_read", { ticketId: String(t._id), reader: String(req.me._id) });
  const [u, a, notes] = await Promise.all([User.findById(t.user).select("firstName lastName username avatar accountType email contact subscription points streak school").populate("school", "name").lean(),
    t.assignedTo ? User.findById(t.assignedTo).select("firstName lastName").lean() : null, TicketNote.find({ ticket: t._id }).lean()]);
  const msgs = [...t.messages.map((m) => ({ id: m._id, sender: m.sender, senderId: m.senderId, text: m.text, at: m.timestamp, status: m.status })), ...notes.map((n) => ({ id: n._id, sender: "note", text: n.text, at: n.at, author: n.authorName }))].sort((x, y) => new Date(x.at) - new Date(y.at));
  const [row] = await decorate([t.toObject()]);
  ok(res, { ...row, description: t.description, messageList: msgs, rating: t.rating, resolvedAt: t.resolvedAt,
    userInfo: u && { id: u._id, name: nameOf(u), username: u.username, email: u.email, phone: u.contact, role: u.accountType, avatar: u.avatar?.image || null, gt: u.points || 0, streak: u.streak || 0, school: u.school?.name || null, premium: !!(u.subscription?.isActive && new Date(u.subscription.expiry) > new Date()) } });
});

const sys = (t, text) => t.messages.push({ sender: "system", text, status: "delivered" });
const emit = (req, t, message) => req.app.get("io")?.to(String(t._id)).emit("new_message", { ticketId: String(t._id), message });

router.post("/tickets/:id/reply", async (req, res) => {
  const t = await SupportTicket.findById(req.params.id);
  if (!t) return fail(res, 404, "Ticket not found");
  const text = String(req.body.text || "").trim();
  if (!text) return fail(res, 400, "Message is required");
  if (req.body.note) {
    const n = await TicketNote.create({ ticket: t._id, author: req.me._id, authorName: nameOf(req.me), text });
    record(req, { action: "Added internal note", target: ticketRef(t._id), cat: "support" });
    return ok(res, { id: n._id, sender: "note", text, at: n.at, author: n.authorName });
  }
  if (t.status === "closed") return fail(res, 400, "This ticket is closed");
  t.messages.push({ sender: "support", senderId: req.me._id, text, status: "delivered" });
  const msg = t.messages[t.messages.length - 1];
  if (!t.assignedTo) t.assignedTo = req.me._id;
  if (["open", "in_progress"].includes(t.status)) t.status = "waiting_user";
  t.lastMessageAt = new Date();
  await t.save();
  emit(req, t, msg);
  record(req, { action: "Replied to ticket", target: ticketRef(t._id), cat: "support" });
  const u = await User.findById(t.user).select("expoPushToken").lean();
  if (u?.expoPushToken) expoNotifications([u.expoPushToken], { title: "New Support Reply", message: text, data: { ticketId: String(t._id) } }).catch(() => {});
  ok(res, { id: msg._id, sender: "support", text, at: msg.timestamp, status: t.status });
});

router.put("/tickets/:id/status", async (req, res) => {
  const t = await SupportTicket.findById(req.params.id);
  if (!t) return fail(res, 404, "Ticket not found");
  const st = req.body.status;
  if (!STATUSES.includes(st)) return fail(res, 400, "Invalid status");
  const old = t.status;
  t.status = st;
  if (!t.assignedTo && old === "open") t.assignedTo = req.me._id;
  if (["resolved", "closed"].includes(st)) { t.resolvedAt = t.resolvedAt || new Date(); if (st === "closed") t.closedAt = new Date(); }
  sys(t, `Status changed from ${old.replace("_", " ")} to ${st.replace("_", " ")} by ${nameOf(req.me)}`);
  t.lastMessageAt = new Date();
  await t.save();
  emit(req, t, t.messages[t.messages.length - 1]);
  record(req, { action: "Changed ticket status", target: ticketRef(t._id), detail: `${old} → ${st}`, cat: "support" });
  ok(res, { status: st });
});
router.put("/tickets/:id/priority", async (req, res) => {
  if (!["low", "medium", "high", "urgent"].includes(req.body.priority)) return fail(res, 400, "Invalid priority");
  const t = await SupportTicket.findByIdAndUpdate(req.params.id, { priority: req.body.priority });
  if (!t) return fail(res, 404, "Ticket not found");
  record(req, { action: "Changed ticket priority", target: ticketRef(t._id), detail: `${t.priority} → ${req.body.priority}`, cat: "support" });
  ok(res, { priority: req.body.priority });
});
router.put("/tickets/:id/assign", async (req, res) => {
  const t = await SupportTicket.findById(req.params.id);
  if (!t) return fail(res, 404, "Ticket not found");
  const a = req.body.assignee && isId(req.body.assignee) ? await User.findOne({ _id: req.body.assignee, accountType: "manager" }).select("firstName lastName") : null;
  t.assignedTo = a ? a._id : null;
  if (a && t.status === "open") t.status = "in_progress";
  await t.save();
  record(req, { action: a ? "Assigned ticket" : "Unassigned ticket", target: ticketRef(t._id), detail: a ? nameOf(a) : "", cat: "support" });
  ok(res, { assignee: a ? { id: a._id, name: nameOf(a) } : null });
});

module.exports = router;
