const mongoose = require("mongoose");

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const cap = (s) => (s ? String(s).replace(/\b\w/g, (c) => c.toUpperCase()) : "");
const nameOf = (u) =>
  u ? (u.firstName && u.lastName ? `${cap(u.firstName)} ${cap(u.lastName)}` : cap(u.username || "")) : "";
const roleLabel = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");
const createdOf = (d) => d?.createdAt || (d?._id ? d._id.getTimestamp() : null);
const isPremium = (u) => !!(u?.subscription?.isActive && u?.subscription?.expiry && new Date(u.subscription.expiry) > new Date());
const idFromDate = (d) => mongoose.Types.ObjectId.createFromTime(Math.floor(new Date(d).getTime() / 1000));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const normPhone = (input = "") => {
  const d = String(input).replace(/\D/g, "");
  if (d.startsWith("234") && d.length > 10) return d.slice(3);
  if (d.startsWith("0") && d.length === 11) return d.slice(1);
  return d;
};
const ticketRef = (id) => "TKT-" + String(id).slice(-6).toUpperCase();
const monthsBack = (n = 12) => {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en", { month: "short" }), start: d });
  }
  return out;
};
const fillMonths = (rows, field = "count", n = 12) => {
  const map = new Map(rows.map((r) => [r._id, r[field] || 0]));
  return monthsBack(n).map((m) => ({ key: m.key, label: m.label, value: map.get(m.key) || 0 }));
};
const csvEscape = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sendCsv = (res, name, header, rows) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send([header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n"));
};
const paging = (q, def = 20, max = 100) => {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit) || def));
  return { page, limit, skip: (page - 1) * limit };
};

module.exports = { isId, oid, cap, nameOf, roleLabel, createdOf, isPremium, idFromDate, esc, ok, fail, normPhone, ticketRef, monthsBack, fillMonths, csvEscape, sendCsv, paging };
