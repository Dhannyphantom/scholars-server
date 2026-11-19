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
const { buildQuestionFields, toMarkup } = require("../controllers/richText"); // NEW
const { buildFilter, OID_RE } = require("../controllers/questionFilter"); // NEW: exhaustive question filters

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

// `question`/`answers`/`explanation` stay the plain-text mirror (old clients, search).
// NEW: `content` (stored rich version) and `source` (the same thing as editable authoring markup —
// an edit form should show/edit `source` when present and PUT it back with `markup: true`).
const qDto = (q) => {
  const c = q.content && q.content.version === 2 ? q.content : null;
  return {
    id: q._id, question: q.question, answers: (q.answers || []).map((a) => ({ id: a._id, name: a.name, correct: !!a.correct })), explanation: q.explanation || "",
    point: q.point, timer: q.timer, subject: q.subject, topic: q.topic, categories: q.categories || [], isTheory: !!q.isTheory, isLatex: !!q.isLatex, user: q.user,
    created: q._id && q._id.getTimestamp ? q._id.getTimestamp() : undefined,
    difficulty: q.difficulty, active: q.active !== false, jambEligible: q.jambEligible !== false,
    hasImage: !!(q.image && q.image.uri), edited: (q.edits || []).length,
    content: c || undefined,
    source: c ? { question: toMarkup(c.stem), answers: (c.options || []).map((o) => ({ name: toMarkup(o.body), correct: !!o.correct })), explanation: toMarkup(c.explanation) } : undefined,
  };
};

router.get("/questions", async (req, res) => {
  const { page, limit, skip } = paging(req.query, 20);
  const F = buildFilter(req.query, proScope(req));
  let rows;
  if (F.needsCount) {
    rows = await Question.aggregate([{ $match: F.filter }, { $addFields: { _oc: { $size: { $ifNull: ["$answers", []] } } } }, { $sort: F.sort }, { $skip: skip }, { $limit: limit }]);
  } else {
    let cur = Question.find(F.filter).sort(F.sort).skip(skip).limit(limit);
    if (F.alpha) cur = cur.collation({ locale: "en", strength: 2 });
    rows = await cur.lean();
  }
  const total = await Question.countDocuments(F.filter);
  ok(res, rows.map(qDto), { total, page, pages: Math.ceil(total / limit), sort: F.sortKey, criteria: F.criteria });
});

