// Tracks which app features (endpoints) are used. Counters are buffered in memory
// and flushed to MongoDB every 15s, so it adds no latency to requests.
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { FeatureUsage, FeatureUser } = require("../models/FeatureUsage");

// [regex on "METHOD /normalised/path", featureId, label, group]  (first match wins)
const RULES = [
  [/^SOCKET \/(create_session|join_session|send_invite|invite_response|quiz_end)$/, "multiplayer", "Multiplayer quiz", "Quizzing"],
  [/^SOCKET \/join_ticket$/, "support_chat", "Support live chat", "Support"],
  [/^POST \/instance\/(premium_quiz|submit_premium)$/, "premium_quiz", "Premium quiz", "Quizzing"],
  [/^POST \/instance\/(freemium_quiz|submit_freemium)$/, "freemium_quiz", "Freemium quiz", "Quizzing"],
  [/^\w+ \/jamb\//, "jamb", "JAMB predictor", "Quizzing"],
  [/^\w+ \/competition(\/|$)/, "competition", "Quiz competition", "Quizzing"],
  [/^(GET|POST) \/instance\/(category|subject_category|subjects|subject_topics|topic|questions|my_questions)$/, "practice_browse", "Subjects & question bank", "Quizzing"],
  [/^\w+ \/school\/(quiz|get_quiz|submit_quiz|quiz_status|quiz_session_students|quiz_history_user)$/, "school_quiz", "School quizzes", "School"],
  [/^\w+ \/school\/assignment/, "school_assignments", "School assignments", "School"],
  [/^POST \/school\/:id\/class-shift$|^POST \/school\/:id\/classes\/[^/]+\/transfer$/, "class_promotion", "Class promotions & graduation", "School"],
  [/^\w+ \/school\/(class$|classes(\/|$)|:id\/classes(\/|$))/, "classes", "Classes (create / manage)", "School"],
  [/^GET \/school\/:id\/dashboard$/, "school_dashboard", "School dashboard", "School"],
  [/^\w+ \/(school\/announcements?|users\/announcements\/read)$/, "announcements", "Announcements", "School"],
  [/^\w+ \/school\/(join|leave|verify|flag|create|search|instances|fetch|students)$/, "school_membership", "School profile & membership", "School"],
  [/^GET \/(users\/(leaderboard\/global|pro_leaderboard)|school\/leaderboard(_schools|\/:id)?)$/, "leaderboards", "Leaderboards", "Social"],
  [/^\w+ \/users\/(friends|search_students|suggestions(\/smart)?|students)$/, "friends", "Friends & suggestions", "Social"],
  [/^\w+ \/users\/rewards$/, "rewards", "Rewards & referrals", "Social"],
  [/^POST \/payouts\/withdraw$/, "withdrawals", "Cash withdrawals", "Money"],
  [/^\w+ \/payouts\/(recharge|data|data-bundles(\/.*)?)$/, "airtime_data", "Airtime & data", "Money"],
  [/^\w+ \/payouts\/(banks|pending(\/.*)?|history|user\/points)$/, "payout_tracking", "Payout history & pending", "Money"],
  [/^\w+ \/(payouts\/(subscription.*|verify-subscription)|payments\/.*|users\/renew-subscription)$/, "subscriptions", "Subscriptions & payments", "Money"],
  [/^\w+ \/support(\/|$)/, "support", "Support tickets", "Support"],
  [/^\w+ \/users\/(login|register|password\/reset|email\/(send-otp|verify-otp)|account\/delete)$/, "auth", "Sign in / account", "Account"],
  [/^\w+ \/users\/(user|userInfo|user_stats|check_limits|activity|updateProfile|updateAvatar|app_info|transactions)$/, "profile", "Profile & daily stats", "Account"],
  [/^GET \/analytics\/me$/, "my_analytics", "Personal analytics", "Account"],
  [/^GET \/admin\/app_version$/, "app_version", "App startup & version check", "Account"],
];
const SKIP = /^\w+ \/(admin-panel|uploads|cron|transactions|analytics$|create(\/|$)|api\/jamb\/(admin|cron)|jamb\/(admin|cron)|competition\/manage|payouts\/(webhooks|wallets|recover)|payments\/subscription_(callback|redirect)|support\/admin|admin\/(?!app_version$)|users\/(professionals|professional|pro_reset|auto-join-guru)$|instance\/(generate|verify|ai_ques|reset))|^(PUT|DELETE|PATCH) \/instance|^\w+ \/?$|^\w+ \/(favicon|socket\.io)/;

const FEATURES = [
  ...new Map([...RULES.map(([, id, label, group]) => [id, { id, label, group }]), ["other", { id: "other", label: "Other endpoints", group: "Other" }]]).values(),
];

const norm = (p) =>
  (String(p).split("?")[0]
    .replace(/^\/api(?=\/jamb)/, "")
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .replace(/\/data-bundles\/[^/]+$/, "/data-bundles/:network")
    .replace(/(\/classes)\/(?!:id\/)[^/]+\/transfer$/, "$1/:level/transfer")
    .replace(/\/+$/, "")) || "/";

function classify(method, url, status) {
  const path = norm(url);
  const sig = `${method} ${path}`;
  if (method === "OPTIONS" || method === "HEAD") return null;
  if (SKIP.test(sig)) return null;
  const hit = RULES.find(([re]) => re.test(sig));
  if (hit) return { key: sig, feature: hit[1], label: hit[2], group: hit[3], method, path };
  if (method === "SOCKET" || status === 404 || status === 401) return null;
  return { key: sig, feature: "other", label: "Other endpoints", group: "Other", method, path };
}

// ── buffering ────────────────────────────────────────────────────────────────
const dayOf = (t = Date.now()) => new Date(t + 3600e3).toISOString().slice(0, 10); // WAT
let buf = new Map(), fresh = new Map();
const seen = new Set();
let seenDay = "";

function record(c, userId, status, ms) {
  const day = dayOf();
  if (day !== seenDay) { seen.clear(); seenDay = day; }
  const k = `${day}|${c.key}`;
  let e = buf.get(k);
  if (!e) buf.set(k, (e = { ...c, day, hits: 0, errors: 0, totalMs: 0, maxMs: 0 }));
  e.hits++;
  if (status >= 400) e.errors++;
  e.totalMs += ms;
  if (ms > e.maxMs) e.maxMs = ms;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    const uk = `${k}|${userId}`;
    if (!seen.has(uk)) { seen.add(uk); fresh.set(uk, { day, key: c.key, feature: c.feature, user: userId }); }
  }
  if (buf.size > 4000 || fresh.size > 8000) flush();
}

