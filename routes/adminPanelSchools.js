// /admin-panel/schools (manager only — gate is applied by the parent router)
const express = require("express");
const router = express.Router();
const { School } = require("../models/School");
const { User } = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const walletService = require("../controllers/walletService");
const { AdminFlag } = require("../models/AdminMisc");
const { markSuspended } = require("../middlewares/guard");
const { record } = require("../controllers/auditService");
const { isId, oid, cap, nameOf, esc, ok, fail, paging } = require("../controllers/adminHelpers");

const LEVELS = ["jss 1", "jss 2", "jss 3", "sss 1", "sss 2", "sss 3"];
const flagSet = async () => new Set((await AdminFlag.find({ kind: "school" }).select("ref").lean()).map((f) => String(f.ref)));
const sName = (s) => cap(s?.name || "");

// ───── cross-school lists (before /:id) ─────
router.get("/", async (req, res) => {
  const { page, limit, skip } = paging(req.query, 15);
  const f = {};
  const q = req.query;
  if (q.q) { const rx = new RegExp(esc(q.q), "i"); f.$or = [{ name: rx }, { email: rx }, { lga: rx }, { state: rx }]; }
  if (q.type) f.type = q.type.toLowerCase();
  if (q.state) f.state = q.state.toLowerCase();
  if (q.sub === "Active") f["subscription.expiry"] = { $gt: new Date() };
  if (q.sub === "Expired") f["subscription.expiry"] = { $lte: new Date() };
  const flagged = await AdminFlag.find({ kind: "school" }).select("ref").lean();
  const fids = flagged.map((x) => x.ref);
  if (q.status) f._id = q.status === "Suspended" ? { $in: fids } : { $nin: fids };
  const [rows, total, all, active, states] = await Promise.all([
    School.aggregate([{ $match: f }, { $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit },
      { $project: { name: 1, email: 1, contact: 1, state: 1, lga: 1, type: 1, createdAt: 1, subscription: 1, rep: 1, students: { $size: "$students" }, teachers: { $size: "$teachers" }, classes: { $size: "$classes" } } }]),
    School.countDocuments(f), School.countDocuments(), School.countDocuments({ "subscription.expiry": { $gt: new Date() } }), School.distinct("state"),
  ]);
  const fs = new Set(fids.map(String));
  ok(res, rows.map((s) => ({ id: s._id, name: sName(s), email: s.email, contact: s.contact, state: s.state, lga: s.lga, type: s.type, createdAt: s.createdAt, subActive: new Date(s.subscription?.expiry) > new Date(), expiry: s.subscription?.expiry, students: s.students, teachers: s.teachers, classes: s.classes, suspended: fs.has(String(s._id)) })),
    { total, page, pages: Math.ceil(total / limit), stats: { total: all, active, expired: all - active, suspended: fids.length }, states: states.filter(Boolean) });
});

const teacherNames = async (rows, key) => {
  const users = await User.find({ _id: { $in: rows.map((r) => r[key]).filter(Boolean) } }).select("firstName lastName username").lean();
  const m = new Map(users.map((u) => [String(u._id), nameOf(u)]));
  return (id) => m.get(String(id)) || "—";
};
const listAgg = async (req, res, { path, pre = [], post = [], project, mapRow }) => {
  const { page, limit, skip } = paging(req.query, 15);
  const schoolM = isId(req.query.school) ? { _id: oid(req.query.school) } : {};
  const [r] = await School.aggregate([
    { $match: schoolM }, { $unwind: `$${path}` }, ...pre, { $project: { schoolId: "$_id", school: "$name", ...project } }, ...post,
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: "n" }] } },
  ]);
  const total = r.total[0]?.n || 0;
  ok(res, await mapRow(r.items), { total, page, pages: Math.ceil(total / limit) });
};

