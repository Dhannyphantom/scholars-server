// /admin-panel/library — categories, subjects, topics, questions (professionals are scoped to their subjects)
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");
const { Topic } = require("../models/Topic");
const { Question } = require("../models/Question");
const { User } = require("../models/User");
const { managerOnly } = require("../middlewares/staffAuth");
const { record } = require("../controllers/auditService");
const { isId, oid, esc, ok, fail, paging } = require("../controllers/adminHelpers");

const proScope = (req) => (req.isManager ? null : (req.me.subjects || []).map(String));
const inScope = (req, subjectId) => req.isManager || proScope(req).includes(String(subjectId));
const ids = (a) => (Array.isArray(a) ? a.filter(isId) : []);

// subjectId -> category ids (derived from Category.subjects)
async function subjectCats() {
  const cats = await Category.find().select("subjects").lean();
  const m = new Map();
  cats.forEach((c) => (c.subjects || []).forEach((s) => m.set(String(s), [...(m.get(String(s)) || []), String(c._id)])));
  return m;
}

router.get("/meta", async (req, res) => {
  const scope = proScope(req);
  const [cats, subs, tops, qBySub, qByTop, qByCat] = await Promise.all([
    Category.find().select("name subjects image").lean(),
    Subject.find(scope ? { _id: { $in: scope } } : {}).select("name topics image").lean(),
    Topic.find().select("name subject categories").lean(),
    Question.aggregate([{ $group: { _id: "$subject", n: { $sum: 1 } } }]),
    Question.aggregate([{ $group: { _id: "$topic", n: { $sum: 1 } } }]),
    Question.aggregate([{ $unwind: "$categories" }, { $group: { _id: "$categories", n: { $sum: 1 } } }]),
  ]);
  const cnt = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));
  const qs = cnt(qBySub), qt = cnt(qByTop), qc = cnt(qByCat);
  const subOfTopic = new Map();
  subs.forEach((s) => (s.topics || []).forEach((t) => subOfTopic.set(String(t), String(s._id))));
  const sc = await subjectCats();
  const subIds = new Set(subs.map((s) => String(s._id)));
  ok(res, {
    categories: cats.map((c) => ({ id: c._id, name: c.name, image: c.image?.thumb || c.image?.uri || null, subjects: (c.subjects || []).map(String).filter((s) => !scope || subIds.has(s)), questions: qc.get(String(c._id)) || 0 })),
    subjects: subs.map((s) => ({ id: s._id, name: s.name, image: s.image?.thumb || s.image?.uri || null, categories: sc.get(String(s._id)) || [], topics: (s.topics || []).length, questions: qs.get(String(s._id)) || 0 })),
    topics: tops.filter((t) => subOfTopic.has(String(t._id)) || (t.subject && subIds.has(String(t.subject))))
      .map((t) => { const sid = subOfTopic.get(String(t._id)) || String(t.subject); return { id: t._id, name: t.name, subject: sid, categories: (t.categories || []).map(String), questions: qt.get(String(t._id)) || 0 }; }),
  });
});

const qDto = (q) => ({ id: q._id, question: q.question, answers: (q.answers || []).map((a) => ({ id: a._id, name: a.name, correct: !!a.correct })), explanation: q.explanation || "", point: q.point, timer: q.timer, subject: q.subject, topic: q.topic, categories: q.categories || [], isTheory: !!q.isTheory, isLatex: !!q.isLatex, user: q.user });

router.get("/questions", async (req, res) => {
  const { page, limit, skip } = paging(req.query, 20);
  const scope = proScope(req);
  const f = {};
  if (req.query.subject && isId(req.query.subject)) f.subject = req.query.subject;
  if (scope) f.subject = req.query.subject && scope.includes(req.query.subject) ? req.query.subject : { $in: scope };
  if (req.query.topic && isId(req.query.topic)) f.topic = req.query.topic;
  if (req.query.category && isId(req.query.category)) f.categories = req.query.category;
  if (req.query.q) f.question = new RegExp(esc(req.query.q), "i");
  const [rows, total] = await Promise.all([Question.find(f).sort({ _id: -1 }).skip(skip).limit(limit).lean(), Question.countDocuments(f)]);
  ok(res, rows.map(qDto), { total, page, pages: Math.ceil(total / limit) });
});

router.get("/questions/:id", async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id");
  const q = await Question.findById(req.params.id).lean();
  if (!q) return fail(res, 404, "Question not found");
  if (!inScope(req, q.subject)) return fail(res, 403, "Outside your assigned subjects");
  ok(res, qDto(q));
});

