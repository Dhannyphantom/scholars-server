const express = require("express");
// const nodemailer = require("nodemailer");
const mediaUploader = require("../middlewares/mediaUploader");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");

// const getUploadMeta = require("../controllers/getUploadMeta");

const bcrypt = require("bcrypt");
const { User, validateLog, validateReg } = require("../models/User");
const auth = require("../middlewares/authRoutes");
const {
  getUploadUri,
  fullUserSelector,
  createDir,
  userSelector,
  checkUserSub,
} = require("../controllers/helpers");
const { AppInfo } = require("../models/AppInfo");
const WalletTransaction = require("../models/WalletTransaction");
const walletService = require("../controllers/walletService");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/assets";
    createDir(uploadPath);
    return cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    return cb(null, `${file.originalname}`);
  },
});
const uploader = multer({ storage, limits: { fieldSize: 5 * 1024 * 1024 } }); // 5MB

const router = express.Router();

function generateReferralToken(username) {
  if (!username) return "";

  const clean = username.toLowerCase().replace(/[^a-z0-9]/g, "");

  // first 4 chars from username
  const base = clean.slice(0, 4);

  // simple numeric signature from username length + char codes
  let sum = 0;
  for (let char of clean) {
    sum += char.charCodeAt(0);
  }

  const suffix = (sum % 10000).toString().padStart(4, "0");

  return (base + suffix).slice(0, 8);
}

router.post("/register", async (req, res) => {
  const { username, email, password, accountType, token: proToken } = req.body;

  const appInfo = await AppInfo.findOne({ ID: "APP" });

  const { error } = validateReg(req.body);
  if (error) return res.status(400).json(error.details[0].message);

  const isPro = accountType == "professional";

  if (isPro) {
    if (appInfo.PRO_TOKEN !== proToken) {
      return res.status(400).send("Invalid pro token");
    }
  }

  const aUser = await User.findOne({ username });
  if (aUser)
    return res.status(400).json("Username has been used already, Try another");
  const eEmail = await User.findOne({ email });
  if (eEmail)
    return res.status(400).json("Email has already been registered, Sign in!");

  const user = new User({
    username,
    email,
    accountType,
    password,
  });

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);

  user.password = hash;

  const token = user.generateAuthToken();

  let referalToken = generateReferralToken(user.username);
  let checker = await User.findOne({
    _id: { $ne: user._id },
    "rewards.code": referalToken,
  });

  while (Boolean(checker)) {
    referalToken = generateReferralToken(user.username);
    checker = await User.findOne({
      _id: { $ne: user._id },
      "rewards.code": referalToken,
    });
  }

  user.rewards = {
    code: referalToken,
    history: [
      {
        title: "Account Creation",
        point: 50,
        status: "pending",
      },
    ],
    point: 0,
  };

  await user.save();

  const userData = await User.findById(user._id).select(fullUserSelector);

  if (isPro) {
    // change PRO_TOKEN
    const randInt = Math.floor(Math.random() * 10e9);
    await AppInfo.updateOne(
      { ID: "APP" },
      {
        $set: {
          PRO_TOKEN: `mosdan@gurupro${randInt}`,
        },
      }
    );
  }

  res.header("x-auth-token", token).json({ token, user: userData });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const { error } = validateLog(req.body);
  if (error) return res.status(400).json(error.details[0].message);

  const user = await User.findOne().or([
    { email: username.toLowerCase() },
    { username },
  ]);

  if (!user) return res.status(400).json(`Invalid profile account`);

  const passValid = await bcrypt.compare(password, user.password);
  if (!passValid) return res.status(400).json("Invalid profile details");
  const token = user.generateAuthToken();

  const userData = await User.findById(user._id).select(fullUserSelector);

  res.header("x-auth-token", token).json({ token, user: userData });
});

router.get("/user", auth, async (req, res) => {
  const userId = req.user.userId;

  const userData = await User.findById(userId).select(fullUserSelector);

  if (!userData)
    return res.status(422).json("User data not found. Please sign in again");

  const today = new Date();
  const expiryDate = new Date(userData?.subscription?.expiry);

  if (expiryDate < today && userData?.subscription?.isActive) {
    // subscription expired
    userData.subscription.isActive = false;
    await userData.save();
  }

  res.json({ user: userData });
});

router.get("/userInfo", auth, async (req, res) => {
  const { userId } = req.query;

  const userData = await User.findById(userId).select(userSelector);

  if (!userData)
    return res.status(422).json("User data not found. Please sign in again");

  const today = new Date();
  const expiryDate = new Date(userData?.subscription?.expiry);

  if (expiryDate < today && userData?.subscription?.isActive) {
    // subscription expired
    userData.subscription.isActive = false;
    await userData.save();
  }

  res.json({ user: userData, status: "success" });
});

router.get("/professionals", auth, async (req, res) => {
  const userId = req.user.userId;

  const userInfo = await User.findById(userId).select("accountType");

  if (userInfo.accountType !== "manager")
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });

  const pros = await User.aggregate([
    {
      $match: { accountType: "professional" },
    },
    {
      $lookup: {
        from: "subjects",
        localField: "subjects",
        foreignField: "_id",
        as: "subjects",
        pipeline: [
          {
            $project: { name: 1 },
          },
        ],
      },
    },
    {
      $lookup: {
        from: "questions",
        localField: "_id",
        foreignField: "user",
        as: "questionsCreated",
      },
    },
    {
      $lookup: {
        from: "topics",
        localField: "_id",
        foreignField: "user",
        as: "topicsCreated",
      },
    },
    {
      $addFields: {
        questionsCount: { $size: "$questionsCreated" },
        topicsCount: { $size: "$topicsCreated" },
      },
    },
    {
      $project: {
        username: 1,
        firstName: 1,
        lastName: 1,
        state: 1,
        email: 1,
        subjects: 1,
        lga: 1,
        avatar: 1,
        verified: 1,
        address: 1,
        contact: 1,
        questionsCount: 1,
        topicsCount: 1,
      },
    },
    {
      $sort: { verified: 1 },
    },
  ]);

  res.send({ status: "success", data: pros });
});

