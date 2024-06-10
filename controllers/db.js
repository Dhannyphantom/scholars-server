const mongoose = require("mongoose");
// const { createDir } = require("./helpers");

// const Fawn = require("fawn");

let connectUri = "";
const currentIp = process.env.ADDRESS;

process.env.NET_DEV === "offline"
  ? (connectUri =
      process.env.MONGO_LOCAL + currentIp.replaceAll(".", "").slice(-6))
  : (connectUri = process.env.MONGO_URI);

module.exports = () => {
  mongoose
    .connect(connectUri)
    .then(() => {
      // Fawn.init(mongoose);
      console.log(`MONGODB CONNECTED ${process.env.NET_DEV} AT ${currentIp}`);
    })
    .catch((err) => console.error("ERROR CONNECTING TO DB", err));

  //   createDir("uploads/");
  //   createDir("uploads/assets");
  //   createDir("uploads/thumbs");
};

// Fawn.init(mongoose);
