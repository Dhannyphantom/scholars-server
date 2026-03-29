/**
 * migrateMedia.js
 *
 * Callable migration helper: Cloudinary → AWS S3
 * Supports both flat string URL fields and nested object fields (e.g. image.uri)
 *
 * @example — Question (nested image object)
 * await migrateMedia({
 *   model: Question,
 *   files: [
 *     { field: "image", folder: "questions", type: "image" },
 *   ],
 * });
 *
 * @example — Subject (imported mediaSchema)
 * await migrateMedia({
 *   model: Subject,
 *   files: [
 *     { field: "image", folder: "subjects", type: "image" },
 *   ],
 * });
 *
 * @example — Category (imported mediaSchema)
 * await migrateMedia({
 *   model: Category,
 *   files: [
 *     { field: "image", folder: "categories", type: "image" },
 *   ],
 * });
 */

const axios = require("axios");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const sharp = require("sharp");

const S3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET_NAME;
const CDN_URL = process.env.CLOUDFRONT_URL.replace(/\/$/, "");

// ─── Dot-notation helpers ──────────────────────────────────────────────────────

/**
 * Reads a value from a doc using dot-notation.
 * e.g. getField(doc, "image.uri") → doc.image.uri
 * Also handles plain top-level fields: getField(doc, "thumbnail") → doc.thumbnail
 */
function getField(doc, field) {
  return field.split(".").reduce((obj, key) => obj?.[key], doc);
}

/**
 * Resolves the raw URL string from a field value.
 * Handles:
 *   - Plain string fields:   doc.thumbnail  → "https://..."
 *   - Nested object fields:  doc.image      → { uri: "https://...", thumb, ... }
 *   - Explicit dot path:     doc.image.uri  → "https://..."
 */
function resolveUrl(fieldValue) {
  if (!fieldValue) return null;
  if (typeof fieldValue === "string") return fieldValue;
  // mediaSchema object — uri is the primary URL
  if (typeof fieldValue === "object" && fieldValue.uri) return fieldValue.uri;
  return null;
}

/**
 * Determines whether a field is a mediaSchema object (vs a plain string URL).
 * Used to decide how to write back the migrated URLs.
 */
function isMediaObject(fieldValue) {
  return (
    fieldValue !== null && typeof fieldValue === "object" && "uri" in fieldValue
  );
}

// ─── S3 / image helpers ────────────────────────────────────────────────────────

async function fetchBuffer(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxRedirects: 5,
  });
  return Buffer.from(response.data);
}

function detectFormat(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8)
    return { ext: "jpg", mime: "image/jpeg" };
  if (buffer[0] === 0x89 && buffer.slice(1, 4).toString() === "PNG")
    return { ext: "png", mime: "image/png" };
  if (buffer.slice(8, 12).toString() === "WEBP")
    return { ext: "webp", mime: "image/webp" };
  return { ext: "jpg", mime: "image/jpeg" }; // fallback
}

function deriveKey(url) {
  try {
    const parts = new URL(url).pathname.split("/");
    const uploadIdx = parts.indexOf("upload");
    const tail = (
      uploadIdx >= 0 ? parts.slice(uploadIdx + 1) : parts.slice(-2)
    ).join("_");
    return tail
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .substring(0, 80);
  } catch {
    return `file_${Date.now()}`;
  }
}

// "covers/animations" → "thumbs/animations" | "covers" → "thumbs"
function thumbFolder(folder) {
  const parts = folder.split("/");
  parts[0] = "thumbs";
  return parts.join("/");
}

async function uploadToS3(buffer, key, mime, bucket) {
  const activeBucket = bucket || BUCKET;
  await S3.send(
    new PutObjectCommand({
      Bucket: activeBucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
      CacheControl: "public, max-age=31536000",
    }),
  );
  return `${CDN_URL}/${key}`;
}

async function processImage(buffer) {
  const { ext, mime } = detectFormat(buffer);

  const compress = (pipeline) =>
    ext === "png"
      ? pipeline.png({ compressionLevel: 8 })
      : pipeline.jpeg({ quality: 82, mozjpeg: true });

  const [original, thumb] = await Promise.all([
    compress(sharp(buffer).clone()).toBuffer(),
    compress(
      sharp(buffer).clone().resize(200, 200, { fit: "cover" }),
    ).toBuffer(),
  ]);

  return { original, thumb, ext, mime };
}

