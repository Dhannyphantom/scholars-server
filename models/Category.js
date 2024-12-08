const mongoose = require("mongoose");
const Joi = require("joi");
const { mediaSchema } = require("./User");

const schema = mongoose.Schema;

const CategorySchema = new schema({
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  subjects: [{ type: schema.Types.ObjectId, ref: "Subject" }],
  image: mediaSchema,
});

const Category = mongoose.model("Category", CategorySchema);

module.exports.Category = Category;
