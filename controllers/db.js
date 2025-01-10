const mongoose = require("mongoose");
const { createDir } = require("./helpers");

// const Fawn = require("fawn");

// const data = createDir("uploads/assets");
// const error = data?.error;
// if (error) {
//   console.log("Assets creation failed!");
// }

let connectUri = "";
const currentIp = process.env.ADDRESS;

process.env.NET_DEV === "offline"
  ? (connectUri = process.env.MONGO_LOCAL)
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
