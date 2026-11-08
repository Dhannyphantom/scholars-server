// Guru Admin Dashboard API — mounted at /admin-panel
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");
const ejs = require("ejs");
const mongoose = require("mongoose");
const router = express.Router();

const { User } = require("../models/User");
const { School } = require("../models/School");
const { Quiz } = require("../models/Quiz");
const { Question } = require("../models/Question");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { SupportTicket } = require("../models/SupportTicket");
const { AppInfo } = require("../models/AppInfo");
const { AuditLog } = require("../models/AuditLog");
const { OnlineQuizCompetition } = require("../models/OnlineQuizCompetition");
const WalletTransaction = require("../models/WalletTransaction");
const PayoutRequest = require("../models/PayoutRequest");
const walletService = require("../controllers/walletService");
const { AdminFlag, ActivityEvent, UserActivity, AdminProfile, ProTokenLog } = require("../models/AdminMisc");
const { staffAuth, managerOnly } = require("../middlewares/staffAuth");
const { markSuspended } = require("../middlewares/guard");
const { record } = require("../controllers/auditService");
const { memberAnalytics } = require("../controllers/memberAnalytics");
const expoNotifications = require("../controllers/expoNotifications");
const { sendMail } = require("../controllers/mailer");
const H = require("../controllers/adminHelpers");
const { isId, oid, cap, nameOf, roleLabel, createdOf, isPremium, idFromDate, esc, ok, fail, normPhone, monthsBack, fillMonths, sendCsv, paging } = H;

const ACTIVE_T = ["open", "in_progress", "waiting_user"];

// ───────────────────────── AUTH (public) ─────────────────────────
const otpStore = new Map(); // email -> { otp, expiresAt, attempts }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sendVerifyMail = async (user) => {
  const otp = String(crypto.randomInt(100000, 999999));
  otpStore.set(user.email, { otp, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0, at: Date.now() });
  const html = await ejs.renderFile(path.join(__dirname, "../views/email_verification.ejs"), {
    userName: user.firstName || user.username, otp, expiryMinutes: 10, appName: "Guru EduTech", supportEmail: process.env.MAIL_FROM, year: new Date().getFullYear(),
  });
  return sendMail({ to: user.email, subject: "Verify your email address", html });
};

router.post("/auth/login", async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return fail(res, 400, "Enter your username/email and password");
  const id = String(identifier).trim().toLowerCase();
  const isNum = /^\d+$/.test(id.replace(/\D/g, "")) && !id.includes("@");
  const user = await User.findOne({ $or: [{ username: id }, { email: id }, ...(isNum ? [{ contact: normPhone(id) }] : [])] });
  if (!user || !(await bcrypt.compare(password, user.password))) return fail(res, 400, "Incorrect username or password");
  if (!["manager", "professional"].includes(user.accountType)) return fail(res, 403, "This dashboard is for Guru staff only");
  if (await AdminFlag.exists({ kind: "user", ref: user._id })) return fail(res, 403, "This account has been suspended");
  if (user.accountType === "professional" && !user.verified)
    return fail(res, 403, "Your professional account is awaiting verification by a manager.", { code: "PENDING_VERIFICATION" });
  const token = user.generateAuthToken();
  record(user._id, { action: "Signed in", cat: "auth" });
  ok(res, { token });
});

router.post("/auth/signup", async (req, res) => {
  const { username, email, phone, password, token } = req.body || {};
  const uname = String(username || "").trim().toLowerCase();
  const mail = String(email || "").trim().toLowerCase();
  const contact = normPhone(phone);
  if (uname.length < 4 || uname.length > 15) return fail(res, 400, "Username must be 4–15 characters");
  if (!EMAIL_RE.test(mail)) return fail(res, 400, "Enter a valid email address");
  if (!/^[789]\d{9}$/.test(contact)) return fail(res, 400, "Phone must be 10 digits (e.g. 7081234567)");
  if (!password || password.length < 8) return fail(res, 400, "Password must be at least 8 characters");
  const appInfo = await AppInfo.findOne({ ID: "APP" });
  if (!token || !appInfo || appInfo.PRO_TOKEN !== token) return fail(res, 400, "That access token isn't valid");
  if (await User.findOne({ username: uname })) return fail(res, 400, "Username has been used already");
  if (await User.findOne({ contact })) return fail(res, 400, "Phone number is already registered");
  if (await User.findOne({ email: mail, accountType: { $in: ["manager", "professional"] } })) return fail(res, 400, "Email is already registered");

  const user = new User({ username: uname, contact, email: mail, accountType: "professional", password: await bcrypt.hash(password, 10) });
  let code = crypto.randomBytes(4).toString("hex");
  while (await User.exists({ "rewards.code": code })) code = crypto.randomBytes(4).toString("hex");
  user.rewards = { code, history: [], point: 0 };
  await user.save();

  // single-use pro token (same behaviour as the mobile registration)
  const next = `mosdan@gurupro${Math.floor(Math.random() * 10e9)}`;
  await AppInfo.updateOne({ ID: "APP" }, { $set: { PRO_TOKEN: next } });
  await ProTokenLog.create({ token: next, byName: "System (auto-rotated after sign-up)" });

  const sent = await sendVerifyMail(user);
  ok(res, { emailSent: !!sent }, { message: "Account created" });

  const managers = await User.find({ accountType: "manager" }).select("expoPushToken").lean();
  expoNotifications(managers.map((m) => m.expoPushToken).filter(Boolean), { title: "New professional registered", message: `${uname} has just created an account`, data: {} }).catch(() => {});
});

