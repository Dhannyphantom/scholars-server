// ==========================================
// RECONCILE JOB (jobs/reconcileJob.js)
// ==========================================
// Safety net: even if the user never reopens the app and no webhook arrives,
// every unresolved subscription / payout is re-checked with Flutterwave.
//
//   // in your server entry, after the DB connection is up:
//   require("./jobs/reconcileJob").start();
const mongoose = require("mongoose");
const { sweepAll } = require("../controllers/pendingService");

let timer = null;
let running = false;

async function tick() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const r = await sweepAll();
    if (r.intents || r.payouts) {
      console.log(`[reconcile] checked ${r.intents} payments, ${r.payouts} payouts`);
    }
  } catch (e) {
    console.error("[reconcile] sweep failed:", e);
  } finally {
    running = false;
  }
}

function start({ intervalMs = 2 * 60 * 1000 } = {}) {
  if (timer) return;
  setTimeout(tick, 15 * 1000).unref?.();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[reconcile] started (every ${Math.round(intervalMs / 1000)}s)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
