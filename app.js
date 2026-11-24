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
const transactionsRoutes = require("./routes/transactions");
const cronRoutes = require("./routes/cron");
const competitionRoutes = require("./routes/competition");
const jambRoutes = require("./routes/jamb");

// ── Admin dashboard integration ──────────────────────────────────────────────
const adminPanel = require("./routes/adminPanel");
const adminPanelGate = require("./routes/adminPanelGate");
const { competitionShim } = require("./middlewares/proGuard");
const {
  suspensionGuard,
  trackActivity,
  auditCompetition,
  startGuard,
} = require("./middlewares/guard");
const {
  trackFeatureUsage,
  trackSocketEvent,
} = require("./middlewares/featureUsage");
const {
  startNotificationWorker,
} = require("./controllers/notificationService");

app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Blocks suspended users/schools on the mobile API + records request-driven activity
app.use(suspensionGuard);
app.use(trackActivity);
// Feature / endpoint usage counters (shown in Admin → Analytics → Features)
app.use(trackFeatureUsage);

// Gate router first: permission guard, professional support desk, permission management
app.use("/admin-panel", adminPanelGate);
app.use("/admin-panel", adminPanel);

app.use("/users", users);
app.use("/payments", payments);
app.use("/create", create);
app.use("/instance", instance);
app.use("/school", school);
app.use("/payouts", payoutRoutes);
app.use("/support", support);
app.use("/analytics", analyticsRoutes);
app.use("/transactions", transactionsRoutes);
app.use("/cron", cronRoutes);
// Lets permitted professionals use the dashboard's competition tools (checks Access control permissions)
app.use("/competition", competitionShim);
app.use("/competition/manage", auditCompetition); // audit trail for competition management
app.use("/competition", competitionRoutes);
app.use("/admin", adminRoutes);
app.use("/jamb", jambRoutes);
app.use("/api/jamb", jambRoutes);

app.use(error);

/// FUNCTION EXPORTS
db();
startGuard();
startNotificationWorker();
socs(io);
// Count meaningful socket events (multiplayer quiz, support chat) as feature usage
io.on("connection", (socket) => {
  socket.on("register_user", (id) => {
    socket.data.userId = id;
  });
  socket.onAny((event) => trackSocketEvent(event, socket.data.userId));
});
app.set("io", io);
require("./jobs/reconcileJob").start();
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