router.post("/auth/verify-email", async (req, res) => {
  const mail = String(req.body?.email || "").toLowerCase();
  const rec = otpStore.get(mail);
  if (!rec || Date.now() > rec.expiresAt) return fail(res, 400, "Code expired — request a new one");
  if (++rec.attempts > 5) { otpStore.delete(mail); return fail(res, 429, "Too many attempts — request a new code"); }
  if (rec.otp !== String(req.body?.otp || "").trim()) return fail(res, 400, `Incorrect code. ${5 - rec.attempts} attempts left`);
  otpStore.delete(mail);
  await User.updateOne({ email: mail, accountType: "professional" }, { $set: { emailVerified: true } });
  ok(res, { verified: true });
});

router.post("/auth/resend", async (req, res) => {
  const mail = String(req.body?.email || "").toLowerCase();
  const user = await User.findOne({ email: mail, accountType: "professional" });
  if (!user) return ok(res, { sent: true });
  const rec = otpStore.get(mail);
  if (rec && Date.now() - rec.at < 60 * 1000) return fail(res, 429, "Please wait a minute before requesting another code");
  await sendVerifyMail(user);
  ok(res, { sent: true });
});

// ───────────────────────── everything below needs staff ─────────────────────────
router.use(staffAuth);

const memberCard = (u, prof, extra = {}) => ({
  id: u._id, name: nameOf(u), firstName: u.firstName, lastName: u.lastName, username: u.username, email: u.email, emailVerified: !!u.emailVerified,
  phone: u.contact, role: roleLabel(u.accountType), verified: !!u.verified, state: u.state, gender: u.gender, avatar: u.avatar?.image || null,
  bio: prof?.bio || "", org: prof?.org || "", notif: prof?.notif || { ticket: true, weekly: true }, joinedAt: createdOf(u), ...extra,
});

// ── Me ──
router.get("/me", async (req, res) => {
  const prof = await AdminProfile.findOne({ user: req.me._id }).lean();
  ok(res, memberCard(req.me, prof));
});

router.put("/me", async (req, res) => {
  const { name, username, email, phone, state, org, gender, bio, notif } = req.body || {};
  const set = {};
  if (name != null) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts[0]) set.firstName = parts[0].toLowerCase();
    if (parts.length > 1) set.lastName = parts.slice(1).join(" ").toLowerCase();
  }
  if (username != null) {
    const un = String(username).trim().toLowerCase();
    if (un.length < 4 || un.length > 15) return fail(res, 400, "Username must be 4–15 characters");
    if (un !== req.me.username && (await User.exists({ username: un }))) return fail(res, 400, "Username is taken");
    set.username = un;
  }
  if (email != null) {
    const em = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return fail(res, 400, "Enter a valid email address");
    if (em !== req.me.email) { set.email = em; set.emailVerified = false; }
  }
  if (phone != null) {
    const c = normPhone(phone);
    if (!/^[789]\d{9}$/.test(c)) return fail(res, 400, "Phone must be 10 digits");
    if (c !== req.me.contact && (await User.exists({ contact: c }))) return fail(res, 400, "Phone number is already registered");
    set.contact = c;
  }
  if (state != null) set.state = String(state).toLowerCase();
  if (gender != null) set.gender = { female: "female", male: "male", other: "others", others: "others" }[String(gender).toLowerCase()] || undefined;
  if (Object.keys(set).length) await User.updateOne({ _id: req.me._id }, { $set: set });
  await AdminProfile.updateOne({ user: req.me._id }, { $set: { ...(bio != null && { bio: String(bio).slice(0, 300) }), ...(org != null && { org: String(org).slice(0, 120) }), ...(notif && { notif: { ticket: !!notif.ticket, weekly: !!notif.weekly } }) } }, { upsert: true });
  const [u, prof] = await Promise.all([User.findById(req.me._id).select("-password -__v").lean(), AdminProfile.findOne({ user: req.me._id }).lean()]);
  record(req, { action: "Updated own profile", cat: "auth" });
  ok(res, memberCard(u, prof));
});

router.post("/me/password", async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 8) return fail(res, 400, "New password must be at least 8 characters");
  const u = await User.findById(req.me._id);
  if (!(await bcrypt.compare(current || "", u.password))) return fail(res, 400, "Current password is incorrect");
  u.password = await bcrypt.hash(next, 12);
  await u.save();
  record(req, { action: "Changed own password", cat: "auth" });
  ok(res, { changed: true });
});

