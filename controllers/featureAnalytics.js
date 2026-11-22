const { FeatureUsage, FeatureUser } = require("../models/FeatureUsage");
const { flush, FEATURES, dayOf } = require("../middlewares/featureUsage");

const DAY = 864e5;
const r1 = (n) => Math.round((n || 0) * 10) / 10;

async function report(daysIn) {
  const days = Math.min(180, Math.max(1, parseInt(daysIn) || 30));
  await flush().catch(() => {});
  const now = Date.now();
  const from = dayOf(now - (days - 1) * DAY);
  const prevFrom = dayOf(now - (2 * days - 1) * DAY);
  const prevTo = dayOf(now - days * DAY);
  const inRange = { day: { $gte: from } };

  const [cur, prev, usersByFeature, usersByKey, series, active] = await Promise.all([
    FeatureUsage.aggregate([{ $match: inRange }, { $group: { _id: "$key", feature: { $first: "$feature" }, label: { $first: "$label" }, group: { $first: "$group" }, method: { $first: "$method" }, path: { $first: "$path" }, hits: { $sum: "$hits" }, errors: { $sum: "$errors" }, totalMs: { $sum: "$totalMs" }, maxMs: { $max: "$maxMs" } } }]),
    FeatureUsage.aggregate([{ $match: { day: { $gte: prevFrom, $lte: prevTo } } }, { $group: { _id: "$feature", hits: { $sum: "$hits" } } }]),
    FeatureUser.aggregate([{ $match: inRange }, { $group: { _id: { f: "$feature", u: "$user" } } }, { $group: { _id: "$_id.f", n: { $sum: 1 } } }]),
    FeatureUser.aggregate([{ $match: inRange }, { $group: { _id: { k: "$key", u: "$user" } } }, { $group: { _id: "$_id.k", n: { $sum: 1 } } }]),
    FeatureUsage.aggregate([{ $match: inRange }, { $group: { _id: "$day", hits: { $sum: "$hits" } } }]),
    FeatureUser.aggregate([{ $match: inRange }, { $group: { _id: "$user" } }, { $count: "n" }]),
  ]);

  const uF = new Map(usersByFeature.map((x) => [x._id, x.n]));
  const uK = new Map(usersByKey.map((x) => [x._id, x.n]));
  const pv = new Map(prev.map((x) => [x._id, x.hits]));
  const totalHits = cur.reduce((s, x) => s + x.hits, 0);

  const endpoints = cur.map((x) => ({
    key: x._id, method: x.method, path: x.path, feature: x.feature, label: x.label, hits: x.hits,
    users: uK.get(x._id) || 0, errors: x.errors, errorRate: r1((x.errors / x.hits) * 100),
    avgMs: Math.round(x.totalMs / x.hits), maxMs: x.maxMs,
  })).sort((a, b) => b.hits - a.hits);

  const byF = new Map(FEATURES.map((f) => [f.id, { ...f, hits: 0, errors: 0, totalMs: 0, endpoints: 0 }]));
  cur.forEach((x) => {
    const f = byF.get(x.feature) || byF.set(x.feature, { id: x.feature, label: x.label, group: x.group, hits: 0, errors: 0, totalMs: 0, endpoints: 0 }).get(x.feature);
    f.hits += x.hits; f.errors += x.errors; f.totalMs += x.totalMs; f.endpoints++;
  });

  const features = [...byF.values()].map((f) => {
    const prevHits = pv.get(f.id) || 0;
    const share = totalHits ? (f.hits / totalHits) * 100 : 0;
    const errorRate = f.hits ? (f.errors / f.hits) * 100 : 0;
    const avgMs = f.hits ? Math.round(f.totalMs / f.hits) : 0;
    const trend = prevHits >= 5 ? Math.round(((f.hits - prevHits) / prevHits) * 100) : null;
    const flags = [];
    if (!f.hits) flags.push("unused");
    else {
      if (share < 1 && f.hits < 50) flags.push("low");
      if (trend !== null && trend <= -30 && prevHits >= 20) flags.push("declining");
      if (f.hits >= 20 && errorRate >= 10) flags.push("errors");
      if (f.hits >= 10 && avgMs >= 1200) flags.push("slow");
    }
    return { id: f.id, label: f.label, group: f.group, hits: f.hits, users: uF.get(f.id) || 0, share: r1(share), prevHits, trend, errors: f.errors, errorRate: r1(errorRate), avgMs, endpoints: f.endpoints, flags };
  }).filter((f) => f.id !== "other" || f.hits).sort((a, b) => b.hits - a.hits);

  const sm = new Map(series.map((x) => [x._id, x.hits]));
  const daily = Array.from({ length: days }, (_, i) => { const d = dayOf(now - (days - 1 - i) * DAY); return { day: d, hits: sm.get(d) || 0 }; });

  return {
    days,
    totals: { hits: totalHits, activeUsers: active[0]?.n || 0, endpoints: endpoints.length, featuresUsed: features.filter((f) => f.hits).length, features: features.length, attention: features.filter((f) => f.flags.length).length },
    groups: [...new Set(features.map((f) => f.group))],
    features, endpoints: endpoints.slice(0, 200), daily,
  };
}
module.exports = { report };
