/**
 * richText.js  (server copy — the client copy is identical except for the last line)
 *
 * "Authoring markup" is what the upload UI / parsers produce and what admins edit:
 *   - plain text by default
 *   - inline formatting tags:  <strong> <em> <u> <s> <sup> <sub> <br>   (b/i/strike/del are aliased)
 *   - math as $...$ (also \(...\), \[...\], $$...$$ or a bare LaTeX expression)
 *
 * toRichText(markup) classifies it into the stored shape:
 *   { format: "text" | "html" | "latex", value: String, hasMath: Boolean }
 *   text  -> value is plain text (may contain $...$ segments if hasMath)
 *   html  -> value is SAFE html (allow-listed tags only, everything else escaped);
 *            math segments, if any, are kept as $...$ with HTML-escaped content
 *   latex -> value is ONE raw LaTeX expression, no delimiters
 */
const ALIAS = { strong: "strong", b: "strong", em: "em", i: "em", u: "u", s: "s", strike: "s", del: "s", sup: "sup", sub: "sub", br: "br" };
const TAG_RE = () => /<(\/?)(strong|b|em|i|u|s|strike|del|sup|sub|br)(?:\s[^<>]*)?\/?>/gi;
const DROP_RE = /<\/?(?:span|div|p|font|a|mark|h[1-6]|ul|ol|li)\b[^<>]*>/gi;
const FMT = "strong|em|u|s|sup|sub";
const PH = (i) => `\uE000${i}\uE001`;
const PH_RE = /\uE000(\d+)\uE001/g;

// $$..$$  or  $..$  (the single-dollar form refuses "$5 and $10" style currency)
const MATH_SRC = String.raw`\$\$([\s\S]+?)\$\$|(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)`;
const mathRe = () => new RegExp(MATH_SRC, "g");

const BARE_LATEX =
  /\\(?:d?frac|sqrt|sum|int|prod|lim|log|ln|sin|cos|tan|cdot|times|div|pm|leq|geq|neq|approx|infty|alpha|beta|gamma|delta|theta|pi|sigma|omega|mu|lambda|vec|bar|hat|left|right|text|mathrm|begin|ldots|rightarrow|to)\b/;

const escText = (s) => s.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escMath = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeEntities = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** Rewrite b/i/strike/... to canonical tags and drop layout tags (span, p, div, a ...). */
function canonTags(s) {
  return String(s)
    .replace(DROP_RE, "")
    .replace(TAG_RE(), (m, c, t) => {
      t = ALIAS[t.toLowerCase()];
      return t === "br" ? (c ? "" : "<br>") : `<${c}${t}>`;
    });
}

/** Close unclosed tags, drop stray closers. */
function balance(s) {
  const st = [];
  s = s.replace(new RegExp(`<(/?)(${FMT})>`, "g"), (m, c, t) => {
    if (!c) { st.push(t); return m; }
    if (st[st.length - 1] === t) { st.pop(); return m; }
    return "";
  });
  return s + st.reverse().map((t) => `</${t}>`).join("");
}

/** Remove empty tags and merge neighbours: <b>a</b><b>b</b> -> <b>ab</b> */
function tidy(s) {
  let p;
  do {
    p = s;
    s = s
      .replace(new RegExp(`<(${FMT})>(\\s*)</\\1>`, "g"), "$2")
      .replace(new RegExp(`</(${FMT})>(\\s*)<\\1>`, "g"), "$2");
  } while (s !== p);
  return s;
}

/** A field that is bold from first to last character is styling, not meaning. */
function unwrapBold(s) {
  const m = /^\s*<strong>([\s\S]*)<\/strong>\s*$/.exec(s);
  return m && !/<\/?strong>/.test(m[1]) ? m[1] : s;
}

