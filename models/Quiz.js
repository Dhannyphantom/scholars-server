const mongoose = require("mongoose");
const Joi = require("joi");

const schema = mongoose.Schema;

const QuizSchema = new schema({});

const Quiz = mongoose.model("Quiz", QuizSchema);

module.exports.Quiz = Quiz;