router.delete("/me/avatar", async (req, res) => {
  try {
    const { deleteFile } = require("../middlewares/uploadToS3");
    const img = req.me.avatar?.image;
    if (img?.uri) await deleteFile(img.uri).catch(() => {});
    if (img?.thumb) await deleteFile(img.thumb).catch(() => {});
  } catch {}
  await User.updateOne({ _id: req.me._id }, { $unset: { "avatar.image": 1 } });
  ok(res, { removed: true });
});

router.get("/me/analytics", async (req, res) => ok(res, await memberAnalytics(req.me._id, !req.isManager)));

// ── Staff list (assignees etc.) ──
router.get("/staff", async (req, res) => {
  const list = await User.find({ accountType: "manager" }).select("firstName lastName username avatar").lean();
  ok(res, list.map((u) => ({ id: u._id, name: nameOf(u), avatar: u.avatar?.image || null })));
});

// ───────────────────────── manager-only from here ─────────────────────────
// (library + question upload are mounted BEFORE this gate — professionals may use them)
router.use("/library", require("./adminPanelLibrary"));
router.use(managerOnly);

// ── Overview ──
router.get("/overview", async (req, res) => {
  const now = new Date();
  const d30 = idFromDate(new Date(now - 30 * 864e5));
  const since12 = monthsBack(12)[0].start;
  const [students, newStudents, schools, newSchools, premium, totalUsers, quizzes, newQuizzes, questions, subjectsN, gt, pendingPayouts,
    ticketsOpen, unassigned, unread, pendingPros, suspended, expiredSchools, latestComp, endedComps, usersByType, qByCat, rev, recentAudit, top, wallets] = await Promise.all([
    User.countDocuments({ accountType: "student" }),
    User.countDocuments({ accountType: "student", _id: { $gte: d30 } }),
    School.countDocuments(),
    School.countDocuments({ createdAt: { $gte: new Date(now - 30 * 864e5) } }),
    User.countDocuments({ "subscription.isActive": true, "subscription.expiry": { $gt: now } }),
    User.countDocuments(),
    Quiz.countDocuments(),
    Quiz.countDocuments({ date: { $gte: new Date(now - 30 * 864e5) } }),
    Question.countDocuments(),
    Subject.countDocuments(),
    User.aggregate([{ $group: { _id: null, n: { $sum: "$points" } } }]),
    PayoutRequest.countDocuments({ status: { $in: ["pending", "processing"] } }),
    SupportTicket.countDocuments({ status: { $in: ACTIVE_T } }),
    SupportTicket.countDocuments({ status: { $in: ACTIVE_T }, assignedTo: null }),
    SupportTicket.countDocuments({ status: { $in: ACTIVE_T }, messages: { $elemMatch: { sender: "user", status: { $ne: "read" } } } }),
    User.countDocuments({ accountType: "professional", verified: false }),
    AdminFlag.countDocuments({ kind: "user" }),
    School.countDocuments({ "subscription.expiry": { $lt: now } }),
    OnlineQuizCompetition.findOne().sort({ year: -1, month: -1 }).select("title month year status resultsPublished startTime endTime totalParticipants totalQuestions prizes").lean(),
    OnlineQuizCompetition.countDocuments({ status: "active", endTime: { $lt: now }, resultsPublished: false }),
    User.aggregate([{ $group: { _id: "$accountType", n: { $sum: 1 } } }]),
    Question.aggregate([{ $unwind: "$categories" }, { $group: { _id: "$categories", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 6 }, { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "c" } }]),
    WalletTransaction.aggregate([
      { $match: { createdAt: { $gte: since12 }, status: "completed", category: { $in: ["subscription", "payout"] }, transactionType: { $in: ["credit", "debit"] } } },
      { $group: { _id: { m: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, c: "$category" }, v: { $sum: "$amount" } } },
    ]),
    AuditLog.find().sort({ at: -1 }).limit(5).lean(),
    User.find({ accountType: "student" }).sort({ totalPoints: -1 }).limit(5).select("firstName lastName username totalPoints class avatar school").populate("school", "name").lean(),
    walletService.getAllBalances(),
  ]);
  const pick = (c) => fillMonths(rev.filter((r) => r._id.c === c).map((r) => ({ _id: r._id.m, count: r.v })));
  ok(res, {
    stats: { students, newStudents, schools, newSchools, premium, totalUsers, quizzes, newQuizzes, questions, subjects: subjectsN, gt: gt[0]?.n || 0, pendingPayouts },
    attention: { ticketsOpen, unassigned, unread, pendingPros, suspended, expiredSchools, endedComps, pendingPayouts },
    competition: latestComp,
    usersByType: usersByType.map((r) => ({ name: roleLabel(r._id), value: r.n })),
    questionsByCategory: qByCat.map((r) => ({ name: r.c?.[0]?.name || "Unknown", value: r.n })),
    revenue: { months: pick("subscription").map((m) => m.label), subscriptions: pick("subscription").map((m) => m.value), withdrawals: pick("payout").map((m) => m.value) },
    recentAudit,
    topStudents: top.map((u) => ({ id: u._id, name: nameOf(u), points: u.totalPoints, school: u.school?.name || "", level: u.class?.level || "", avatar: u.avatar?.image || null })),
    wallets,
  });
});

