// routes/jamb.js — mounted at /jamb (and /api/jamb) in app.js
const express = require("express");
const router = express.Router();

const svc = require("../controllers/jambService");
const {
  requireAuth,
  requirePremium,
  requireCron,
  jambErrorHandler,
} = require("../middlewares/jambAuth");
const adminAuth = require("../middlewares/adminRoutes");

const uid = (req) => req.user.userId;

// ── Scheduler (shared CRON_SECRET) ─────────────────────────────────────────
router.post("/cron/sweep", requireCron, async (req, res) => {
  res.json(await svc.sweep());
});

// ── Admin: flag which subjects JAMB uses (professional / manager accounts) ─
router.get("/admin/subjects", adminAuth, async (req, res) => {
  res.json(await svc.adminListSubjects());
});
router.put("/admin/subjects/:id", adminAuth, async (req, res) => {
  res.json(await svc.adminUpdateSubject(req.params.id, req.body));
});

// ── Any authenticated user ─────────────────────────────────────────────────
router.use(requireAuth);
router.get("/config", (req, res) => res.json(svc.getConfig()));
router.get("/summary", async (req, res) => {
  res.json(await svc.buildSummary(uid(req)));
});

// ── Premium students only ──────────────────────────────────────────────────
router.use(requirePremium);

router.put("/selection", async (req, res) => {
  res.json(await svc.saveSelection(uid(req), req.body && req.body.subjectIds));
});

router.post("/subjects/performance", async (req, res) => {
  res.json(await svc.subjectPerformance(uid(req), req.body && req.body.subjectIds));
});

router.post("/attempts", async (req, res) => {
  res.json(await svc.issueAttempt(uid(req), req.body && req.body.subjectIds));
});

// must be declared before /attempts/:id
router.get("/attempts/active", async (req, res) => {
  const attempt = await svc.activeAttempt(uid(req));
  if (!attempt) return res.status(204).end();
  res.json(attempt);
});

router.post("/attempts/:id/submit", async (req, res) => {
  res.json(
    await svc.submitAttempt(
      uid(req),
      req.params.id,
      req.body,
      req.header("idempotency-key"),
    ),
  );
});

router.delete("/attempts/:id", async (req, res) => {
  await svc.quitAttempt(uid(req), req.params.id);
  res.status(204).end();
});

router.get("/history", async (req, res) => {
  res.json(await svc.history(uid(req), req.query));
});

router.get("/rounds/:id", async (req, res) => {
  res.json(await svc.getRound(uid(req), req.params.id));
});

if (process.env.NODE_ENV !== "production") {
  router.post("/dev/skip-cooldown", async (req, res) => {
    res.json(await svc.devSkipCooldown(uid(req)));
  });
}

router.use(jambErrorHandler);

module.exports = router;
