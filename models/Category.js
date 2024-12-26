const mongoose = require("mongoose");
const Joi = require("joi");
const { mediaSchema } = require("./User");

const schema = mongoose.Schema;

const CategorySchema = new schema({
  name: {
    type: String,
    required: true,
    unique: true,
    index: true,
    collation: { locale: "en", strength: 2 },
  },
  subjects: [{ type: schema.Types.ObjectId, ref: "Subject" }],
  image: mediaSchema,
});

const Category = mongoose.model("Category", CategorySchema);

module.exports.Category = Category;