// ── Categories (manager) ──
router.post("/categories", managerOnly, async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return fail(res, 400, "Name is required");
  if (await Category.findOne({ name }).collation({ locale: "en", strength: 2 })) return fail(res, 400, "A category with that name already exists");
  const c = await Category.create({ name, user: req.me._id, subjects: ids(req.body.subjects) });
  record(req, { action: "Created category", target: name, cat: "library", meta: { kind: "category_create", count: 1 } });
  ok(res, { id: c._id });
});
router.put("/categories/:id", managerOnly, async (req, res) => {
  const c = await Category.findById(req.params.id);
  if (!c) return fail(res, 404, "Category not found");
  if (req.body.name) c.name = String(req.body.name).trim();
  if (req.body.subjects) c.subjects = ids(req.body.subjects);
  await c.save();
  record(req, { action: "Edited category", target: c.name, cat: "library" });
  ok(res, { id: c._id });
});
router.delete("/categories/:id", managerOnly, async (req, res) => {
  const c = await Category.findByIdAndDelete(req.params.id);
  if (!c) return fail(res, 404, "Category not found");
  await Promise.all([Question.updateMany({ categories: c._id }, { $pull: { categories: c._id } }), Topic.updateMany({ categories: c._id }, { $pull: { categories: c._id } })]);
  record(req, { action: "Deleted category", target: c.name, cat: "library" });
  ok(res, { deleted: true });
});

// ── Subjects (manager) ──
const setSubjectCats = async (subjectId, catIds) => {
  await Category.updateMany({ _id: { $nin: catIds }, subjects: subjectId }, { $pull: { subjects: subjectId } });
  await Category.updateMany({ _id: { $in: catIds } }, { $addToSet: { subjects: subjectId } });
};
router.post("/subjects", managerOnly, async (req, res) => {
  const name = String(req.body.name || "").trim().toLowerCase();
  if (!name) return fail(res, 400, "Name is required");
  const s = await Subject.create({ name, user: req.me._id });
  await setSubjectCats(s._id, ids(req.body.categories));
  record(req, { action: "Created subject", target: name, cat: "library", meta: { kind: "subject_create", count: 1 } });
  ok(res, { id: s._id });
});
router.put("/subjects/:id", managerOnly, async (req, res) => {
  const s = await Subject.findById(req.params.id);
  if (!s) return fail(res, 404, "Subject not found");
  if (req.body.name) s.name = String(req.body.name).trim().toLowerCase();
  await s.save();
  if (req.body.categories) await setSubjectCats(s._id, ids(req.body.categories));
  record(req, { action: "Edited subject", target: s.name, cat: "library" });
  ok(res, { id: s._id });
});
router.delete("/subjects/:id", managerOnly, async (req, res) => {
  const s = await Subject.findByIdAndDelete(req.params.id);
  if (!s) return fail(res, 404, "Subject not found");
  await Promise.all([Question.deleteMany({ subject: s._id }), Topic.deleteMany({ _id: { $in: s.topics } }), Category.updateMany({ subjects: s._id }, { $pull: { subjects: s._id } })]);
  record(req, { action: "Deleted subject", target: s.name, detail: `${(s.topics || []).length} topic(s) removed`, cat: "library" });
  ok(res, { deleted: true });
});

