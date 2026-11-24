// Permission catalogue, inheritance rules, route -> permission table. Managers are always unrestricted.
//  kind "level":  none | view | edit        kind "view": none | view        kind "action": off(none) | on(edit)
//  A child with no explicit value inherits its parent's level, unless inherit:false (sensitive => off by default).
//  A child can never exceed its parent (actions only need the parent to be at least "view").
const AdminPermission = require("../models/AdminPermission");

const LV = { none: 0, view: 1, edit: 2 };
const NAME = ["none", "view", "edit"];
const N = (key, label, parent, kind, desc, inherit = true) => ({ key, label, parent, kind, desc, inherit });
const CATALOG = [
  N("overview", "Overview", null, "view", "Home dashboard: stats, quests, wallets, live feed"),
  N("users", "Users", null, "level", "view: browse users and open profiles · edit: basic user management"),
  N("users.export", "Export users (CSV)", "users", "action", "", false),
  N("users.subscription", "Add subscription days", "users", "action", "", false),
  N("users.points", "Adjust GT balance", "users", "action", "", false),
  N("users.role", "Change roles", "users", "action", "", false),
  N("users.suspend", "Suspend / reactivate users", "users", "action", "", false),
  N("users.notify", "Send push to a user", "users", "action", "", false),
  N("users.verify_pro", "Verify / revoke / reject professionals", "users", "action", "", false),
  N("team", "Team", null, "view", "Managers and professionals list and their analytics"),
  N("schools", "Schools", null, "level", "view: school list and details · edit: create/edit schools, members, rep"),
  N("schools.classes", "Classes", "schools", "level", "Classes tab, graduation and class changes"),
  N("schools.quizzes", "School quizzes", "schools", "level", "Quizzes tab and quiz status/deletion"),
  N("schools.assign", "School assignments", "schools", "level", "Assignments tab, extend, delete submissions"),
  N("schools.ann", "Announcements", "schools", "level", "Announcements tab and deletion"),
  N("schools.billing", "School subscription days & wallet", "schools", "action", "", false),
  N("schools.danger", "Suspend / delete schools", "schools", "action", "", false),
  N("library", "Library", null, "level", "Categories, subjects, topics and questions"),
  N("library.categories", "Categories", "library", "level", "", false),
  N("library.subjects", "Subjects", "library", "level", "", false),
  N("library.topics", "Topics", "library", "level"),
  N("library.questions", "Questions", "library", "level", "Browse and edit questions (professionals stay limited to their assigned subjects)"),
  N("library.bulk", "Bulk edit / delete by filter", "library", "action"),
  N("questions", "Question upload", null, "level", "view: open the page · edit: upload question banks"),
  N("competition", "Competition", null, "level", "view: see tournaments · edit: create and edit drafts"),
  N("competition.publish", "Take a competition live", "competition", "action", "", false),
  N("competition.results", "Publish results & award prizes", "competition", "action", "", false),
  N("competition.delete", "Delete draft competitions", "competition", "action", "", false),
  N("events", "Live activity", null, "view", "Real-time activity stream"),
  N("support", "Support", null, "level", "view: read tickets · edit: work tickets"),
  N("support.reply", "Reply to users", "support", "action"),
  N("support.manage", "Change status, priority, assignee", "support", "action"),
  N("support.export", "Export tickets (CSV)", "support", "action", "", false),
  N("notify", "Notifications", null, "level", "view: history · edit: send / schedule push and email"),
  N("tokens", "Pro tokens", null, "level", "view: token history and professionals · edit: change the active token"),
  N("tokens.reveal", "Reveal the active token", "tokens", "action", "", false),
  N("analytics", "Analytics", null, "view", "Charts and numbers"),
  N("analytics.overview", "Overview", "analytics", "view"),
  N("analytics.features", "Features", "analytics", "view", "Feature / endpoint usage"),
  N("analytics.users", "Users", "analytics", "view"),
  N("analytics.schools", "School", "analytics", "view"),
  N("analytics.content", "Content", "analytics", "view"),
  N("analytics.quizzes", "Quizzes", "analytics", "view"),
  N("analytics.financial", "Financial", "analytics", "view", "", false),
  N("analytics.transfer", "Transfer funds between wallets", "analytics", "action", "", false),
  N("audit", "Audit logs", null, "view", "Who did what, and when"),
  N("audit.export", "Export audit log (CSV)", "audit", "action", "", false),
];
const BY = Object.fromEntries(CATALOG.map((n) => [n.key, n]));
const DEF = { library: 2, questions: 2 }; // what professionals could already do before permissions existed

function effective(stored = {}) {
  const out = {};
  const get = (k) => {
    if (k in out) return out[k];
    const n = BY[k], pv = n.parent ? get(n.parent) : 2;
    const ex = LV[stored[k]];
    let v;
    if (n.kind === "action") v = ex !== undefined ? (ex >= 2 && pv >= 1 ? 2 : 0) : n.inherit === false ? 0 : pv >= 2 ? 2 : 0;
    else {
      v = ex !== undefined ? ex : !n.parent ? DEF[k] ?? 0 : n.inherit === false ? 0 : pv;
      v = Math.min(v, n.kind === "view" ? 1 : 2, pv);
    }
    return (out[k] = v);
  };
  CATALOG.forEach((n) => get(n.key));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, NAME[v]]));
}

