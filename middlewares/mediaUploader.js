const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const _NET = process.env.NET_DEV;
const { initializeApp } = require("firebase/app");
const {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytesResumable,
} = require("firebase/storage");
const firebaseConfig = require("../controllers/firebase.config");
// const { createDir } = require("../controllers/helpers");

// INITIALIZING FIREBASE SDK
initializeApp(firebaseConfig);

// INITIALIZING FIREBASE STORAGE
const storage = getStorage();

const uploadFile = async (buffer, filePath, mimetype) => {
  const storageRef = ref(storage, filePath);

  const snapshot = await uploadBytesResumable(storageRef, buffer, {
    contentType: mimetype,
  });
  const mediaUrl = await getDownloadURL(snapshot.ref);
  return mediaUrl;
};

module.exports = async (req, res, next) => {
  const media = [];
  const bodyData = req?.body?.data;
  const mediaData =
    Boolean(bodyData) && typeof bodyData == "string"
      ? JSON.parse(req.body?.data)
      : req.body;

  req.data = mediaData;
  if (mediaData.hasOwnProperty("media") && mediaData.media === false) {
    next();
    return;
  }

  if (!mediaData) return res.status(422).json("No media data");

  const outputFolder = `uploads/${mediaData.bucket}`;
  const outputThumb = "uploads/thumbs";
  const isFiles = Boolean(req.files);

  if (_NET == "offline") {
    const data = isFiles ? req.files : [req.file];
    const resizePromises = data.map(async (file) => {
      const filePath = path.resolve(outputFolder, file.filename);

      await sharp(file.path)
        .toFormat(file.mimetype?.split("/")[1], {
          mozjpeg: true,
          quality: 65,
        })
        .toFile(filePath);

      await sharp(file.path)
        .resize(60)
        .toFormat(file.mimetype?.split("/")[1], { mozjpeg: true, quality: 15 })
        .toFile(path.resolve(outputThumb, file.filename));

      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        console.log({ unlinkErr: err });
      }
      const imageObject = await sharp(filePath).metadata();

      media.push({
        uri: file.filename,
        width: imageObject.width,
        height: imageObject.height,
        type: file.mimetype,
      });
    });
    await Promise.all([...resizePromises]);
  } else if (_NET === "online") {
    const mediaArr = Boolean(req.file) ? [req.file] : req.files;
    const resizePromises = mediaArr.map(async (file) => {
      const { data, info } = await sharp(file.path)
        .toFormat(file.mimetype?.split("/")[1], {
          mozjpeg: true,
          quality: 65,
        })
        .toBuffer({ resolveWithObject: true });

      const bufferThumb = await sharp(file.path)
        .resize(60)
        .toFormat(file.mimetype?.split("/")[1], { mozjpeg: true, quality: 15 })
        .toBuffer();

      const mediaUrl = await uploadFile(
        data,
        `${mediaData.bucket}/${file.filename}`,
        file.mimetype
      );
      const thumbUrl = await uploadFile(
        bufferThumb,
        `thumbs/${file.filename}`,
        file.mimetype
      );

      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        console.log({ unlinkErr: err });
      }

      media.push({
        uri: mediaUrl,
        thumb: thumbUrl,
        width: info.width,
        key: file.filename,
        type: "image",
        height: info.height,
      });
    });
    await Promise.all([...resizePromises]);
  }

  req.media = isFiles ? media : media[0];

  next();
};
