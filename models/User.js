const mongoose = require("mongoose");
const Joi = require("joi");
const jwt = require("jsonwebtoken");

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
    enum: ["image", "video", "text"],
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

const txHistorySchema = new schema({
  type: {
    type: String,
    enum: ["withdrawal", "subscription"],
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  message: {
    type: String,
    maxlength: 255,
    required: true,
  },
  tx_ref: {
    type: String,
    maxlength: 255,
    required: true,
  },
  flw_ref: {
    type: String,
    maxlength: 255,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
});

const userSchema = new schema({
  avatar: mediaDataSchema,
  address: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  accountType: {
    type: String,
    enum: ["teacher", "student", "professional"],
    required: true,
  },
  birthday: {
    type: Date,
    required: false,
  },
  state: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  country: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
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
    number: {
      type: Number,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "private",
    },
  },
  points: {
    type: Number,
    min: 0,
    default: 0,
  },
  streak: {
    type: Number,
    min: 0,
    default: 0,
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
  subscription: {
    current: {
      type: Date,
      default: new Date(new Date().getMilliseconds() - DEFAULT_SUB_MILLI),
    },
    expiry: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
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
});

userSchema.methods.generateAuthToken = function () {
  return jwt.sign({ userId: this._id }, process.env.JWT_KEY);
};

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

const validateReg = (user) => {
  const schema = Joi.object({
    username: Joi.string().required().min(4).max(15).trim().lowercase(),
    accountType: Joi.string().required().max(255).alphanum(),
    email: Joi.string().required().min(4).max(255).email().trim(),
    password: Joi.string().required().min(8).max(255).trim(),
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
module.exports.userSelector = "-password -__v";
