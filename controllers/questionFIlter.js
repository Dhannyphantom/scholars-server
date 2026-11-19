/**
 * questionFilter.js — one place that turns "filter criteria" into a MongoDB filter for Question.
 * Used by: GET /questions (list), POST /questions/by-filter/* (preview / delete / update).
 * Every id is cast to ObjectId so the same filter works in find(), countDocuments() and aggregate().
 *
 * Criteria (all optional, all combined with AND; arrays may be arrays or comma-separated strings):
 *   q, qIn(question|answers|explanation|all)       text search
 *   subject[], topic[], category[], categoryMode(any|all|none), noCategory
 *   isTheory, hasImage, hasExplanation             true | false
 *   format[]   legacy | v2 | text | html | latex | math
 *   pointMin/Max, timerMin/Max, optionsMin/Max     numeric ranges
 *   difficulty[] easy|medium|hard|none, active, jambEligible
 *   createdFrom/createdTo (YYYY-MM-DD, from the ObjectId timestamp), createdBy[]
 *   edited, editedBy[]
 *   issue[]    noCorrect | multiCorrect | fewOptions | emptyOption
 * Sort: newest | oldest | points_desc | points_asc | time_desc | time_asc | alpha_asc | alpha_desc | options_desc | options_asc
 */
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Types;

const OID_RE = /^[a-f\d]{24}$/i;
const arr = (v) =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
const idList = (v) =>
  arr(v)
    .filter((s) => OID_RE.test(s))
    .map((s) => new ObjectId(s));
