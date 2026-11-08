// controllers/jambService.js
// JAMB Score Predictor — all business logic (see JAMB_BACKEND_GUIDE.md).
//
// Design notes
//  * No transactions are required (works on a standalone MongoDB). Every step of a
//    submission is idempotent / resumable:
//      issued -> submitting (CAS, graded paper stored) -> round $push (guarded)
//      -> counters (CAS) -> round completion (CAS) -> profile recompute -> submitted
//    A sweeper (`sweep`) finishes anything a crash left half way.
//  * Grading is done from the immutable paper snapshot; the client only sends ids.
//  * Rounds are created lazily the first time the user touches the feature after
//    the rest period.

const mongoose = require("mongoose");
const CFG = require("./jambConfig");
const {
  JambProfile,
  JambRound,
  JambAttempt,
  JambSeen,
} = require("../models/Jamb");
const { User } = require("../models/User");
const { Subject } = require("../models/Subject");
const { Question } = require("../models/Question");

const ObjectId = mongoose.Types.ObjectId;

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────
function jerr(status, code, message, details) {
  const e = new Error(message || code);
  e.jamb = true;
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

const isValidId = (v) =>
  typeof v === "string" && /^[a-f0-9]{24}$/i.test(v) && ObjectId.isValid(v);
const oid = (v) => new ObjectId(String(v));
const str = (v) => String(v);
const toMs = (d) => (d ? +new Date(d) : 0);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);
const sameSet = (a, b) => {
  const A = new Set(a.map(str));
  const B = new Set(b.map(str));
  return A.size === B.size && [...A].every((x) => B.has(x));
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function activeCooldownMs(profile, now) {
  return profile && profile.cooldownUntil && new Date(profile.cooldownUntil) > now
    ? toMs(profile.cooldownUntil)
    : 0;
}

function isPremiumUser(user, now = new Date()) {
  const sub = user && user.subscription;
  return !!(
    user &&
    user.accountType === "student" &&
    sub &&
    sub.isActive &&
    (!sub.expiry || new Date(sub.expiry) > now)
  );
}

function questionCountFor(subject) {
  const compulsory = !!subject.jambCompulsory;
  if (CFG.USE_MOCK_COUNTS)
    return compulsory ? CFG.QUESTIONS.mockCompulsory : CFG.QUESTIONS.mockOther;
  return compulsory ? CFG.QUESTIONS.compulsory : CFG.QUESTIONS.other;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure scoring helpers (unit-tested)
// ─────────────────────────────────────────────────────────────────────────────
function ratingFor(percent) {
  const band = CFG.RATING_BANDS.find((b) => percent >= b.min);
  return (band || CFG.RATING_BANDS[CFG.RATING_BANDS.length - 1]).label;
}

function levelFor(lifetimeCorrect) {
  const n = Number(lifetimeCorrect) || 0;
  let lvl = CFG.LEVELS[0];
  for (const l of CFG.LEVELS) if (n >= l.min) lvl = l;
  const next = CFG.LEVELS[CFG.LEVELS.indexOf(lvl) + 1] || null;
  return { level: lvl, next, progress: next ? Math.min(n / next.min, 1) : 1 };
}

function buildInsights(subjects) {
  const sorted = [...subjects].sort((a, b) => b.percent - a.percent); // stable: ties keep selection order
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  let focus = sorted.filter((s) => s.percent < 65).reverse().slice(0, 2); // weakest first, max 2
  if (!focus.length) focus = [weakest];
  const nextStep =
    weakest.percent < 50
      ? `Revise ${weakest.name} basics, then retake the assessment.`
      : weakest.percent < 70
        ? `Attempt more ${weakest.name} practice questions.`
        : "Keep practising timed questions to stay sharp.";
  const pair = (s) => ({ name: s.name, percent: s.percent });
  return {
    strongest: pair(strongest),
    weakest: pair(weakest),
    focus: focus.map(pair),
    nextStep,
  };
}

function summarize(subjects) {
  const avg = subjects.reduce((s, x) => s + x.percent, 0) / subjects.length;
  const predicted = Math.round((avg / 100) * CFG.TOTAL_SCORE);
  const percent = Math.round(avg);
  return {
    model: "v1-sum",
    predicted,
    percent,
    rangeLow: Math.max(predicted - CFG.RANGE_MARGIN, 0),
    rangeHigh: Math.min(predicted + CFG.RANGE_MARGIN, CFG.TOTAL_SCORE),
    rating: ratingFor(percent),
    totalCorrect: subjects.reduce((s, x) => s + (x.correct || 0), 0),
    totalQuestions: subjects.reduce((s, x) => s + (x.total || 0), 0),
    insights: buildInsights(subjects),
  };
}

// Grade raw answers against the paper snapshot. Throws 422 on any tampering.
function gradePaper(paper, answers) {
  if (!Array.isArray(answers))
    throw jerr(422, "VALIDATION_FAILED", "answers must be an array.");

  const index = new Map();
  paper.forEach((p) =>
    p.questions.forEach((q) => index.set(str(q.questionId), q)),
  );

  const given = new Map();
  const problems = [];
  answers.forEach((a, i) => {
    const qid = a && a.questionId != null ? str(a.questionId) : null;
    const snap = qid ? index.get(qid) : null;
    if (!snap) return problems.push({ index: i, field: "questionId", message: "Unknown question." });
    if (given.has(qid))
      return problems.push({ index: i, field: "questionId", message: "Duplicate question." });
    const aid = a.answerId == null ? null : str(a.answerId);
    if (aid !== null && !snap.answerIds.some((x) => str(x) === aid))
      return problems.push({ index: i, field: "answerId", message: "Answer does not belong to question." });
    given.set(qid, aid);
  });
  if (problems.length)
    throw jerr(422, "VALIDATION_FAILED", "Invalid answers.", problems.slice(0, 20));

  const correctIds = [];
  const wrongIds = [];
  const subjects = paper.map((p) => {
    let correct = 0;
    let skipped = 0;
    p.questions.forEach((q) => {
      const aid = given.get(str(q.questionId));
      if (aid == null) skipped++;
      else if (aid === str(q.correctAnswerId)) {
        correct++;
        correctIds.push(str(q.questionId));
      } else wrongIds.push(str(q.questionId));
    });
    const total = p.questions.length;
    return {
      subjectId: str(p.subjectId),
      total,
      correct,
      skipped,
      wrong: total - correct - skipped,
      percent: total ? Math.round((correct / total) * 100) : 0,
    };
  });
  return { subjects, correctIds, wrongIds, answered: correctIds.length + wrongIds.length };
}

// Largest-remainder allocation of `count` picks across groups of the given sizes.
function allocate(sizes, count) {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= count) return sizes.slice();
  const raw = sizes.map((n) => (n / total) * count);
  const out = raw.map((v, i) => Math.min(Math.floor(v), sizes[i]));
  let left = count - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0])
    .map((x) => x[1]);
  while (left > 0) {
    let progressed = false;
    for (const i of order) {
      if (left > 0 && out[i] < sizes[i]) {
        out[i]++;
        left--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

// cand: randomly ordered [{_id, difficulty?}] -> `want` ids, 30/50/20 easy/medium/hard when known.
function chooseByDifficulty(cand, want) {
  if (cand.length <= want) return cand.map((c) => c._id);
  const easy = Math.round(want * 0.3);
  const medium = Math.round(want * 0.5);
  const target = { easy, medium, hard: Math.max(want - easy - medium, 0) };
  const picked = [];
  const used = new Set();
  for (const level of ["easy", "medium", "hard"]) {
    let n = target[level];
    for (const c of cand) {
      if (n <= 0) break;
      if (c.difficulty === level && !used.has(str(c._id))) {
        picked.push(c._id);
        used.add(str(c._id));
        n--;
      }
    }
  }
  for (const c of cand) {
    if (picked.length >= want) break;
    if (!used.has(str(c._id))) {
      picked.push(c._id);
      used.add(str(c._id));
    }
  }
  return picked.slice(0, want);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shaping for the client
// ─────────────────────────────────────────────────────────────────────────────
function orderResults(round) {
  return (round.subjectIds || [])
    .map((id) => (round.results || []).find((r) => str(r.subjectId) === str(id)))
    .filter(Boolean);
}

const clientSubject = (r) => ({
  _id: str(r.subjectId),
  name: r.name,
  image: r.image || null,
  total: r.total,
  correct: r.correct,
  wrong: r.wrong,
  skipped: r.skipped,
  percent: r.percent,
  score: r.percent,
});

function toRoundResult(roundDoc) {
  const round = plain(roundDoc);
  const s = round.summary || {};
  const ins = s.insights || {};
  return {
    id: str(round._id),
    number: round.number,
    date: iso(round.completedAt),
    subjects: orderResults(round).map(clientSubject),
    predicted: s.predicted,
    percent: s.percent,
    range: { low: s.rangeLow, high: s.rangeHigh },
    rating: { label: s.rating },
    totalCorrect: s.totalCorrect,
    totalQuestions: s.totalQuestions,
    insights: {
      strongest: ins.strongest || null,
      weakest: ins.weakest || null,
      focus: ins.focus || [],
      nextStep: ins.nextStep || "",
    },
  };
}

function shapeActiveRound(roundDoc) {
  const round = plain(roundDoc);
  const completed = {};
  (round.results || []).forEach((r) => {
    completed[str(r.subjectId)] = {
      _id: str(r.subjectId),
      name: r.name,
      image: r.image || null,
      total: r.total,
      correct: r.correct,
      wrong: r.wrong,
      skipped: r.skipped,
      percent: r.percent,
      date: iso(r.completedAt),
    };
  });
  return {
    id: str(round._id),
    number: round.number,
    subjectIds: (round.subjectIds || []).map(str),
    completed,
    availableAt: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile / round state
// ─────────────────────────────────────────────────────────────────────────────
async function upsertProfile(userId) {
  try {
    return await JambProfile.findOneAndUpdate(
      { userId: oid(userId) },
      { $setOnInsert: { userId: oid(userId) } },
      { upsert: true, new: true },
    );
  } catch (e) {
    if (e.code === 11000) return JambProfile.findOne({ userId: oid(userId) });
    throw e;
  }
}

async function abandonActiveRound(userId) {
  await JambRound.updateMany(
    { userId: oid(userId), status: "active" },
    { $set: { status: "abandoned" } },
  );
  await JambAttempt.updateMany(
    { userId: oid(userId), status: "issued" },
    { $set: { status: "abandoned" } },
  );
}

// Edge case: a chosen subject was un-flagged/deleted mid-round -> abandon, require re-selection.
async function reconcileSelection(userId, profile) {
  if (!profile || profile.selection.length !== CFG.SUBJECTS_PER_ROUND) return profile;
  const ok = await Subject.countDocuments({
    _id: { $in: profile.selection },
    jambEligible: true,
  });
  if (ok === CFG.SUBJECTS_PER_ROUND) return profile;
  await abandonActiveRound(userId);
  return JambProfile.findOneAndUpdate(
    { userId: oid(userId) },
    { $set: { selection: [] } },
    { new: true },
  );
}

async function getOrCreateActiveRound(userId, profile) {
  let round = await JambRound.findOne({ userId: oid(userId), status: "active" });
  if (round && !sameSet(round.subjectIds, profile.selection)) {
    await JambRound.updateOne({ _id: round._id, status: "active" }, { $set: { status: "abandoned" } });
    round = null;
  }
  if (round) return round;

  const completed = await JambRound.countDocuments({ userId: oid(userId), status: "completed" });
  try {
    return await JambRound.create({
      userId: oid(userId),
      number: completed + 1,
      subjectIds: profile.selection,
      status: "active",
      results: [],
    });
  } catch (e) {
    if (e.code === 11000) {
      const again = await JambRound.findOne({ userId: oid(userId), status: "active" });
      if (again) return again;
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config / summary
// ─────────────────────────────────────────────────────────────────────────────
function getConfig() {
  const compulsory = CFG.USE_MOCK_COUNTS ? CFG.QUESTIONS.mockCompulsory : CFG.QUESTIONS.compulsory;
  const other = CFG.USE_MOCK_COUNTS ? CFG.QUESTIONS.mockOther : CFG.QUESTIONS.other;
  return {
    cooldownHours: CFG.COOLDOWN_HOURS,
    subjectsPerRound: CFG.SUBJECTS_PER_ROUND,
    totalScore: CFG.TOTAL_SCORE,
    questionsPerSubject: { compulsory, other },
    secondsPerQuestion: CFG.SECONDS_PER_QUESTION,
    levels: CFG.LEVELS,
    ratingBands: CFG.RATING_BANDS,
    serverNow: new Date().toISOString(),
  };
}

async function buildSummary(userId) {
  const now = new Date();
  const [user, profile0] = await Promise.all([
    User.findById(userId).select("accountType subscription quizStats.totalCorrectAnswers").lean(),
    JambProfile.findOne({ userId: oid(userId) }).lean(),
  ]);
  const lifetimeCorrect = (user && user.quizStats && user.quizStats.totalCorrectAnswers) || 0;
  const empty = {
    serverNow: now.toISOString(),
    selection: [],
    rounds: 0,
    average: 0,
    best: 0,
    lifetimeCorrect,
    cooldownUntil: 0,
    round: null,
    history: [],
  };
  if (!profile0) return empty;

  const profile = (await reconcileSelection(userId, profile0)) || profile0;
  const profileObj = plain(profile);
  const selection = (profileObj.selection || []).map(str);
  const cd = activeCooldownMs(profileObj, now);

  let round = null;
  if (selection.length === CFG.SUBJECTS_PER_ROUND) {
    const pending = {
      id: "pending",
      number: (profileObj.roundsCompleted || 0) + 1,
      subjectIds: selection,
      completed: {},
      availableAt: cd,
    };
    if (cd) round = pending;
    else {
      let doc = await JambRound.findOne({ userId: oid(userId), status: "active" }).lean();
      if (doc && !sameSet(doc.subjectIds, selection)) doc = null;
      if (!doc && isPremiumUser(user, now)) doc = await getOrCreateActiveRound(userId, profileObj);
      round = doc ? shapeActiveRound(doc) : pending;
    }
  }

  const history = await JambRound.find({ userId: oid(userId), status: "completed" })
    .sort({ completedAt: -1 })
    .limit(CFG.HISTORY_IN_SUMMARY)
    .lean();

  const rounds = profileObj.roundsCompleted || 0;
  return {
    serverNow: now.toISOString(),
    selection,
    rounds,
    average: rounds ? Math.round((profileObj.predictedSum || 0) / rounds) : 0,
    best: profileObj.bestPredicted || 0,
    lifetimeCorrect,
    cooldownUntil: cd,
    round,
    history: history.map(toRoundResult),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Question bank helpers
// ─────────────────────────────────────────────────────────────────────────────
// Exactly one correct answer, MCQ only, active & JAMB-eligible. A MISSING flag counts as true so
// existing questions keep working without a data migration.
const ONE_CORRECT = {
  $expr: {
    $eq: [
      { $size: { $filter: { input: { $ifNull: ["$answers", []] }, cond: "$$this.correct" } } },
      1,
    ],
  },
};
const poolFilter = (subjectId) => ({
  subject: subjectId,
  active: { $ne: false },
  jambEligible: { $ne: false },
  isTheory: { $ne: true },
  ...ONE_CORRECT,
});

const dbTotalCache = new Map(); // subjectId -> { n, at }
async function dbTotal(subjectId) {
  const key = str(subjectId);
  const hit = dbTotalCache.get(key);
  if (hit && Date.now() - hit.at < CFG.DB_TOTAL_CACHE_MS) return hit.n;
  const n = await Question.countDocuments({
    subject: oid(subjectId),
    active: { $ne: false },
    jambEligible: { $ne: false },
    isTheory: { $ne: true },
  });
  dbTotalCache.set(key, { n, at: Date.now() });
  return n;
}

async function correctCounts(userId, subjectIds) {
  const out = {};
  subjectIds.forEach((id) => (out[str(id)] = 0));
  const u = await User.findById(userId).select("qBank").lean();
  const ids = ((u && u.qBank) || []).filter((e) => e.correct).map((e) => e.question);
  if (!ids.length) return out;
  const rows = await Question.aggregate([
    { $match: { _id: { $in: ids }, subject: { $in: subjectIds.map(oid) } } },
    { $group: { _id: "$subject", n: { $sum: 1 } } },
  ]);
  rows.forEach((r) => (out[str(r._id)] = r.n));
  return out;
}

async function subjectPerformance(userId, subjectIds) {
  if (!Array.isArray(subjectIds) || !subjectIds.length || subjectIds.length > 20 || !subjectIds.every(isValidId))
    throw jerr(422, "VALIDATION_FAILED", "subjectIds must be a list of valid ids.");
  const ids = [...new Set(subjectIds.map(str))];
  const subjects = await Subject.find({ _id: { $in: ids.map(oid) } })
    .select("name image jambCompulsory")
    .lean();
  const bySubject = new Map(subjects.map((s) => [str(s._id), s]));
  const correct = await correctCounts(userId, ids);

  const items = [];
  for (const id of ids) {
    const s = bySubject.get(id);
    if (!s) continue;
    const total = await dbTotal(id);
    const c = correct[id] || 0;
    items.push({
      _id: id,
      name: s.name,
      image: s.image || null,
      dbTotal: total,
      examMax: questionCountFor(s),
      correct: c,
      percent: total ? Math.min(100, Math.round((c / total) * 100)) : 0,
    });
  }
  return { items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────
async function saveSelection(userId, subjectIds) {
  const bad = (msg, details) => jerr(422, "INVALID_SELECTION", msg, details);
  if (!Array.isArray(subjectIds)) throw bad("subjectIds must be a list.");
  const ids = subjectIds.map(str);
  if (ids.length !== CFG.SUBJECTS_PER_ROUND || new Set(ids).size !== ids.length || !ids.every(isValidId))
    throw bad(`Choose exactly ${CFG.SUBJECTS_PER_ROUND} different subjects.`);

  const subjects = await Subject.find({ _id: { $in: ids.map(oid) } })
    .select("name jambEligible jambCompulsory")
    .lean();
  if (subjects.length !== ids.length || subjects.some((s) => !s.jambEligible))
    throw bad("One or more subjects are not available for JAMB practice.");

  const compulsory = await Subject.find({ jambEligible: true, jambCompulsory: true }).select("_id name").lean();
  if (!compulsory.length) throw bad("JAMB subjects have not been configured yet.");
  const missing = compulsory.filter((c) => !ids.includes(str(c._id)));
  if (missing.length) throw bad(`${missing[0].name} is compulsory.`);

  if (!CFG.USE_MOCK_COUNTS) {
    const small = [];
    for (const s of subjects) {
      const n = await Question.countDocuments(poolFilter(s._id));
      if (n < CFG.MIN_BANK_SIZE_PER_SUBJECT) small.push({ subject: s.name, available: n });
    }
    if (small.length) throw bad("Not enough questions yet for one or more subjects.", small);
  }

  let profile = await upsertProfile(userId);
  const active = await JambRound.findOne({ userId: oid(userId), status: "active" });
  if (active && !sameSet(active.subjectIds, ids)) await abandonActiveRound(userId); // R9: cooldown untouched
  await JambProfile.updateOne({ _id: profile._id }, { $set: { selection: ids.map(oid) } });
  return buildSummary(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issuing attempts
// ─────────────────────────────────────────────────────────────────────────────
async function stratifiedSample(baseFilter, exclude, count) {
  const filter = { ...baseFilter, _id: { $nin: exclude } };
  const groups = await Question.aggregate([
    { $match: filter },
    { $group: { _id: "$topic", n: { $sum: 1 } } },
  ]);
  const alloc = allocate(groups.map((g) => g.n), count);
  const picked = [];
  for (let i = 0; i < groups.length; i++) {
    if (!alloc[i]) continue;
    const cand = await Question.aggregate([
      { $match: { ...filter, topic: groups[i]._id } },
      { $sample: { size: Math.min(groups[i].n, alloc[i] * 3) } },
      { $project: { difficulty: 1 } },
    ]);
    picked.push(...chooseByDifficulty(cand, alloc[i]));
  }
  if (picked.length < count) {
    const rest = await Question.aggregate([
      { $match: { ...baseFilter, _id: { $nin: [...exclude, ...picked] } } },
      { $sample: { size: count - picked.length } },
      { $project: { _id: 1 } },
    ]);
    picked.push(...rest.map((r) => r._id));
  }
  return picked;
}

async function pickQuestions(userId, subject, count) {
  const base = poolFilter(subject._id);
  const seenDoc = await JambSeen.findOne({ userId: oid(userId), subjectId: subject._id }).lean();
  const seen = (seenDoc && seenDoc.questionIds) || [];
  const unseenCount = await Question.countDocuments({ ...base, _id: { $nin: seen } });

  let picks = [];
  let reset = false;
  if (unseenCount >= count) {
    picks = await stratifiedSample(base, seen, count);
  } else {
    // Bank exhausted for this user: start a new cycle, take every unseen question and
    // top up with the OLDEST seen ones.
    reset = true;
    const all = (await Question.find({ ...base, _id: { $nin: seen } }).select("_id").lean()).map((d) => d._id);
    const need = count - all.length;
    let top = [];
    if (need > 0 && seen.length) {
      const valid = new Set(
        (await Question.find({ ...base, _id: { $in: seen } }).select("_id").lean()).map((d) => str(d._id)),
      );
      top = seen.filter((id) => valid.has(str(id))).slice(0, need);
    }
    picks = [...all, ...top];
  }

  const required = CFG.USE_MOCK_COUNTS ? 1 : count;
  if (picks.length < required)
    throw jerr(422, "INSUFFICIENT_QUESTIONS", `Not enough ${subject.name} questions yet.`, {
      subject: subject.name,
      available: picks.length,
      required,
    });

  const docs = await Question.find({ _id: { $in: picks } }).lean();
  return { docs: shuffle(docs), reset };
}

async function markSeen(userId, picked) {
  for (const p of picked) {
    const ids = p.docs.map((d) => d._id);
    if (p.reset) {
      await JambSeen.updateOne(
        { userId: oid(userId), subjectId: p.subjectId },
        { $set: { questionIds: ids, updatedAt: new Date() }, $inc: { cycle: 1 } },
        { upsert: true },
      );
    } else {
      await JambSeen.updateOne(
        { userId: oid(userId), subjectId: p.subjectId },
        { $push: { questionIds: { $each: ids } }, $set: { updatedAt: new Date() }, $setOnInsert: { cycle: 0 } },
        { upsert: true },
      );
    }
  }
}

async function presentAttempt(attempt) {
  const a = plain(attempt);
  const subjects = await Subject.find({ _id: { $in: a.paper.map((p) => p.subjectId) } })
    .select("name image")
    .lean();
  const subjMap = new Map(subjects.map((s) => [str(s._id), s]));
  const qIds = a.paper.flatMap((p) => p.questions.map((q) => q.questionId));
  const qDocs = await Question.find({ _id: { $in: qIds } }).lean();
  const qMap = new Map(qDocs.map((q) => [str(q._id), q]));

  const questionBank = a.paper.map((p) => {
    const s = subjMap.get(str(p.subjectId)) || {};
    return {
      subject: { _id: str(p.subjectId), name: s.name, image: s.image || null },
      questions: p.questions
        .map((sn) => {
          const q = qMap.get(str(sn.questionId));
          if (!q) return null;
          const byId = new Map((q.answers || []).map((x) => [str(x._id), x]));
          const answers = sn.answerIds
            .map((id) => byId.get(str(id)))
            .filter(Boolean)
            .map((x) => ({
              _id: x._id,
              name: x.name,
              latex: x.latex || null,
              isLatex: !!x.isLatex,
              correct: str(x._id) === str(sn.correctAnswerId),
            }));
          return {
            _id: q._id,
            question: q.question,
            isLatex: !!q.isLatex,
            questionLatex: q.questionLatex || null,
            image: q.image && q.image.uri ? q.image : null,
            answers,
            explanation: q.explanation || null,
            explanationLatex: q.explanationLatex || null,
            point: sn.point != null ? sn.point : 1,
            timer: CFG.SECONDS_PER_QUESTION,
          };
        })
        .filter(Boolean),
    };
  });
  return { attemptId: str(a._id), expiresAt: iso(a.expiresAt), questionBank };
}

async function issueAttempt(userId, subjectIds) {
  const now = new Date();
  if (!Array.isArray(subjectIds) || !subjectIds.length || !subjectIds.every(isValidId))
    throw jerr(422, "VALIDATION_FAILED", "subjectIds must be a non-empty list of ids.");
  const ids = [...new Set(subjectIds.map(str))];

  let profile = await JambProfile.findOne({ userId: oid(userId) });
  if (profile) profile = (await reconcileSelection(userId, profile)) || profile;
  if (!profile || profile.selection.length !== CFG.SUBJECTS_PER_ROUND)
    throw jerr(409, "SELECTION_REQUIRED", "Choose your 4 JAMB subjects first.");

  const cd = activeCooldownMs(profile, now);
  if (cd) throw jerr(409, "COOLDOWN_ACTIVE", "Next round unlocks later.", { cooldownUntil: cd });

  const round = await getOrCreateActiveRound(userId, profile);
  if (!ids.every((id) => round.subjectIds.map(str).includes(id)))
    throw jerr(422, "VALIDATION_FAILED", "Subjects are not part of your current round.");
  if (ids.some((id) => round.results.some((r) => str(r.subjectId) === id)))
    throw jerr(409, "SUBJECT_ALREADY_COMPLETED", "You already completed this subject in this round.");

  // resume or replace an open attempt
  const open = await JambAttempt.findOne({ userId: oid(userId), status: "issued" });
  if (open) {
    if (sameSet(open.subjectIds, ids) && open.expiresAt > now && str(open.roundId) === str(round._id))
      return presentAttempt(open);
    await JambAttempt.updateOne({ _id: open._id, status: "issued" }, { $set: { status: "abandoned" } });
  }

  const recent = await JambAttempt.countDocuments({
    userId: oid(userId),
    createdAt: { $gte: new Date(now.getTime() - 3600e3) },
  });
  if (recent >= CFG.ATTEMPT_ISSUES_PER_HOUR)
    throw jerr(429, "RATE_LIMITED", "Too many attempts. Please try again later.");

  const subjects = await Subject.find({ _id: { $in: ids.map(oid) } })
    .select("name image jambCompulsory")
    .lean();
  if (subjects.length !== ids.length) throw jerr(422, "VALIDATION_FAILED", "Unknown subject.");
  // requested order, compulsory subject first
  const ordered = ids
    .map((id) => subjects.find((s) => str(s._id) === id))
    .sort((a, b) => Number(!!b.jambCompulsory) - Number(!!a.jambCompulsory));

  const picked = [];
  for (const subject of ordered) {
    const { docs, reset } = await pickQuestions(userId, subject, questionCountFor(subject));
    picked.push({ subjectId: subject._id, docs, reset });
  }

  const paper = picked.map((p) => ({
    subjectId: p.subjectId,
    questions: p.docs.map((q) => ({
      questionId: q._id,
      correctAnswerId: q.answers.find((a) => a.correct)._id,
      answerIds: shuffle(q.answers).map((a) => a._id),
      point: q.point,
    })),
  }));
  const total = paper.reduce((n, p) => n + p.questions.length, 0);
  const expiresAt = new Date(
    now.getTime() +
      (total * (CFG.SECONDS_PER_QUESTION + CFG.PER_QUESTION_UI_OVERHEAD_SECONDS) + CFG.ATTEMPT_GRACE_SECONDS) * 1000,
  );

  let attempt;
  try {
    attempt = await JambAttempt.create({
      userId: oid(userId),
      roundId: round._id,
      subjectIds: ordered.map((s) => s._id),
      paper,
      issuedAt: now,
      expiresAt,
    });
  } catch (e) {
    if (e.code === 11000) {
      // a parallel request from the same user won the race: hand back its attempt
      const twin = await JambAttempt.findOne({ userId: oid(userId), status: "issued" });
      if (twin) return presentAttempt(twin);
    }
    throw e;
  }
  await markSeen(userId, picked);
  return presentAttempt(attempt);
}

async function activeAttempt(userId) {
  const now = new Date();
  const open = await JambAttempt.findOne({ userId: oid(userId), status: "issued" });
  if (!open) return null;
  if (open.expiresAt <= now) {
    await JambAttempt.updateOne({ _id: open._id, status: "issued" }, { $set: { status: "expired" } });
    return null;
  }
  return presentAttempt(open);
}

async function quitAttempt(userId, attemptId) {
  if (!isValidId(attemptId)) throw jerr(404, "NOT_FOUND", "Attempt not found.");
  const attempt = await JambAttempt.findOne({ _id: oid(attemptId), userId: oid(userId) });
  if (!attempt) throw jerr(404, "NOT_FOUND", "Attempt not found.");
  if (attempt.status === "issued")
    await JambAttempt.updateOne({ _id: attempt._id, status: "issued" }, { $set: { status: "abandoned" } });
  else if (["submitting", "submitted"].includes(attempt.status))
    throw jerr(409, "ATTEMPT_ALREADY_SUBMITTED", "This attempt was already submitted.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Submitting
// ─────────────────────────────────────────────────────────────────────────────
const submitHits = new Map(); // userId -> [timestamps]
function rateLimitSubmit(userId, max = 30, windowMs = 3600e3) {
  const now = Date.now();
  const list = (submitHits.get(userId) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    submitHits.set(userId, list);
    throw jerr(429, "RATE_LIMITED", "Too many submissions. Please try again later.");
  }
  list.push(now);
  submitHits.set(userId, list);
}

async function finalizeProfile(userId) {
  const agg = await JambRound.aggregate([
    { $match: { userId: oid(userId), status: "completed" } },
    {
      $group: {
        _id: null,
        n: { $sum: 1 },
        sum: { $sum: "$summary.predicted" },
        best: { $max: "$summary.predicted" },
        last: { $max: "$completedAt" },
      },
    },
  ]);
  const a = agg[0] || { n: 0, sum: 0, best: 0, last: null };
  const profile = await upsertProfile(userId);
  if (profile.roundsCompleted === a.n && profile.predictedSum === a.sum) return profile; // already in sync

  const cooldownUntil = a.last ? new Date(+a.last + CFG.COOLDOWN_HOURS * 3600e3) : null;
  return JambProfile.findOneAndUpdate(
    { _id: profile._id },
    {
      $set: {
        roundsCompleted: a.n,
        predictedSum: a.sum,
        bestPredicted: a.best || 0,
        cooldownUntil,
        cooldownNotified: false,
      },
    },
    { new: true },
  );
}

// complete a round that has all its subject results (idempotent)
async function completeRoundIfDone(roundDoc) {
  let round = roundDoc;
  if (round.status === "active" && round.results.length >= round.subjectIds.length) {
    const summary = summarize(orderResults(plain(round)));
    const done = await JambRound.findOneAndUpdate(
      { _id: round._id, status: "active" },
      { $set: { status: "completed", completedAt: new Date(), summary } },
      { new: true },
    );
    round = done || (await JambRound.findById(round._id));
  }
  if (round.status === "completed") await finalizeProfile(round.userId);
  return round;
}

async function applyCounters(attempt) {
  // at-most-once: only the CAS winner applies the (non-idempotent) counters
  const won = await JambAttempt.findOneAndUpdate(
    { _id: attempt._id, countersApplied: { $ne: true } },
    { $set: { countersApplied: true } },
  );
  if (!won) return;

  const g = attempt.graded;
  const answered = g.correctIds.length + g.wrongIds.length;
  if (!answered) return;

  const u = await User.findById(attempt.userId).select("qBank").lean();
  const existing = new Map(((u && u.qBank) || []).map((e) => [str(e.question), !!e.correct]));
  const ops = [];
  const fresh = [];
  const record = (id, correct) => {
    if (!existing.has(id)) fresh.push({ question: oid(id), correct });
    else if (existing.get(id) !== correct)
      ops.push({
        updateOne: {
          filter: { _id: attempt.userId, "qBank.question": oid(id) },
          update: { $set: { "qBank.$.correct": correct } },
        },
      });
  };
  g.correctIds.forEach((id) => record(id, true));
  g.wrongIds.forEach((id) => record(id, false));
  if (fresh.length)
    ops.push({ updateOne: { filter: { _id: attempt.userId }, update: { $push: { qBank: { $each: fresh } } } } });
  ops.push({
    updateOne: {
      filter: { _id: attempt.userId },
      update: {
        $inc: {
          "quizStats.totalCorrectAnswers": g.correctIds.length,
          "quizStats.totalQuestionsAnswered": answered,
        },
      },
    },
  });
  await User.bulkWrite(ops, { ordered: false });
}

async function finishSubmission(attemptDoc) {
  let attempt = attemptDoc;
  const userId = attempt.userId;
  const graded = attempt.graded;

  let round = await JambRound.findById(attempt.roundId);
  if (!round) {
    await JambAttempt.updateOne({ _id: attempt._id }, { $set: { status: "abandoned" } });
    throw jerr(410, "ATTEMPT_ABANDONED", "This attempt is no longer valid.");
  }

  const alreadyRecorded = round.results.some((r) => str(r.attemptId) === str(attempt._id));
  if (!alreadyRecorded) {
    const updated = await JambRound.findOneAndUpdate(
      {
        _id: round._id,
        status: "active",
        "results.subjectId": { $nin: graded.subjects.map((s) => oid(s.subjectId)) },
      },
      {
        $push: {
          results: {
            $each: graded.subjects.map((s) => ({
              ...s,
              subjectId: oid(s.subjectId),
              attemptId: attempt._id,
              completedAt: attempt.submittedAt,
            })),
          },
        },
      },
      { new: true },
    );
    if (!updated) {
      await JambAttempt.updateOne({ _id: attempt._id, status: "submitting" }, { $set: { status: "abandoned" } });
      if (round.status !== "active")
        throw jerr(410, "ATTEMPT_ABANDONED", "Your round changed while this attempt was open.");
      throw jerr(409, "SUBJECT_ALREADY_COMPLETED", "You already completed this subject in this round.");
    }
    round = updated;
  }

  await applyCounters(attempt);
  round = await completeRoundIfDone(round);

  const [profile, user] = await Promise.all([
    JambProfile.findOne({ userId }).lean(),
    User.findById(userId).select("quizStats.totalCorrectAnswers").lean(),
  ]);
  const lifetimeCorrect = (user && user.quizStats && user.quizStats.totalCorrectAnswers) || 0;
  const subjectResults = graded.subjects.map((s) => clientSubject(s));

  let response;
  if (round.status === "completed") {
    const cd = toMs(profile && profile.cooldownUntil);
    response = {
      complete: true,
      remaining: 0,
      subjectResults,
      roundResult: toRoundResult(round),
      lifetimeCorrect,
      availableAt: cd,
      cooldownUntil: cd,
    };
  } else {
    response = {
      complete: false,
      remaining: round.subjectIds.length - round.results.length,
      subjectResults,
      lifetimeCorrect,
      cooldownUntil: 0,
    };
  }
  await JambAttempt.updateOne({ _id: attempt._id }, { $set: { status: "submitted", response } });
  return response;
}

async function submitAttempt(userId, attemptId, body, idemKey) {
  const now = new Date();
  if (!isValidId(attemptId)) throw jerr(404, "NOT_FOUND", "Attempt not found.");
  rateLimitSubmit(str(userId));

  let attempt = await JambAttempt.findOne({ _id: oid(attemptId), userId: oid(userId) });
  if (!attempt) throw jerr(404, "NOT_FOUND", "Attempt not found.");
  if (attempt.status === "submitted" && attempt.response) return attempt.response; // idempotent replay
  if (attempt.status === "abandoned") throw jerr(410, "ATTEMPT_ABANDONED", "This attempt was quit or replaced.");
  if (attempt.status === "expired") throw jerr(410, "ATTEMPT_EXPIRED", "This attempt has expired.");

  if (attempt.status === "issued") {
    if (now > attempt.expiresAt) {
      await JambAttempt.updateOne({ _id: attempt._id, status: "issued" }, { $set: { status: "expired" } });
      throw jerr(410, "ATTEMPT_EXPIRED", "This attempt has expired.");
    }
    const profile = await JambProfile.findOne({ userId: oid(userId) }).lean();
    const cd = activeCooldownMs(profile, now);
    if (cd) throw jerr(409, "COOLDOWN_ACTIVE", "Attempt not counted: rest period is active.", { cooldownUntil: cd });

    const { answers, durationMs } = body || {};
    const result = gradePaper(attempt.paper, answers);

    const subjects = await Subject.find({ _id: { $in: attempt.paper.map((p) => p.subjectId) } })
      .select("name image")
      .lean();
    const meta = new Map(subjects.map((s) => [str(s._id), s]));
    const gradedSubjects = result.subjects.map((s) => ({
      ...s,
      name: (meta.get(s.subjectId) || {}).name,
      image: (meta.get(s.subjectId) || {}).image || null,
    }));

    const flags = [];
    const dur = Number(durationMs);
    if (result.answered > 0 && Number.isFinite(dur) && dur / result.answered < 2000) flags.push("too_fast");
    if (Number.isFinite(dur) && dur > now - attempt.issuedAt + 5000) flags.push("duration_mismatch");

    const set = {
      status: "submitting",
      submittedAt: now,
      flags,
      graded: {
        subjects: gradedSubjects,
        correctIds: result.correctIds,
        wrongIds: result.wrongIds,
      },
    };
    if (Number.isFinite(dur)) set.durationMs = dur;
    if (idemKey) set.idempotencyKey = String(idemKey).slice(0, 100);
    const won = await JambAttempt.findOneAndUpdate(
      { _id: attempt._id, status: "issued" },
      { $set: set },
      { new: true },
    );
    if (!won) {
      const cur = await JambAttempt.findById(attempt._id);
      if (cur && cur.status === "submitted" && cur.response) return cur.response;
      throw jerr(409, "SUBMIT_IN_PROGRESS", "This attempt is already being submitted.");
    }
    attempt = won;
  }

  // status === "submitting": fresh submission or a resumed one (cooldown deliberately not re-checked)
  return finishSubmission(attempt);
}

// ─────────────────────────────────────────────────────────────────────────────
// History / rounds / dev
// ─────────────────────────────────────────────────────────────────────────────
async function history(userId, { limit, cursor } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const q = { userId: oid(userId), status: "completed" };
  if (cursor) {
    const [ms, id] = String(cursor).split("|");
    if (!Number.isFinite(Number(ms)) || !isValidId(id)) throw jerr(422, "VALIDATION_FAILED", "Invalid cursor.");
    const at = new Date(Number(ms));
    q.$or = [{ completedAt: { $lt: at } }, { completedAt: at, _id: { $lt: oid(id) } }];
  }
  const rows = await JambRound.find(q).sort({ completedAt: -1, _id: -1 }).limit(n + 1).lean();
  const page = rows.slice(0, n);
  const last = page[page.length - 1];
  return {
    items: page.map(toRoundResult),
    nextCursor: rows.length > n && last ? `${toMs(last.completedAt)}|${str(last._id)}` : null,
  };
}

async function getRound(userId, roundId) {
  if (!isValidId(roundId)) throw jerr(404, "NOT_FOUND", "Round not found.");
  const round = await JambRound.findOne({ _id: oid(roundId), userId: oid(userId), status: "completed" }).lean();
  if (!round) throw jerr(404, "NOT_FOUND", "Round not found.");
  return toRoundResult(round);
}

async function devSkipCooldown(userId) {
  if (process.env.NODE_ENV === "production") throw jerr(404, "NOT_FOUND", "Not found.");
  await JambProfile.updateOne(
    { userId: oid(userId) },
    { $set: { cooldownUntil: null, cooldownNotified: true } },
  );
  return buildSummary(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin helpers (flag which subjects JAMB uses)
// ─────────────────────────────────────────────────────────────────────────────
async function adminListSubjects() {
  const subjects = await Subject.find({}).select("name jambEligible jambCompulsory").sort({ name: 1 }).lean();
  const items = [];
  for (const s of subjects)
    items.push({
      _id: str(s._id),
      name: s.name,
      jambEligible: !!s.jambEligible,
      jambCompulsory: !!s.jambCompulsory,
      bankSize: await Question.countDocuments(poolFilter(s._id)),
    });
  return { items };
}

async function adminUpdateSubject(subjectId, body) {
  if (!isValidId(subjectId)) throw jerr(404, "NOT_FOUND", "Subject not found.");
  const set = {};
  for (const k of ["jambEligible", "jambCompulsory"]) {
    if (body && body[k] !== undefined) {
      if (typeof body[k] !== "boolean") throw jerr(422, "VALIDATION_FAILED", `${k} must be a boolean.`);
      set[k] = body[k];
    }
  }
  if (!Object.keys(set).length) throw jerr(422, "VALIDATION_FAILED", "Nothing to update.");
  if (set.jambCompulsory === true) set.jambEligible = true; // a compulsory subject must be selectable
  const s = await Subject.findByIdAndUpdate(subjectId, { $set: set }, { new: true })
    .select("name jambEligible jambCompulsory")
    .lean();
  if (!s) throw jerr(404, "NOT_FOUND", "Subject not found.");
  dbTotalCache.delete(str(s._id));
  return { _id: str(s._id), name: s.name, jambEligible: !!s.jambEligible, jambCompulsory: !!s.jambCompulsory };
}

// ─────────────────────────────────────────────────────────────────────────────
// Background sweep — schedule POST /jamb/cron/sweep every ~5 minutes
// ─────────────────────────────────────────────────────────────────────────────
async function sweep(now = new Date()) {
  const out = { recoveredRounds: 0, resumedAttempts: 0, expiredAttempts: 0, resyncedProfiles: 0, notified: 0, orphansRemoved: 0 };
  const safe = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[jamb sweep] ${label} failed:`, e && e.message);
    }
  };

  // 1. rounds with all results but still "active" (crash before completion)
  await safe("recover rounds", async () => {
    const stuck = await JambRound.find({
      status: "active",
      $expr: {
        $gte: [{ $size: { $ifNull: ["$results", []] } }, { $size: { $ifNull: ["$subjectIds", []] } }],
      },
    }).limit(100);
    for (const r of stuck) {
      await completeRoundIfDone(r);
      out.recoveredRounds++;
    }
  });

  // 2. submissions that stalled half way
  await safe("resume submissions", async () => {
    const stalled = await JambAttempt.find({
      status: "submitting",
      submittedAt: { $lt: new Date(now.getTime() - 2 * 60e3) },
    }).limit(100);
    for (const a of stalled) {
      try {
        await finishSubmission(a);
        out.resumedAttempts++;
      } catch (e) {
        if (!(e && e.jamb)) throw e;
      }
    }
  });

  // 3. open attempts past their deadline
  await safe("expire attempts", async () => {
    const r = await JambAttempt.updateMany(
      { status: "issued", expiresAt: { $lt: now } },
      { $set: { status: "expired" } },
    );
    out.expiredAttempts = r.modifiedCount || 0;
  });

  // 4. completed rounds whose profile counters never got updated
  await safe("resync profiles", async () => {
    const userIds = await JambRound.distinct("userId", {
      status: "completed",
      completedAt: { $gte: new Date(now.getTime() - 3600e3) },
    });
    for (const id of userIds) {
      const before = await JambProfile.findOne({ userId: id }).select("roundsCompleted").lean();
      const after = await finalizeProfile(id);
      if (!before || (after && before.roundsCompleted !== after.roundsCompleted)) out.resyncedProfiles++;
    }
  });

  // 5. "next round is ready" push
  await safe("notify", async () => {
    const expoNotifications = require("./expoNotifications");
    const due = await JambProfile.find({
      cooldownUntil: { $lte: now, $ne: null },
      cooldownNotified: false,
    })
      .limit(500)
      .lean();
    for (const p of due) {
      const claim = await JambProfile.updateOne(
        { _id: p._id, cooldownNotified: false },
        { $set: { cooldownNotified: true } },
      );
      if (!claim.modifiedCount) continue;
      const user = await User.findById(p.userId).select("accountType subscription tokens.pushToken").lean();
      const push = user && user.tokens && user.tokens.pushToken;
      if (!isPremiumUser(user, now) || !push || push.state !== "registered" || !push.token) continue;
      await expoNotifications([push.token], {
        title: `Round ${(p.roundsCompleted || 0) + 1} is ready 🎯`,
        message: "Your rest period is over. Start your next JAMB round.",
        data: { type: "jamb_round_ready", channel: "General" },
      });
      out.notified++;
    }
  });

  // 6. cascade-clean data of deleted accounts (sampled, so each run is cheap)
  await safe("orphans", async () => {
    const sample = await JambProfile.aggregate([{ $sample: { size: 100 } }, { $project: { userId: 1 } }]);
    if (!sample.length) return;
    const alive = new Set(
      (await User.find({ _id: { $in: sample.map((s) => s.userId) } }).select("_id").lean()).map((u) => str(u._id)),
    );
    const gone = sample.map((s) => s.userId).filter((id) => !alive.has(str(id)));
    if (!gone.length) return;
    await Promise.all([
      JambProfile.deleteMany({ userId: { $in: gone } }),
      JambRound.deleteMany({ userId: { $in: gone } }),
      JambAttempt.deleteMany({ userId: { $in: gone } }),
      JambSeen.deleteMany({ userId: { $in: gone } }),
    ]);
    out.orphansRemoved = gone.length;
  });

  return out;
}

module.exports = {
  getConfig,
  buildSummary,
  saveSelection,
  subjectPerformance,
  issueAttempt,
  activeAttempt,
  submitAttempt,
  quitAttempt,
  history,
  getRound,
  devSkipCooldown,
  adminListSubjects,
  adminUpdateSubject,
  sweep,
  _internals: {
    ratingFor,
    levelFor,
    buildInsights,
    summarize,
    gradePaper,
    allocate,
    chooseByDifficulty,
    toRoundResult,
    shapeActiveRound,
    questionCountFor,
    isPremiumUser,
  },
};
