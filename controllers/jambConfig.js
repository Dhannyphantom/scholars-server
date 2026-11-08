// controllers/jambConfig.js
// Single source of truth for the JAMB Score Predictor rules (see JAMB_BACKEND_GUIDE §3).
// (Not placed in a top-level ./config folder on purpose: the `config` npm package
// scans that folder.)

const num = (value, fallback) =>
  value === undefined || value === "" || Number.isNaN(Number(value))
    ? fallback
    : Number(value);

module.exports = {
  SUBJECTS_PER_ROUND: 4,
  TOTAL_SCORE: 400,
  PER_SUBJECT_SCORE: 100,
  COOLDOWN_HOURS: num(process.env.JAMB_COOLDOWN_HOURS, 24), // 0.01 for staging tests
  RANGE_MARGIN: 12, // likely range = predicted ± 12, clamped 0..400
  SECONDS_PER_QUESTION: 20,
  ATTEMPT_GRACE_SECONDS: 120,
  PER_QUESTION_UI_OVERHEAD_SECONDS: 5,
  USE_MOCK_COUNTS: process.env.JAMB_MOCK_COUNTS === "true", // true => English 5 / others 2
  QUESTIONS: { compulsory: 100, other: 50, mockCompulsory: 5, mockOther: 2 },
  MIN_BANK_SIZE_PER_SUBJECT: 60, // not enforced in mock mode
  ATTEMPT_ISSUES_PER_HOUR: 10,
  DB_TOTAL_CACHE_MS: 10 * 60 * 1000,
  HISTORY_IN_SUMMARY: 50,
  RATING_BANDS: [
    { min: 80, label: "Excellent" },
    { min: 65, label: "Very Good" },
    { min: 50, label: "Good" },
    { min: 40, label: "Fair" },
    { min: 0, label: "Needs Work" },
  ],
  LEVELS: [
    { key: "beginner", name: "Beginner", min: 0, max: 499 },
    { key: "amateur", name: "Amateur", min: 500, max: 999 },
    { key: "professional", name: "Professional", min: 1000, max: 1999 },
    { key: "expert", name: "Expert", min: 2000, max: 3999 },
    { key: "ultimate", name: "Ultimate", min: 4000, max: null },
  ],
};
