const nodemailer = require("nodemailer");

// ─── Transporter ──────────────────────────────────────────────────────────────
// Reads credentials from environment variables — never hardcode these.
// Supported out of the box: Gmail, Outlook/Hotmail, Yahoo, SendGrid, Mailgun,
// SES, or any raw SMTP host.

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST, // e.g. "smtp.gmail.com" | "smtp.sendgrid.net"
  port: Number(process.env.MAIL_PORT) || 587,
  secure: process.env.MAIL_SECURE === "true", // true for port 465, false for 587
  auth: {
    user: process.env.MAIL_USER, // your sending address or API user
    pass: process.env.MAIL_PASS, // app password / API key — NOT your account password
  },
  // Uncomment if your host uses a self-signed cert (dev only):
  // tls: { rejectUnauthorized: false },
});

// ─── Verify connection on startup (optional but recommended) ──────────────────
// Logs a clear message so you know immediately if credentials are wrong.
// transporter.verify((err) => {
//   if (err) {
//     console.error("❌ Mailer connection failed:", err.message);
//   } else {
//     console.log("✅ Mailer ready —", process.env.MAIL_HOST);
//   }
// });

module.exports = transporter;

// ─── .env entries needed ──────────────────────────────────────────────────────
//
// MAIL_HOST=smtp.gmail.com
// MAIL_PORT=587
// MAIL_SECURE=false
// MAIL_USER=you@gmail.com
// MAIL_PASS=your_app_password_here
//
// ─── Gmail note ───────────────────────────────────────────────────────────────
// Use an App Password (not your Gmail password).
// Generate one at: https://myaccount.google.com/apppasswords
// Requires 2FA to be enabled on the account.
//
// ─── Popular host values ──────────────────────────────────────────────────────
// Gmail:      smtp.gmail.com        port 587  secure false
// Outlook:    smtp.office365.com    port 587  secure false
// Yahoo:      smtp.mail.yahoo.com   port 587  secure false
// SendGrid:   smtp.sendgrid.net     port 587  secure false  user=apikey
// Mailgun:    smtp.mailgun.org      port 587  secure false
// AWS SES:    email-smtp.<region>.amazonaws.com  port 587  secure false
