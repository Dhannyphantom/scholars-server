// mailer.js
const SibApiV3Sdk = require("sib-api-v3-sdk");

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const sendMail = async ({ to, subject, html }) => {
  try {
    await apiInstance.sendTransacEmail({
      sender: {
        email: process.env.MAIL_FROM,
        name: "Guru EduTech",
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    });

    console.log("✅ Email sent to", to);
    return true;
  } catch (error) {
    console.error("❌ Mailer error:", error?.response?.body || error.message);
    return false;
  }
};

module.exports = { sendMail };
