const { AuditLog } = require("../models/AuditLog");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { Question } = require("../models/Question");
const { SupportTicket } = require("../models/SupportTicket");
const { oid } = require("./adminHelpers");

const DAY = 864e5;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** Query-driven analytics for one staff member (audit log + library + support collections). */
async function memberAnalytics(userId, isPro) {
  const id = oid(userId);
  const now = new Date();
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const since90 = new Date(now - 90 * DAY);

  const [logs, recent, totalActions, cats, subs, tops, qs, qEdits, tEdits] = await Promise.all([
    AuditLog.find({ actor: id, at: { $gte: since90 } }).select("at cat meta").sort({ at: -1 }).limit(8000).lean(),
    AuditLog.find({ actor: id }).sort({ at: -1 }).limit(8).lean(),
    AuditLog.countDocuments({ actor: id }),
    Category.countDocuments({ user: id }),
    Subject.countDocuments({ user: id }),
    Topic.countDocuments({ user: id }),
    Question.countDocuments({ user: id }),
    Question.countDocuments({ edits: id }),
    Topic.countDocuments({ edits: id }),
  ]);

  const weight = (l, kind) => (kind ? (l.meta?.kind === kind ? l.meta?.count || 1 : 0) : 1);
  const kinds = isPro
    ? [["question_upload"], ["question_edit"], ["topic_create"]]
    : [[null], ["__tickets"], ["__review"]];

  const periods = [today0, new Date(now - 7 * DAY), new Date(now - 30 * DAY), null];
  const sumFor = (kind, from) =>
    logs.reduce((s, l) => {
      if (from && l.at < from) return s;
      if (kind === "__review") return s + (["user", "professional"].includes(l.cat) ? 1 : 0);
      if (kind === "__tickets") return s + (l.cat === "support" ? 1 : 0);
      return s + weight(l, kind);
    }, 0);

  const metrics = kinds.map(([k]) => periods.map((p) => (p ? sumFor(k, p) : null)));
  // all-time column from authoritative sources
  const reviewAll = await AuditLog.countDocuments({ actor: id, cat: { $in: ["user", "professional"] } });
  const ticketsAll = await SupportTicket.countDocuments({ assignedTo: id });
  metrics[0][3] = isPro ? qs : totalActions;
  metrics[1][3] = isPro ? qEdits : ticketsAll;
  metrics[2][3] = isPro ? tops : reviewAll;

  // daily (30d) series of the primary metric
  const primary = kinds[0][0];
  const daily = [];
  const byDay = new Map();
  logs.forEach((l) => byDay.set(dayKey(l.at), (byDay.get(dayKey(l.at)) || 0) + weight(l, primary)));
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(new Date(now - i * DAY));
    daily.push({ date: k, value: byDay.get(k) || 0 });
  }
  const activeKeys = new Set(logs.map((l) => dayKey(l.at)));
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    if (activeKeys.has(dayKey(new Date(now - i * DAY)))) streak++;
    else if (i > 0) break;
  }
  const wd = Array(7).fill(0);
  logs.forEach((l) => wd[new Date(l.at).getDay()] += weight(l, primary));
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: WD[d], value: wd[d] }));
  const best = weekdays.reduce((b, d) => (d.value > b.value ? d : b), weekdays[0]);
  const total30 = daily.reduce((s, d) => s + d.value, 0);

  // focus areas
  let areas = [];
  if (isPro) {
    const rows = await Question.aggregate([
      { $match: { user: id } }, { $group: { _id: "$subject", value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 6 },
      { $lookup: { from: "subjects", localField: "_id", foreignField: "_id", as: "s" } },
    ]);
    areas = rows.map((r) => ({ name: r.s?.[0]?.name || "Unknown", value: r.value }));
  } else {
    const rows = await AuditLog.aggregate([{ $match: { actor: id } }, { $group: { _id: "$cat", value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 6 }]);
    areas = rows.map((r) => ({ name: r._id, value: r.value }));
  }

  // manager support block / pro library snapshot
  let support = null, snapshot = null;
  if (!isPro) {
    const active = ["open", "in_progress", "waiting_user"];
    const [resolved, open, rated, unassigned] = await Promise.all([
      SupportTicket.countDocuments({ assignedTo: id, status: { $in: ["resolved", "closed"] } }),
      SupportTicket.countDocuments({ assignedTo: id, status: { $in: active } }),
      SupportTicket.aggregate([{ $match: { assignedTo: id, "rating.score": { $exists: true } } }, { $group: { _id: "$rating.score", n: { $sum: 1 } } }]),
      SupportTicket.countDocuments({ assignedTo: null, status: { $in: active } }),
    ]);
    const n = rated.reduce((s, r) => s + r.n, 0);
    support = {
      resolved, open, unassigned, rated: n,
      avgRating: n ? +(rated.reduce((s, r) => s + r._id * r.n, 0) / n).toFixed(2) : 0,
      distribution: [5, 4, 3, 2, 1].map((s) => rated.find((r) => r._id === s)?.n || 0),
    };
  } else {
    const [s] = await Question.aggregate([
      { $match: { user: id } },
      { $group: { _id: null, count: { $sum: 1 }, avgPoint: { $avg: "$point" }, avgTimer: { $avg: "$timer" },
          theory: { $sum: { $cond: ["$isTheory", 1, 0] } }, explained: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$explanation", ""] } }, 0] }, 1, 0] } } } },
    ]);
    snapshot = s ? { questions: s.count, avgPoint: +s.avgPoint.toFixed(1), avgTimer: Math.round(s.avgTimer), theory: s.theory, explained: s.explained, topics: tops } : { questions: 0, avgPoint: 0, avgTimer: 0, theory: 0, explained: 0, topics: tops };
  }

  return {
    contributions: { cat: { up: cats, ed: 0 }, sub: { up: subs, ed: 0 }, top: { up: tops, ed: tEdits }, qs: { up: qs, ed: qEdits } },
    metrics, daily, weekdays, areas, support, snapshot,
    recent, streak, bestDay: best.value ? best.day : null, dailyAvg: +(total30 / 30).toFixed(1), activeDays30: daily.filter((d) => d.value > 0).length, total30,
  };
}
module.exports = { memberAnalytics };