// ── Users ──
const userFilter = async (q) => {
  const f = {};
  const ands = [];
  if (q.role) f.accountType = String(q.role).toLowerCase();
  if (q.plan === "Premium") Object.assign(f, { "subscription.isActive": true, "subscription.expiry": { $gt: new Date() } });
  if (q.plan === "Freemium") ands.push({ $nor: [{ "subscription.isActive": true, "subscription.expiry": { $gt: new Date() } }] });
  if (q.status) {
    const ids = (await AdminFlag.find({ kind: "user" }).select("ref").lean()).map((x) => x.ref);
    ands.push({ _id: q.status === "Suspended" ? { $in: ids } : { $nin: ids } });
  }
  if (q.q) {
    const rx = new RegExp(esc(String(q.q).trim()), "i");
    const schools = await School.find({ name: rx }).select("_id").limit(20).lean();
    ands.push({ $or: [{ firstName: rx }, { lastName: rx }, { username: rx }, { email: rx }, ...(schools.length ? [{ school: { $in: schools.map((s) => s._id) } }] : [])] });
  }
  if (ands.length) f.$and = ands;
  return f;
};
const userRow = (u, flags) => ({
  id: u._id, name: nameOf(u), username: u.username, role: roleLabel(u.accountType), plan: isPremium(u) ? "Premium" : "Freemium", gt: u.points || 0,
  streak: u.streak || 0, school: u.school?.name || null, schoolId: u.school?._id || null, suspended: flags.has(String(u._id)), verified: !!u.verified,
  avatar: u.avatar?.image || null, joinedAt: createdOf(u),
});

router.get("/users", async (req, res) => {
  const { page, limit, skip } = paging(req.query, 20);
  const f = await userFilter(req.query);
  const [rows, total] = await Promise.all([
    User.find(f).sort({ _id: -1 }).skip(skip).limit(limit).select("firstName lastName username accountType subscription points streak school verified avatar").populate("school", "name").lean(),
    User.countDocuments(f),
  ]);
  const flags = new Set((await AdminFlag.find({ kind: "user", ref: { $in: rows.map((r) => r._id) } }).select("ref").lean()).map((x) => String(x.ref)));
  ok(res, rows.map((u) => userRow(u, flags)), { total, page, pages: Math.ceil(total / limit) });
});

router.get("/users/export", async (req, res) => {
  const f = await userFilter(req.query);
  const rows = await User.find(f).sort({ _id: -1 }).limit(20000).select("firstName lastName username email contact accountType subscription points streak school verified").populate("school", "name").lean();
  const flags = new Set((await AdminFlag.find({ kind: "user" }).select("ref").lean()).map((x) => String(x.ref)));
  record(req, { action: "Exported users", target: `${rows.length} rows`, cat: "export" });
  sendCsv(res, "guru-users.csv", ["Name", "Username", "Email", "Phone", "Role", "Plan", "GT", "Streak", "School", "Status", "Joined"],
    rows.map((u) => [nameOf(u), u.username, u.email, u.contact, roleLabel(u.accountType), isPremium(u) ? "Premium" : "Freemium", u.points || 0, u.streak || 0, u.school?.name || "", flags.has(String(u._id)) ? "Suspended" : "Active", createdOf(u)?.toISOString().slice(0, 10)]));
});

router.get("/users/search", async (req, res) => {
  const rx = new RegExp(esc(String(req.query.q || "").trim()), "i");
  const roles = String(req.query.roles || "student,teacher").split(",");
  const rows = await User.find({ accountType: { $in: roles }, $or: [{ firstName: rx }, { lastName: rx }, { username: rx }] }).limit(15).select("firstName lastName username accountType school class").populate("school", "name").lean();
  ok(res, rows.map((u) => ({ id: u._id, name: nameOf(u), username: u.username, role: roleLabel(u.accountType), school: u.school?.name || null, level: u.class?.level || null })));
});

