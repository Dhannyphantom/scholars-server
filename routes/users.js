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
} = require("../controllers/helpers");
const { AppInfo } = require("../models/AppInfo");

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
  // let referalToken = generateReferralToken(userData.username);
  // let checker = await User.findOne({
  //   _id: { $ne: userData._id },
  //   "rewards.code": referalToken,
  // });

  // while (Boolean(checker)) {
  //   referalToken = generateReferralToken(userData.username);
  //   checker = await User.findOne({
  //     _id: { $ne: userData._id },
  //     "rewards.code": referalToken,
  //   });
  // }

  // userData.rewards = {
  //   code: referalToken,
  //   history: [
  //     {
  //       title: "Account Creation",
  //       point: 50,
  //       status: "pending",
  //     },
  //   ],
  //   point: 0,
  // };
  // await userData.save();

  res.json({ user: userData });
});

router.get("/userInfo", auth, async (req, res) => {
  const { userId } = req.query;

  const userData = await User.findById(userId).select(userSelector);

  if (!userData)
    return res.status(422).json("User data not found. Please sign in again");

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

module.exports = router;
