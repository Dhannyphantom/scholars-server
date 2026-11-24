// Mounted BEFORE the main admin-panel router (see app.js).
//  1. proGuard enforces professional permissions on every /admin-panel request
//  2. support desk + staff list for professionals, feature analytics
//  3. permission management (managers only)
const express = require("express");
const router = express.Router();
const { User } = require("../models/User");
const { SupportTicket } = require("../models/SupportTicket");
const AdminPermission = require("../models/AdminPermission");
const { staffAuth, managerOnly } = require("../middlewares/staffAuth");
const { guard } = require("../middlewares/proGuard");
const { record } = require("../controllers/auditService");
const { report } = require("../controllers/featureAnalytics");
const P = require("../controllers/permissions");
const { isId, nameOf, ticketRef, ok, fail } = require("../controllers/adminHelpers");

router.use(guard);

const STAFF = { $or: [{ accountType: "manager" }, { accountType: "professional", verified: true }] };
const mgr = (req, res, next) => (req.isManager ? next() : fail(res, 403, "Managers only"));

// ── staff / support ──────────────────────────────────────────────────────────
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

// ── my permissions (any staff) ───────────────────────────────────────────────
router.get("/me/permissions", staffAuth, async (req, res) =>
  ok(res, { role: req.isManager ? "manager" : "professional", all: req.isManager, effective: req.isManager ? null : await P.effectiveFor(req.me._id) }));

// ── manage permissions (managers only) ───────────────────────────────────────
const summary = (eff) => {
  const top = P.CATALOG.filter((n) => !n.parent);
  return { visible: top.filter((n) => P.LV[eff[n.key]] >= 1).length, editable: top.filter((n) => eff[n.key] === "edit").length, total: top.length };
};
const proOf = async (req, res) => {
  if (!isId(req.params.userId)) return fail(res, 400, "Invalid id"), null;
  const u = await User.findOne({ _id: req.params.userId, accountType: "professional" }).select("firstName lastName username avatar verified subjects");
  if (!u) return fail(res, 404, "Professional not found"), null;
  return u;
};

router.get("/permissions/catalog", staffAuth, mgr, (req, res) => ok(res, { catalog: P.CATALOG, presets: P.PRESETS }));

router.get("/permissions/professionals", staffAuth, mgr, async (req, res) => {
  const pros = await User.find({ accountType: "professional" }).sort({ verified: -1, _id: -1 }).select("firstName lastName username avatar verified subjects").lean();
  const docs = await AdminPermission.find({ user: { $in: pros.map((p) => p._id) } }).lean();
  const dm = new Map(docs.map((d) => [String(d.user), d.perms]));
  ok(res, pros.map((p) => ({ id: p._id, name: nameOf(p), username: p.username, verified: !!p.verified, avatar: p.avatar?.image || null,
    subjects: (p.subjects || []).length, customized: dm.has(String(p._id)), ...summary(P.effective(dm.get(String(p._id)) || {})) })));
});

router.get("/permissions/:userId", staffAuth, mgr, async (req, res) => {
  const u = await proOf(req, res); if (!u) return;
  const d = await AdminPermission.findOne({ user: u._id }).lean();
  ok(res, { user: { id: u._id, name: nameOf(u), username: u.username, verified: !!u.verified, avatar: u.avatar?.image || null }, customized: !!d, stored: d?.perms || {}, effective: P.effective(d?.perms || {}) });
});

router.put("/permissions/:userId", staffAuth, mgr, async (req, res) => {
  const u = await proOf(req, res); if (!u) return;
  const perms = P.sanitize(req.body.perms);
  await AdminPermission.updateOne({ user: u._id }, { $set: { perms, updatedBy: req.me._id, updatedAt: new Date() } }, { upsert: true });
  P.clear(u._id);
  const eff = P.effective(perms), s = summary(eff);
  record(req, { action: "Updated professional permissions", target: `@${u.username}`, detail: `${s.visible} sections visible, ${s.editable} editable`, cat: "professional" });
  ok(res, { stored: perms, effective: eff });
});

router.post("/permissions/:userId/reset", staffAuth, mgr, async (req, res) => {
  const u = await proOf(req, res); if (!u) return;
  await AdminPermission.deleteOne({ user: u._id });
  P.clear(u._id);
  record(req, { action: "Reset professional permissions", target: `@${u.username}`, cat: "professional" });
  ok(res, { effective: P.effective({}) });
});

module.exports = router;
