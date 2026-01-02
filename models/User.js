const mongoose = require("mongoose");
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const { classsSchoolEnums } = require("../controllers/helpers");

const schema = mongoose.Schema;

//
const DEFAULT_SUB_MILLI = 1000 * 60 * 60 * 24 * 2; // 2 DAYS

const mediaDataSchema = new schema({
  uri: {
    type: String,
    maxlength: 1024,
    required: true,
  },
  type: {
    type: String,
    // enum: ["image", "video", "text"],
    default: "image",
    maxlength: 255,
  },
  thumb: {
    type: String,
    maxlength: 1024,
  },
  width: {
    type: Number,
    required: true,
  },
  height: {
    type: Number,
    required: true,
  },
});

const cardSchema = new schema({
  first_6digits: {
    type: String,
    required: false,
  },
  last_4digits: {
    type: String,
    required: false,
  },
  issuer: {
    type: String,
    required: false,
  },
  country: {
    type: String,
    required: false,
  },
  type: {
    type: String,
    required: false,
  },
  expiry: {
    type: String,
    required: false,
  },
});

const studentSubjectsSchema = new schema({
  subject: {
    type: mongoose.Types.ObjectId,
    ref: "Subject",
  },
  date: {
    type: Date,
    default: Date.now,
  },
  questions: [{ type: mongoose.Types.ObjectId, ref: "Question" }], //For the whole week
});

const txHistorySchema = new schema({
  type: {
    type: String,
    enum: ["withdrawal", "subscription"],
    required: false,
  },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  date: {
    type: Date,
    required: false,
  },
  message: {
    type: String,
    maxlength: 255,
    required: false,
  },
  tx: {
    card: {
      type: cardSchema,
      required: false,
    },
    id: {
      type: Number,
      required: false,
    },
    customerId: {
      type: Number,
      required: false,
    },
  },
  tx_ref: {
    type: String,
    maxlength: 255,
    required: false,
  },
  flw_ref: {
    type: String,
    maxlength: 255,
    required: false,
  },
  amount: {
    type: Number,
    required: false,
  },
});

const rewardSchema = new schema({
  title: {
    type: String,
    required: true,
  },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
  },
  point: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    required: true,
    enum: ["pending", "rewarded"],
  },
});

const quotaSchema = new schema({
  last_update: {
    // Per Quiz Done
    type: Date,
    default: Date.now,
  },
  daily_update: {
    // Per Day
    type: Date,
    default: Date.now,
  },
  weekly_update: {
    // Per Week
    type: Date,
    default: Date.now,
  },
  point_per_week: {
    // Points per week
    type: Number,
    default: 0,
  },
  daily_questions: {
    // For the whole week
    type: [schema.Types.ObjectId],
    ref: "Question",
  },
  subjects: [studentSubjectsSchema],
});

const userSchema = new schema({
  avatar: {
    image: mediaDataSchema,
    lastUpdate: {
      type: Date,
      default: Date.now,
    },
  },
  address: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  accountType: {
    type: String,
    enum: ["teacher", "student", "professional", "manager"],
    required: true,
  },
  birthday: {
    type: Date,
    required: false,
  },
  state: {
    type: String,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  country: {
    type: String,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  class: {
    level: {
      type: String,
      enum: classsSchoolEnums,
      required: false,
    },
    hasChanged: {
      type: Boolean,
      default: false,
    },
  },
  expoPushToken: {
    type: String,
  }, // store user's device push token here
  email: {
    type: String,
    required: true,
    unique: true,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 4,
    maxlength: 1024,
    trim: true,
  },
  firstName: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  lastName: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  contact: {
    type: String,
    minlength: 4,
    maxlength: 15,
    trim: true,
  },
  points: {
    type: Number,
    min: 0,
    default: 0,
  },
  schoolPoints: {
    type: Number,
    min: 0,
    default: 0,
  },
  preffix: {
    type: String,
    required: false,
    enum: ["mr.", "ms.", "mrs.", ""],
  },
  totalPoints: {
    type: Number,
    min: 0,
    default: 0,
  },
  streak: {
    type: Number,
    min: 0,
    default: 0,
  },
  school: {
    type: schema.Types.ObjectId,
    ref: "School",
  },
  subscription: {
    current: {
      type: Date,
      default: new Date(new Date().getTime() - DEFAULT_SUB_MILLI),
    },
    expiry: {
      type: Date,
      default: new Date(new Date().getTime() - DEFAULT_SUB_MILLI),
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  schoolLevel: {
    type: String,
    required: false,
    enum: ["junior", "senior"],
  },
  subjects: {
    // FOR PROFESSIONAL
    type: [schema.Types.ObjectId],
    ref: "Subejct",
  },
  following: {
    // FOR PROFESSIONAL
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  followers: {
    // FOR PROFESSIONAL
    type: [schema.Types.ObjectId],
    ref: "User",
  },
  gender: {
    type: String,
    enum: ["male", "Male", "female", "Female", "others", "Others"],
    lowercase: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    minlength: 2,
    maxlength: 20,
    trim: true,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean, // NOT FULLY FUNCTIONAL YET
    default: false,
  },

  rewards: new schema({
    point: {
      type: Number,
      default: 0,
    },
    code: {
      type: String,
      required: true,
    },
    history: [rewardSchema],
  }),

  tx_history: [txHistorySchema],
  rank: {
    type: String,
    default: "beginner",
  },
  tokens: {
    mailToken: {
      type: Number,
      min: 0,
      default: 0,
    },
    pushToken: {
      token: {
        type: String,
      },
      state: {
        type: String,
        enum: ["registered", "unregistered"],
        default: "unregistered",
      },
    },
  },
  lga: {
    type: String,
    required: false,
  },
  quota: quotaSchema,
  quotas: [quotaSchema],
  qBank: {
    type: [schema.Types.ObjectId],
    ref: "Question",
    default: [],
  },
});

userSchema.methods.generateAuthToken = function () {
  return jwt.sign({ userId: this._id }, process.env.JWT_KEY);
};

userSchema.virtual("fullName").get(function () {
  if (Boolean(this.firsName) && Boolean(this.lastName)) {
    return `${this.firstName} ${this.lastName}`;
  }
});

userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });

const validateReg = (user) => {
  const schema = Joi.object({
    username: Joi.string().required().min(4).max(15).trim().lowercase(),
    accountType: Joi.string().required().max(255).alphanum(),
    referral: Joi.string().optional().max(255).alphanum(),
    email: Joi.string().required().min(4).max(255).email().trim(),
    password: Joi.string().required().min(8).max(255).trim(),
    token: Joi.string().optional().min(4).max(25).trim(),
  });

  return schema.validate(user);
};

const validateLog = (user) => {
  const schema = Joi.object({
    username: Joi.string().required().min(4).max(255).trim(),
    password: Joi.string().required().min(4).max(255).trim(),
  });

  return schema.validate(user);
};

const User = mongoose.model("User", userSchema);

module.exports.User = User;
module.exports.validateReg = validateReg;
module.exports.validateLog = validateLog;
module.exports.mediaSchema = mediaDataSchema;
module.exports.txHistorySchema = txHistorySchema;
