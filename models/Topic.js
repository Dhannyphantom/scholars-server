const mongoose = require("mongoose");
const Joi = require("joi");

const schema = mongoose.Schema;

const TopicSchema = new schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  questions: [{ type: schema.Types.ObjectId, ref: "Question" }],
  categories: [{ type: schema.Types.ObjectId, ref: "Category" }],
  subject: { type: schema.Types.ObjectId, ref: "Subject" },
  subjectName: { type: String, trim: true },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  edits: [{ type: schema.Types.ObjectId, ref: "User" }],
});

const Topic = mongoose.model("Topic", TopicSchema);

module.exports.Topic = Topic;
