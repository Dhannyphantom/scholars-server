const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const { getUploadUri } = require("../controllers/helpers");
const auth = require("../middlewares/authRoutes");
const { Category } = require("../models/Category");
const { Subject } = require("../models/Subject");

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
  "/subject",
  [auth, uploader.array("media", 100), mediaUploader],
  async (req, res) => {
    const reqData = req.data;
    const media = getUploadUri(req.media, reqData?.bucket);

    reqData.data.forEach(async (item) => {
      const asset = media.find((obj) => obj.key == item?.image?.assetId);
      delete asset.key;

      const subject = new Subject({
        name: item.name,
        image: asset,
      });

      try {
        await subject.save();
        // push subject to selected categories
        const catIds = item.categories.map((cats) => cats._id);
        await Category.updateMany(
          { _id: { $in: catIds } },
          {
            $addToSet: {
              subjects: subject._id,
            },
          }
        );
      } catch (error) {
        return res.status(422).send({ status: "failed", error });
      }
    });

    res.send({ status: "success" });
  }
);

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