function sanitize(input = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const n = BY[k];
    if (!n || typeof v !== "string") continue;
    const ok = n.kind === "action" ? ["none", "edit"] : n.kind === "view" ? ["none", "view"] : ["none", "view", "edit"];
    if (ok.includes(v)) out[k] = v;
  }
  return out;
}

// ── presets ─────────────────────────────────────────────────────────────────
const fill = (p) => { CATALOG.filter((n) => !n.parent).forEach((n) => (p[n.key] = p[n.key] || "none")); return p; };
const PRESETS = [
  { id: "none", label: "No access", desc: "Profile only", perms: fill({}) },
  { id: "contributor", label: "Contributor", desc: "Library and question upload (the old default)", perms: fill({ library: "edit", questions: "edit" }) },
  { id: "content", label: "Content manager", desc: "Full library, bulk tools, question upload", perms: fill({ library: "edit", "library.categories": "edit", "library.subjects": "edit", "library.bulk": "edit", questions: "edit" }) },
  { id: "support", label: "Support agent", desc: "Work tickets, see users, push to a user", perms: fill({ support: "edit", "support.export": "edit", users: "view", "users.notify": "edit" }) },
  { id: "viewer", label: "Read-only observer", desc: "See most sections, change nothing", perms: fill({ overview: "view", users: "view", team: "view", schools: "view", library: "view", competition: "view", events: "view", support: "view", analytics: "view", "analytics.financial": "none" }) },
  { id: "analyst", label: "Analyst", desc: "Analytics incl. finance, activity and audit", perms: fill({ overview: "view", analytics: "view", "analytics.financial": "view", events: "view", audit: "view", users: "view" }) },
  { id: "full", label: "Full access", desc: "Everything a manager can do in the dashboard", perms: fill(Object.fromEntries(CATALOG.map((n) => [n.key, n.kind === "level" ? "edit" : n.kind === "view" ? "view" : "edit"]))) },
];

