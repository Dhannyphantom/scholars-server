// Manager-only editor for the single AppInfo document ({ ID: "APP" }) that the mobile app reads from GET /users/app_info.
// Mounted at /admin-panel/app-config by adminPanelGate (after staffAuth + managers-only check).
// PRO_TOKEN is deliberately NOT exposed here: it has its own screen (Pro Tokens) with reveal/rotate history + audit trail.
const express = require("express");
const router = express.Router();
const { AppInfo } = require("../models/AppInfo");
const { record } = require("../controllers/auditService");
const { ok, fail } = require("../controllers/adminHelpers");

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const cmpVer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

// field -> [label, min, max]  (whole numbers only)
const NUMS = {
  POINT_VALUE: ["Point value", 1, 1000000],
  POINT_FAIL: ["Point fail", 0, 1000000],
  STUDENT_SUB: ["Student subscription", 0, 100000000],
  SCHOOL_SUB: ["School subscription", 0, 100000000],
  MAX_WEEK_QUOTA: ["Max weekly quota", 0, 100000000],
  MAX_SUBJECT_PER_WEEK: ["Max subjects per week", 1, 100],
};
// field -> [label, max length]
const STRS = { NAME: ["App name", 40], POINT_VALUE_TEXT: ["Point label", 10] };
const VSTRS = { updateMessage: ["Update message", 300], forceMessage: ["Force-update message", 300] };

const view = (d) => ({
  id: d._id,
  ID: d.ID,
  NAME: d.NAME,
  POINT_VALUE: d.POINT_VALUE,
  POINT_VALUE_TEXT: d.POINT_VALUE_TEXT,
  POINT_FAIL: d.POINT_FAIL,
  STUDENT_SUB: d.STUDENT_SUB,
  SCHOOL_SUB: d.SCHOOL_SUB,
  MAX_WEEK_QUOTA: d.MAX_WEEK_QUOTA,
  MAX_SUBJECT_PER_WEEK: d.MAX_SUBJECT_PER_WEEK,
  VERSION: {
    latestVersion: d.VERSION?.latestVersion ?? "1.0.0",
    minimumSupportedVersion: d.VERSION?.minimumSupportedVersion ?? "1.0.0",
    otaEnabled: d.VERSION?.otaEnabled ?? true,
    updateMessage: d.VERSION?.updateMessage ?? "",
    forceMessage: d.VERSION?.forceMessage ?? "",
  },
});

const load = () => AppInfo.findOne({ ID: "APP" }).lean();

router.get("/", async (req, res) => {
  const d = await load();
  if (!d) return fail(res, 404, "App settings document not found");
  ok(res, view(d));
});

router.put("/", async (req, res) => {
  const body = req.body || {};
  const cur = await load();
  if (!cur) return fail(res, 404, "App settings document not found");

  const set = {};

  for (const [k, [label, max]] of Object.entries(STRS)) {
    if (body[k] === undefined) continue;
    const v = String(body[k]).trim();
    if (!v || v.length > max) return fail(res, 400, `${label} must be 1–${max} characters`);
    set[k] = v;
  }
  for (const [k, [label, min, max]] of Object.entries(NUMS)) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (body[k] === "" || body[k] === null || !Number.isInteger(v) || v < min || v > max)
      return fail(res, 400, `${label} must be a whole number between ${min} and ${max}`);
    set[k] = v;
  }

  const bv = body.VERSION;
  if (bv !== undefined) {
    if (typeof bv !== "object" || bv === null) return fail(res, 400, "Invalid version settings");
    for (const k of ["latestVersion", "minimumSupportedVersion"]) {
      if (bv[k] === undefined) continue;
      const v = String(bv[k]).trim();
      if (!SEMVER.test(v)) return fail(res, 400, `${k === "latestVersion" ? "Latest version" : "Minimum supported version"} must look like 1.2.0`);
      set[`VERSION.${k}`] = v;
    }
    if (bv.otaEnabled !== undefined) {
      if (typeof bv.otaEnabled !== "boolean") return fail(res, 400, "OTA updates must be on or off");
      set["VERSION.otaEnabled"] = bv.otaEnabled;
    }
    for (const [k, [label, max]] of Object.entries(VSTRS)) {
      if (bv[k] === undefined) continue;
      const v = String(bv[k]).trim();
      if (!v || v.length > max) return fail(res, 400, `${label} must be 1–${max} characters`);
      set[`VERSION.${k}`] = v;
    }
    const latest = set["VERSION.latestVersion"] ?? cur.VERSION?.latestVersion;
    const min = set["VERSION.minimumSupportedVersion"] ?? cur.VERSION?.minimumSupportedVersion;
    if (latest && min && SEMVER.test(latest) && SEMVER.test(min) && cmpVer(min, latest) > 0)
      return fail(res, 400, "Minimum supported version can't be higher than the latest version");
  }

  // keep only real changes
  const before = view(cur);
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !(v instanceof Date) ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const was = Object.fromEntries(flat(before));
  const changes = Object.entries(set).filter(([k, v]) => was[k] !== v);
  if (!changes.length) return ok(res, before, { message: "No changes" });

  await AppInfo.updateOne({ ID: "APP" }, { $set: Object.fromEntries(changes) });
  const fresh = await load();

  record(req, {
    action: "Updated app settings",
    target: "AppInfo",
    detail: changes.map(([k, v]) => `${k.replace("VERSION.", "")}: ${was[k]} → ${v}`).join(" · ").slice(0, 500),
    cat: "config",
    meta: { changed: changes.map(([k]) => k) },
  });

  ok(res, view(fresh), { message: "App settings saved" });
});

module.exports = router;