router.get("/users/:id", async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id");
  const id = oid(req.params.id);
  const u = await User.findById(id).select("-password -__v -qBank -activeDays -quotas").populate("school", "name type state lga").lean();
  if (!u) return fail(res, 404, "User not found");
  const isPro = u.accountType === "professional";
  const [flag, subjects, qN, tN, txs, prof, act] = await Promise.all([
    AdminFlag.findOne({ kind: "user", ref: id }).lean(),
    isPro && u.subjects?.length ? Subject.find({ _id: { $in: u.subjects } }).select("name").lean() : [],
    isPro ? Question.countDocuments({ user: id }) : 0,
    isPro ? Topic.countDocuments({ user: id }) : 0,
    WalletTransaction.find({ userId: id }).sort({ createdAt: -1 }).limit(10).select("transactionType category amount description createdAt status metadata").lean(),
    AdminProfile.findOne({ user: id }).lean(),
    UserActivity.findOne({ user: id }).lean(),
  ]);
  ok(res, {
    ...memberCard(u, prof), contactCode: u.contactCode, birthday: u.birthday, lga: u.lga, address: u.address, country: u.country, preffix: u.preffix,
    plan: isPremium(u) ? "Premium" : "Freemium", subscription: u.subscription, points: u.points || 0, totalPoints: u.totalPoints || 0, schoolPoints: u.schoolPoints || 0,
    streak: u.streak || 0, rank: u.rank, leaderboardRank: u.leaderboardRank, class: u.class, schoolLevel: u.schoolLevel,
    school: u.school ? { id: u.school._id, name: u.school.name, type: u.school.type, state: u.school.state, lga: u.school.lga } : null,
    followers: u.followers?.length || 0, following: u.following?.length || 0,
    quizStats: u.quizStats || {}, quizHistory: (u.quizHistory || []).slice(0, 6), invites: { total: (u.invites || []).length, pending: (u.invites || []).filter((i) => i.status === "pending").length },
    rewards: { code: u.rewards?.code, point: u.rewards?.point || 0, history: (u.rewards?.history || []).slice(-5).reverse() },
    quota: u.quota ? { daily: u.quota.daily_questions_count || 0, weekly: u.quota.point_per_week || 0, lastUpdate: u.quota.last_update } : null,
    device: { pushRegistered: !!u.expoPushToken, lastSeenAt: act?.lastSeenAt || null, lastPath: act?.lastPath || null, requests: act?.hits || 0 },
    subjects: subjects.map((s) => ({ id: s._id, name: s.name })), questionsCount: qN, topicsCount: tN,
    transactions: txs, txHistory: (u.tx_history || []).slice(-5).reverse(),
    suspended: !!flag, suspendReason: flag?.reason || null, suspendedAt: flag?.at || null,
  });
});

const requireUser = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id"), null;
  const u = await User.findById(req.params.id);
  if (!u) return fail(res, 404, "User not found"), null;
  return u;
};
const notifyUserPush = (u, title, message) => u?.expoPushToken && expoNotifications([u.expoPushToken], { title, message, data: {} }).catch(() => {});

router.post("/users/:id/subscription-days", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  const days = parseInt(req.body.days);
  if (!days || days < 1 || days > 3650) return fail(res, 400, "Enter a number of days between 1 and 3650");
  const now = new Date();
  const start = u.subscription?.expiry && now < u.subscription.expiry ? new Date(u.subscription.expiry) : now;
  u.subscription.expiry = new Date(start.getTime() + days * 864e5);
  u.subscription.current = now;
  u.subscription.isActive = true;
  u.tx_history.push({ type: "subscription", date: now, message: `+${days} days (granted by staff)`, amount: 0 });
  await u.save();
  record(req, { action: "Granted subscription days", target: `@${u.username}`, detail: `+${days} days${req.body.reason ? ` — ${req.body.reason}` : ""}`, cat: "user" });
  ok(res, { expiry: u.subscription.expiry });
});

router.post("/users/:id/adjust-points", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  const amt = Math.trunc(Number(req.body.amount));
  if (!amt) return fail(res, 400, "Enter a non-zero amount");
  const before = u.points || 0;
  const after = Math.max(0, before + amt);
  await User.updateOne({ _id: u._id }, { $set: { points: after } });
  await WalletTransaction.create({
    accountType: "student", transactionType: "points", category: "adjustment", amount: 0, balanceBefore: 0, balanceAfter: 0, userId: u._id,
    reference: `ADJ_PTS_${Date.now()}_${u._id}`, description: `Manual GT adjustment ${amt > 0 ? "+" : ""}${amt}${req.body.reason ? ` — ${req.body.reason}` : ""}`,
    metadata: { pointsBefore: before, pointsAfter: after, by: String(req.me._id) }, status: "completed",
  });
  record(req, { action: "Adjusted GT balance", target: `@${u.username}`, detail: `${amt > 0 ? "+" : ""}${amt} GT${req.body.reason ? ` — ${req.body.reason}` : ""}`, cat: "user" });
  ok(res, { points: after });
});