router.get("/classes", (req, res) => {
  const lv = req.query.level ? { "classes.level": req.query.level } : {};
  const qm = req.query.q ? { $or: [{ name: new RegExp(esc(req.query.q), "i") }, { "classes.alias": new RegExp(esc(req.query.q), "i") }] } : {};
  return listAgg(req, res, { path: "classes", pre: [{ $match: { ...lv, ...qm } }], project: { id: "$classes._id", level: "$classes.level", alias: "$classes.alias", teachers: { $size: "$classes.teachers" }, students: { $size: "$classes.students" } },
    post: [{ $sort: { school: 1, level: 1 } }], mapRow: async (rows) => rows.map((r) => ({ ...r, school: cap(r.school) })) });
});

router.get("/quizzes", (req, res) => {
  const m = {};
  if (req.query.status) m["quiz.status"] = req.query.status;
  if (req.query.class) m["quiz.class"] = req.query.class;
  if (req.query.q) { const rx = new RegExp(esc(req.query.q), "i"); m.$or = [{ "quiz.title": rx }, { name: rx }]; }
  return listAgg(req, res, { path: "quiz", pre: [{ $match: m }, { $lookup: { from: "subjects", localField: "quiz.subject", foreignField: "_id", as: "sub" } }],
    project: { id: "$quiz._id", title: "$quiz.title", class: "$quiz.class", status: "$quiz.status", teacher: "$quiz.teacher", subject: { $arrayElemAt: ["$sub.name", 0] }, questions: { $size: "$quiz.questions" }, sessions: { $size: "$quiz.sessions" }, date: "$quiz.date",
      participants: { $sum: { $map: { input: "$quiz.sessions", as: "s", in: { $size: "$$s.participants" } } } } },
    post: [{ $sort: { date: -1 } }], mapRow: async (rows) => { const tn = await teacherNames(rows, "teacher"); return rows.map((r) => ({ ...r, school: cap(r.school), subject: cap(r.subject), teacher: tn(r.teacher) })); } });
});

router.get("/assignments", (req, res) => {
  const m = {};
  if (req.query.status) m["assignments.status"] = req.query.status;
  if (req.query.q) { const rx = new RegExp(esc(req.query.q), "i"); m.$or = [{ "assignments.title": rx }, { name: rx }]; }
  return listAgg(req, res, { path: "assignments", pre: [{ $match: m }, { $lookup: { from: "subjects", localField: "assignments.subject", foreignField: "_id", as: "sub" } }],
    project: { id: "$assignments._id", title: "$assignments.title", classes: "$assignments.classes", status: "$assignments.status", teacher: "$assignments.teacher", subject: { $arrayElemAt: ["$sub.name", 0] }, expiry: "$assignments.expiry", date: "$assignments.date", submissions: { $size: "$assignments.submissions" } },
    post: [{ $sort: { date: -1 } }], mapRow: async (rows) => { const tn = await teacherNames(rows, "teacher"); return rows.map((r) => ({ ...r, school: cap(r.school), subject: cap(r.subject), teacher: tn(r.teacher) })); } });
});

router.get("/announcements", (req, res) => {
  const m = {};
  if (req.query.type) m["announcements.type"] = req.query.type;
  if (req.query.q) { const rx = new RegExp(esc(req.query.q), "i"); m.$or = [{ "announcements.message": rx }, { name: rx }]; }
  return listAgg(req, res, { path: "announcements", pre: [{ $match: m }],
    project: { id: "$announcements._id", type: "$announcements.type", message: "$announcements.message", visibility: "$announcements.visibility", classes: "$announcements.classes", date: "$announcements.date", reads: { $size: "$announcements.reads" } },
    post: [{ $sort: { date: -1 } }], mapRow: async (rows) => rows.map((r) => ({ ...r, school: cap(r.school) })) });
});

// ───── detail ─────
const avgOf = (sessions) => { const s = sessions.filter((x) => x.participants?.length); return s.length ? +(s.reduce((a, x) => a + (x.average_score || 0), 0) / s.length).toFixed(1) : 0; };