router.get("/pro_leaderboard", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const proAcct = { $in: ["professional", "manager"] };

    // Get leaderboard with question counts and rankings
    const leaderboard = await User.aggregate([
      {
        $match: {
          accountType: proAcct,
          verified: true, // Only include verified professionals
        },
      },
      {
        $lookup: {
          from: "questions", // Change to your actual collection name if different
          localField: "_id",
          foreignField: "user",
          as: "questionsCreated",
        },
      },
      {
        $addFields: {
          questionsCount: {
            $cond: {
              if: { $isArray: "$questionsCreated" },
              then: { $size: "$questionsCreated" },
              else: 0,
            },
          },
        },
      },
      {
        $sort: {
          questionsCount: -1,
          _id: 1, // Secondary sort for consistent ordering when counts are equal
        },
      },
      {
        $project: {
          username: 1,
          firstName: 1,
          lastName: 1,
          avatar: 1,
          questionsCount: 1,
          state: 1,
          lga: 1,
        },
      },
    ]);

    // Add proper ranking
    const rankedLeaderboard = leaderboard.map((user, index) => ({
      ...user,
      rank: index + 1,
    }));

    // Find current user's position
    const currentUserPosition = rankedLeaderboard.findIndex(
      (user) => user._id.toString() === userId.toString()
    );

    let userRank = null;
    let userStats = null;

    if (currentUserPosition !== -1) {
      userRank = currentUserPosition + 1;
      userStats = rankedLeaderboard[currentUserPosition];
    } else {
      // If user is not in the main leaderboard (unverified or no questions), get their stats
      const userInfo = await User.aggregate([
        {
          $match: {
            _id: new mongoose.Types.ObjectId(userId),
            accountType: proAcct,
          },
        },
        {
          $lookup: {
            from: "questions", // Change to your actual collection name if different
            localField: "_id",
            foreignField: "user",
            as: "questionsCreated",
          },
        },
        {
          $addFields: {
            questionsCount: {
              $cond: {
                if: { $isArray: "$questionsCreated" },
                then: { $size: "$questionsCreated" },
                else: 0,
              },
            },
          },
        },
        {
          $project: {
            username: 1,
            firstName: 1,
            lastName: 1,
            avatar: 1,
            questionsCount: 1,
            state: 1,
            lga: 1,
            verified: 1,
          },
        },
      ]);

      if (userInfo.length > 0) {
        userStats = userInfo[0];

        // Calculate rank among all professionals (including unverified)
        const totalProfessionals = await User.aggregate([
          {
            $match: { accountType: proAcct },
          },
          {
            $lookup: {
              from: "questions", // Change to your actual collection name if different
              localField: "_id",
              foreignField: "user",
              as: "questionsCreated",
            },
          },
          {
            $addFields: {
              questionsCount: {
                $cond: {
                  if: { $isArray: "$questionsCreated" },
                  then: { $size: "$questionsCreated" },
                  else: 0,
                },
              },
            },
          },
          {
            $match: {
              questionsCount: { $gt: userStats.questionsCount },
            },
          },
          {
            $count: "count",
          },
        ]);

        userRank =
          totalProfessionals.length > 0 ? totalProfessionals[0].count + 1 : 1;
      }
    }

    res.send({
      status: "success",
      data: {
        leaderboard: rankedLeaderboard,
        currentUser: {
          rank: userRank,
          stats: userStats,
        },
        totalProfessionals: rankedLeaderboard.length,
      },
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).send({
      status: "failed",
      message: "Error fetching leaderboard",
    });
  }
});

