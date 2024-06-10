const mongoose = require("mongoose");
const Joi = require("joi");
const jwt = require("jsonwebtoken");

const schema = mongoose.Schema;

const mediaDataSchema = new schema({
  uri: {
    type: String,
    maxlength: 1024,
    required: true,
  },
  type: {
    type: String,
    enum: ["image", "video", "text"],
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

const userSchema = new schema({
  avatar: mediaDataSchema,
  address: {
    type: String,
    minlength: 4,
    maxlength: 255,
    lowercase: true,
    trim: true,
  },
  city: {
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
  fullName: {
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
    contactCode: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["public", "private", "weebs"],
      default: "private",
    },
  },
  points: {
    type: Number,
    min: 0,
    default: 0, // CHANGE TO 20 AND GIVE 80 MORE WHEN ACCOUNT IS VERIFIED
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

const validateReg = (user) => {
  const schema = Joi.object({
    username: Joi.string().required().min(4).max(15).trim().lowercase(),
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
