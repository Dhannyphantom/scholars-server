const { Expo } = require("expo-server-sdk");
const ejs = require("ejs");
const path = require("path");
const { User } = require("../models/User");
const { School } = require("../models/School");
const { ScheduledNotification } = require("../models/AdminMisc");
const { sendMail } = require("./mailer");
const { esc, cap } = require("./adminHelpers");

const SELECT = "firstName lastName username email expoPushToken subscription";
const premiumQ = () => ({ "subscription.isActive": true, "subscription.expiry": { $gt: new Date() } });

/** Mongo filter for an audience; throws Error('...') when a single target cannot be found */
async function audienceFilter({ type, value }) {
  switch (type) {
    case "all": return {};
    case "students": return { accountType: "student" };
    case "teachers": return { accountType: "teacher" };
    case "premium": return premiumQ();
    case "freemium": return { $nor: [premiumQ()] };
    case "school": {
      const s = await School.findOne({ name: new RegExp(`^${esc(String(value || "").trim())}$`, "i") }).select("name students.user teachers.user").lean();
      if (!s) throw new Error(`School "${value}" not found`);
      return { _id: { $in: [...s.students.map((x) => x.user), ...s.teachers.map((x) => x.user)] } };
    }
    case "user": {
      const u = await User.findOne({ username: String(value || "").replace(/^@/, "").toLowerCase() }).select("_id").lean();
      if (!u) throw new Error(`User "${value}" not found`);
      return { _id: u._id };
    }
    default: throw new Error("Unknown audience");
  }
}
const audienceLabel = ({ type, value }) =>
  ({ all: "All users", students: "All students", teachers: "All teachers", premium: "Premium users", freemium: "Freemium users" }[type] ||
  (type === "school" ? `School: ${value}` : `User: @${String(value).replace(/^@/, "")}`));

// Safe placeholders only — admin input is never evaluated as EJS
const personalise = (str = "", u) =>
  String(str)
    .replace(/<%=\s*user\.firstName\s*%>|\{\{\s*firstName\s*\}\}/g, cap(u.firstName) || cap(u.username) || "there")
    .replace(/<%=\s*user\.lastName\s*%>|\{\{\s*lastName\s*\}\}/g, cap(u.lastName))
    .replace(/<%=\s*user\.username\s*%>|\{\{\s*username\s*\}\}/g, u.username || "");

async function sendPush(users, p) {
  const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN, useFcmV1: true });
  const msgs = users
    .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
    .map((u) => ({
      to: u.expoPushToken,
      title: personalise(p.title, u),
      subtitle: p.subtitle || undefined,
      body: personalise(p.message, u),
      data: { ...(p.data || {}), channel: p.channel || "General" },
      sound: p.sound === "none" ? null : p.sound || "default",
      priority: p.priority || "default",
      ttl: p.ttl ? Number(p.ttl) : undefined,
      badge: p.badge !== "" && p.badge != null ? Number(p.badge) : undefined,
      categoryId: p.category || undefined,
      channelId: p.channel || "General",
      richContent: p.image ? { image: p.image } : undefined,
    }));
  let sent = 0, failed = 0;
  for (const chunk of expo.chunkPushNotifications(msgs)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((t) => (t.status === "ok" ? sent++ : failed++));
    } catch { failed += chunk.length; }
  }
  return { total: users.length, sent, failed: failed + (users.length - msgs.length) };
}

async function sendEmails(users, p) {
  const variant = ["announcement", "promo", "results"].includes(p.template) ? p.template : "announcement";
  const list = users.filter((u) => u.email);
  let sent = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      try {
        const html = await ejs.renderFile(path.join(__dirname, "../views/admin_mail.ejs"), {
          variant, appName: "Guru EduTech", supportEmail: process.env.MAIL_FROM, year: new Date().getFullYear(),
          heading: personalise(p.heading, u), message: personalise(p.message, u), ctaLabel: p.ctaLabel || "", ctaUrl: p.ctaUrl || "",
        });
        (await sendMail({ to: u.email, subject: personalise(p.subject, u), html })) ? sent++ : failed++;
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return { total: users.length, sent, failed: failed + (users.length - list.length) };
}

async function processNotification(id) {
  const job = await ScheduledNotification.findOneAndUpdate({ _id: id, status: "pending" }, { status: "processing" }, { new: true });
  if (!job) return;
  try {
    const filter = await audienceFilter(job.audience);
    const users = await User.find(filter).select(SELECT).lean();
    const result = job.channel === "push" ? await sendPush(users, job.payload) : await sendEmails(users, job.payload);
    await ScheduledNotification.updateOne({ _id: id }, { status: "sent", result });
  } catch (e) {
    await ScheduledNotification.updateOne({ _id: id }, { status: "failed", "result.error": e.message });
  }
}

const startNotificationWorker = () =>
  setInterval(async () => {
    try {
      const due = await ScheduledNotification.find({ status: "pending", runAt: { $lte: new Date() } }).select("_id").limit(10).lean();
      for (const d of due) await processNotification(d._id);
    } catch (e) { console.error("[notify worker]", e.message); }
  }, 30 * 1000).unref();

module.exports = { audienceFilter, audienceLabel, processNotification, startNotificationWorker };
