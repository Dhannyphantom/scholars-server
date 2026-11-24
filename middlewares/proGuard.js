// Enforces professional permissions on the admin dashboard API (and the competition endpoints it uses).
const jwt = require("jsonwebtoken");
const { User } = require("../models/User");
const { AdminFlag } = require("../models/AdminMisc");
const P = require("../controllers/permissions");

const cache = new Map();
async function who(id) {
  const h = cache.get(id);
  if (h && Date.now() - h.at < 20000) return h;
  const u = await User.findById(id).select("accountType verified").lean();
  const v = { at: Date.now(), type: u?.accountType, verified: !!u?.verified };
  cache.set(id, v);
  return v;
}
const deny = (res, msg) => res.status(403).json({ success: false, message: msg });
const tokenOf = (req) => { try { return jwt.verify(req.header("x-auth-token"), process.env.JWT_KEY); } catch { return null; } };

// mounted at /admin-panel BEFORE every admin route
async function guard(req, res, next) {
  try {
    const p = req.path;
    if (/^\/auth(\/|$)/.test(p) || req.method === "OPTIONS") return next();
    const payload = tokenOf(req);
    if (!payload) return next(); // downstream auth answers 401
    const u = await who(String(payload.userId));
    if (u.type !== "professional") return next(); // managers & others: unchanged behaviour
    if (/^\/(me|staff)(\/|$)/.test(p)) return next();
    const need = P.requiredFor(req.method, p);
    if (!need) return deny(res, "This area isn't available to your account.");
    const eff = await P.effectiveFor(payload.userId);
    const msg = P.check(eff, need);
    if (msg) return deny(res, msg);
    req.proAllowed = true; // lets staffAuth.managerOnly through
    req.perms = eff;
    next();
  } catch (e) { next(e); }
}

// mounted at /competition: lets permitted professionals use the manager-only competition endpoints
let mgr = { id: null, at: 0 };
async function managerId() {
  if (mgr.id && Date.now() - mgr.at < 600000) return mgr.id;
  const m = await User.findOne({ accountType: "manager" }).select("_id").lean();
  mgr = { id: m?._id ? String(m._id) : null, at: Date.now() };
  return mgr.id;
}
async function competitionShim(req, res, next) {
  try {
    const token = req.header("x-auth-token");
    const payload = tokenOf(req);
    if (!payload) return next();
    const u = await who(String(payload.userId));
    if (u.type !== "professional") return next();
    const need = P.requiredForCompetition(req.method, req.path, !!req.header("x-admin-panel"));
    if (!need) return next(); // ordinary app endpoints are untouched
    if (!u.verified || (await AdminFlag.exists({ kind: "user", ref: payload.userId }))) return deny(res, "Account not active");
    const msg = P.check(await P.effectiveFor(payload.userId), need);
    if (msg) return deny(res, msg);
    const m = await managerId();
    if (!m) return next();
    req.headers["x-auth-token"] = jwt.sign({ userId: m }, process.env.JWT_KEY);
    res.once("prefinish", () => { req.headers["x-auth-token"] = token; }); // audit log keeps the real actor
    next();
  } catch (e) { next(e); }
}
module.exports = { guard, competitionShim };
