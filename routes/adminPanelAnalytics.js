// /admin-panel/analytics/:section (manager only — gate applied by parent)
const express = require("express");
const router = express.Router();
const { User } = require("../models/User");
const { School } = require("../models/School");
const { Quiz } = require("../models/Quiz");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { Question } = require("../models/Question");
const WalletTransaction = require("../models/WalletTransaction");
const PayoutRequest = require("../models/PayoutRequest");
const walletService = require("../controllers/walletService");
const { nameOf, cap, roleLabel, ok, fail, monthsBack, fillMonths, idFromDate } = require("../controllers/adminHelpers");

const DAY = 864e5;
const grp = (rows) => rows.map((r) => ({ name: r._id == null ? "Unknown" : String(r._id), value: r.n }));
const byMonthUser = () => User.aggregate([{ $match: { _id: { $gte: idFromDate(monthsBack(12)[0].start) } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: { $toDate: "$_id" } } }, count: { $sum: 1 } } }]);
const byMonthQuiz = () => Quiz.aggregate([{ $match: { date: { $gte: monthsBack(12)[0].start } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, count: { $sum: 1 } } }]);
const person = (u) => ({ id: u._id, name: nameOf(u), points: u.totalPoints || 0, streak: u.streak || 0, avatar: u.avatar?.image || null });

