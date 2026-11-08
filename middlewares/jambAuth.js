// middlewares/jambAuth.js
// Auth helpers for /jamb routes. Error bodies follow the guide's format:
//   { error: { code, message, details? } }
const jwt = require("jsonwebtoken");
const { User } = require("../models/User");

const sendError = (res, status, code, message, details) =>
  res.status(status).json({
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  });

// Same token contract as the rest of the server (x-auth-token); a Bearer header is accepted too.
function requireAuth(req, res, next) {
  let token = req.header("x-auth-token");
  if (!token) {
    const h = req.header("authorization") || "";
    if (/^Bearer\s+/i.test(h)) token = h.replace(/^Bearer\s+/i, "").trim();
  }
  if (!token) return sendError(res, 401, "UNAUTHENTICATED", "Access denied");

  try {
    const payload = jwt.verify(token, process.env.JWT_KEY);
    if (!payload?.userId)
      return sendError(res, 401, "UNAUTHENTICATED", "Invalid token provided!");
    req.user = payload;
    next();
  } catch (err) {
    return sendError(res, 401, "UNAUTHENTICATED", "Invalid token provided!");
  }
}

// Premium is checked against the DB on every call (never a client claim).
// The feature is for student accounts with an active, unexpired subscription.
async function requirePremium(req, res, next) {
  const user = await User.findById(req.user.userId)
    .select("accountType subscription")
    .lean();
  if (!user) return sendError(res, 404, "NOT_FOUND", "User account not found");

  const sub = user.subscription || {};
  const notExpired = !sub.expiry || new Date(sub.expiry) > new Date();
  const ok = user.accountType === "student" && sub.isActive && notExpired;
  if (!ok)
    return sendError(
      res,
      403,
      "PREMIUM_REQUIRED",
      "JAMB Score Predictor is for premium students.",
    );
  next();
}

// Shared-secret guard for the scheduler (same secret the existing /cron routes use).
function requireCron(req, res, next) {
  const expected = process.env.CRON_SECRET || "guru_cron_secret_change_me";
  const secret =
    req.headers["x-cron-secret"] || req.query.secret || req.body?.secret;
  if (!secret || secret !== expected)
    return sendError(res, 401, "UNAUTHENTICATED", "Unauthorised");
  next();
}

// Router-level error handler: maps service errors (err.status/err.code) to the guide's format.
// eslint-disable-next-line no-unused-vars
function jambErrorHandler(err, req, res, next) {
  if (err && err.jamb) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  if (err && err.name === "CastError") {
    return sendError(res, 422, "VALIDATION_FAILED", "Invalid id supplied.");
  }
  console.error("[jamb] unexpected error:", err);
  return sendError(res, 500, "INTERNAL_ERROR", "Something went wrong.");
}

module.exports = {
  requireAuth,
  requirePremium,
  requireCron,
  jambErrorHandler,
  sendError,
};
