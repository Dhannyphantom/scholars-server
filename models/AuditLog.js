const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  actorName: String,
  actorUsername: String,
  role: { type: String, enum: ["Manager", "Professional"] },
  action: { type: String, required: true },
  target: String,
  detail: String,
  cat: { type: String, default: "system", index: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now, index: true },
});

// Append-only: block every update/delete path
["updateOne", "updateMany", "findOneAndUpdate", "findOneAndDelete", "deleteOne", "deleteMany", "findOneAndReplace"].forEach((op) =>
  auditLogSchema.pre(op, function () {
    throw new Error("Audit logs are append-only");
  }),
);

module.exports.AuditLog = mongoose.model("AuditLog", auditLogSchema);