router.get("/:id", async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id");
  const s = await School.findById(req.params.id).lean();
  if (!s) return fail(res, 404, "School not found");
  const memberIds = [...s.students.map((x) => x.user), ...s.teachers.map((x) => x.user), s.rep, ...s.quiz.map((q) => q.teacher), ...s.assignments.map((a) => a.teacher)].filter(Boolean);
  const [users, subs, flag, led, bal] = await Promise.all([
    User.find({ _id: { $in: memberIds } }).select("firstName lastName username avatar class points verified contact").lean(),
    require("../models/Subject").Subject.find({ _id: { $in: [...s.quiz.map((q) => q.subject), ...s.assignments.map((a) => a.subject)].filter(Boolean) } }).select("name").lean(),
    AdminFlag.findOne({ kind: "school", ref: s._id }).lean(),
    WalletTransaction.find({ schoolId: s._id }).sort({ createdAt: -1 }).limit(15).select("transactionType category amount description createdAt status reference").lean(),
    WalletTransaction.aggregate([{ $match: { schoolId: s._id, status: "completed" } }, { $group: { _id: "$transactionType", n: { $sum: "$amount" } } }]),
  ]);
  const um = new Map(users.map((u) => [String(u._id), u]));
  const sm = new Map(subs.map((x) => [String(x._id), cap(x.name)]));
  const nm = (id) => nameOf(um.get(String(id))) || "—";
  const classOf = new Map();
  s.classes.forEach((c) => c.students.forEach((id) => classOf.set(String(id), c)));
  const person = (e, isStudent) => { const u = um.get(String(e.user)); const c = classOf.get(String(e.user)); return { id: e.user, name: nm(e.user), username: u?.username, verified: !!e.verified, avatar: u?.avatar?.image || null, gt: u?.points || 0, level: isStudent ? c?.level || u?.class?.level || null : null, classId: isStudent ? c?._id || null : null }; };
  const credit = bal.find((b) => b._id === "credit")?.n || 0, debit = bal.find((b) => b._id === "debit")?.n || 0;
  ok(res, {
    id: s._id, name: sName(s), email: s.email, contact: s.contact, state: s.state, lga: s.lga, type: s.type, createdAt: s.createdAt, levels: s.levels,
    subscription: { ...s.subscription, active: new Date(s.subscription?.expiry) > new Date() }, suspended: !!flag, suspendReason: flag?.reason || null,
    rep: s.rep ? { id: s.rep, name: nm(s.rep), username: um.get(String(s.rep))?.username } : null,
    students: s.students.map((e) => person(e, true)), teachers: s.teachers.map((e) => person(e, false)),
    classes: s.classes.map((c) => ({ id: c._id, level: c.level, alias: c.alias || "", teachers: c.teachers.map(String), students: c.students.map(String) })),
    alumni: (s.alumni || []).map((a) => ({ id: a._id, type: a.type, fromClass: a.fromClass, date: a.date, students: a.students })),
    quizzes: s.quiz.map((q) => ({ id: q._id, title: q.title, class: q.class, status: q.status, subject: sm.get(String(q.subject)) || "—", teacher: nm(q.teacher), questions: q.questions.length, sessions: q.sessions.length, participants: q.sessions.reduce((a, x) => a + x.participants.length, 0), avg: avgOf(q.sessions), date: q.date })),
    assignments: s.assignments.map((a) => ({ id: a._id, title: a.title, classes: a.classes, status: a.status, subject: sm.get(String(a.subject)) || "—", teacher: nm(a.teacher), expiry: a.expiry, date: a.date, submissions: a.submissions.length })),
    announcements: s.announcements.map((a) => ({ id: a._id, type: a.type, message: a.message, date: a.date, visibility: a.visibility, classes: a.classes, reads: a.reads.length })).sort((a, b) => new Date(b.date) - new Date(a.date)),
    wallet: { balance: credit - debit, credits: credit, debits: debit, rows: led },
  });
});

