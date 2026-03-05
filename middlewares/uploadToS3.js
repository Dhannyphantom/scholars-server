const multer = require("multer");
const sharp = require("sharp");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

/* ================= CONFIG ================= */

const _NET = process.env.NET_DEV || "offline"; // "online" | "offline"
const ADDRESS = process.env.ADDRESS || "http://localhost";
const PORT = process.env.PORT || 5000;

const s3 =
  _NET === "online"
    ? new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      })
    : null;

/* ================= MULTER ================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const uploadSingle = upload.single("file");

/* ================= HELPERS ================= */

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const extractKeyFromUrl = (url) => {
  try {
    const { pathname } = new URL(url);
    return pathname.replace(/^\//, "");
  } catch {
    return null;
  }
};

/* ================= MAIN PROCESSOR ================= */

const processAndUpload =
  (bucketName = "avatars") =>
  async (req, res, next) => {
    if (!req.file) return next();

    try {
      const unique = crypto.randomBytes(8).toString("hex");

      const metadata = await sharp(req.file.buffer).metadata();

      /* ==== MAIN IMAGE ==== */
      const mainBuffer = await sharp(req.file.buffer)
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();

      /* ==== THUMB ==== */
      const thumbBuffer = await sharp(req.file.buffer)
        .resize({ width: 250, withoutEnlargement: true })
        .jpeg({ quality: 40, mozjpeg: true })
        .toBuffer();

      const mainName = `${unique}.jpg`;
      const thumbName = `thumb_${unique}.jpg`;

      /* ================= ONLINE ================= */

      if (_NET === "online") {
        const mainKey = `${bucketName}/${mainName}`;
        const thumbKey = `thumbs/${thumbName}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: mainKey,
            Body: mainBuffer,
            ContentType: "image/jpeg",
          }),
        );

        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: "image/jpeg",
          }),
        );

        req.body.file = {
          uri: `${process.env.CLOUDFRONT_URL}/${mainKey}`,
          thumb: `${process.env.CLOUDFRONT_URL}/${thumbKey}`,
          key: mainName,
          assetId: unique,
          type: "image/jpg",
          width: metadata.width,
          height: metadata.height,
        };
      } else {

      /* ================= OFFLINE ================= */
        const mainDir = path.join("uploads", bucketName);
        const thumbDir = path.join("uploads", "thumbs");

        ensureDir(mainDir);
        ensureDir(thumbDir);

        fs.writeFileSync(path.join(mainDir, mainName), mainBuffer);
        fs.writeFileSync(path.join(thumbDir, thumbName), thumbBuffer);

        req.body.file = {
          uri: `${ADDRESS}:${PORT}/uploads/${bucketName}/${mainName}`,
          thumb: `${ADDRESS}:${PORT}/uploads/thumbs/${thumbName}`,
          key: mainName,
          assetId: unique,
          type: "image/jpg",
          width: metadata.width,
          height: metadata.height,
        };
      }

      next();
    } catch (err) {
      next(err);
    }
  };

/* ================= DELETE ================= */

const deleteFile = async (fileUrl) => {
  if (!fileUrl) return false;

  if (_NET === "online") {
    const key = extractKeyFromUrl(fileUrl);
    if (!key) return false;

    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
      }),
    );

    return true;
  } else {
    const localPath = fileUrl.replace(`${ADDRESS}:${PORT}/`, "");
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      return true;
    }
  }

  return false;
};

module.exports = {
  uploadSingle,
  processAndUpload,
  deleteFile,
};
