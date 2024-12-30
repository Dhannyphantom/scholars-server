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

      thumber = images?.thumb ?? images.uri;

      imgUri = `${
        ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + images.uri
      }`;
      thumbUri = `${ADDRESS + ":" + PORT + "/uploads/thumbs" + "/" + thumber}`;
    } else {
      imgUri = images.uri;
      thumbUri = images.thumb;
    }

    return {
      uri: imgUri,
      type: images.type,
      thumb: thumbUri,
      width: images.width,
      height: images.height,
    };
  }
};

const capFirstLetter = (str) => {
  if (!str) return null;
  return str[0].toUpperCase() + str.slice(1);
};

const capCapitalize = (str) => {
  let capitalized = capFirstLetter(str);
  for (let i = 0; i < str.length; i++) {
    const letter = capitalized[i];
    if (letter === " " && capitalized[i + 1]) {
      capitalized =
        capitalized.slice(0, i + 1) +
        capitalized[i + 1].toUpperCase() +
        capitalized.slice(i + 2);
    }
  }
  return capitalized;
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

const classEnums = ["jss 1", "jss 2", "jss 3", "sss 1", "sss 2", "sss 3"];
const userSelector =
  "avatar firstName lastName username gender preffix state lga points rank accountType";
const fullUserSelector = "-password -__v";

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
  userSelector,
  fullUserSelector,
  capFirstLetter,
  capCapitalize,
};