router.post("/users/:id/role", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  const role = String(req.body.role || "").toLowerCase();
  if (!["student", "teacher", "professional", "manager"].includes(role)) return fail(res, 400, "Invalid role");
  if (String(u._id) === String(req.me._id)) return fail(res, 400, "You can't change your own role");
  if (role === u.accountType) return fail(res, 400, "User already has that role");
  const old = u.accountType;
  const set = { accountType: role };
  const unset = {};
  if (role === "professional") { set.verified = false; set.subjects = []; }
  if (old === "professional" && role !== "professional") set.subjects = [];
  if (["student", "teacher"].includes(old) && !["student", "teacher"].includes(role)) {
    await School.updateMany({}, { $pull: { students: { user: u._id }, teachers: { user: u._id }, "classes.$[].students": u._id, "classes.$[].teachers": u._id } });
    unset.school = ""; unset["class.level"] = ""; unset["class.id"] = "";
  } else if (old === "student" && role === "teacher") {
    await School.updateMany({ "students.user": u._id }, { $pull: { students: { user: u._id }, "classes.$[].students": u._id } });
    unset.school = ""; unset["class.level"] = ""; unset["class.id"] = "";
  } else if (old === "teacher" && role === "student") {
    await School.updateMany({ "teachers.user": u._id }, { $pull: { teachers: { user: u._id }, "classes.$[].teachers": u._id } });
    unset.school = "";
  }
  await User.updateOne({ _id: u._id }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) });
  record(req, { action: "Changed role", target: `@${u.username}`, detail: `${roleLabel(old)} → ${roleLabel(role)}`, cat: "user" });
  notifyUserPush(u, "Role updated", `Your account role is now ${roleLabel(role)}.`);
  ok(res, { role: roleLabel(role) });
});

router.post("/users/:id/suspend", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  if (u.accountType === "manager") return fail(res, 400, "Managers can't be suspended");
  const reason = String(req.body.reason || "").slice(0, 300);
  await AdminFlag.updateOne({ kind: "user", ref: u._id }, { $set: { reason, by: req.me._id, at: new Date() } }, { upsert: true });
  markSuspended("user", u._id, true);
  record(req, { action: "Suspended user", target: `@${u.username}`, detail: reason, cat: "user" });
  ok(res, { suspended: true });
});
router.post("/users/:id/unsuspend", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  await AdminFlag.deleteOne({ kind: "user", ref: u._id });
  markSuspended("user", u._id, false);
  record(req, { action: "Reactivated user", target: `@${u.username}`, cat: "user" });
  ok(res, { suspended: false });
});

router.post("/users/:id/notify", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  if (!u.expoPushToken) return fail(res, 400, "This user hasn't registered a device for push notifications");
  await expoNotifications([u.expoPushToken], { title: req.body.title || "Message from Guru", message: req.body.message || "", data: {} });
  record(req, { action: "Sent push to user", target: `@${u.username}`, detail: req.body.title, cat: "notify" });
  ok(res, { sent: true });
});

// ── Professionals ──
router.get("/professionals", async (req, res) => {
  const pros = await User.find({ accountType: "professional" }).sort({ verified: 1, _id: -1 }).select("firstName lastName username email contact subjects verified avatar").lean();
  const ids = pros.map((p) => p._id);
  const [qs, ts, subs] = await Promise.all([
    Question.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: "$user", n: { $sum: 1 } } }]),
    Topic.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: "$user", n: { $sum: 1 } } }]),
    Subject.find({ _id: { $in: pros.flatMap((p) => p.subjects || []) } }).select("name").lean(),
  ]);
  const q = new Map(qs.map((x) => [String(x._id), x.n])), t = new Map(ts.map((x) => [String(x._id), x.n])), s = new Map(subs.map((x) => [String(x._id), x.name]));
  ok(res, pros.map((p) => ({ id: p._id, name: nameOf(p), username: p.username, email: p.email, phone: p.contact, verified: !!p.verified, avatar: p.avatar?.image || null,
    subjects: (p.subjects || []).map((i) => ({ id: i, name: s.get(String(i)) })), questions: q.get(String(p._id)) || 0, topics: t.get(String(p._id)) || 0 })));
});

router.post("/users/:id/pro", async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  if (u.accountType !== "professional") return fail(res, 400, "Not a professional account");
  const { action, subjects = [] } = req.body;
  if (action === "verify") {
    if (!subjects.length) return fail(res, 400, "Select at least one subject");
    await User.updateOne({ _id: u._id }, { $set: { verified: true, subjects: subjects.filter(isId) } });
    notifyUserPush(u, "Verification Success", "Your account is now verified with access to professional features. Welcome to the team!");
  } else if (action === "revoke") {
    await User.updateOne({ _id: u._id }, { $set: { verified: false, subjects: [] } });
    notifyUserPush(u, "Pro Access Revoked", "You can no longer access Pro features. Please contact admin.");
  } else if (action === "reject") {
    notifyUserPush(u, "Pro Access Rejected", "Sorry, you're not eligible to access Pro features. Please contact admin.");
    await User.deleteOne({ _id: u._id });
  } else return fail(res, 400, "Invalid action");
  record(req, { action: { verify: "Verified professional", revoke: "Revoked professional", reject: "Rejected professional" }[action], target: `@${u.username}`, detail: action === "verify" ? `${subjects.length} subject(s)` : "", cat: "professional" });
  ok(res, { done: true });
});