router.get("/:id/quizzes/:qid", async (req, res) => {
  const s = await School.findById(req.params.id).lean();
  const q = s?.quiz.find((x) => String(x._id) === req.params.qid);
  if (!q) return fail(res, 404, "Quiz not found");
  const uids = [q.teacher, ...q.sessions.flatMap((x) => x.participants.map((p) => p.student))].filter(Boolean);
  const users = await User.find({ _id: { $in: uids } }).select("firstName lastName username").lean();
  const um = new Map(users.map((u) => [String(u._id), nameOf(u)]));
  const sub = await require("../models/Subject").Subject.findById(q.subject).select("name").lean();
  ok(res, { id: q._id, schoolId: s._id, school: sName(s), title: q.title, status: q.status, class: q.class, subject: cap(sub?.name), teacher: um.get(String(q.teacher)) || "—", date: q.date,
    questions: q.questions.map((x) => ({ question: x.question, point: x.point, answers: x.answers })),
    sessions: q.sessions.map((x) => ({ id: x._id, date: x.date, ended: x.ended, avg: x.average_score, total: x.total_score, participants: x.participants.map((p) => ({ studentId: p.student, name: um.get(String(p.student)) || "—", score: p.score, date: p.date })).sort((a, b) => b.score - a.score) })) });
});

router.get("/:id/assignments/:aid", async (req, res) => {
  const s = await School.findById(req.params.id).lean();
  const a = s?.assignments.find((x) => String(x._id) === req.params.aid);
  if (!a) return fail(res, 404, "Assignment not found");
  const users = await User.find({ _id: { $in: [a.teacher, ...a.submissions.map((x) => x.student)].filter(Boolean) } }).select("firstName lastName username").lean();
  const um = new Map(users.map((u) => [String(u._id), nameOf(u)]));
  const sub = await require("../models/Subject").Subject.findById(a.subject).select("name").lean();
  ok(res, { id: a._id, schoolId: s._id, school: sName(s), title: a.title, question: a.question, status: a.status, classes: a.classes, subject: cap(sub?.name), teacher: um.get(String(a.teacher)) || "—", date: a.date, expiry: a.expiry,
    submissions: a.submissions.map((x) => ({ id: x._id, studentId: x.student, name: um.get(String(x.student)) || "—", solution: x.solution, score: x.score, date: x.date })), history: (a.history || []).length });
});

// ───── mutations ─────
const load = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id"), null;
  const s = await School.findById(req.params.id);
  if (!s) return fail(res, 404, "School not found"), null;
  return s;
};
const aud = (req, s, action, detail = "") => record(req, { action, target: sName(s), detail, cat: "school" });

router.post("/", async (req, res) => {
  const b = req.body;
  if (!b.name || !b.email || !b.state || !b.lga || !b.type) return fail(res, 400, "Name, email, state, LGA and type are required");
  if (await School.exists({ email: String(b.email).toLowerCase() })) return fail(res, 400, "A school with that email already exists");
  const now = new Date();
  const s = await School.create({ name: b.name, email: b.email, contact: b.contact, state: b.state, lga: b.lga, type: String(b.type).toLowerCase(), createdAt: now, subscription: { current: now, expiry: new Date(now.getTime() + 90 * 864e5), isActive: true } });
  aud(req, s, "Created school");
  ok(res, { id: s._id });
});

router.put("/:id", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const b = req.body;
  if (b.email && b.email.toLowerCase() !== s.email && (await School.exists({ email: b.email.toLowerCase(), _id: { $ne: s._id } }))) return fail(res, 400, "Another school uses that email");
  ["name", "email", "contact", "state", "lga"].forEach((k) => b[k] != null && (s[k] = b[k]));
  if (b.type) s.type = String(b.type).toLowerCase();
  await s.save();
  aud(req, s, "Edited school details");
  ok(res, { id: s._id });
});

router.post("/:id/rep", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const t = s.teachers.find((x) => String(x.user) === String(req.body.userId));
  if (!t) return fail(res, 400, "Choose one of the school's teachers");
  t.verified = true; s.rep = t.user;
  await s.save();
  const u = await User.findById(t.user).select("firstName lastName username").lean();
  aud(req, s, "Changed school rep", `→ ${nameOf(u)}`);
  ok(res, { rep: t.user });
});

