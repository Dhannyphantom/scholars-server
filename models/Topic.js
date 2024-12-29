const mongoose = require("mongoose");
const Joi = require("joi");

const schema = mongoose.Schema;

const TopicSchema = new schema({
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  questions: [{ type: schema.Types.ObjectId, ref: "Question" }],
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

const Topic = mongoose.model("Topic", TopicSchema);

module.exports.Topic = Topic;
