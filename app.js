require("dotenv").config();
require("express-async-errors");
const express = require("express");
const cors = require("cors");
const path = require("path");

const error = require("./middlewares/error");

const app = express();
const http = require("http").createServer(app);

const bodyParser = require("body-parser");
const Joi = require("joi");
Joi.objectId = require("joi-objectid")(Joi);

// Set EJS as the template engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(cors());
//ROUTES AND CONTROLLERS
const users = require("./routes/users");
const payments = require("./routes/payments");
const db = require("./controllers/db");

app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/users", users);
app.use("/payments", payments);

app.use(error);

/// FUNCTION EXPORTS
db();
// chat(http, app);

app.get("/", (req, res) => {
  res.send("<h1>Welcome to SCHOLARS server</h1>");
});

const port = process.env.PORT;
http.listen(port, () => console.log(`Server running on port ${port}....`));