router.post("/:id/suspend", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  await AdminFlag.updateOne({ kind: "school", ref: s._id }, { $set: { reason: String(req.body.reason || "").slice(0, 300), by: req.me._id, at: new Date() } }, { upsert: true });
  markSuspended("school", s._id, true);
  aud(req, s, "Suspended school", req.body.reason);
  ok(res, { suspended: true });
});
router.post("/:id/unsuspend", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  await AdminFlag.deleteOne({ kind: "school", ref: s._id });
  markSuspended("school", s._id, false);
  aud(req, s, "Reactivated school");
  ok(res, { suspended: false });
});

router.delete("/:id", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  if (String(req.body.confirmName || "").trim().toLowerCase() !== s.name.toLowerCase()) return fail(res, 400, "School name doesn't match");
  await User.updateMany({ school: s._id }, { $unset: { school: "", "class.level": "", "class.id": "" } });
  await AdminFlag.deleteOne({ kind: "school", ref: s._id });
  markSuspended("school", s._id, false);
  await s.deleteOne();
  aud(req, s, "Deleted school", `${s.students.length} students, ${s.teachers.length} teachers detached`);
  ok(res, { deleted: true });
});

router.post("/:id/subscription-days", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const days = parseInt(req.body.days);
  if (!days || days < 1 || days > 3650) return fail(res, 400, "Enter days between 1 and 3650");
  const now = new Date();
  const start = s.subscription?.expiry && now < s.subscription.expiry ? new Date(s.subscription.expiry) : now;
  s.subscription = { current: now, expiry: new Date(start.getTime() + days * 864e5), isActive: true };
  await s.save();
  await User.updateMany({ _id: { $in: s.teachers.map((t) => t.user) } }, { $set: { subscription: { current: s.subscription.current, expiry: s.subscription.expiry, isActive: true } } });
  aud(req, s, "Granted school subscription days", `+${days} days${req.body.reason ? ` — ${req.body.reason}` : ""}`);
  ok(res, { expiry: s.subscription.expiry });
});

router.post("/:id/wallet-adjust", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const amt = parseFloat(req.body.amount);
  if (!amt || amt === 0) return fail(res, 400, "Enter a non-zero amount");
  const ref = `ADMIN_SCH_${Date.now()}_${s._id}`;
  const desc = `Admin adjustment${req.body.reason ? `: ${req.body.reason}` : ""}`;
  try {
    if (amt > 0) await walletService.credit("school", amt, "adjustment", ref, { schoolId: s._id, userId: req.me._id, description: desc });
    else { await walletService.debit("school", Math.abs(amt), "adjustment", ref, { userId: req.me._id, description: desc }); await WalletTransaction.updateOne({ reference: ref }, { schoolId: s._id }); }
  } catch (e) { return fail(res, 400, e.message); }
  aud(req, s, "Adjusted school wallet", `${amt > 0 ? "+" : "−"}₦${Math.abs(amt).toLocaleString()}${req.body.reason ? ` — ${req.body.reason}` : ""}`);
  ok(res, { adjusted: amt });
});

// ── members ──
const detach = async (userId) => {
  const uid = oid(userId);
  await School.updateMany({ $or: [{ "students.user": uid }, { "teachers.user": uid }] }, { $pull: { students: { user: uid }, teachers: { user: uid }, "classes.$[].students": uid, "classes.$[].teachers": uid } });
};

router.post("/:id/members", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const u = isId(req.body.userId) && (await User.findById(req.body.userId).select("accountType username firstName lastName"));
  if (!u || !["student", "teacher"].includes(u.accountType)) return fail(res, 400, "Choose a student or teacher");
  await detach(u._id);
  const fresh = await School.findById(s._id);
  const set = { school: fresh._id, verified: true };
  if (u.accountType === "teacher") fresh.teachers.push({ user: u._id, verified: true });
  else {
    fresh.students.push({ user: u._id, verified: true });
    const cls = LEVELS.includes(req.body.level) && fresh.classes.find((c) => c.level === req.body.level);
    if (cls) { cls.students.push(u._id); set["class.level"] = cls.level; set["class.id"] = cls._id; }
  }
  await fresh.save();
  await User.updateOne({ _id: u._id }, { $set: set });
  aud(req, fresh, `Added ${u.accountType} to school`, nameOf(u));
  ok(res, { added: true });
});