router.get("/friends", auth, async (req, res) => {
  const profileUserId = new mongoose.Types.ObjectId(req.user.userId);

  const [result] = await User.aggregate([
    /* ===========================
     1. TARGET USER
  ============================ */
    { $match: { _id: profileUserId } },

    /* ===========================
     2. NORMALIZE
  ============================ */
    {
      $addFields: {
        followers: { $ifNull: ["$followers", []] },
        following: { $ifNull: ["$following", []] },
      },
    },

    /* ===========================
     3. IDS + COUNTS
  ============================ */
    {
      $addFields: {
        mutualIds: { $setIntersection: ["$followers", "$following"] },
        followersCount: { $size: "$followers" },
        followingCount: { $size: "$following" },
      },
    },
    {
      $addFields: {
        mutualsCount: { $size: "$mutualIds" },
      },
    },

    /* ===========================
     4. FOLLOWERS
  ============================ */
    {
      $lookup: {
        from: "users",
        let: {
          ids: "$followers",
          myFollowing: "$following",
          myFollowers: "$followers",
        },
        pipeline: [
          { $match: { $expr: { $in: ["$_id", "$$ids"] } } },

          /* school */
          {
            $lookup: {
              from: "schools",
              let: { uid: "$_id" },
              pipeline: [
                { $match: { $expr: { $in: ["$$uid", "$students.user"] } } },
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    studentRecord: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$students",
                            as: "s",
                            cond: { $eq: ["$$s.user", "$$uid"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                },
              ],
              as: "school",
            },
          },

          {
            $addFields: {
              school: {
                $cond: [
                  { $gt: [{ $size: "$school" }, 0] },
                  {
                    _id: { $arrayElemAt: ["$school._id", 0] },
                    name: { $arrayElemAt: ["$school.name", 0] },
                    verified: {
                      $arrayElemAt: ["$school.studentRecord.verified", 0],
                    },
                  },
                  null,
                ],
              },

              status: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $and: [
                          { $in: ["$_id", "$$myFollowing"] },
                          { $in: ["$_id", "$$myFollowers"] },
                        ],
                      },
                      then: "accepted",
                    },
                    {
                      case: { $in: ["$_id", "$$myFollowing"] },
                      then: "pending",
                    },
                    {
                      case: { $in: ["$_id", "$$myFollowers"] },
                      then: "follower",
                    },
                  ],
                  default: "none",
                },
              },
            },
          },

          {
            $project: {
              username: 1,
              firstName: 1,
              lastName: 1,
              avatar: 1,
              school: 1,
              status: 1,
            },
          },
        ],
        as: "followers",
      },
    },

    /* ===========================
     5. FOLLOWING
  ============================ */
    {
      $lookup: {
        from: "users",
        let: {
          ids: "$following",
          myFollowing: "$following",
          myFollowers: "$followers",
        },
        pipeline: [
          { $match: { $expr: { $in: ["$_id", "$$ids"] } } },

          /* school */
          {
            $lookup: {
              from: "schools",
              let: { uid: "$_id" },
              pipeline: [
                { $match: { $expr: { $in: ["$$uid", "$students.user"] } } },
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    studentRecord: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$students",
                            as: "s",
                            cond: { $eq: ["$$s.user", "$$uid"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                },
              ],
              as: "school",
            },
          },

          {
            $addFields: {
              school: {
                $cond: [
                  { $gt: [{ $size: "$school" }, 0] },
                  {
                    _id: { $arrayElemAt: ["$school._id", 0] },
                    name: { $arrayElemAt: ["$school.name", 0] },
                    verified: {
                      $arrayElemAt: ["$school.studentRecord.verified", 0],
                    },
                  },
                  null,
                ],
              },
              status: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $and: [
                          { $in: ["$_id", "$$myFollowing"] },
                          { $in: ["$_id", "$$myFollowers"] },
                        ],
                      },
                      then: "accepted",
                    },
                    {
                      case: { $in: ["$_id", "$$myFollowers"] },
                      then: "follower",
                    },
                    {
                      case: { $in: ["$_id", "$$myFollowing"] },
                      then: "pending",
                    },
                  ],
                  default: "none",
                },
              },
            },
          },

          {
            $project: {
              username: 1,
              firstName: 1,
              lastName: 1,
              avatar: 1,
              school: 1,
              status: 1,
            },
          },
        ],
        as: "following",
      },
    },

    /* ===========================
     6. MUTUALS
  ============================ */
    {
      $lookup: {
        from: "users",
        let: {
          ids: "$mutualIds",
          myFollowing: "$following",
          myFollowers: "$followers",
        },
        pipeline: [
          { $match: { $expr: { $in: ["$_id", "$$ids"] } } },

          /* school */
          {
            $lookup: {
              from: "schools",
              let: { uid: "$_id" },
              pipeline: [
                { $match: { $expr: { $in: ["$$uid", "$students.user"] } } },
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    studentRecord: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$students",
                            as: "s",
                            cond: { $eq: ["$$s.user", "$$uid"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                },
              ],
              as: "school",
            },
          },

          {
            $addFields: {
              school: {
                $cond: [
                  { $gt: [{ $size: "$school" }, 0] },
                  {
                    _id: { $arrayElemAt: ["$school._id", 0] },
                    name: { $arrayElemAt: ["$school.name", 0] },
                    verified: {
                      $arrayElemAt: ["$school.studentRecord.verified", 0],
                    },
                  },
                  null,
                ],
              },
              status: "accepted",
            },
          },

          {
            $project: {
              username: 1,
              firstName: 1,
              lastName: 1,
              avatar: 1,
              school: 1,
              status: 1,
            },
          },
        ],
        as: "mutuals",
      },
    },

    /* ===========================
     7. CLEANUP
  ============================ */
    {
      $project: {
        followers: 1,
        following: 1,
        mutuals: 1,
        followersCount: 1,
        mutualsCount: 1,
        followingCount: 1,
        // mutualIds: 0,
        // password: 0,
        // __v: 0,
      },
    },
  ]);

  res.send({ status: "success", data: result });
});

router.get("/rewards", auth, async (req, res) => {
  const userId = req.user.userId;

  const userInfo = await User.findById(userId).select("rewards username");

  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "User not found!" });

  if (!userInfo?.rewards) {
    let referalToken = generateReferralToken(userInfo.username);
    let checker = await User.findOne({
      _id: { $ne: userInfo._id },
      "rewards.code": referalToken,
    });

    while (Boolean(checker)) {
      referalToken = generateReferralToken(userInfo.username);
      checker = await User.findOne({
        _id: { $ne: userInfo._id },
        "rewards.code": referalToken,
      });
    }

    userInfo.rewards = {
      code: referalToken,
      history: [],
      point: 0,
    };
    await userInfo.save();
  }

  res.send({ status: "success", data: userInfo.rewards });
});

