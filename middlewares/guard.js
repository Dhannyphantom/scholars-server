// Global middlewares: suspension guard, query-driven activity tracking, competition audit
const jwt = require("jsonwebtoken");
const { User } = require("../models/User");
const { School } = require("../models/School");
const { AdminFlag, ActivityEvent, UserActivity } = require("../models/AdminMisc");
const { record } = require("../controllers/auditService");
const { normPhone } = require("../controllers/adminHelpers");

const suspendedUsers = new Set();
const suspendedSchools = new Set();

const loadSuspensions = async () => {
  try {
    const flags = await AdminFlag.find().select("kind ref").lean();
    suspendedUsers.clear();
    suspendedSchools.clear();
    flags.forEach((f) => (f.kind === "user" ? suspendedUsers : suspendedSchools).add(String(f.ref)));
  } catch (e) {
    console.error("[guard] load flags", e.message);
  }
};
const markSuspended = (kind, id, on) => {
  const set = kind === "user" ? suspendedUsers : suspendedSchools;
  on ? set.add(String(id)) : set.delete(String(id));
};
const startGuard = () => {
  loadSuspensions();
  setInterval(loadSuspensions, 60 * 1000).unref();
};

const decode = (token) => {
  try {
    return token ? jwt.verify(token, process.env.JWT_KEY) : null;
  } catch {
    return null;
  }
};

const suspensionGuard = async (req, res, next) => {
  try {
    if (req.path.startsWith("/admin-panel")) return next();
    const payload = decode(req.header("x-auth-token"));
    const uid = payload?.userId;
    if (uid && suspendedUsers.has(String(uid))) {
      return res.status(403).json("Your account has been suspended. Please contact support.");
    }
    if (req.method === "POST" && req.path === "/users/login" && suspendedUsers.size && req.body?.username) {
      const raw = String(req.body.username);
      const u = await User.findOne({ $or: [{ username: raw.toLowerCase() }, ...(/^\d+$/.test(raw.replace(/\D/g, "")) ? [{ contact: normPhone(raw) }] : [])] })
        .select("_id")
        .lean();
      if (u && suspendedUsers.has(String(u._id))) return res.status(403).json("Your account has been suspended. Please contact support.");
    }
    if (uid && suspendedSchools.size && req.path.startsWith("/school")) {
      const hit = await School.exists({
        _id: { $in: [...suspendedSchools] },
        $or: [{ "students.user": uid }, { "teachers.user": uid }],
      });
      if (hit) return res.status(403).json("Your school has been suspended. Contact Guru support.");
    }
  } catch (e) {
    console.error("[guard]", e.message);
  }
  next();
};

// ── Query-driven activity tracking ─────────────────────────────────────────
const RULES = [
  ["POST", /^\/users\/login$/, "auth", "signed in"],
  ["POST", /^\/users\/email\/verify-otp$/, "auth", "verified their email"],
  ["POST", /^\/instance\/premium_quiz$/, "quiz", "started a premium quiz"],
  ["POST", /^\/instance\/freemium_quiz$/, "quiz", "started a free quiz"],
  ["POST", /^\/competition\/[a-f0-9]{24}\/questions$/, "quiz", "joined the monthly tournament"],
  ["POST", /^\/competition\/[a-f0-9]{24}\/submit$/, "quiz", "submitted their tournament answers"],
  ["POST", /^\/school\/join$/, "school", "joined a school"],
  ["POST", /^\/school\/leave$/, "school", "left a school"],
  ["POST", /^\/school\/flag$/, "school", "flagged a student"],
  ["POST", /^\/school\/quiz$/, "school", "created a school quiz"],
  ["POST", /^\/school\/assignment$/, "school", "posted an assignment"],
  ["POST", /^\/school\/assignment\/submit$/, "school", "submitted an assignment"],
  ["POST", /^\/payouts\/withdraw$/, "payment", "requested a withdrawal"],
  ["POST", /^\/payouts\/recharge$/, "payment", "redeemed GT for airtime"],
  ["POST", /^\/payouts\/data$/, "payment", "redeemed GT for a data bundle"],
  ["POST", /^\/users\/renew-subscription$/, "payment", "renewed their subscription with GT"],
  ["POST", /^\/support\/ticket$/, "support", "opened a support ticket"],
];
const lastWrite = new Map();

const trackActivity = (req, res, next) => {
  if (req.path.startsWith("/admin-panel") || req.path.startsWith("/uploads")) return next();
  res.on("finish", async () => {
    try {
      if (res.statusCode >= 400) return;
      const payload = decode(req.header("x-auth-token")) || decode(res.getHeader("x-auth-token"));
      const uid = payload?.userId;
      if (!uid) return;
      const now = Date.now();
      if (now - (lastWrite.get(uid) || 0) > 60 * 1000) {
        lastWrite.set(uid, now);
        await UserActivity.updateOne({ user: uid }, { $set: { lastSeenAt: new Date(), lastPath: req.path }, $inc: { hits: 1 } }, { upsert: true });
      }
      const rule = RULES.find(([m, re]) => m === req.method && re.test(req.path));
      if (rule) await ActivityEvent.create({ user: uid, type: rule[2], text: rule[3] });
    } catch (e) {
      /* tracking must never break a request */
    }
  });
  next();
};

// ── Audit for the existing /competition/manage endpoints ───────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COMP_RULES = [
  ["POST", /^\/$/, "Created competition draft"],
  ["PUT", /^\/[a-f0-9]{24}$/, "Updated competition"],
  ["DELETE", /^\/[a-f0-9]{24}$/, "Deleted competition draft"],
  ["POST", /^\/[a-f0-9]{24}\/publish$/, "Took competition live"],
  ["POST", /^\/[a-f0-9]{24}\/publish-results$/, "Published competition results"],
  ["POST", /^\/[a-f0-9]{24}\/award-prizes$/, "Retried competition prize awards"],
];
const auditCompetition = (req, res, next) => {
  const rule = COMP_RULES.find(([m, re]) => m === req.method && re.test(req.path));
  if (!rule) return next();
  res.on("finish", async () => {
    try {
      if (res.statusCode >= 400) return;
      const payload = decode(req.header("x-auth-token"));
      if (!payload) return;
      let target = "Competition";
      const id = req.path.split("/")[1];
      const b = req.body || {};
      if (b.month && b.year) target = `${MON[b.month - 1]} ${b.year}`;
      else if (id) {
        const { OnlineQuizCompetition } = require("../models/OnlineQuizCompetition");
        const c = await OnlineQuizCompetition.findById(id).select("month year").lean();
        if (c) target = `${MON[c.month - 1]} ${c.year}`;
      }
      await record(payload.userId, { action: rule[2], target, cat: "competition" });
    } catch (e) {}
  });
  next();
};

module.exports = { suspensionGuard, trackActivity, auditCompetition, startGuard, markSuspended, loadSuspensions };