router.patch("/:id/members/:uid/verify", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const e = [...s.students, ...s.teachers].find((x) => String(x.user) === req.params.uid);
  if (!e) return fail(res, 404, "Member not found");
  e.verified = !!req.body.verified;
  await s.save();
  await User.updateOne({ _id: e.user }, { $set: { verified: e.verified } });
  const u = await User.findById(e.user).select("firstName lastName username").lean();
  aud(req, s, e.verified ? "Verified member" : "Unverified member", nameOf(u));
  ok(res, { verified: e.verified });
});

router.delete("/:id/members/:uid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const u = await User.findById(req.params.uid).select("firstName lastName username").lean();
  await detach(req.params.uid);
  await User.updateOne({ _id: req.params.uid }, { $unset: { school: "", "class.level": "", "class.id": "" } });
  aud(req, s, "Removed member from school", nameOf(u));
  ok(res, { removed: true });
});

// ── classes ──
const loadClass = async (req, res) => {
  const s = await load(req, res); if (!s) return {};
  const c = s.classes.id(req.params.cid);
  if (!c) return fail(res, 404, "Class not found"), {};
  return { s, c };
};
router.put("/:id/classes/:cid", async (req, res) => {
  const { s, c } = await loadClass(req, res); if (!c) return;
  c.alias = String(req.body.alias || "").slice(0, 40);
  await s.save();
  aud(req, s, "Renamed class", `${c.level.toUpperCase()} → ${c.alias || "(no alias)"}`);
  ok(res, { alias: c.alias });
});
router.post("/:id/classes/:cid/members", async (req, res) => {
  const { s, c } = await loadClass(req, res); if (!c) return;
  const { userId, role } = req.body;
  if (role === "teacher") {
    if (!s.teachers.some((t) => String(t.user) === String(userId))) return fail(res, 400, "Not a teacher at this school");
    if (!c.teachers.some((x) => String(x) === String(userId))) c.teachers.push(userId);
  } else {
    if (!s.students.some((t) => String(t.user) === String(userId))) return fail(res, 400, "Not a student at this school");
    s.classes.forEach((k) => (k.students = k.students.filter((x) => String(x) !== String(userId))));
    c.students.push(userId);
    await User.updateOne({ _id: userId }, { $set: { "class.level": c.level, "class.id": c._id } });
  }
  await s.save();
  aud(req, s, `Added ${role === "teacher" ? "teacher" : "student"} to class`, c.level.toUpperCase());
  ok(res, { added: true });
});
router.delete("/:id/classes/:cid/members/:uid", async (req, res) => {
  const { s, c } = await loadClass(req, res); if (!c) return;
  c.teachers = c.teachers.filter((x) => String(x) !== req.params.uid);
  const wasStudent = c.students.some((x) => String(x) === req.params.uid);
  c.students = c.students.filter((x) => String(x) !== req.params.uid);
  await s.save();
  if (wasStudent) await User.updateOne({ _id: req.params.uid }, { $unset: { "class.level": "", "class.id": "" } });
  aud(req, s, "Removed member from class", c.level.toUpperCase());
  ok(res, { removed: true });
});
router.post("/:id/classes/:cid/move", async (req, res) => {
  const { s, c } = await loadClass(req, res); if (!c) return;
  const target = s.classes.find((k) => k.level === req.body.level);
  if (!target) return fail(res, 400, "That class doesn't exist at this school");
  c.students = c.students.filter((x) => String(x) !== String(req.body.userId));
  if (!target.students.some((x) => String(x) === String(req.body.userId))) target.students.push(req.body.userId);
  await s.save();
  await User.updateOne({ _id: req.body.userId }, { $set: { "class.level": target.level, "class.id": target._id } });
  aud(req, s, "Moved student between classes", `${c.level.toUpperCase()} → ${target.level.toUpperCase()}`);
  ok(res, { moved: true });
});
router.post("/:id/classes/:cid/graduate", async (req, res) => {
  const { s, c } = await loadClass(req, res); if (!c) return;
  if (c.level !== "sss 3") return fail(res, 400, "Only SSS 3 can graduate");
  const ids = c.students.map(String);
  if (!ids.length) return fail(res, 400, "No students in this class");
  const users = await User.find({ _id: { $in: ids } }).select("firstName lastName username").lean();
  s.alumni.push({ type: "graduated", fromClass: c.level, students: users.map((u) => ({ user: u._id, name: nameOf(u) })) });
  s.students = s.students.filter((e) => !ids.includes(String(e.user)));
  c.students = [];
  await s.save();
  await User.updateMany({ _id: { $in: ids } }, { $unset: { school: "", "class.level": "", "class.alias": "", "class.id": "" }, $set: { "class.hasChanged": false } });
  aud(req, s, "Graduated class", `SSS 3 · ${ids.length} students`);
  ok(res, { graduated: ids.length });
});