// ── Team ──
router.get("/team", async (req, res) => {
  const f = { accountType: { $in: ["manager", "professional"] }, _id: { $ne: req.me._id } };
  if (req.query.role) f.accountType = req.query.role.toLowerCase();
  if (req.query.q) { const rx = new RegExp(esc(req.query.q), "i"); f.$or = [{ firstName: rx }, { lastName: rx }, { username: rx }]; }
  const rows = await User.find(f).sort({ _id: -1 }).select("firstName lastName username email accountType verified avatar subjects").lean();
  const flags = new Set((await AdminFlag.find({ kind: "user", ref: { $in: rows.map((r) => r._id) } }).select("ref").lean()).map((x) => String(x.ref)));
  const subs = await Subject.find({ _id: { $in: rows.flatMap((r) => r.subjects || []) } }).select("name").lean();
  const sm = new Map(subs.map((s) => [String(s._id), s.name]));
  let out = rows.map((u) => ({ id: u._id, name: nameOf(u), username: u.username, email: u.email, role: roleLabel(u.accountType), avatar: u.avatar?.image || null, subjects: (u.subjects || []).map((i) => sm.get(String(i))).filter(Boolean),
    status: flags.has(String(u._id)) ? "Suspended" : u.accountType === "professional" && !u.verified ? "Pending" : "Active" }));
  if (req.query.status) out = out.filter((u) => u.status === req.query.status);
  ok(res, out);
});

router.get("/team/:id", async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id");
  const u = await User.findById(req.params.id).select("-password -__v").lean();
  if (!u || !["manager", "professional"].includes(u.accountType)) return fail(res, 404, "Team member not found");
  const [prof, flag, analytics, subs, actions] = await Promise.all([
    AdminProfile.findOne({ user: u._id }).lean(), AdminFlag.findOne({ kind: "user", ref: u._id }).lean(), memberAnalytics(u._id, u.accountType === "professional"),
    Subject.find({ _id: { $in: u.subjects || [] } }).select("name").lean(),
    AuditLog.find({ target: `@${u.username}` }).sort({ at: -1 }).limit(8).lean(),
  ]);
  ok(res, { member: memberCard(u, prof, { suspended: !!flag, suspendReason: flag?.reason, subjects: subs.map((s) => ({ id: s._id, name: s.name })),
    status: flag ? "Suspended" : u.accountType === "professional" && !u.verified ? "Pending" : "Active" }), analytics, actions });
});

// ── Pro token ──
router.get("/tokens", async (req, res) => {
  const info = await AppInfo.findOne({ ID: "APP" }).select("PRO_TOKEN").lean();
  let history = await ProTokenLog.find().sort({ at: -1 }).limit(20).lean();
  if (!history.length && info?.PRO_TOKEN) history = [await ProTokenLog.create({ token: info.PRO_TOKEN, byName: "Initial token" })];
  ok(res, { length: info?.PRO_TOKEN?.length || 0, history: history.map((h) => ({ id: h._id, token: h.token, by: h.byName, at: h.at, active: h.token === info?.PRO_TOKEN })) });
});
router.post("/tokens/reveal", async (req, res) => {
  const info = await AppInfo.findOne({ ID: "APP" }).select("PRO_TOKEN").lean();
  record(req, { action: "Revealed pro token", cat: "token" });
  ok(res, { token: info?.PRO_TOKEN });
});
router.post("/tokens/log", async (req, res) => {
  const ev = { copy: "Copied pro token", share: "Shared pro token" }[req.body.event];
  if (!ev) return fail(res, 400, "Unknown event");
  record(req, { action: ev, cat: "token" });
  ok(res, { logged: true });
});
router.put("/tokens", async (req, res) => {
  const token = String(req.body.token || "").trim();
  if (token.length < 4 || token.length > 25) return fail(res, 400, "Token must be 4–25 characters");
  await AppInfo.updateOne({ ID: "APP" }, { $set: { PRO_TOKEN: token } });
  await ProTokenLog.create({ token, by: req.me._id, byName: nameOf(req.me) });
  record(req, { action: "Changed pro token", detail: "New value not logged", cat: "token" });
  ok(res, { changed: true });
});

