const mongoose = require("mongoose");
const { createDir } = require("./helpers");
const { AppInfo } = require("../models/AppInfo");
const walletService = require("./walletService");

createDir("uploads/assets");

let connectUri = "";
const currentIp = process.env.ADDRESS;

const initAppInfo = async () => {
  try {
    await AppInfo.updateOne(
      { ID: "APP" },
      {
        $setOnInsert: {
          NAME: "Guru",
          PRO_TOKEN: "gurupro@mosdan",
          POINT_VALUE: 10,
          VERSION: {
            SHOULD_UPDATE: "1.1.0",
            MUST_UPDATE: "1.0.0",
          },
          STUDENT_SUB: 2000,
          SCHOOL_SUB: 10000,
          MAX_WEEK_QUOTA: 40000,
          POINT_VALUE_TEXT: "GT",
          POINT_FAIL: 15,
          MAX_SUBJECT_PER_WEEK: 5,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error("❌ Failed to initialize AppInfo:", err);
  }
};

process.env.NET_DEV === "offline"
  ? (connectUri = process.env.MONGO_LOCAL)
  : (connectUri = process.env.MONGO_URI);

module.exports = () => {
  mongoose
    .connect(connectUri)
    .then(async () => {
      // Fawn.init(mongoose);
      console.log(`MONGODB CONNECTED ${process.env.NET_DEV} AT ${currentIp}`);
      await initAppInfo();
      await walletService.initializeWallets();
    })
    .catch((err) => console.error("ERROR CONNECTING TO DB", err));
};

// Fawn.init(mongoose);
