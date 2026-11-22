// Mounted BEFORE the main admin-panel router (see app.js). Lets verified professionals use the
// support desk, and exposes feature-usage analytics to managers.
const express = require("express");
const router = express.Router();
const { User } = require("../models/User");
const { SupportTicket } = require("../models/SupportTicket");
const { staffAuth, managerOnly } = require("../middlewares/staffAuth");
const { record } = require("../controllers/auditService");
const { report } = require("../controllers/featureAnalytics");
const { isId, nameOf, ticketRef, ok, fail } = require("../controllers/adminHelpers");

const STAFF = { $or: [{ accountType: "manager" }, { accountType: "professional", verified: true }] };

// assignees: managers + verified professionals
router.get("/staff", staffAuth, async (req, res) => {
  const list = await User.find(STAFF).select("firstName lastName username avatar accountType").lean();
  ok(res, list.map((u) => ({ id: u._id, name: nameOf(u), role: u.accountType, avatar: u.avatar?.image || null })));
});

router.put("/support/tickets/:id/assign", staffAuth, async (req, res) => {
  const t = await SupportTicket.findById(req.params.id);
  if (!t) return fail(res, 404, "Ticket not found");
  const a = req.body.assignee && isId(req.body.assignee)
    ? await User.findOne({ _id: req.body.assignee, ...STAFF }).select("firstName lastName")
    : null;
  t.assignedTo = a ? a._id : null;
  if (a && t.status === "open") t.status = "in_progress";
  await t.save();
  record(req, { action: a ? "Assigned ticket" : "Unassigned ticket", target: ticketRef(t._id), detail: a ? nameOf(a) : "", cat: "support" });
  ok(res, { assignee: a ? { id: a._id, name: nameOf(a) } : null });
});

router.use("/support", staffAuth, require("./adminPanelSupport"));

router.get("/analytics/features", staffAuth, managerOnly, async (req, res) => ok(res, await report(req.query.days)));

module.exports = router;
