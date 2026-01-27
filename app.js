require("dotenv").config();
require("express-async-errors");
const { Server } = require("socket.io");
const express = require("express");
const cors = require("cors");
const path = require("path");

const error = require("./middlewares/error");

const app = express();
const http = require("http").createServer(app);

const io = new Server(http, {
  cors: {
    origin: "*",
  },
});

const bodyParser = require("body-parser");
const Joi = require("joi");
Joi.objectId = require("joi-objectid")(Joi);

// Set EJS as the template engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// app.use(cors());
// const cors = require('cors');
app.use(cors({ origin: "*" }));

//ROUTES AND CONTROLLERS
const db = require("./controllers/db");
const users = require("./routes/users");
const payments = require("./routes/payments");
const create = require("./routes/create");
const instance = require("./routes/instance");
const school = require("./routes/school");
const support = require("./routes/support");
const socs = require("./controllers/socs");
const payoutRoutes = require("./routes/payouts");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");
const managerAuth = require("./middlewares/managerAuth");

app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/users", users);
app.use("/payments", payments);
app.use("/create", create);
app.use("/instance", instance);
app.use("/school", school);
app.use("/payouts", payoutRoutes);
app.use("/support", support);
app.use("/analytics", managerAuth, analyticsRoutes);
app.use("/admin", adminRoutes);

app.use(error);

/// FUNCTION EXPORTS
db();
socs(io);
app.set("io", io);
// chat(http, app);

app.get("/", (req, res) => {
  res.send("<h1>Welcome to Guru server</h1>");
});

const port = process.env.PORT || 3000;
http.listen(port, () => console.log(`Server running on port ${port}....`));

// Global Error Handlers
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  // Optional: Shut down gracefully or restart
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason?.code);
  // Optional: Shut down gracefully or restart
});
