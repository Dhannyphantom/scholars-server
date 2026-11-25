// Images uploaded from the Notify page. They live in S3 for a limited time and are
// removed automatically (S3 object + DB record) once their lifespan is over.
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const { NotifyUpload } = require("../models/AdminMisc");

let s3;
const client = () => (s3 ||= new S3Client({
  region: process.env.AWS_REGION,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
}));
const cdn = () => String(process.env.CLOUDFRONT_URL || "").replace(/\/$/, "");
const DAY = 864e5;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function saveUpload({ buffer, mime, days, by }) {
  const ext = EXT[mime];
  if (!ext) throw new Error("Only JPG, PNG, WEBP or GIF images are allowed");
  let body = buffer;
  if (mime !== "image/gif") {
    try {
      const sharp = require("sharp");
      body = await sharp(buffer).rotate().resize({ width: 1600, withoutEnlargement: true })[ext === "jpg" ? "jpeg" : ext](ext === "jpg" ? { quality: 84, mozjpeg: true } : undefined).toBuffer();
    } catch { body = buffer; }
  }
  const key = `notify/${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${ext}`;
  await client().send(new PutObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key, Body: body, ContentType: mime, CacheControl: "public, max-age=86400" }));
  const lifespan = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const doc = await NotifyUpload.create({ key, url: `${cdn()}/${key}`, expiresAt: new Date(Date.now() + lifespan * DAY), by });
  return doc;
}

/** Keep images alive until (at least) a week after a notification is due to go out. */
async function extendForUrls(urls, runAt) {
  const list = [...new Set(urls.filter(Boolean))];
  if (!list.length) return;
  const min = new Date(new Date(runAt).getTime() + 7 * DAY);
  await NotifyUpload.updateMany({ url: { $in: list }, expiresAt: { $lt: min } }, { expiresAt: min });
}

async function cleanupExpiredUploads() {
  const due = await NotifyUpload.find({ expiresAt: { $lte: new Date() } }).limit(100).lean();
  for (const u of due) {
    try {
      await client().send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: u.key }));
      await NotifyUpload.deleteOne({ _id: u._id });
    } catch (e) { console.error("[notify cleanup]", u.key, e.message); }
  }
  return due.length;
}

module.exports = { saveUpload, extendForUrls, cleanupExpiredUploads };
