/**
 * Server-side plan catalogue: the ONLY place that decides how many days a
 * given amount buys. The client used to send `days` and the server trusted it.
 *
 * !! SYNC THIS with `subDropdown` / `subSchoolDrop` in the app's dataStore. !!
 * (Seeded from the amounts the old /subscribe route used.)
 *
 * ENFORCE_PLAN_CATALOG=true  -> reject anything not in this list
 * otherwise (default)        -> accept, but log a warning on mismatch
 * Ship in warn mode, check the logs, fix the list, then switch to enforce.
 */
const student = [];
for (let n = 1; n <= 12; n++) student.push({ amount: 2000 * n, days: 30 * n });

const school = [
  { amount: 10000, days: 90 },
  { amount: 20000, days: 180 },
  { amount: 30000, days: 270 },
];

const PLANS = { student, school };

const listFor = (type) => (type === "school" ? PLANS.school : PLANS.student);

const findPlan = (type, amount, days) =>
  listFor(type).find(
    (p) => p.amount === Number(amount) && p.days === Number(days),
  ) || null;

const findPlanByAmount = (type, amount) =>
  listFor(type).find((p) => p.amount === Number(amount)) || null;

const ENFORCE = () => process.env.ENFORCE_PLAN_CATALOG === "true";

module.exports = { PLANS, findPlan, findPlanByAmount, ENFORCE };
