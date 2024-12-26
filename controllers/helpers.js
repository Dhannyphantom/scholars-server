const _NET = process.env.NET_DEV;
// const image_exts = ["jpg", "jpeg", "png", "gif"];
const User = require("../models/User.js");

const ADDRESS = process.env.ADDRESS;
const PORT = process.env.PORT;
const GT_VALUE = 1000;

const getUploadUri = (images, bucketName) => {
  let imgUri, thumbUri;

  if (Array.isArray(images)) {
    //   an array of images
    if (_NET === "offline") {
      const imgUris = images.map((obj) => {
        return {
          ...obj,
          uri: `${
            ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + obj.uri
          }`,
          key: obj.uri,
          type: obj.type ?? "image/jpg",
          thumb: `${
            ADDRESS +
            ":" +
            PORT +
            "/uploads/thumbs" +
            "/" +
            (obj.thumb ? obj.thumb : obj.uri)
          }`,
        };
      });

      return imgUris;
    } else if (_NET === "online") {
      return images;
    }
  } else {
    // Single upload
    if (_NET === "offline") {
      let thumber;
      if (images[0].thumb) {
        thumber = images[0].thumb;
      } else {
        thumber = images[0].uri;
      }
      imgUri = `${
        ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + images[0].uri
      }`;
      thumbUri = `${ADDRESS + ":" + PORT + "/uploads/thumbs" + "/" + thumber}`;
    } else {
      imgUri = images[0].uri;
      thumbUri = images[0].thumb;
    }

    return {
      uri: imgUri,
      type: images[0].type ?? "image/jpg",
      thumb: thumbUri,
      width: images[0].width,
      height: images[0].height,
    };
  }
};

const getCurrencyAmount = (number) => {
  if (number && typeof number == "number") {
    return `₦${Number(number).toLocaleString()}`;
  } else {
    return null;
  }
};

const formatPoints = (number) => {
  // if (number && typeof number == "number") {
  return `${number} GT`;
  // return `${Number(number).toLocaleString()} TK`;
  // } else {
  //   return null;
  // }
};

const calculatePointsAmount = (value) => {
  // reverse is false, value = "points"
  // reverse is true, value = "amount"
  // N1 = 1000 GT;
  // x = points;
  const amount = (value / GT_VALUE).toPrecision(2);
  const pointsVal = Math.floor(value * GT_VALUE);
  return {
    amount,
    format: getCurrencyAmount(Number(amount)),
    point: pointsVal,
    pointFormat: formatPoints(pointsVal),
  };
};

const classEnums = ["jss1", "jss2", "jss3", "ss1", "ss2", "ss3"];

module.exports.fetchUser = async (userId) => {
  const userData = await User.findOne({ _id: userId }).select("-password -__v");

  return userData ?? null;
};

module.exports = {
  formatPoints,
  calculatePointsAmount,
  getCurrencyAmount,
  classEnums,
  getUploadUri,
};