const S = {
  async overview() {
    const since = new Date(Date.now() - 30 * DAY);
    const [total, schools, quizzes, active, questions, acc, growth, quizSeries, top] = await Promise.all([
      User.countDocuments(), School.countDocuments(), Quiz.countDocuments(), User.countDocuments({ activeDays: { $gte: since } }), Question.countDocuments(),
      Quiz.aggregate([{ $group: { _id: null, a: { $avg: "$summary.accuracyRate" } } }]), byMonthUser(), byMonthQuiz(),
      User.find({ accountType: "student" }).sort({ totalPoints: -1 }).limit(5).select("firstName lastName username totalPoints streak avatar").lean(),
    ]);
    return { totals: { users: total, schools, quizzes, activeUsers: active, engagement: total ? +((active / total) * 100).toFixed(1) : 0, questions, avgScore: +(acc[0]?.a || 0).toFixed(1) },
      growth: fillMonths(growth), quizSeries: fillMonths(quizSeries), top: top.map(person) };
  },
  async users() {
    const since = new Date(Date.now() - 30 * DAY);
    const [total, active, fresh, verified, premium, byType, byGender, states, growth, topPts, topStreak] = await Promise.all([
      User.countDocuments(), User.countDocuments({ activeDays: { $gte: since } }), User.countDocuments({ _id: { $gte: idFromDate(since) } }), User.countDocuments({ verified: true }),
      User.countDocuments({ "subscription.isActive": true, "subscription.expiry": { $gt: new Date() } }),
      User.aggregate([{ $group: { _id: "$accountType", n: { $sum: 1 } } }]), User.aggregate([{ $group: { _id: "$gender", n: { $sum: 1 } } }]),
      User.aggregate([{ $match: { state: { $nin: [null, ""] } } }, { $group: { _id: "$state", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 6 }]), byMonthUser(),
      User.find({ accountType: "student" }).sort({ totalPoints: -1 }).limit(5).select("firstName lastName username totalPoints streak avatar").lean(),
      User.find({ accountType: "student" }).sort({ streak: -1 }).limit(5).select("firstName lastName username totalPoints streak avatar").lean(),
    ]);
    return { totals: { total, active, fresh, verified, premium, freemium: total - premium }, byType: grp(byType).map((r) => ({ ...r, name: roleLabel(r.name) })),
      byGender: grp(byGender).map((r) => ({ ...r, name: cap(r.name) })), states: grp(states).map((r) => ({ ...r, name: cap(r.name) })), growth: fillMonths(growth), topPoints: topPts.map(person), topStreak: topStreak.map(person) };
  },
  async schools() {
    const [totals, top, levels, subs] = await Promise.all([
      School.aggregate([{ $group: { _id: null, schools: { $sum: 1 }, students: { $sum: { $size: "$students" } }, teachers: { $sum: { $size: "$teachers" } }, classes: { $sum: { $size: "$classes" } }, assignments: { $sum: { $size: "$assignments" } }, announcements: { $sum: { $size: "$announcements" } }, quizzes: { $sum: { $size: "$quiz" } } } }]),
      School.aggregate([{ $project: { name: 1, n: { $size: "$students" } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
      School.aggregate([{ $unwind: "$classes" }, { $group: { _id: "$classes.level", n: { $sum: { $size: "$classes.students" } } } }, { $sort: { _id: 1 } }]),
      School.aggregate([{ $group: { _id: { $gt: ["$subscription.expiry", new Date()] }, n: { $sum: 1 } } }]),
    ]);
    const t = totals[0] || {};
    return { totals: { schools: t.schools || 0, students: t.students || 0, teachers: t.teachers || 0, classes: t.classes || 0, assignments: t.assignments || 0, announcements: t.announcements || 0, quizzes: t.quizzes || 0, activeSubs: subs.find((x) => x._id)?.n || 0 },
      top: top.map((r) => ({ name: cap(r.name), value: r.n })), levels: levels.map((r) => ({ name: String(r._id).toUpperCase(), value: r.n })) };
  },
  async content() {
    const [cats, subs, tops, qs, types, topCats, topSubs] = await Promise.all([
      Category.countDocuments(), Subject.countDocuments(), Topic.countDocuments(), Question.countDocuments(), Question.aggregate([{ $group: { _id: "$isTheory", n: { $sum: 1 } } }]),
      Category.aggregate([{ $project: { name: 1, n: { $size: "$subjects" } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
      Subject.aggregate([{ $project: { name: 1, n: { $size: "$topics" } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
    ]);
    const theory = types.find((x) => x._id === true)?.n || 0;
    return { totals: { categories: cats, subjects: subs, topics: tops, questions: qs, theory, objective: qs - theory, avgPerTopic: tops ? +(qs / tops).toFixed(1) : 0 }, topCategories: topCats.map((r) => ({ name: cap(r.name), value: r.n })), topSubjects: topSubs.map((r) => ({ name: cap(r.name), value: r.n })) };
  },
  async quizzes() {
    const [total, modes, perf, wins, series, top] = await Promise.all([
      Quiz.countDocuments(), Quiz.aggregate([{ $group: { _id: { m: "$mode", t: "$type" }, n: { $sum: 1 } } }]),
      Quiz.aggregate([{ $group: { _id: null, avg: { $avg: "$summary.accuracyRate" }, c: { $sum: "$summary.correctAnswers" }, q: { $sum: "$summary.totalQuestions" } } }]),
      User.aggregate([{ $group: { _id: null, n: { $sum: "$quizStats.totalWins" } } }]), byMonthQuiz(),
      User.find({ "quizStats.totalQuizzes": { $gt: 0 } }).sort({ totalPoints: -1 }).limit(5).select("firstName lastName username totalPoints streak avatar").lean(),
    ]);
    const n = (f) => modes.filter(f).reduce((s, r) => s + r.n, 0);
    const p = perf[0] || {};
    return { totals: { total, wins: wins[0]?.n || 0, avgScore: +(p.avg || 0).toFixed(1), accuracy: p.q ? +((p.c / p.q) * 100).toFixed(1) : 0 },
      modes: [{ name: "Solo", value: n((r) => r._id.m === "solo" && r._id.t !== "freemium") }, { name: "Multiplayer", value: n((r) => r._id.m === "friends") }, { name: "Freemium", value: n((r) => r._id.m === "solo" && r._id.t === "freemium") }],
      series: fillMonths(series), top: top.map(person) };
  },
  async financial() {
    const since = monthsBack(12)[0].start;
    const [wallets, txTotal, tx30, payouts, byType, byStatus, rev] = await Promise.all([
      walletService.getAllBalances(), WalletTransaction.countDocuments(), WalletTransaction.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * DAY) } }),
      PayoutRequest.aggregate([{ $group: { _id: null, n: { $sum: 1 }, amt: { $avg: "$amount" }, pts: { $avg: "$pointsConverted" }, total: { $sum: "$amount" } } }]),
      PayoutRequest.aggregate([{ $group: { _id: "$payoutType", n: { $sum: 1 } } }]), PayoutRequest.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      WalletTransaction.aggregate([{ $match: { createdAt: { $gte: since }, status: "completed", category: { $in: ["subscription", "payout"] }, transactionType: { $in: ["credit", "debit"] } } }, { $group: { _id: { m: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, c: "$category" }, count: { $sum: "$amount" } } }]),
    ]);
    const pick = (c) => fillMonths(rev.filter((r) => r._id.c === c).map((r) => ({ _id: r._id.m, count: r.count })));
    const p = payouts[0] || {};
    return { wallets, totals: { transactions: txTotal, recent: tx30, payouts: p.n || 0, avgAmount: Math.round(p.amt || 0), avgPoints: Math.round(p.pts || 0), paidOut: Math.round(p.total || 0) },
      payoutsByType: grp(byType).map((r) => ({ ...r, name: cap(r.name) })), payoutsByStatus: grp(byStatus).map((r) => ({ ...r, name: cap(r.name) })), revenue: pick("subscription"), withdrawals: pick("payout") };
  },
};

router.get("/:section", async (req, res) => {
  const fn = S[req.params.section];
  if (!fn) return fail(res, 404, "Unknown analytics section");
  ok(res, await fn());
});

module.exports = router;