const num = (v) =>
  v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const bool = (v) =>
  v === true || v === "true" || v === "1"
    ? true
    : v === false || v === "false" || v === "0"
      ? false
      : null;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const day = (s) => {
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const oidAt = (d) =>
  new ObjectId(
    Math.floor(d.getTime() / 1000)
      .toString(16)
      .padStart(8, "0") + "0000000000000000",
  );

const optCount = { $size: { $ifNull: ["$answers", []] } };
const correctCount = {
  $size: {
    $filter: {
      input: { $ifNull: ["$answers", []] },
      as: "a",
      cond: { $eq: ["$$a.correct", true] },
    },
  },
};

const SORTS = {
  newest: { _id: -1 },
  oldest: { _id: 1 },
  points_desc: { point: -1, _id: -1 },
  points_asc: { point: 1, _id: -1 },
  time_desc: { timer: -1, _id: -1 },
  time_asc: { timer: 1, _id: -1 },
  alpha_asc: { question: 1, _id: 1 },
  alpha_desc: { question: -1, _id: 1 },
  options_desc: { _oc: -1, _id: -1 },
  options_asc: { _oc: 1, _id: -1 },
};

const ISSUES = {
  noCorrect: { isTheory: { $ne: true }, $expr: { $eq: [correctCount, 0] } },
  multiCorrect: { isTheory: { $ne: true }, $expr: { $gt: [correctCount, 1] } },
  fewOptions: { isTheory: { $ne: true }, $expr: { $lt: [optCount, 2] } },
  emptyOption: {
    answers: {
      $elemMatch: { $or: [{ name: { $exists: false } }, { name: "" }] },
    },
  },
};

const FORMATS = {
  legacy: { "content.version": { $ne: 2 } },
  v2: { "content.version": 2 },
  text: { "content.stem.format": "text" },
  html: { "content.stem.format": "html" },
  latex: { "content.stem.format": "latex" },
  math: {
    $or: [
      { "content.stem.hasMath": true },
      { "content.options.body.hasMath": true },
      { isLatex: true },
    ],
  },
};

/** scope = array of subject ids a professional may touch (null for managers) */
function buildFilter(src = {}, scope = null) {
  const and = [];
  let criteria = 0;
  const add = (c) => {
    and.push(c);
    criteria++;
  };

  if (scope)
    and.push({
      subject: {
        $in: scope
          .filter((s) => OID_RE.test(String(s)))
          .map((s) => new ObjectId(String(s))),
      },
    });

  const subject = idList(src.subject),
    topic = idList(src.topic),
    category = idList(src.category);
  if (subject.length) add({ subject: { $in: subject } });
  if (topic.length) add({ topic: { $in: topic } });
  if (category.length) {
    const mode = src.categoryMode;
    add(
      mode === "all"
        ? { categories: { $all: category } }
        : mode === "none"
          ? { categories: { $nin: category } }
          : { categories: { $in: category } },
    );
  }
  if (bool(src.noCategory) === true)
    add({
      $or: [{ categories: { $exists: false } }, { categories: { $size: 0 } }],
    });

  const q = String(src.q ?? "").trim();
  if (q) {
    const rx = new RegExp(esc(q), "i");
    const where = {
      question: { question: rx },
      answers: { "answers.name": rx },
      explanation: { explanation: rx },
    };
    add(
      where[src.qIn] || {
        $or: [where.question, where.answers, where.explanation],
      },
    );
  }

  const th = bool(src.isTheory);
  if (th !== null) add(th ? { isTheory: true } : { isTheory: { $ne: true } });
  const img = bool(src.hasImage);
  if (img !== null)
    add(
      img
        ? { "image.uri": { $exists: true, $ne: "" } }
        : { $or: [{ "image.uri": { $exists: false } }, { "image.uri": "" }] },
    );
  const ex = bool(src.hasExplanation);
  if (ex !== null)
    add(
      ex
        ? { explanation: { $exists: true, $nin: ["", null] } }
        : {
            $or: [
              { explanation: { $exists: false } },
              { explanation: "" },
              { explanation: null },
            ],
          },
    );

  const fmts = arr(src.format).filter((f) => FORMATS[f]);
  if (fmts.length) add({ $or: fmts.map((f) => FORMATS[f]) });

  const range = (field, lo, hi) => {
    const r = {};
    if (num(lo) !== null) r.$gte = num(lo);
    if (num(hi) !== null) r.$lte = num(hi);
    if (Object.keys(r).length) add({ [field]: r });
  };
  range("point", src.pointMin, src.pointMax);
  range("timer", src.timerMin, src.timerMax);
  const oMin = num(src.optionsMin),
    oMax = num(src.optionsMax);
  if (oMin !== null) add({ $expr: { $gte: [optCount, oMin] } });
  if (oMax !== null) add({ $expr: { $lte: [optCount, oMax] } });

  const diff = arr(src.difficulty).filter((d) =>
    ["easy", "medium", "hard", "none"].includes(d),
  );
  if (diff.length)
    add({
      $or: diff.map((d) =>
        d === "none" ? { difficulty: { $exists: false } } : { difficulty: d },
      ),
    });
  const act = bool(src.active);
  if (act !== null) add(act ? { active: { $ne: false } } : { active: false });
  const jamb = bool(src.jambEligible);
  if (jamb !== null)
    add(jamb ? { jambEligible: { $ne: false } } : { jambEligible: false });

  const from = src.createdFrom ? day(src.createdFrom) : null;
  const to = src.createdTo ? day(src.createdTo) : null;
  if (from) add({ _id: { $gte: oidAt(from) } });
  if (to) add({ _id: { $lt: oidAt(new Date(to.getTime() + 86400000)) } }); // inclusive of the whole "to" day
  const by = idList(src.createdBy);
  if (by.length) add({ user: { $in: by } });
  const ed = bool(src.edited);
  if (ed !== null)
    add(
      ed
        ? { "edits.0": { $exists: true } }
        : { $or: [{ edits: { $exists: false } }, { edits: { $size: 0 } }] },
    );
  const edBy = idList(src.editedBy);
  if (edBy.length) add({ edits: { $in: edBy } });

  const issues = arr(src.issue).filter((i) => ISSUES[i]);
  if (issues.length) add({ $or: issues.map((i) => ISSUES[i]) });

  const sortKey = SORTS[src.sort] ? src.sort : "newest";
  return {
    filter: and.length ? { $and: and } : {},
    hasCriteria: criteria > 0,
    criteria,
    sortKey,
    sort: SORTS[sortKey],
    needsCount: sortKey.startsWith("options"), // sort by a computed field -> aggregate
    alpha: sortKey.startsWith("alpha"), // case-insensitive collation
  };
}

module.exports = { buildFilter, SORTS, OID_RE, oidAt };
