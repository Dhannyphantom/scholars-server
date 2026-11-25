// Safe rich-text for admin emails. The dashboard editor produces simple HTML
// (bold, italic, underline, links, images, lists, paragraphs) plus {{firstName}}-style
// placeholders. Everything is run through this allow-list before it is stored or sent,
// so admin input can never inject scripts or unexpected markup.

const LEGACY = [
  [/<%=\s*user\.firstName\s*%>/g, "{{firstName}}"],
  [/<%=\s*user\.lastName\s*%>/g, "{{lastName}}"],
  [/<%=\s*user\.username\s*%>/g, "{{username}}"],
];

const escText = (s) => s.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const getAttr = (attrs, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs || "");
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim() : "";
};
const safeUrl = (u, allowMail) => (/^https?:\/\//i.test(u) || (allowMail && /^mailto:/i.test(u)) ? u : "");

const STYLE = {
  p: "margin:0 0 14px;",
  ul: "margin:0 0 14px;padding-left:22px;",
  ol: "margin:0 0 14px;padding-left:22px;",
  li: "margin:0 0 6px;",
  a: "color:#167a40;font-weight:800;text-decoration:underline;",
  img: "display:block;max-width:100%;height:auto;border-radius:14px;margin:6px auto 14px;border:0;",
};
const SIMPLE = { strong: "strong", b: "strong", em: "em", i: "em", u: "u", s: "s", strike: "s", del: "s", p: "p", div: "p", ul: "ul", ol: "ol", li: "li" };

function sanitizeEmailHtml(input = "") {
  let src = String(input).slice(0, 60000);
  LEGACY.forEach(([re, to]) => (src = src.replace(re, to)));
  src = src.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "");
  const stack = [];
  let out = "";
  let last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    out += escText(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = !!m[1];
    const raw = m[2].toLowerCase();
    if (raw === "br") { if (!closing) out += "<br>"; continue; }
    if (raw === "img") {
      if (closing) continue;
      const u = safeUrl(getAttr(m[3], "src"));
      if (u) out += `<img src="${escAttr(u)}" alt="${escAttr(getAttr(m[3], "alt"))}" style="${STYLE.img}">`;
      continue;
    }
    const tag = raw === "a" ? "a" : SIMPLE[raw];
    if (!tag) continue;
    if (closing) {
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue;
      out += stack.splice(i).reverse().map((t) => `</${t}>`).join("");
      continue;
    }
    if (tag === "a") {
      const u = safeUrl(getAttr(m[3], "href"), true);
      if (!u) continue;
      stack.push("a");
      out += `<a href="${escAttr(u)}" target="_blank" rel="noopener" style="${STYLE.a}">`;
      continue;
    }
    stack.push(tag);
    out += `<${tag}${STYLE[tag] ? ` style="${STYLE[tag]}"` : ""}>`;
  }
  out += escText(src.slice(last));
  out += stack.reverse().map((t) => `</${t}>`).join("");
  // Plain text pasted without any tags: keep line breaks
  if (!/<(p|ul|ol|li)\b/.test(out)) out = out.replace(/\r?\n/g, "<br>");
  return out.replace(/<p[^>]*>(\s|<br>)*<\/p>/g, "").trim();
}

/** html -> plain text (used for the plain-text part / search / history) */
const stripHtml = (h = "") => String(h).replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** every https image URL used in html */
const imageUrls = (h = "") => [...String(h).matchAll(/<img[^>]+src="([^"]+)"/gi)].map((x) => x[1].replace(/&amp;/g, "&"));

module.exports = { sanitizeEmailHtml, stripHtml, imageUrls };