// ── Topics ──
router.post("/topics", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const { subject } = req.body;
  if (!name || !isId(subject)) return fail(res, 400, "Name and subject are required");
  if (!inScope(req, subject)) return fail(res, 403, "Outside your assigned subjects");
  const sub = await Subject.findById(subject);
  if (!sub) return fail(res, 404, "Subject not found");
  const cats = ids(req.body.categories).length ? ids(req.body.categories) : ((await subjectCats()).get(String(subject)) || []);
  const t = await Topic.create({ name, user: req.me._id, subject, subjectName: sub.name, categories: cats });
  await Subject.updateOne({ _id: subject }, { $addToSet: { topics: t._id } });
  record(req, { action: "Created topic", target: name, detail: sub.name, cat: "library", meta: { kind: "topic_create", count: 1 } });
  ok(res, { id: t._id });
});
router.put("/topics/:id", async (req, res) => {
  const t = await Topic.findById(req.params.id);
  if (!t) return fail(res, 404, "Topic not found");
  const cur = await Subject.findOne({ topics: t._id }).select("_id name");
  const curId = cur?._id || t.subject;
  if (!inScope(req, curId)) return fail(res, 403, "Outside your assigned subjects");
  if (req.body.name) t.name = String(req.body.name).trim();
  if (req.body.categories) t.categories = ids(req.body.categories);
  const next = req.body.subject;
  if (isId(next) && String(next) !== String(curId)) {
    if (!inScope(req, next)) return fail(res, 403, "Outside your assigned subjects");
    const ns = await Subject.findById(next);
    if (!ns) return fail(res, 404, "Subject not found");
    await Subject.updateMany({ topics: t._id }, { $pull: { topics: t._id } });
    await Subject.updateOne({ _id: next }, { $addToSet: { topics: t._id } });
    await Question.updateMany({ topic: t._id }, { $set: { subject: next } });
    t.subject = next; t.subjectName = ns.name;
  }
  t.edits = [...new Set([...(t.edits || []).map(String), String(req.me._id)])];
  await t.save();
  record(req, { action: "Edited topic", target: t.name, cat: "library", meta: { kind: "topic_edit", count: 1 } });
  ok(res, { id: t._id });
});
router.delete("/topics/:id", async (req, res) => {
  const t = await Topic.findById(req.params.id);
  if (!t) return fail(res, 404, "Topic not found");
  const cur = await Subject.findOne({ topics: t._id }).select("_id");
  if (!inScope(req, cur?._id || t.subject)) return fail(res, 403, "Outside your assigned subjects");
  const n = await Question.deleteMany({ topic: t._id });
  await Subject.updateMany({ topics: t._id }, { $pull: { topics: t._id } });
  await t.deleteOne();
  record(req, { action: "Deleted topic", target: t.name, detail: `${n.deletedCount} question(s) removed`, cat: "library" });
  ok(res, { deleted: true });
});

// ── Questions ──
const cleanAnswers = (a) => (Array.isArray(a) ? a : []).filter((x) => x && String(x.name || "").trim()).map((x) => ({ name: String(x.name).trim(), correct: !!x.correct, ...(x.latex && { latex: x.latex, isLatex: !!x.isLatex }) }));
const validQ = (b, isTheory) => {
  if (!String(b.question || "").trim()) return "Question text is required";
  if (!isTheory) {
    const a = cleanAnswers(b.answers);
    if (a.length < 2) return "Add at least two answer options";
    if (a.filter((x) => x.correct).length !== 1) return "Mark exactly one correct answer";
  }
  return null;
};

router.post("/questions/bulk", async (req, res) => {
  const list = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!list.length) return fail(res, 422, "No questions provided");
  if (list.length > 500) return fail(res, 422, "Maximum 500 questions per upload");
  for (const [i, q] of list.entries()) {
    const err = validQ(q, q.isTheory);
    if (err) return fail(res, 422, `Question ${i + 1}: ${err}`);
    if (!isId(q.subject) || !isId(q.topic)) return fail(res, 422, `Question ${i + 1}: subject and topic are required`);
    if (!inScope(req, q.subject)) return fail(res, 403, `Question ${i + 1}: outside your assigned subjects`);
    if (!ids(q.categories).length) return fail(res, 422, `Question ${i + 1}: pick at least one category`);
    if (!(await Subject.exists({ _id: q.subject, topics: q.topic }))) return fail(res, 422, `Question ${i + 1}: topic doesn't belong to that subject`);
  }
  const docs = await Question.insertMany(list.map((q) => ({
    question: String(q.question).trim(), answers: cleanAnswers(q.answers), explanation: q.explanation || undefined, point: Number(q.point) || 5, timer: Number(q.timer) || 40,
    subject: q.subject, topic: q.topic, categories: ids(q.categories), isTheory: !!q.isTheory, user: req.me._id, image: { type: "null" },
  })));
  const byTopic = new Map();
  docs.forEach((d) => byTopic.set(String(d.topic), [...(byTopic.get(String(d.topic)) || []), d._id]));
  await Promise.all([...byTopic].map(([t, qs]) => Topic.updateOne({ _id: t }, { $addToSet: { questions: { $each: qs } } })));
  await User.updateOne({ _id: req.me._id }, { $inc: { totalPoints: docs.length * 10 } });
  record(req, { action: "Uploaded questions", target: `${docs.length} question${docs.length > 1 ? "s" : ""}`, cat: "library", meta: { kind: "question_upload", count: docs.length } });
  ok(res, { created: docs.length });
});