function classifyUrl(url) {
  if (!url) return "empty";
  if (url.includes(CDN_URL) || url.includes("amazonaws.com")) return "s3";
  if (url.includes("cloudinary.com")) return "cloudinary";
  if (url.includes("firebasestorage.googleapis.com")) return "firebase";
  return "unknown";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object}   options
 * @param {Model}    options.model          - Mongoose model
 * @param {object[]} options.files          - [{ field, folder, type: "image"|"audio"|"video"|"pdf" }]
 *                                            `field` can be:
 *                                              - a plain string field: "thumbnail"
 *                                              - a dot-path to a string: "image.uri"
 *                                              - a mediaSchema object field: "image"
 * @param {string}   [options.bucket]       - S3 bucket override
 */
async function migrateMedia({ model, files, bucket }) {
  const activeBucket = bucket || BUCKET;
  const docs = await model.find({});
  const results = { total: docs.length, updated: 0, skipped: 0, failed: 0 };

  console.log(`\n${"─".repeat(55)}`);
  console.log(`[${model.modelName}] Migrating ${docs.length} documents…`);

  for (const doc of docs) {
    // MongoDB $set changes — dot-notation keys work natively
    const changes = {};

    for (const { field, folder, type } of files) {
      const fieldValue = getField(doc, field);
      const url = resolveUrl(fieldValue);
      const origin = classifyUrl(url);

      if (origin === "empty") {
        results.skipped++;
        continue;
      }

      if (origin === "s3") {
        console.log(`  ↷ ${doc._id} → ${field}: already on S3, skipping`);
        results.skipped++;
        continue;
      }

      if (origin === "unknown") {
        console.warn(
          `  ? ${doc._id} → ${field}: unknown URL origin (${url}), skipping`,
        );
        results.skipped++;
        continue;
      }

      if (!["cloudinary", "firebase"].includes(origin)) continue;

      // origin === "cloudinary" | "firebase" — proceed
      try {
        const buffer = await fetchBuffer(url);
        const fileKey = deriveKey(url);
        const mediaObject = isMediaObject(fieldValue);

        if (type === "image") {
          const { original, thumb, ext, mime } = await processImage(buffer);

          const [newUrl, newThumb] = await Promise.all([
            uploadToS3(
              original,
              `${folder}/${fileKey}.${ext}`,
              mime,
              activeBucket,
            ),
            uploadToS3(
              thumb,
              `${thumbFolder(folder)}/${fileKey}.${ext}`,
              mime,
              activeBucket,
            ),
          ]);

          if (mediaObject) {
            // Nested mediaSchema object — write uri and thumb in one $set
            // e.g. "image.uri" and "image.thumb" via dot notation
            changes[`${field}.uri`] = newUrl;
            changes[`${field}.thumb`] = newThumb;
          } else {
            // Plain string field
            changes[field] = newUrl;

            // Handle sibling thumb field if it exists (e.g. avatarThumb)
            if (field === "avatar" && doc.avatar?.thumb !== undefined) {
              changes["avatar.thumb"] = newThumb;
            } else if (doc[`${field}Thumb`] !== undefined) {
              changes[`${field}Thumb`] = newThumb;
            }
          }
        } else {
          // Non-image: audio, video, pdf
          const ext = url.split(".").pop().split("?")[0].toLowerCase();
          const mimeMap = {
            mp3: "audio/mpeg",
            wav: "audio/wav",
            m4a: "audio/mp4",
            pdf: "application/pdf",
            mp4: "video/mp4",
            mov: "video/quicktime",
          };
          const newUrl = await uploadToS3(
            buffer,
            `${folder}/${fileKey}.${ext}`,
            mimeMap[ext] || "application/octet-stream",
            activeBucket,
          );

          if (mediaObject) {
            changes[`${field}.uri`] = newUrl;
          } else {
            changes[field] = newUrl;
          }
        }

        console.log(`  ✓ ${doc._id} → ${field} migrated`);
      } catch (err) {
        console.error(`  ✗ ${doc._id} → ${field}: ${err.message}`);
        results.failed++;
      }
    }

    if (Object.keys(changes).length) {
      await model.updateOne({ _id: doc._id }, { $set: changes });
      results.updated++;
    }
  }

  console.log(
    `\n  ✦ Done — total:${results.total} | updated:${results.updated} | skipped:${results.skipped} | failed:${results.failed}`,
  );
  return results;
}

module.exports = { migrateMedia };
