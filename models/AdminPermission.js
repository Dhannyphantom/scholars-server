const mongoose = require("mongoose");
const { Schema } = mongoose;
// Explicit permission choices for one professional: { "analytics.features": "view", "users.suspend": "edit", ... }
// Anything not listed follows the catalogue defaults / parent inheritance (see controllers/permissions.js).
module.exports = mongoose.model("AdminPermission", new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", unique: true, required: true },
  perms: { type: Schema.Types.Mixed, default: {} },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedAt: { type: Date, default: Date.now },
}));