// ── route -> required permission ────────────────────────────────────────────
const ANY = /./;
const ROUTES = [
  [/^GET$/, /^\/overview$/, "overview", "view"],
  [/^GET$/, /^\/users\/export$/, "users.export", "edit"],
  [/^GET$/, /^\/users(\/search)?$/, "users", "view"],
  [/^GET$/, /^\/users\/[^/]+$/, "users", "view"],
  [/^POST$/, /^\/users\/[^/]+\/subscription-days$/, "users.subscription", "edit"],
  [/^POST$/, /^\/users\/[^/]+\/adjust-points$/, "users.points", "edit"],
  [/^POST$/, /^\/users\/[^/]+\/role$/, "users.role", "edit"],
  [/^POST$/, /^\/users\/[^/]+\/(suspend|unsuspend)$/, "users.suspend", "edit"],
  [/^POST$/, /^\/users\/[^/]+\/notify$/, "users.notify", "edit"],
  [/^POST$/, /^\/users\/[^/]+\/pro$/, "users.verify_pro", "edit"],
  [/^GET$/, /^\/professionals$/, ["tokens", "users.verify_pro"], "view"],
  [/^GET$/, /^\/team(\/[^/]+)?$/, "team", "view"],
  [/^GET$/, /^\/tokens$/, "tokens", "view"],
  [/^POST$/, /^\/tokens\/reveal$/, "tokens.reveal", "edit"],
  [/^POST$/, /^\/tokens\/log$/, "tokens", "view"],
  [/^PUT$/, /^\/tokens$/, "tokens", "edit"],
  [/^GET$/, /^\/events$/, "events", "view"],
  [/^GET$/, /^\/audit\/export$/, "audit.export", "edit"],
  [/^GET$/, /^\/audit$/, "audit", "view"],
  [/^GET$/, /^\/schools\/classes$/, "schools.classes", "view"],
  [/^GET$/, /^\/schools\/quizzes$/, "schools.quizzes", "view"],
  [/^GET$/, /^\/schools\/assignments$/, "schools.assign", "view"],
  [/^GET$/, /^\/schools\/announcements$/, "schools.ann", "view"],
  [/^GET$/, /^\/schools\/[^/]+\/quizzes\/[^/]+$/, "schools.quizzes", "view"],
  [/^GET$/, /^\/schools\/[^/]+\/assignments\/[^/]+$/, "schools.assign", "view"],
  [/^GET$/, /^\/schools(\/[^/]+)?$/, "schools", "view"],
  [ANY, /^\/schools\/[^/]+\/(subscription-days|wallet-adjust)$/, "schools.billing", "edit"],
  [/^POST$/, /^\/schools\/[^/]+\/(suspend|unsuspend)$/, "schools.danger", "edit"],
  [/^DELETE$/, /^\/schools\/[^/]+$/, "schools.danger", "edit"],
  [ANY, /^\/schools\/[^/]+\/classes(\/.*)?$/, "schools.classes", "edit"],
  [ANY, /^\/schools\/[^/]+\/quizzes(\/.*)?$/, "schools.quizzes", "edit"],
  [ANY, /^\/schools\/[^/]+\/assignments(\/.*)?$/, "schools.assign", "edit"],
  [ANY, /^\/schools\/[^/]+\/announcements(\/.*)?$/, "schools.ann", "edit"],
  [ANY, /^\/schools(\/.*)?$/, "schools", "edit"],
  [/^GET$/, /^\/support\/tickets\/export$/, "support.export", "edit"],
  [/^POST$/, /^\/support\/tickets\/[^/]+\/reply$/, "support.reply", "edit"],
  [/^PUT$/, /^\/support\/tickets\/[^/]+\/(status|priority|assign)$/, "support.manage", "edit"],
  [/^GET$/, /^\/support(\/.*)?$/, "support", "view"],
  [/^GET$/, /^\/notify\/history$/, "notify", "view"],
  [ANY, /^\/notify(\/.*)?$/, "notify", "edit"],
  [/^GET$/, /^\/analytics\/(overview|features|users|schools|content|quizzes|financial)$/, "analytics.$1", "view"],
  [/^POST$/, /^\/wallets\/transfer$/, "analytics.transfer", "edit"],
  [/^GET$/, /^\/library\/meta$/, ["library", "questions"], "view"],
  [/^GET$/, /^\/library\/questions(\/facets|\/[^/]+)?$/, ["library.questions", "questions"], "view"],
  [/^POST$/, /^\/library\/questions\/by-filter\/preview$/, ["library.bulk", "library.questions"], "view"],
  [/^POST$/, /^\/library\/questions\/bulk$/, ["questions", "library.questions"], "edit"],
  [/^POST$/, /^\/library\/questions\/(bulk-delete|bulk-move|bulk-set|by-filter\/(delete|update))$/, "library.bulk", "edit"],
  [/^(PUT|POST)$/, /^\/library\/questions\/[^/]+(\/duplicate)?$/, "library.questions", "edit"],
  [ANY, /^\/library\/categories(\/.*)?$/, "library.categories", "edit"],
  [ANY, /^\/library\/subjects(\/.*)?$/, "library.subjects", "edit"],
  [ANY, /^\/library\/topics(\/.*)?$/, "library.topics", "edit"],
];
const COMP = [
  [/^GET$/, /^\/manage\/(list|subjects-topics)$/, "competition", "view"],
  [/^POST$/, /^\/manage\/[^/]+\/publish$/, "competition.publish", "edit"],
  [/^POST$/, /^\/manage\/[^/]+\/(publish-results|award-prizes)$/, "competition.results", "edit"],
  [/^DELETE$/, /^\/manage\/[^/]+$/, "competition.delete", "edit"],
  [/^(POST|PUT)$/, /^\/manage(\/[^/]+)?$/, "competition", "edit"],
];
function lookup(table, method, rel) {
  const path = String(rel).split("?")[0].replace(/\/+$/, "") || "/";
  for (const [m, re, keys, need] of table) {
    const hit = re.exec(path);
    if (m.test(method) && hit) return { keys: [].concat(keys).map((k) => k.replace("$1", hit[1])), need };
  }
  return null;
}
const requiredFor = (method, rel) => lookup(ROUTES, method, rel);
function requiredForCompetition(method, rel, adminHeader) {
  if (/^\/manage(\/|$)/.test(rel)) return lookup(COMP, method, rel) || { keys: ["__none"], need: "edit" };
  if (adminHeader && method === "GET" && /^\/[a-f0-9]{24}(\/leaderboard)?\/?$/.test(rel)) return { keys: ["competition"], need: "view" };
  return null;
}
/** returns an error message, or null when allowed */
function check(eff, req) {
  if (req.keys.some((k) => LV[eff[k]] >= LV[req.need])) return null;
  const n = BY[req.keys[0]];
  return n ? `You don't have ${req.need === "view" ? "access" : "permission"} for “${n.parent ? BY[n.parent].label + " › " : ""}${n.label}”. Ask a manager.` : "This area isn't available to your account.";
}

// ── storage (20s cache) ─────────────────────────────────────────────────────
const cache = new Map();
async function storedFor(userId) {
  const id = String(userId), h = cache.get(id);
  if (h && Date.now() - h.at < 20000) return h.perms;
  const d = await AdminPermission.findOne({ user: userId }).lean();
  cache.set(id, { at: Date.now(), perms: d?.perms || {} });
  return d?.perms || {};
}
const effectiveFor = async (userId) => effective(await storedFor(userId));
const clear = (userId) => cache.delete(String(userId));

module.exports = { CATALOG, PRESETS, effective, effectiveFor, storedFor, sanitize, requiredFor, requiredForCompetition, check, clear, LV, BY };
