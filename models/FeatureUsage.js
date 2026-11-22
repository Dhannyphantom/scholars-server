const mongoose = require("mongoose");
const { Schema } = mongoose;
const TTL = 60 * 60 * 24 * 180; // keep 180 days

// One document per (day, endpoint). Counters only, so it stays tiny.
const usageSchema = new Schema({
  day: { type: String, required: true }, // YYYY-MM-DD (Africa/Lagos)
  key: { type: String, required: true }, // "POST /instance/premium_quiz"
  feature: String,
  label: String,
  group: String,
  method: String,
  path: String,
  hits: { type: Number, default: 0 },
  errors: { type: Number, default: 0 },
  totalMs: { type: Number, default: 0 },
  maxMs: { type: Number, default: 0 },
  at: { type: Date, expires: TTL },
});
usageSchema.index({ day: 1, key: 1 }, { unique: true });
usageSchema.index({ feature: 1, day: 1 });

// One document per (day, endpoint, user) -> unique-user counts.
const userSchema = new Schema({
  day: { type: String, required: true },
  key: { type: String, required: true },
  feature: String,
  user: { type: Schema.Types.ObjectId, required: true },
  at: { type: Date, expires: TTL },
});
userSchema.index({ day: 1, key: 1, user: 1 }, { unique: true });
userSchema.index({ day: 1, feature: 1 });

module.exports = {
  FeatureUsage: mongoose.model("FeatureUsage", usageSchema),
  FeatureUser: mongoose.model("FeatureUser", userSchema),
};
