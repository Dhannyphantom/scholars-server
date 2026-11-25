// /admin-panel/notify (manager only — gate applied by parent)
const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { sanitizeEmailHtml, stripHtml, imageUrls } = require("../controllers/richMail");
const { saveUpload, extendForUrls } = require("../controllers/notifyUploads");
const { ScheduledNotification } = require("../models/AdminMisc");
const { audienceFilter, audienceLabel, processNotification } = require("../controllers/notificationService");
const { User } = require("../models/User");
const { record } = require("../controllers/auditService");
const { nameOf, isId, ok, fail } = require("../controllers/adminHelpers");

// Image upload (S3, auto-deleted after `days`)
router.post("/upload", (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err) return fail(res, 400, err.code === "LIMIT_FILE_SIZE" ? "Image must be 5MB or smaller" : err.message);
    if (!req.file) return fail(res, 400, "Choose an image to upload");
    try {
      const d = await saveUpload({ buffer: req.file.buffer, mime: req.file.mimetype, days: req.body?.days, by: req.me._id });
      ok(res, { url: d.url, expiresAt: d.expiresAt });
    } catch (e) { fail(res, 400, e.message); }
  });
});

router.post("/send", async (req, res) => {
  const { channel, audience, payload, scheduleAt } = req.body || {};
  if (channel === "email" && payload) {
    payload.message = sanitizeEmailHtml(payload.message);
    if (!stripHtml(payload.message) && !imageUrls(payload.message).length) return fail(res, 400, "Write a message first");
    payload.subject = String(payload.subject || "").slice(0, 200);
    payload.heading = String(payload.heading || "").slice(0, 200);
  }
  if (!["push", "email"].includes(channel)) return fail(res, 400, "Invalid channel");
  if (!audience?.type) return fail(res, 400, "Choose an audience");
  if (channel === "push" && (!payload?.title || !payload?.message)) return fail(res, 400, "Title and message are required");
  if (channel === "email" && (!payload?.subject || !payload?.heading || !payload?.message)) return fail(res, 400, "Subject, heading and message are required");
  try { await audienceFilter(audience); } catch (e) { return fail(res, 404, e.message); }
  const runAt = scheduleAt ? new Date(scheduleAt) : new Date();
  if (isNaN(runAt)) return fail(res, 400, "Invalid schedule time");
  const later = runAt.getTime() > Date.now() + 30 * 1000;
  const job = await ScheduledNotification.create({ channel, audience: { ...audience, label: audienceLabel(audience) }, payload, runAt, by: req.me._id, byName: nameOf(req.me) });
  record(req, { action: later ? `Scheduled ${channel}` : `Sent ${channel}`, target: audienceLabel(audience), detail: payload.title || payload.subject, cat: "notify" });
  extendForUrls([payload.image, ...imageUrls(payload.message)], runAt).catch(() => {});
  if (!later) processNotification(job._id).catch((e) => console.error("[notify]", e.message));
  ok(res, { id: job._id, scheduled: later });
});

router.get("/history", async (req, res) => {
  const rows = await ScheduledNotification.find().sort({ createdAt: -1 }).limit(15).lean();
  ok(res, rows.map((r) => ({ id: r._id, channel: r.channel, audience: r.audience?.label, title: r.payload?.title || r.payload?.subject, status: r.status, runAt: r.runAt, by: r.byName, result: r.result })));
});

router.delete("/:id", async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, "Invalid id");
  const r = await ScheduledNotification.findOneAndUpdate({ _id: req.params.id, status: "pending" }, { status: "cancelled" });
  if (!r) return fail(res, 404, "Only pending notifications can be cancelled");
  record(req, { action: "Cancelled scheduled notification", target: r.audience?.label, cat: "notify" });
  ok(res, { cancelled: true });
});

module.exports = router;