router.get("/search_students", auth, async (req, res) => {
  const userId = req.user.userId;
  const { q } = req.query;

  const searchStage = q
    ? {
        $or: [
          { firstName: { $regex: q, $options: "i" } },
          { lastName: { $regex: q, $options: "i" } },
          { username: { $regex: q, $options: "i" } },
        ],
      }
    : {};

  const currentUserId = new mongoose.Types.ObjectId(userId);

  const result = await User.aggregate([
    // 1. Only students
    {
      $match: {
        accountType: "student",
        ...searchStage,
        _id: { $ne: currentUserId },
      },
    },
    /* ===========================
     2. SCHOOL LOOKUP
  ============================ */
    {
      $lookup: {
        from: "schools",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $in: ["$$userId", "$students.user"],
              },
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              studentRecord: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$students",
                      as: "s",
                      cond: { $eq: ["$$s.user", "$$userId"] },
                    },
                  },
                  0,
                ],
              },
            },
          },
        ],
        as: "school",
      },
    },

    {
      $addFields: {
        school: {
          $cond: [
            { $gt: [{ $size: "$school" }, 0] },
            {
              _id: { $arrayElemAt: ["$school._id", 0] },
              name: { $arrayElemAt: ["$school.name", 0] },
              verified: {
                $arrayElemAt: ["$school.studentRecord.verified", 0],
              },
            },
            null,
          ],
        },
      },
    },

    // 2. Normalize arrays (safety)
    {
      $addFields: {
        followers: { $ifNull: ["$followers", []] },
        following: { $ifNull: ["$following", []] },
      },
    },

    // 3. Compute counts
    {
      $addFields: {
        followersCount: { $size: "$followers" },
        followingCount: { $size: "$following" },

        // mutuals = users present in both followers & following
        mutualsCount: {
          $size: {
            $setIntersection: ["$followers", "$following"],
          },
        },
      },
    },

    // 4. Relationship flags relative to requester
    {
      $addFields: {
        isFollowing: { $in: [currentUserId, "$followers"] },
        isFollower: { $in: [currentUserId, "$following"] },
      },
    },

    // 5. Friend status
    {
      $addFields: {
        status: {
          $cond: [
            { $and: ["$isFollowing", "$isFollower"] },
            "mutual",
            {
              $cond: [
                "$isFollowing",
                "following",
                {
                  $cond: ["$isFollower", "follower", null],
                },
              ],
            },
          ],
        },
      },
    },

    // 6. Clean up output
    {
      $project: {
        // followers: 0,
        // following: 0,
        // isFollowing: 0,
        // isFollower: 0,
        // __v: 0,
        // password: 0,
        // tokens: 0,
        // tx_history: 0,
        // accountType: 0,
        // qBank: 0,
        // address: 0,
        username: 1,
        firstName: 1,
        lastName: 1,
        followersCount: 1,
        followingCount: 1,
        mutualsCount: 1,
        school: 1,
        avatar: 1,
        verified: 1,
        points: 1,
        status: 1,
      },
    },
  ]);

  res.send({ status: "success", data: result });
});

router.put("/rewards", auth, async (req, res) => {
  const userId = req.user.userId;

  const { rewardId, point } = req.body;

  if (!rewardId || !point)
    return res
      .status(422)
      .send({ status: "failed", message: "Incomplete reward data" });

  await User.updateOne(
    {
      _id: userId,
      "rewards.history._id": rewardId,
      "rewards.history.status": "pending",
    },
    {
      $set: {
        "rewards.history.$.status": "rewarded",
      },
      $inc: {
        points: point,
        totalPoints: point,
        "rewards.point": point,
      },
    }
  );

  res.send({ status: "success" });
});