// Values the filter panel needs (ranges, creators/editors, date span). Must stay ABOVE /questions/:id.
router.get("/questions/facets", async (req, res) => {
  const { filter } = buildFilter({}, proScope(req));
  const [[agg], creatorIds, editorIds] = await Promise.all([
    Question.aggregate([{ $match: filter }, { $group: { _id: null, pMin: { $min: "$point" }, pMax: { $max: "$point" }, tMin: { $min: "$timer" }, tMax: { $max: "$timer" }, first: { $min: "$_id" }, last: { $max: "$_id" } } }]),
    Question.distinct("user", filter),
    Question.distinct("edits", filter),
  ]);
  const people = await User.find({ _id: { $in: [...new Set([...creatorIds, ...editorIds].map(String))] } }).select("name username").lean();
  const pick = (idsArr) => idsArr.map((i) => { const u = people.find((x) => String(x._id) === String(i)); return { id: String(i), name: u ? u.name || u.username || String(i) : "Unknown user" }; });
  ok(res, {
    points: agg ? { min: agg.pMin, max: agg.pMax } : null,
    timers: agg ? { min: agg.tMin, max: agg.tMax } : null,
    dates: agg ? { from: agg.first.getTimestamp(), to: agg.last.getTimestamp() } : null,
    creators: pick(creatorIds), editors: pick(editorIds),
  });
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

// NEW — classify question/answers/explanation (authoring markup) into the stored fields.
//  returns { f: { question, answers, explanation?, content } } or { error }.
//  `existing` (the stored content) is passed ONLY for old plain-text editors, so an unchanged field
//  keeps its formatting; the new editor (body.markup === true) is authoritative and passes nothing.
const build = (b, existing) => {
  const src = cleanAnswers(b.answers);
  const f = buildQuestionFields({ question: b.question, answers: src, explanation: b.explanation }, existing);
  if (!f.question.trim()) return { error: "Question text is required" };
  if (!b.isTheory && f.answers.filter((a) => a.correct).length !== 1) return { error: "Mark exactly one correct answer (maximum 6 options)" };
  f.answers = f.answers.map((a, i) => ({ ...a, ...(src[i]?.latex && { latex: src[i].latex, isLatex: !!src[i].isLatex }) })); // keep old AI-latex passthrough
  return { f };
};
const appendCopy = (stem) =>
  stem.format === "latex" ? { format: "text", value: `$${stem.value}$ (copy)`, hasMath: true } : { ...stem, value: `${stem.value} (copy)` };

router.post("/questions/bulk", async (req, res) => {
  const list = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!list.length) return fail(res, 422, "No questions provided");
  if (list.length > 500) return fail(res, 422, "Maximum 500 questions per upload");
  const built = [];
  for (const [i, q] of list.entries()) {
    const err = validQ(q, q.isTheory);
    if (err) return fail(res, 422, `Question ${i + 1}: ${err}`);
    if (!isId(q.subject) || !isId(q.topic)) return fail(res, 422, `Question ${i + 1}: subject and topic are required`);
    if (!inScope(req, q.subject)) return fail(res, 403, `Question ${i + 1}: outside your assigned subjects`);
    if (!ids(q.categories).length) return fail(res, 422, `Question ${i + 1}: pick at least one category`);
    if (!(await Subject.exists({ _id: q.subject, topics: q.topic }))) return fail(res, 422, `Question ${i + 1}: topic doesn't belong to that subject`);
    const r = build(q);
    if (r.error) return fail(res, 422, `Question ${i + 1}: ${r.error}`);
    built.push(r.f);
  }
  const docs = await Question.insertMany(list.map((q, i) => ({
    question: built[i].question, answers: built[i].answers, explanation: built[i].explanation, content: built[i].content,
    point: Number(q.point) || 5, timer: Number(q.timer) || 40,
    subject: q.subject, topic: q.topic, categories: ids(q.categories), isTheory: !!q.isTheory, user: req.me._id, image: { type: "null" },
  })));
  const byTopic = new Map();
  docs.forEach((d) => byTopic.set(String(d.topic), [...(byTopic.get(String(d.topic)) || []), d._id]));
  await Promise.all([...byTopic].map(([t, qs]) => Topic.updateOne({ _id: t }, { $addToSet: { questions: { $each: qs } } })));
  await User.updateOne({ _id: req.me._id }, { $inc: { totalPoints: docs.length * 10 } });

  // Keep the structure in step with the batch context: a topic must list every category its questions use
  // (the student app filters topics by category), and we report subjects that are not under a chosen category.
  const catsOfTopic = new Map(), catsOfSubject = new Map();
  list.forEach((q) => {
    const cs = ids(q.categories).map(String);
    catsOfTopic.set(String(q.topic), new Set([...(catsOfTopic.get(String(q.topic)) || []), ...cs]));
    catsOfSubject.set(String(q.subject), new Set([...(catsOfSubject.get(String(q.subject)) || []), ...cs]));
  });
  await Promise.all([...catsOfTopic].map(([t, cs]) => Topic.updateOne({ _id: t }, { $addToSet: { categories: { $each: [...cs] } } })));
  const [catDocs, subDocs] = await Promise.all([
    Category.find({ _id: { $in: [...new Set([...catsOfSubject.values()].flatMap((s) => [...s]))] } }).select("name subjects").lean(),
    Subject.find({ _id: { $in: [...catsOfSubject.keys()] } }).select("name").lean(),
  ]);
  const warnings = [];
  catsOfSubject.forEach((cs, sid) => cs.forEach((cid) => {
    const c = catDocs.find((x) => String(x._id) === cid);
    if (c && !(c.subjects || []).some((x) => String(x) === sid)) warnings.push(`${subDocs.find((s) => String(s._id) === sid)?.name || "subject"} is not listed under category “${c.name}”, so students in that category won't see these questions yet`);
  }));

  record(req, { action: "Uploaded questions", target: `${docs.length} question${docs.length > 1 ? "s" : ""}`, cat: "library", meta: { kind: "question_upload", count: docs.length } });
  ok(res, { created: docs.length, warnings });
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
  const r = build(b, b.markup === true ? undefined : q.toObject().content);
  if (r.error) return fail(res, 422, r.error);
  const oldTopic = String(q.topic);
  Object.assign(q, { question: r.f.question, answers: r.f.answers, explanation: r.f.explanation, content: r.f.content, point: Number(b.point) || q.point, timer: Number(b.timer) || q.timer, subject, topic: isId(b.topic) ? b.topic : q.topic, isTheory: !!b.isTheory });
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
  const d = await Question.create({
    ...rest, user: req.me._id, question: `${q.question} (copy)`,
    ...(q.content?.stem && { content: { ...q.content, stem: appendCopy(q.content.stem) } }), // keep content in step with the plain mirror
  });
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

// ── Manage EVERYTHING that matches a filter (or an explicit selection), not just the visible page ──
// Body: { filter: {…same criteria as GET /questions…} }  or  { ids: [...] }, plus expectedCount for writes.
const MAX_MANAGE = 50000;
const chunks = (a, n = 2000) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function manageTarget(req) {
  const scope = proScope(req);
  const b = req.body || {};
  if (Array.isArray(b.ids) && b.ids.length) {
    const { filter } = buildFilter({}, scope);
    return { filter: { $and: [{ _id: { $in: ids(b.ids).map((x) => new mongoose.Types.ObjectId(String(x))) } }, filter] }, hasCriteria: true };
  }
  const r = buildFilter(b.filter || {}, scope);
  return { filter: r.filter, hasCriteria: r.hasCriteria };
}
// resolves the ids to act on, or answers the request with an error and returns null
async function manageIds(req, res) {
  const t = await manageTarget(req);
  if (!t.hasCriteria) { fail(res, 400, "Apply at least one filter (or select questions) first"); return null; }
  const rows = await Question.find(t.filter).select("_id").limit(MAX_MANAGE + 1).lean();
  if (rows.length > MAX_MANAGE) { fail(res, 422, `More than ${MAX_MANAGE} questions match. Narrow the filter first.`); return null; }
  if (!rows.length) { fail(res, 404, "No questions match"); return null; }
  const exp = req.body.expectedCount;
  if (Number.isInteger(exp) && exp !== rows.length) { fail(res, 409, `The matching set changed (${rows.length} question(s) now). Review and confirm again.`); return null; }
  return rows.map((r) => r._id);
}

router.post("/questions/by-filter/preview", async (req, res) => {
  const t = await manageTarget(req);
  const [count, bySubject] = await Promise.all([
    Question.countDocuments(t.filter),
    Question.aggregate([{ $match: t.filter }, { $group: { _id: "$subject", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }, { $lookup: { from: "subjects", localField: "_id", foreignField: "_id", as: "s" } }, { $project: { n: 1, name: { $arrayElemAt: ["$s.name", 0] } } }]),
  ]);
  ok(res, { count, hasCriteria: t.hasCriteria, tooMany: count > MAX_MANAGE, bySubject: bySubject.map((r) => ({ name: r.name || "Unknown subject", n: r.n })) });
});

router.post("/questions/by-filter/delete", async (req, res) => {
  const qids = await manageIds(req, res);
  if (!qids) return;
  for (const c of chunks(qids)) {
    await Question.deleteMany({ _id: { $in: c } });
    await Topic.updateMany({ questions: { $in: c } }, { $pull: { questions: { $in: c } } });
  }
  record(req, { action: "Deleted questions (by filter)", target: `${qids.length} question(s)`, cat: "library", meta: { kind: "question_edit", count: qids.length } });
  ok(res, { deleted: qids.length });
});

router.post("/questions/by-filter/update", async (req, res) => {
  const b = req.body || {}, s = b.set || {};
  const set = {}, unset = {};
  if (s.point !== undefined && s.point !== "") { const n = Number(s.point); if (!(n > 0)) return fail(res, 422, "Points must be greater than 0"); set.point = n; }
  if (s.timer !== undefined && s.timer !== "") { const n = Number(s.timer); if (!(n >= 5)) return fail(res, 422, "Seconds must be at least 5"); set.timer = n; }
  ["isTheory", "active", "jambEligible"].forEach((k) => { if (typeof s[k] === "boolean") set[k] = s[k]; });
  if (s.difficulty === "") unset.difficulty = "";
  else if (["easy", "medium", "hard"].includes(s.difficulty)) set.difficulty = s.difficulty;

  const catIds = ids(b.categories?.ids), catMode = b.categories?.mode;
  if (catMode && !["add", "remove", "replace"].includes(catMode)) return fail(res, 422, "Invalid category action");
  if (catMode && !catIds.length) return fail(res, 422, "Pick at least one category");

  let moveTo = null;
  if (b.move?.topic) {
    const t = isId(b.move.topic) && (await Topic.findById(b.move.topic));
    if (!t) return fail(res, 404, "Target topic not found");
    const sub = await Subject.findOne({ topics: t._id }).select("_id");
    if (!sub || !inScope(req, sub._id)) return fail(res, 403, "Outside your assigned subjects");
    moveTo = { topic: t._id, subject: sub._id };
  }
  if (!Object.keys(set).length && !Object.keys(unset).length && !catMode && !moveTo) return fail(res, 400, "Choose at least one change");

  const qids = await manageIds(req, res);
  if (!qids) return;
  const catOids = catIds.map((x) => new mongoose.Types.ObjectId(String(x)));

  for (const c of chunks(qids)) {
    const q = { _id: { $in: c } };
    const $set = { ...set, ...(moveTo || {}) };
    const $addToSet = { edits: req.me._id };
    if (catMode === "replace") $set.categories = catOids;
    if (catMode === "add") $addToSet.categories = { $each: catOids };
    await Question.updateMany(q, { ...(Object.keys($set).length && { $set }), ...(Object.keys(unset).length && { $unset: unset }), $addToSet });
    if (catMode === "remove") {
      // never leave a question without a category: if removal would empty it, it is left unchanged
      await Question.updateMany(q, [{ $set: {
        categories: { $let: { vars: { rest: { $filter: { input: "$categories", as: "c", cond: { $not: [{ $in: ["$$c", catOids] }] } } } }, in: { $cond: [{ $gt: [{ $size: "$$rest" }, 0] }, "$$rest", "$categories"] } } },
        edits: { $setUnion: [{ $ifNull: ["$edits", []] }, [req.me._id]] },
      } }]);
    }
    if (moveTo) {
      await Topic.updateMany({ questions: { $in: c } }, { $pull: { questions: { $in: c } } });
      await Topic.updateOne({ _id: moveTo.topic }, { $addToSet: { questions: { $each: c } } });
    }
  }
  if (catMode === "add" || catMode === "replace") {
    const topics = await Question.distinct("topic", { _id: { $in: qids } }); // topics must list the categories their questions use
    await Topic.updateMany({ _id: { $in: topics } }, { $addToSet: { categories: { $each: catOids } } });
  }
  const what = [...Object.keys(set), ...Object.keys(unset), catMode && `categories:${catMode}`, moveTo && "move"].filter(Boolean).join(", ");
  record(req, { action: "Bulk-updated questions (by filter)", target: `${qids.length} question(s)`, detail: what, cat: "library", meta: { kind: "question_edit", count: qids.length } });
  ok(res, { updated: qids.length });
});

module.exports = router;