// ── quizzes / assignments / announcements ──
router.put("/:id/quizzes/:qid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const q = s.quiz.id(req.params.qid);
  if (!q) return fail(res, 404, "Quiz not found");
  const st = req.body.status;
  if (!["active", "inactive", "review"].includes(st)) return fail(res, 400, "Invalid status");
  if (st === "review") {
    let sess = q.sessions.id(q.currentSession);
    if (!sess) { q.sessions.push({ _id: q.currentSession || oid(q._id) }); sess = q.sessions[q.sessions.length - 1]; }
    sess.ended = true; q.currentSubmissions = [];
  }
  q.status = st;
  await s.save();
  aud(req, s, "Changed quiz status", `${q.title} → ${st}`);
  ok(res, { status: st });
});
router.delete("/:id/quizzes/:qid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const q = s.quiz.id(req.params.qid);
  if (!q) return fail(res, 404, "Quiz not found");
  const title = q.title;
  s.quiz.pull(q._id);
  await s.save();
  aud(req, s, "Deleted school quiz", title);
  ok(res, { deleted: true });
});
router.put("/:id/assignments/:aid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const a = s.assignments.id(req.params.aid);
  if (!a) return fail(res, 404, "Assignment not found");
  if (!["ongoing", "inactive", "finished"].includes(req.body.status)) return fail(res, 400, "Invalid status");
  a.status = req.body.status;
  await s.save();
  aud(req, s, "Changed assignment status", `${a.title} → ${a.status}`);
  ok(res, { status: a.status });
});
router.post("/:id/assignments/:aid/extend", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const a = s.assignments.id(req.params.aid);
  if (!a) return fail(res, 404, "Assignment not found");
  const days = parseInt(req.body.days);
  if (!days || days < 1 || days > 365) return fail(res, 400, "Enter days between 1 and 365");
  const base = a.expiry && new Date(a.expiry) > new Date() ? new Date(a.expiry) : new Date();
  a.expiry = new Date(base.getTime() + days * 864e5);
  a.status = "ongoing";
  await s.save();
  aud(req, s, "Extended assignment deadline", `${a.title} +${days}d`);
  ok(res, { expiry: a.expiry });
});
router.delete("/:id/assignments/:aid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const a = s.assignments.id(req.params.aid);
  if (!a) return fail(res, 404, "Assignment not found");
  const title = a.title;
  s.assignments.pull(a._id);
  await s.save();
  aud(req, s, "Deleted assignment", title);
  ok(res, { deleted: true });
});
router.delete("/:id/assignments/:aid/submissions/:sid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  const a = s.assignments.id(req.params.aid);
  if (!a) return fail(res, 404, "Assignment not found");
  a.submissions.pull(req.params.sid);
  await s.save();
  aud(req, s, "Deleted assignment submission", a.title);
  ok(res, { deleted: true });
});
router.delete("/:id/announcements/:nid", async (req, res) => {
  const s = await load(req, res); if (!s) return;
  s.announcements.pull(req.params.nid);
  await s.save();
  aud(req, s, "Deleted announcement");
  ok(res, { deleted: true });
});

module.exports = router;
