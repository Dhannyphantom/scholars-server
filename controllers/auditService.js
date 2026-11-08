const { AuditLog } = require("../models/AuditLog");
const { User } = require("../models/User");
const { nameOf } = require("./adminHelpers");

const cache = new Map();
async function actorInfo(id) {
  const key = String(id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit;
  const u = await User.findById(id).select("firstName lastName username accountType").lean();
  const info = { at: Date.now(), name: nameOf(u) || "Unknown", username: u?.username, role: u?.accountType === "manager" ? "Manager" : "Professional" };
  cache.set(key, info);
  return info;
}

/** record(req | userId, { action, target, detail, cat, meta }) — never throws */
async function record(who, { action, target = "", detail = "", cat = "system", meta = {} }) {
  try {
    const id = who?.user?.userId || who?.me?._id || who;
    const a = await actorInfo(id);
    await AuditLog.create({ actor: id, actorName: a.name, actorUsername: a.username, role: a.role, action, target, detail, cat, meta });
  } catch (e) {
    console.error("[audit]", e.message);
  }
}
module.exports = { record };
