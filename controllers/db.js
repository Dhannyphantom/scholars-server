const mongoose = require("mongoose");
const { createDir } = require("./helpers");

createDir("uploads/assets");

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
};

// Fawn.init(mongoose);