router.put("/questions/:id", async (req, res) => {
  const q = await Question.findById(req.params.id);
  if (!q) return fail(res, 404, "Question not found");
  if (!inScope(req, q.subject)) return fail(res, 403, "Outside your assigned subjects");
  const b = req.body;
  const err = validQ(b, b.isTheory);
  if (err) return fail(res, 422, err);
  const subject = isId(b.subject) ? b.subject : q.subject;
  if (!inScope(req, subject)) return fail(res, 403, "Outside your assigned subjects");
  if (isId(b.topic) && !(await Subject.exists({ _id: subject, topics: b.topic }))) return fail(res, 422, "Topic doesn't belong to that subject");
  const oldTopic = String(q.topic);
  Object.assign(q, { question: String(b.question).trim(), answers: cleanAnswers(b.answers), explanation: b.explanation || undefined, point: Number(b.point) || q.point, timer: Number(b.timer) || q.timer, subject, topic: isId(b.topic) ? b.topic : q.topic, isTheory: !!b.isTheory });
  if (ids(b.categories).length) q.categories = ids(b.categories);
  q.edits = [...new Set([...(q.edits || []).map(String), String(req.me._id)])];
  await q.save();
  if (oldTopic !== String(q.topic)) {
    await Topic.updateOne({ _id: oldTopic }, { $pull: { questions: q._id } });
    await Topic.updateOne({ _id: q.topic }, { $addToSet: { questions: q._id } });
  }
  record(req, { action: "Edited question", target: q.question.slice(0, 60), cat: "library", meta: { kind: "question_edit", count: 1 } });
  ok(res, { id: q._id });
});

router.post("/questions/:id/duplicate", async (req, res) => {
  const q = await Question.findById(req.params.id).lean();
  if (!q) return fail(res, 404, "Question not found");
  if (!inScope(req, q.subject)) return fail(res, 403, "Outside your assigned subjects");
  const { _id, edits, __v, ...rest } = q;
  const d = await Question.create({ ...rest, user: req.me._id, question: `${q.question} (copy)` });
  await Topic.updateOne({ _id: q.topic }, { $addToSet: { questions: d._id } });
  record(req, { action: "Duplicated question", target: q.question.slice(0, 60), cat: "library", meta: { kind: "question_upload", count: 1 } });
  ok(res, { id: d._id });
});

const scoped = async (req, idList) => {
  const rows = await Question.find({ _id: { $in: ids(idList) } }).select("subject topic").lean();
  return rows.filter((r) => inScope(req, r.subject));
};
router.post("/questions/bulk-delete", async (req, res) => {
  const rows = await scoped(req, req.body.ids);
  if (!rows.length) return fail(res, 400, "Nothing to delete");
  const qids = rows.map((r) => r._id);
  await Question.deleteMany({ _id: { $in: qids } });
  await Topic.updateMany({ questions: { $in: qids } }, { $pull: { questions: { $in: qids } } });
  record(req, { action: "Deleted questions", target: `${qids.length} question(s)`, cat: "library" });
  ok(res, { deleted: qids.length });
});
router.post("/questions/bulk-move", async (req, res) => {
  const { topic } = req.body;
  const t = isId(topic) && (await Topic.findById(topic));
  if (!t) return fail(res, 404, "Topic not found");
  const sub = await Subject.findOne({ topics: t._id }).select("_id");
  if (!sub || !inScope(req, sub._id)) return fail(res, 403, "Outside your assigned subjects");
  const rows = await scoped(req, req.body.ids);
  const qids = rows.map((r) => r._id);
  await Question.updateMany({ _id: { $in: qids } }, { $set: { topic: t._id, subject: sub._id }, $addToSet: { edits: req.me._id } });
  await Topic.updateMany({ questions: { $in: qids } }, { $pull: { questions: { $in: qids } } });
  await Topic.updateOne({ _id: t._id }, { $addToSet: { questions: { $each: qids } } });
  record(req, { action: "Moved questions", target: `${qids.length} → ${t.name}`, cat: "library", meta: { kind: "question_edit", count: qids.length } });
  ok(res, { moved: qids.length });
});
router.post("/questions/bulk-set", async (req, res) => {
  const set = {};
  if (req.body.point) set.point = Number(req.body.point);
  if (req.body.timer) set.timer = Number(req.body.timer);
  if (!Object.keys(set).length) return fail(res, 400, "Nothing to update");
  const rows = await scoped(req, req.body.ids);
  const qids = rows.map((r) => r._id);
  await Question.updateMany({ _id: { $in: qids } }, { $set: set, $addToSet: { edits: req.me._id } });
  record(req, { action: "Bulk-updated questions", target: `${qids.length} question(s)`, detail: Object.entries(set).map(([k, v]) => `${k}=${v}`).join(", "), cat: "library", meta: { kind: "question_edit", count: qids.length } });
  ok(res, { updated: qids.length });
});

module.exports = router;