router.put("/students", auth, async (req, res) => {
  const userId = req.user.userId;
  const { type, user } = req.body;
  try {
    const currentUserId = new mongoose.Types.ObjectId(userId);
    const targetUserId = new mongoose.Types.ObjectId(user);

    if (!["follow", "unfollow"].includes(type)) {
      return res.status(400).json({ message: "Invalid action type" });
    }

    if (currentUserId.equals(targetUserId)) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    // const session = await mongoose.startSession();
    // session.startTransaction();

    if (type === "follow") {
      // Add target to my following
      await User.updateOne(
        { _id: currentUserId },
        { $addToSet: { following: targetUserId } }
      );

      // Add me to target's followers
      await User.updateOne(
        { _id: targetUserId },
        { $addToSet: { followers: currentUserId } }
      );
    }

    if (type === "unfollow") {
      // Remove target from my following
      await User.updateOne(
        { _id: currentUserId },
        { $pull: { following: targetUserId } }
      );

      // Remove me from target's followers
      await User.updateOne(
        { _id: targetUserId },
        { $pull: { followers: currentUserId } }
      );
    }

    // await session.commitTransaction();
    // session.endSession();

    return res.status(200).json({
      success: true,
      action: type,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

router.put("/professional", auth, async (req, res) => {
  const userId = req.user.userId;
  const { proId, subjects, action } = req.body;
  // action = 'verify' | 'reject' | 'revoke'

  const userInfo = await User.findById(userId).select("accountType");

  if (userInfo.accountType !== "manager")
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request" });

  if (!action)
    return res
      .status(422)
      .send({ status: "failed", message: "Missing action info!" });

  switch (action) {
    case "verify":
      await User.updateOne(
        { _id: proId },
        {
          $set: {
            verified: true,
            subjects: subjects?.map((item) => item?._id),
          },
        }
      );
      break;
    case "revoke":
      await User.updateOne(
        { _id: proId },
        {
          $set: {
            verified: false,
            subjects: [],
          },
        }
      );
      break;
    case "reject":
      await User.deleteOne({ _id: proId });
      break;

    default:
      break;
  }

  res.send({ status: "success" });
});

router.post(
  "/updateAvatar",
  [auth, uploader.single("upload"), mediaUploader],
  async (req, res) => {
    const user = await User.findById(req.user.userId);
    const imageData = req.media;

    if (!imageData) return res.status(400).json("Media data not found!");

    const userAvatarObj = getUploadUri(req.media, "avatars");

    // return res.status(422).send({ status: "failed", message: "Testing" });

    try {
      user.avatar.image = userAvatarObj;
      user.avatar.lastUpdate = new Date();

      await user.save();
    } catch (errr) {
      console.log({ errr });
    }

    res.json({ avatar: user.avatar });
  }
);

router.post("/generate_appinfo", async (req, res) => {
  const appInfo = new AppInfo({ ID: "APP" });

  await appInfo.save();

  res.send({ status: "success" });
});

router.post("/pro_reset", async (req, res) => {
  const { key, email } = req.body;

  if (key !== "mosdan@reset")
    return res
      .status(422)
      .send({ status: "failed", message: "Unauthorized request!" });
  const userInfo = await User.findOne({ email, accountType: "professional" });
  if (!userInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "Email not found!" });

  const newPass = "Gurupro1234";

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(newPass, salt);

  userInfo.password = hash;

  await userInfo.save();

  res.send({ status: "success", message: `Password reset successful` });
});

// Add to routes/payouts.js

// Get all user transactions (money + points)
router.get("/transactions", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      page = 1,
      limit = 30,
      category, // Optional: filter by category (subscription, payout, refund, etc.)
      type, // Optional: filter by type (credit, debit, points)
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query
    const query = { userId };
    if (category) query.category = category;
    if (type) query.transactionType = type;

    // Fetch transactions
    const transactions = await WalletTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .select(
        "transactionType category amount reference description metadata createdAt status"
      );

    const total = await WalletTransaction.countDocuments(query);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Fetch transactions error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/renew-subscription", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { value, days } = req.body;

    if (!days || days <= 0) {
      return res.status(400).send({
        status: "failed",
        message: "Invalid subscription duration",
      });
    }

    const user = await User.findById(userId).select("points subscription");

    if (!user) {
      return res.status(404).send({
        status: "failed",
        message: "User not found",
      });
    }

    if (user.points < value) {
      return res.status(422).send({
        status: "failed",
        message: "Not enough Guru Tokens",
      });
    }

    const today = new Date();
    const millisToAdd = days * 24 * 60 * 60 * 1000;

    let startDate;

    if (user.subscription?.expiry && today < user.subscription.expiry) {
      startDate = new Date(user.subscription.expiry);
    } else {
      startDate = today;
      user.subscription.current = today;
    }

    const newExpiry = new Date(startDate.getTime() + millisToAdd);

    const balanceBefore = user.points;
    user.subscription.expiry = newExpiry;
    user.subscription.current = today;
    user.subscription.isActive = true;
    user.points -= value;

    // Record as points transaction (doesn't affect wallet balance)
    const reference = `SUB_RENEW_${Date.now()}_${userId}`;

    const transaction = new WalletTransaction({
      accountType: "student",
      transactionType: "points", // New type - doesn't affect wallet balance
      category: "subscription",
      amount: 0, // No money involved
      balanceBefore: 0, // Wallet balance unchanged
      balanceAfter: 0, // Wallet balance unchanged
      reference,
      userId,
      description: `Subscription renewal - ${days} days`,
      metadata: {
        pointsSpent: value,
        pointsBalanceBefore: balanceBefore,
        pointsBalanceAfter: user.points,
        days,
        newExpiry,
      },
      status: "completed",
    });

    await transaction.save();
    await user.save();

    res.send({
      status: "success",
      message: "Subscription renewed successfully",
      data: {
        current: user.subscription.current,
        expiry: user.subscription.expiry,
        isActive: user.subscription.isActive,
        pointsSpent: value,
        pointsRemaining: user.points,
        daysAdded: days,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({
      status: "failed",
      message: "Subscription renewal failed",
    });
  }
});

router.get("/app_info", async (req, res) => {
  const appInfo = await AppInfo.findOne({ ID: "APP" });

  if (!appInfo)
    return res
      .status(422)
      .send({ status: "failed", message: "App info not found!" });

  res.send({ status: "success", data: appInfo });
});

router.put("/updateProfile", auth, async (req, res) => {
  const userId = req.user.userId;

  const userData = req.body;

  const update_object = {};

  const getNameVal = ["state", "lga", "preffix", "schoolLevel"];

  Object.entries(userData).map(([key, val]) => {
    update_object[key] = getNameVal.includes(key) ? val?.name : val;
  });

  const preffix = update_object?.preffix;

  if (update_object["gender"]) {
    update_object["gender"] = update_object["gender"]?.name;
  }

  if (Boolean(preffix)) {
    if (preffix == "mr.") {
      update_object["gender"] = "male";
    } else if (["ms.", "mrs."].includes(preffix)) {
      update_object["gender"] = "female";
    }
  }

  if (update_object["class"]) {
    update_object["class"] = {
      hasChanged: true,
      level: update_object["class"]?.name?.toLowerCase(),
    };
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $set: update_object,
    },
    {
      new: true,
    }
  ).select(fullUserSelector);

  res.json({ user: updatedUser });
});

router.get("/user_stats", auth, async (req, res) => {
  const userId = req.user.userId;
  const A_DAY = 1000 * 60 * 60 * 24;
  const A_WEEK = 1000 * 60 * 60 * 24 * 7;

  try {
    const userInfo = await User.findById(userId)
      .select("quota quotas points totalPoints qBank")
      .populate("quota.subjects.subject", "name")
      .populate("quota.daily_subjects.subject", "name")
      .lean();

    if (!userInfo) {
      return res.status(404).send({
        status: "failed",
        message: "User not found",
      });
    }

    const currentQuota = userInfo.quota;
    const isToday =
      currentQuota && new Date() - new Date(currentQuota.daily_update) < A_DAY;
    const isThisWeek =
      currentQuota &&
      new Date() - new Date(currentQuota.weekly_update) < A_WEEK;

    // Daily stats
    const dailyStats = {
      questionsAnswered: isToday ? currentQuota.daily_questions_count || 0 : 0,
      questionsRemaining:
        100 - (isToday ? currentQuota.daily_questions_count || 0 : 0),
      subjectsAnswered: isToday
        ? (currentQuota.daily_subjects || []).map((s) => ({
            subject: s.subject,
            questionsCount: s.questions_count,
            remainingQuestions: 50 - s.questions_count,
          }))
        : [],
      canAnswerMore: isToday
        ? (currentQuota.daily_questions_count || 0) < 100
        : true,
      lastUpdate: isToday ? currentQuota.daily_update : null,
    };

    // Weekly stats
    const weeklyStats = {
      pointsEarned: isThisWeek ? currentQuota.point_per_week || 0 : 0,
      questionsAnswered: isThisWeek
        ? currentQuota.daily_questions?.length || 0
        : 0,
      subjectsCount: isThisWeek
        ? new Set(currentQuota.subjects?.map((s) => s.subject.toString())).size
        : 0,
      weekStart: isThisWeek ? currentQuota.weekly_update : null,
    };

    // Overall stats
    const overallStats = {
      totalPoints: userInfo.totalPoints || 0,
      currentPoints: userInfo.points || 0,
      totalQuestionsAnswered: userInfo.qBank?.length || 0,
      weeklyHistory:
        userInfo.quotas?.map((q) => ({
          weekStart: q.weekly_update,
          pointsEarned: q.point_per_week,
          questionsAnswered: q.daily_questions?.length || 0,
        })) || [],
    };

    res.send({
      status: "success",
      data: {
        daily: dailyStats,
        weekly: weeklyStats,
        overall: overallStats,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(422).send({
      status: "failed",
      message: "Failed to fetch stats",
      error: err.message,
    });
  }
});

router.get("/check_limits", auth, async (req, res) => {
  const userId = req.user.userId;
  const A_DAY = 1000 * 60 * 60 * 24;

  try {
    const userInfo = await User.findById(userId)
      .select("quota")
      .populate("quota.daily_subjects.subject", "name")
      .lean();

    if (!userInfo) {
      return res.status(404).send({
        status: "failed",
        message: "User not found",
      });
    }

    const currentQuota = userInfo.quota;
    const isToday =
      currentQuota && new Date() - new Date(currentQuota.daily_update) < A_DAY;

    const dailyQuestionsCount = isToday
      ? currentQuota.daily_questions_count || 0
      : 0;
    const dailySubjects = isToday ? currentQuota.daily_subjects || [] : [];

    res.send({
      status: "success",
      data: {
        totalQuestionsRemaining: 100 - dailyQuestionsCount,
        totalQuestionsAnswered: dailyQuestionsCount,
        maxQuestionsPerDay: 100,
        maxQuestionsPerSubject: 50,
        maxSubjectsPerDay: 2,
        subjectsToday: dailySubjects.map((s) => ({
          subject: s.subject,
          questionsAnswered: s.questions_count,
          questionsRemaining: 50 - s.questions_count,
        })),
        canAnswerMore: dailyQuestionsCount < 100,
        canAddSubject: dailySubjects.length < 2,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(422).send({
      status: "failed",
      message: "Failed to check limits",
      error: err.message,
    });
  }
});

/**
 * GET /api/users/suggestions/friends
 * Smart friend suggestions based on multiple criteria
 */
router.get("/suggestions", auth, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const {
      limit = 20,
      offset = 0,
      accountType, // Optional filter by account type
    } = req.query;

    // Get current user with all relationship data
    const currentUser = await User.findById(currentUserId)
      .select("following followers school class.level subjects accountType")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Build exclusion list (users to NOT suggest)
    const excludedUserIds = new Set([
      currentUserId.toString(),
      ...(currentUser.following || []).map((id) => id.toString()),
      ...(currentUser.followers || []).map((id) => id.toString()),
    ]);

    // Build match criteria with scoring weights
    const matchPipeline = [
      // Exclude current user and existing connections
      {
        $match: {
          _id: {
            $nin: Array.from(excludedUserIds).map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
          // isActive: true, // Only active users
        },
      },

      // Add calculated scoring fields
      {
        $addFields: {
          // Different school bonus (encourage cross-school connections)
          differentSchoolScore: {
            $cond: [
              {
                $and: [
                  { $ne: [currentUser.school, null] },
                  { $ne: ["$school", null] },
                  { $ne: ["$school", currentUser.school] },
                ],
              },
              20,
              1,
            ],
          },

          // Same state/region score (proximity matters)
          sameRegionScore: {
            $cond: [
              {
                $and: [
                  { $ne: [currentUser.state, null] },
                  { $eq: ["$state", currentUser.state] },
                ],
              },
              15,
              0,
            ],
          },

          // Class level match score (academic peer level)
          classScore: {
            $cond: [
              {
                $and: [
                  { $ne: [currentUser.class?.level, null] },
                  { $eq: ["$class.level", currentUser.class?.level] },
                ],
              },
              25,
              0,
            ],
          },

          // Account type match score
          accountTypeScore: {
            $cond: [{ $eq: ["$accountType", currentUser.accountType] }, 10, 0],
          },

          // Mutual followers score (STRONGEST social proof)
          mutualFollowersCount: {
            $size: {
              $ifNull: [
                {
                  $setIntersection: [
                    { $ifNull: ["$followers", []] },
                    currentUser.following || [],
                  ],
                },
                [],
              ],
            },
          },

          // Mutual following score (bidirectional connections)
          mutualFollowingCount: {
            $size: {
              $ifNull: [
                {
                  $setIntersection: [
                    { $ifNull: ["$following", []] },
                    currentUser.following || [],
                  ],
                },
                [],
              ],
            },
          },

          // People who follow YOU that also follow this user (strong relevance)
          yourFollowersAlsoFollowCount: {
            $size: {
              $ifNull: [
                {
                  $setIntersection: [
                    { $ifNull: ["$followers", []] },
                    currentUser.followers || [],
                  ],
                },
                [],
              ],
            },
          },

          // People YOU follow who also follow this user (discovered through network)
          followedByYourNetworkCount: {
            $size: {
              $ifNull: [
                {
                  $setIntersection: [
                    { $ifNull: ["$followers", []] },
                    currentUser.following || [],
                  ],
                },
                [],
              ],
            },
          },
        },
      },

      // Calculate mutual connection score (HIGHEST WEIGHT - Social Proof)
      {
        $addFields: {
          mutualConnectionScore: {
            $add: [
              { $multiply: ["$mutualFollowersCount", 8] }, // People you both follow
              { $multiply: ["$mutualFollowingCount", 8] }, // People who follow both
              { $multiply: ["$followedByYourNetworkCount", 6] }, // Followed by your connections
              { $multiply: ["$yourFollowersAlsoFollowCount", 5] }, // Your followers like them too
            ],
          },
        },
      },

      // Popular user bonus (social proof through follower count)
      {
        $addFields: {
          popularityScore: {
            $cond: [
              { $gte: [{ $size: { $ifNull: ["$followers", []] } }, 50] },
              15,
              {
                $cond: [
                  { $gte: [{ $size: { $ifNull: ["$followers", []] } }, 20] },
                  10,
                  {
                    $cond: [
                      {
                        $gte: [{ $size: { $ifNull: ["$followers", []] } }, 10],
                      },
                      5,
                      0,
                    ],
                  },
                ],
              },
            ],
          },
        },
      },

      // High performer bonus (top students get visibility)
      {
        $addFields: {
          performanceScore: {
            $cond: [
              { $gte: ["$totalPoints", 10000] },
              20,
              {
                $cond: [
                  { $gte: ["$totalPoints", 5000] },
                  15,
                  {
                    $cond: [
                      { $gte: ["$totalPoints", 2000] },
                      10,
                      {
                        $cond: [{ $gte: ["$totalPoints", 500] }, 5, 0],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },

      // Active streak bonus (engaged users)
      {
        $addFields: {
          streakScore: {
            $cond: [
              { $gte: ["$streak", 30] },
              15,
              {
                $cond: [
                  { $gte: ["$streak", 14] },
                  10,
                  {
                    $cond: [{ $gte: ["$streak", 7] }, 5, 0],
                  },
                ],
              },
            ],
          },
        },
      },

      // Calculate subject match score (for academic alignment)
      {
        $addFields: {
          subjectScore: {
            $multiply: [
              {
                $size: {
                  $ifNull: [
                    {
                      $setIntersection: [
                        { $ifNull: ["$subjects", []] },
                        currentUser.subjects || [],
                      ],
                    },
                    [],
                  ],
                },
              },
              8,
            ],
          },
        },
      },

      // Calculate activity score based on recent activity
      {
        $addFields: {
          activityScore: {
            $cond: [
              {
                $gte: [
                  "$quota.last_update",
                  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                ],
              },
              10,
              0,
            ],
          },
        },
      },

      // Calculate final relevance score with social proof emphasis
      {
        $addFields: {
          relevanceScore: {
            $add: [
              "$mutualConnectionScore", // 40-100+ points (HIGHEST - social proof)
              "$popularityScore", // 0-15 points (social validation)
              "$performanceScore", // 0-20 points (achievement)
              "$streakScore", // 0-15 points (engagement)
              "$classScore", // 0-25 points (academic peer)
              "$differentSchoolScore", // 0-20 points (cross-school networking)
              "$sameRegionScore", // 0-15 points (geographical relevance)
              "$accountTypeScore", // 0-10 points (user type match)
              "$subjectScore", // 0-40+ points (academic interests)
              "$activityScore", // 0-10 points (recent activity)
            ],
          },
        },
      },

      // Apply optional filters
      ...(accountType ? [{ $match: { accountType } }] : []),

      // Sort by relevance score (highest first)
      { $sort: { relevanceScore: -1, points: -1, createdAt: -1 } },

      // Pagination
      { $skip: parseInt(offset) },
      { $limit: parseInt(limit) },

      // Project only needed fields
      {
        $project: {
          username: 1,
          firstName: 1,
          lastName: 1,
          avatar: 1,
          accountType: 1,
          school: 1,
          "class.level": 1,
          points: 1,
          totalPoints: 1,
          streak: 1,
          verified: 1,
          followers: { $size: { $ifNull: ["$followers", []] } },
          following: { $size: { $ifNull: ["$following", []] } },

          // Include match details for transparency
          matchDetails: {
            relevanceScore: "$relevanceScore",
            socialProof: {
              mutualConnections: "$mutualFollowersCount",
              followedByYourNetwork: "$followedByYourNetworkCount",
              yourFollowersAlsoFollow: "$yourFollowersAlsoFollowCount",
              totalFollowers: { $size: { $ifNull: ["$followers", []] } },
              totalFollowing: { $size: { $ifNull: ["$following", []] } },
            },
            academicMatch: {
              sameClass: { $gt: ["$classScore", 0] },
              classLevel: "$class.level",
              sharedSubjects: {
                $size: {
                  $ifNull: [
                    {
                      $setIntersection: [
                        { $ifNull: ["$subjects", []] },
                        currentUser.subjects || [],
                      ],
                    },
                    [],
                  ],
                },
              },
            },
            networkingValue: {
              fromDifferentSchool: { $gt: ["$differentSchoolScore", 0] },
              sameRegion: { $gt: ["$sameRegionScore", 0] },
              isHighPerformer: { $gte: ["$totalPoints", 2000] },
              hasActiveStreak: { $gte: ["$streak", 7] },
              isRecentlyActive: { $gt: ["$activityScore", 0] },
            },
          },
        },
      },
    ];

    const suggestions = await User.aggregate(matchPipeline);

    // Populate school details if needed
    await User.populate(suggestions, {
      path: "school",
      select: "name type",
    });

    // Get total count for pagination
    const totalCountPipeline = [
      {
        $match: {
          _id: {
            $nin: Array.from(excludedUserIds).map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
          isActive: true,
        },
      },
      ...(accountType ? [{ $match: { accountType } }] : []),
      { $count: "total" },
    ];

    const totalResult = await User.aggregate(totalCountPipeline);
    const totalSuggestions = totalResult.length > 0 ? totalResult[0].total : 0;

    return res.json({
      success: true,
      data: {
        suggestions,
        pagination: {
          total: totalSuggestions,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + suggestions.length < totalSuggestions,
        },
      },
    });
  } catch (error) {
    console.error("Friend suggestions error:", error);
    return res.status(500).json({
      error: "Failed to fetch friend suggestions",
      message: error.message,
    });
  }
});

/**
 * GET /api/users/suggestions/friends/smart
 * Enhanced suggestions with categorized results
 */
router.get("/suggestions/smart", auth, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const currentUser = await User.findById(currentUserId)
      .select("following followers school class.level subjects accountType")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const excludedUserIds = new Set([
      currentUserId.toString(),
      ...(currentUser.following || []).map((id) => id.toString()),
      ...(currentUser.followers || []).map((id) => id.toString()),
    ]);

    // Get categorized suggestions
    const [
      sameschoolUsers,
      sameClassUsers,
      mutualConnectionUsers,
      activeUsers,
    ] = await Promise.all([
      // Same school
      currentUser.school
        ? User.find({
            _id: { $nin: Array.from(excludedUserIds) },
            school: currentUser.school,
            isActive: true,
          })
            .select(
              "username firstName lastName avatar accountType school class.level points verified"
            )
            .populate("school", "name type")
            .limit(10)
            .lean()
        : [],

      // Same class level
      currentUser.class?.level
        ? User.find({
            _id: { $nin: Array.from(excludedUserIds) },
            "class.level": currentUser.class.level,
            isActive: true,
          })
            .select(
              "username firstName lastName avatar accountType class.level points verified"
            )
            .limit(10)
            .lean()
        : [],

      // Mutual connections (people followed by people you follow)
      User.find({
        _id: { $nin: Array.from(excludedUserIds) },
        followers: { $in: currentUser.following || [] },
        isActive: true,
      })
        .select(
          "username firstName lastName avatar accountType points verified followers"
        )
        .limit(10)
        .lean(),

      // Recently active users
      User.find({
        _id: { $nin: Array.from(excludedUserIds) },
        "quota.last_update": {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
        isActive: true,
      })
        .select(
          "username firstName lastName avatar accountType points verified streak"
        )
        .sort({ "quota.last_update": -1 })
        .limit(10)
        .lean(),
    ]);

    return res.json({
      success: true,
      data: {
        categories: {
          sameSchool: {
            title: "From Your School",
            users: sameschoolUsers,
            count: sameschoolUsers.length,
          },
          sameClass: {
            title: "In Your Class",
            users: sameClassUsers,
            count: sameClassUsers.length,
          },
          mutualConnections: {
            title: "People You May Know",
            users: mutualConnectionUsers,
            count: mutualConnectionUsers.length,
          },
          recentlyActive: {
            title: "Recently Active",
            users: activeUsers,
            count: activeUsers.length,
          },
        },
      },
    });
  } catch (error) {
    console.error("Smart friend suggestions error:", error);
    return res.status(500).json({
      error: "Failed to fetch smart suggestions",
      message: error.message,
    });
  }
});

module.exports = router;
