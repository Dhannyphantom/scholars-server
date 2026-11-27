const mongoose = require("mongoose");
const { Schema } = mongoose;
const oid = Schema.Types.ObjectId;

// Presence of a document == suspended
const flagSchema = new Schema({
  kind: { type: String, enum: ["user", "school"], required: true },
  ref: { type: oid, required: true },
  reason: String,
  by: { type: oid, ref: "User" },
  at: { type: Date, default: Date.now },
});
flagSchema.index({ kind: 1, ref: 1 }, { unique: true });
const AdminFlag = mongoose.model("AdminFlag", flagSchema);

// Request-tracked events (login, quiz start, school join, payout request...). Expires after 30 days.
const ActivityEvent = mongoose.model(
  "ActivityEvent",
  new Schema({
    user: { type: oid, ref: "User", index: true },
    type: { type: String, enum: ["quiz", "payment", "auth", "school", "support"], index: true },
    text: String,
    at: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 30 },
  }),
);

// Presence: updated (throttled) whenever an authenticated user hits the API
const UserActivity = mongoose.model(
  "UserActivity",
  new Schema({
    user: { type: oid, ref: "User", unique: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    lastPath: String,
    hits: { type: Number, default: 0 },
  }),
);

const TicketNote = mongoose.model(
  "TicketNote",
  new Schema({
    ticket: { type: oid, ref: "SupportTicket", index: true },
    author: { type: oid, ref: "User" },
    authorName: String,
    text: { type: String, maxlength: 5000 },
    at: { type: Date, default: Date.now },
  }),
);

const AdminProfile = mongoose.model(
  "AdminProfile",
  new Schema({
    user: { type: oid, ref: "User", unique: true },
    bio: { type: String, maxlength: 300, default: "" },
    org: { type: String, maxlength: 120, default: "" },
    notif: { ticket: { type: Boolean, default: true }, weekly: { type: Boolean, default: true } },
  }),
);

const ProTokenLog = mongoose.model(
  "ProTokenLog",
  new Schema({
    token: String,
    by: { type: oid, ref: "User" },
    byName: String,
    at: { type: Date, default: Date.now },
  }),
);

const ScheduledNotification = mongoose.model(
  "ScheduledNotification",
  new Schema({
    channel: { type: String, enum: ["push", "email"] },
    audience: { type: { type: String }, value: String, who: String, label: String },
    payload: Schema.Types.Mixed,
    runAt: { type: Date, index: true },
    status: { type: String, enum: ["pending", "processing", "sent", "failed", "cancelled"], default: "pending", index: true },
    result: { total: Number, sent: Number, failed: Number, error: String },
    by: { type: oid, ref: "User" },
    byName: String,
    createdAt: { type: Date, default: Date.now },
  }),
);

// Snapshot of the users / schools touched by a bulk subscription change, so the follow-up
// notification goes to exactly them. Expires after 90 days.
const BulkBatch = mongoose.model(
  "BulkBatch",
  new Schema({
    kind: { type: String, enum: ["users", "schools"], required: true },
    ids: [{ type: oid }],
    action: String,
    days: Number,
    count: Number,
    label: String,
    by: { type: oid, ref: "User" },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  }),
);

const NotifyUpload = mongoose.model(
  "NotifyUpload",
  new Schema({
    key: String,
    url: { type: String, index: true },
    expiresAt: { type: Date, index: true },
    by: { type: oid, ref: "User" },
    createdAt: { type: Date, default: Date.now },
  }),
);

module.exports = { NotifyUpload, AdminFlag, ActivityEvent, UserActivity, TicketNote, AdminProfile, ProTokenLog, ScheduledNotification, BulkBatch };