// ── Live events (query-driven; polled by the client) ──
router.get("/events", async (req, res) => {
  const limit = Math.min(60, parseInt(req.query.limit) || 40);
  const type = req.query.type;
  const want = (t) => !type || type === "all" || type === t;
  const since = new Date(Date.now() - 14 * 864e5);
  const [tracked, quizzes, txs, signups, tickets, schools, joins] = await Promise.all([
    ActivityEvent.find({ ...(type && type !== "all" && { type }) }).sort({ at: -1 }).limit(limit).lean(),
    want("quiz") ? Quiz.find({ date: { $gte: since } }).sort({ date: -1 }).limit(limit).select("user date summary subjects mode").populate("subjects", "name").lean() : [],
    want("payment") ? WalletTransaction.find({ createdAt: { $gte: since }, status: "completed", category: { $in: ["subscription", "payout"] } }).sort({ createdAt: -1 }).limit(limit).select("userId category amount createdAt transactionType description").lean() : [],
    want("auth") ? User.find({ _id: { $gte: idFromDate(since) } }).sort({ _id: -1 }).limit(limit).select("firstName lastName username accountType").lean() : [],
    want("support") ? SupportTicket.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(limit).select("user categoryTitle subject createdAt").lean() : [],
    want("school") ? School.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(limit).select("name createdAt rep").lean() : [],
    0,
  ]);
  const uids = [...tracked.map((e) => e.user), ...quizzes.map((e) => e.user), ...txs.map((e) => e.userId), ...tickets.map((e) => e.user), ...schools.map((e) => e.rep)].filter(Boolean);
  const users = await User.find({ _id: { $in: uids } }).select("firstName lastName username").lean();
  const um = new Map(users.map((u) => [String(u._id), u]));
  const who = (id) => { const u = um.get(String(id)); return u ? { userId: u._id, name: nameOf(u) } : { userId: null, name: "Someone" }; };
  const ev = [];
  tracked.forEach((e) => ev.push({ id: `a${e._id}`, type: e.type, at: e.at, ...who(e.user), text: e.text }));
  quizzes.forEach((q) => ev.push({ id: `q${q._id}`, type: "quiz", at: q.date, ...who(q.user), text: `completed a ${(q.subjects || []).map((s) => cap(s.name)).join(" & ") || "quiz"} ${q.mode === "friends" ? "multiplayer " : ""}quiz`, tag: `${q.summary?.pointsEarned >= 0 ? "+" : ""}${q.summary?.pointsEarned || 0} GT` }));
  txs.forEach((t) => ev.push({ id: `t${t._id}`, type: "payment", at: t.createdAt, ...who(t.userId), text: t.category === "subscription" ? "paid for a subscription" : "received a payout", tag: `₦${Number(t.amount).toLocaleString()}` }));
  signups.forEach((u) => ev.push({ id: `u${u._id}`, type: "auth", at: u._id.getTimestamp(), userId: u._id, name: nameOf(u), text: `created a new ${u.accountType} account` }));
  tickets.forEach((t) => ev.push({ id: `s${t._id}`, type: "support", at: t.createdAt, ...who(t.user), text: `opened a support ticket — ${t.categoryTitle || t.subject || "Help"}` }));
  schools.forEach((s) => ev.push({ id: `c${s._id}`, type: "school", at: s.createdAt, ...who(s.rep), text: `registered a new school — ${cap(s.name)}` }));
  ev.sort((a, b) => new Date(b.at) - new Date(a.at));
  const [online, activeToday] = await Promise.all([
    UserActivity.countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } }),
    UserActivity.countDocuments({ lastSeenAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
  ]);
  ok(res, ev.slice(0, limit), { online, activeToday });
});

// ── Audit log ──
const auditFilter = (q) => {
  const f = {};
  if (q.role) f.role = q.role;
  if (q.cat) f.cat = q.cat;
  if (q.q) { const rx = new RegExp(esc(q.q), "i"); f.$or = [{ actorName: rx }, { actorUsername: rx }, { action: rx }, { target: rx }, { detail: rx }]; }
  return f;
};
router.get("/audit", async (req, res) => {
  const { page, limit, skip } = paging(req.query, 20);
  const f = auditFilter(req.query);
  const day = new Date(new Date().setHours(0, 0, 0, 0));
  const [rows, total, all, mgr, pro, today, cats] = await Promise.all([
    AuditLog.find(f).sort({ at: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(f), AuditLog.estimatedDocumentCount(),
    AuditLog.countDocuments({ role: "Manager" }), AuditLog.countDocuments({ role: "Professional" }), AuditLog.countDocuments({ at: { $gte: day } }), AuditLog.distinct("cat"),
  ]);
  ok(res, rows, { total, page, pages: Math.ceil(total / limit), stats: { all, manager: mgr, professional: pro, today }, cats });
});
router.get("/audit/export", async (req, res) => {
  const rows = await AuditLog.find(auditFilter(req.query)).sort({ at: -1 }).limit(20000).lean();
  record(req, { action: "Exported audit log", target: `${rows.length} rows`, cat: "export" });
  sendCsv(res, "guru-audit-log.csv", ["Time", "Actor", "Username", "Role", "Action", "Target", "Detail"], rows.map((r) => [r.at.toISOString(), r.actorName, r.actorUsername, r.role, r.action, r.target, r.detail]));
});

router.use("/schools", require("./adminPanelSchools"));
router.use("/support", require("./adminPanelSupport"));
router.use("/analytics", require("./adminPanelAnalytics"));
router.use("/notify", require("./adminPanelNotify"));

// wallet transfer (analytics → financial)
router.post("/wallets/transfer", async (req, res) => {
  const { from, to, amount, note } = req.body || {};
  const amt = parseFloat(amount);
  if (!(amt > 0)) return fail(res, 400, "Amount must be positive");
  try {
    const r = await walletService.transferFunds(from, to, amt, `GURU_TRF_${Date.now()}_${req.me._id}`, { userId: req.me._id, description: note || `Transfer from ${from} to ${to}` });
    record(req, { action: "Transferred wallet funds", target: `${from} → ${to}`, detail: `₦${amt.toLocaleString()}`, cat: "financial" });
    ok(res, { from: r.fromBalance, to: r.toBalance });
  } catch (e) { fail(res, 400, e.message); }
});

module.exports = router;
