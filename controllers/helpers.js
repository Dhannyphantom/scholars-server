const _NET = process.env.NET_DEV;
// const image_exts = ["jpg", "jpeg", "png", "gif"];
const User = require("../models/User.js");

const ADDRESS = process.env.ADDRESS;
const PORT = process.env.PORT;

module.exports.getUploadUri = (imageData, images, bucketName) => {
  let imgUri, thumbUri;

  if (Array.isArray(imageData) && images.length > 1) {
    //   an array of images
    if (_NET === "offline") {
      const imgUris = images.map((obj) => {
        return {
          ...obj,
          uri: `${
            ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + obj.uri
          }`,
          type: obj.type ?? "image",
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
      type: imageData.type ?? images[0].type ?? "image",
      thumb: thumbUri,
      width: images[0].width,
      height: images[0].height,
    };
  }
};

module.exports.fetchUser = async (userId) => {
  console.log({ User });
  const userData = await User.findOne({ _id: userId }).select("-password -__v");

  return userData ?? null;
};
