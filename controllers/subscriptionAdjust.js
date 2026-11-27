// Staff-made subscription changes (gift / deduct days).
// Shared by the single-user, single-school and bulk dashboard routes so they all behave the same.
const DAY = 864e5;

const isLive = (sub, now = new Date()) => !!(sub?.isActive && sub?.expiry && new Date(sub.expiry) > now);

/** 1..3650 or null */
const parseDays = (v) => {
  const d = parseInt(v);
  return d >= 1 && d <= 3650 ? d : null;
};

/**
 * What a change does to one subscription.
 *  action "add":    extends from the current expiry (or from today when expired/freemium)
 *  action "deduct": shortens the expiry; when nothing is left the holder drops to Freemium
 *                   (isActive false, expiry = now). Already-freemium holders are skipped.
 * returns { skip:true } | { isActive, expiry, current?, toFreemium }
 */
function planChange(sub, action, days, now = new Date()) {
  if (action === "deduct") {
    if (!isLive(sub, now)) return { skip: true };
    const next = new Date(new Date(sub.expiry).getTime() - days * DAY);
    const out = next > now ? { isActive: true, expiry: next, toFreemium: false } : { isActive: false, expiry: now, toFreemium: true };
    if (sub.current) out.current = sub.current;
    return out;
  }
  const start = isLive(sub, now) ? new Date(sub.expiry) : now;
  return { isActive: true, expiry: new Date(start.getTime() + days * DAY), current: now, toFreemium: false };
}

const txMessage = (action, days, toFreemium) =>
  action === "deduct" ? `-${days} days (deducted by staff)${toFreemium ? " — moved to Freemium" : ""}` : `+${days} days (granted by staff)`;

module.exports = { DAY, isLive, parseDays, planChange, txMessage };
