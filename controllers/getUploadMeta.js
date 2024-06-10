const _NET = process.env.NET_DEV;

const ADDRESS = process.env.ADDRESS;
const PORT = process.env.PORT;

module.exports = (mediaData, media, bucketName) => {
  let imgUri, thumbUri;

  if (Array.isArray(mediaData) && media.length > 1) {
    //   an array of media
    if (_NET === "offline") {
      const imgUris = media.map((obj, idx) => {
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
            (obj.thumb ?? obj.uri)
          }`,
        };
      });

      return imgUris;
    } else if (_NET === "online") {
      return media;
    }
  } else {
    // Single upload
    if (_NET === "offline") {
      let thumber;
      if (media[0].thumb) {
        thumber = media[0].thumb;
      } else {
        thumber = media[0].uri;
      }
      imgUri = `${
        ADDRESS + ":" + PORT + "/uploads/" + bucketName + "/" + media[0].uri
      }`;
      thumbUri = `${ADDRESS + ":" + PORT + "/uploads/thumbs" + "/" + thumber}`;
    } else {
      imgUri = media[0].uri;
      thumbUri = media[0].thumb;
    }

    const fileObj = {
      uri: imgUri,
      type: mediaData.type ?? media[0].type ?? "image",
      thumb: thumbUri,
      width: media[0].width,
      height: media[0].height,
    };

    return fileObj;
  }
};
