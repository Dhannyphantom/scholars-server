const mongoose = require("mongoose");
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const { classEnums } = require("../controllers/helpers");

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

const txHistorySchema = new schema({
  type: {
    type: String,
    enum: ["withdrawal", "subscription"],
    required: true,
  },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: false,
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
  tx: {
    card: {
      type: cardSchema,
      required: true,
    },
    id: {
      type: Number,
      required: true,
    },
    customerId: {
      type: Number,
      required: true,
    },
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

const rewardSchema = new schema({
  title: {
    type: String,
    required: true,
  },
  point: {
    type: Number,
    required: true,
  },
  claimed: {
    type: Boolean,
    default: false,
  },
});

const quotaSchema = new schema({
  last_update: {
    type: Date,
    default: Date.now,
  },
  daily_update: {
    type: Date,
    default: Date.now,
  },
  daily_questions: {
    type: [schema.Types.ObjectId],
    ref: "Question",
  },
  subjects: {
    subject: {
      type: [schema.Types.ObjectId],
      ref: "Subject",
    },

    questions: {
      type: [schema.Types.ObjectId],
      ref: "Question",
    },
  },
});

const quizSchema = new schema({
  status: {
    type: String,
    enum: ["active", "inactive"],
  },
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
  },
  title: {
    type: String,
    maxlength: 100,
  },
  sessions: [
    {
      date: {
        type: Date,
      },
      participants: {
        user: {
          type: [schema.Types.ObjectId],
          ref: "User",
        },
        score: {
          type: Number,
          default: 0,
        },
      },
    },
  ],
});

const assQuestionSchema = new schema({
  title: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "closed"],
  },
  expiry: {
    type: Date,
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  class: {
    type: [String],
    enum: classEnums,
  },
});

const assignmentSchema = new schema({
  subject: {
    type: schema.Types.ObjectId,
    ref: "Subject",
  },
  list: [assQuestionSchema],
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
  accountDetail: {
    acct_number: {
      type: String,
      maxlength: 50,
    },
    bank_code: {
      type: String,
      maxlength: 4,
    },
    bank_name: {
      type: String,
      maxlength: 255,
    },
    card_number: {
      type: String,
      maxlength: 80,
    },
    card_cvv: {
      type: String,
      maxlength: 4,
    },
    card_exp_month: {
      type: String,
      maxlength: 4,
    },
    card_exp_year: {
      type: String,
      maxlength: 4,
    },
  },
  assignments: [assignmentSchema],
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
  preffix: {
    type: String,
    required: false,
    enum: ["mr.", "ms.", "mrs."],
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
  class: {
    type: String,
    required: false,
  },
  schoolLevel: {
    type: String,
    required: true,
    enum: ["junior", "senior"],
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
    required: true,
  },
  quota: quotaSchema,
  quotas: [quotaSchema],
  quizzes: [quizSchema],
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
module.exports.userSelector = "-password -__v";