let flushing = null;
async function flush() {
  if (flushing) return flushing;
  const b = buf, f = fresh;
  buf = new Map(); fresh = new Map();
  if (!b.size && !f.size) return;
  flushing = (async () => {
    try {
      const at = (day) => new Date(`${day}T12:00:00Z`);
      if (b.size)
        await FeatureUsage.bulkWrite([...b.values()].map((e) => ({
          updateOne: {
            filter: { day: e.day, key: e.key },
            update: {
              $inc: { hits: e.hits, errors: e.errors, totalMs: e.totalMs },
              $max: { maxMs: e.maxMs },
              $set: { feature: e.feature, label: e.label, group: e.group, method: e.method, path: e.path },
              $setOnInsert: { at: at(e.day) },
            },
            upsert: true,
          },
        })), { ordered: false });
      if (f.size)
        await FeatureUser.bulkWrite([...f.values()].map((u) => ({
          updateOne: {
            filter: { day: u.day, key: u.key, user: new mongoose.Types.ObjectId(String(u.user)) },
            update: { $setOnInsert: { feature: u.feature, at: at(u.day) } },
            upsert: true,
          },
        })), { ordered: false });
    } catch (e) {
      if (e.code !== 11000) console.error("[featureUsage] flush", e.message);
    } finally { flushing = null; }
  })();
  return flushing;
}
setInterval(flush, 15000).unref();

const decode = (t) => { try { return t ? jwt.verify(t, process.env.JWT_KEY) : null; } catch { return null; } };
const bearer = (req) => (/^Bearer\s+/i.test(req.header("authorization") || "") ? req.header("authorization").replace(/^Bearer\s+/i, "") : null);

const trackFeatureUsage = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    try {
      const c = classify(req.method, req.originalUrl, res.statusCode);
      if (!c) return;
      const p = decode(req.header("x-auth-token")) || decode(bearer(req)) || decode(res.getHeader("x-auth-token"));
      record(c, p?.userId, res.statusCode, Date.now() - start);
    } catch (e) { /* never break a request */ }
  });
  next();
};

const trackSocketEvent = (event, userId) => {
  try {
    const c = classify("SOCKET", `/${event}`, 200);
    if (c) record(c, userId, 200, 0);
  } catch (e) {}
};

module.exports = { trackFeatureUsage, trackSocketEvent, flush, FEATURES, dayOf, classify };
