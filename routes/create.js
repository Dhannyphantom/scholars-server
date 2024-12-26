const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const { getUploadUri } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
const { Category } = require("../models/Category");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    return cb(null, "./uploads/assets/");
  },
  filename: (req, file, cb) => {
    return cb(null, `${file.originalname}`);
  },
});

const uploader = multer({ storage, limits: { fieldSize: 2 * 1024 * 1024 } }); // 2MB

const router = express.Router();

router.post(
  "/category",
  [auth, uploader.array("media", 100), mediaUploader],
  async (req, res) => {
    const reqData = req.data;
    const media = getUploadUri(req.media, reqData?.bucket);

    reqData.data.forEach(async (item) => {
      const asset = media.find((obj) => obj.key == item?.image?.assetId);
      delete asset.key;
      const category = new Category({
        name: item.name,
        image: asset,
      });

      try {
        await category.save();
      } catch (error) {
        return res.status(422).send({ status: "failed", error });
      }
    });

    res.send({ status: "success" });
  }
);

module.exports = router;