function normalize(src) {
  let s = String(src ?? "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  s = s
    .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_, m) => "$$" + m + "$$")
    .replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (_, m) => "$" + m.trim() + "$");

  const maths = [];
  s = s.replace(mathRe(), (m, dd, inl) => {
    maths.push({ t: (dd ?? inl).trim(), d: dd != null });
    return PH(maths.length - 1);
  });

  // A bare LaTeX expression with no delimiters, e.g. "\frac{1}{2}" typed as an option
  if (!maths.length && BARE_LATEX.test(s) && !/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s.replace(/\\[A-Za-z]+/g, ""))) {
    maths.push({ t: s.trim(), d: false });
    s = PH(0);
  }

  s = canonTags(s)
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, "<em>$1</em>");
  s = unwrapBold(tidy(balance(s)));
  return { s, maths };
}

const dlm = (m, f) => (m.d ? "$$" + f(m.t) + "$$" : "$" + f(m.t) + "$");

function toRichText(src) {
  const { s, maths } = normalize(src);
  const t = s.trim();
  if (!t) return { format: "text", value: "", hasMath: false };

  const hasTags = new RegExp(`</?(?:${FMT})>|<br>`).test(t);
  const only = /^\uE000(\d+)\uE001$/.exec(t);
  if (only && !hasTags && !maths[+only[1]].d) return { format: "latex", value: maths[+only[1]].t, hasMath: true };

  if (!hasTags) {
    return { format: "text", value: t.replace(PH_RE, (_, i) => dlm(maths[+i], (x) => x)), hasMath: maths.length > 0 };
  }

  const html = t
    .replace(/\n/g, "<br>")
    .split(new RegExp(`(</?(?:${FMT})>|<br>)`))
    .map((p, i) => (i % 2 ? p : escText(p)))
    .join("")
    .replace(PH_RE, (_, i) => dlm(maths[+i], escMath));
  return { format: "html", value: html, hasMath: maths.length > 0 };
}

/** Plain-text rendering (math kept as $...$). Used for the legacy fields. */
function toPlain(rt) {
  if (!rt) return "";
  if (rt.format === "latex") return `$${rt.value}$`;
  if (rt.format === "html") return decodeEntities(rt.value.replace(/<br>/g, "\n").replace(new RegExp(`</?(?:${FMT})>`, "g"), ""));
  return rt.value || "";
}


/** Inverse of toRichText: a stored field -> editable authoring markup (what an edit form should show). */
function toMarkup(rt) {
  if (!rt) return "";
  if (rt.format === "latex") return `$${rt.value}$`;
  if (rt.format !== "html") return rt.value || "";
  return rt.value
    .split(new RegExp(`(</?(?:${FMT})>|<br>)`))
    .map((p, i) => (i % 2 ? (p === "<br>" ? "\n" : p) : decodeEntities(p)))
    .join("");
}

/**
 * Turn one incoming question (authoring markup in question / answers[].name / explanation)
 * into { content (new), question/answers/explanation (legacy, plain) }.
 * Pass `existingContent` when editing: any field whose plain text did not change keeps its
 * stored rich version, so an old editor that only knows plain text cannot strip formatting.
 */
function buildQuestionFields(item, existingContent) {
  const keep = (old, src) => {
    const fresh = toRichText(src);
    return old && toPlain(old) === toPlain(fresh) ? old : fresh;
  };
  const old = existingContent && existingContent.version === 2 ? existingContent : null;

  const stem = keep(old?.stem, item.question);
  const options = (item.answers || [])
    .map((a) => ({ name: a?.name, correct: !!a?.correct }))
    .filter((a) => String(a.name ?? "").trim())
    .slice(0, 6)
    .map((a, i) => ({ key: "ABCDEF"[i], body: keep(old?.options?.[i]?.body, a.name), correct: a.correct }));
  const expl = keep(old?.explanation, item.explanation);
  const hasExpl = expl.value !== "";

  return {
    question: toPlain(stem),
    answers: options.map((o) => ({ name: toPlain(o.body), correct: o.correct })),
    ...(hasExpl && { explanation: toPlain(expl) }),
    content: { version: 2, stem, options, ...(hasExpl && { explanation: expl }) },
  };
}

module.exports = { toRichText, toPlain, toMarkup, buildQuestionFields, canonTags, tidy, mathRe, decodeEntities, escapeHtml: escMath };
