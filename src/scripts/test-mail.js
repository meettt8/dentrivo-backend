import 'dotenv/config';
import { sendEmail } from '../utils/mailer.js';
import notificationService from '../services/NotificationService.js';

async function main() {
  const targetRecipient = process.argv[2];

  console.log('================================================================');
  console.log('       Dentrivo Brevo HTTP API Verification Script              ');
  console.log('================================================================');
  console.log(`BREVO_API_KEY:  ${process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.slice(0, 15) + '...' : '(NOT SET)'}`);
  console.log(`MAIL_FROM:      ${process.env.MAIL_FROM || process.env.MAIL_FROM_ADDRESS || '(NOT SET)'}`);
  console.log(`MAIL_FROM_NAME: ${process.env.MAIL_FROM_NAME || 'Dentrivo'}`);
  console.log('----------------------------------------------------------------');

  if (!process.env.BREVO_API_KEY) {
    console.error('❌ Error: BREVO_API_KEY is not set in .env.');
    console.log('Create an API key in Brevo under SMTP & API > API Keys (v3 API key).');
    process.exit(1);
  }

  console.log('Connecting to Brevo HTTP API (Port 443 HTTPS)...');
  const verification = await notificationService.verifyConnection();

  if (!verification.success) {
    console.error(`\n❌ Brevo API Verification Failed:\n   ${verification.message}\n`);
    console.log('Troubleshooting tips:');
    console.log('1. Make sure you are using an API Key created under Brevo > SMTP & API > API Keys.');
    console.log('2. Ensure MAIL_FROM is a sender verified under Brevo > Senders & IP.');
    process.exit(1);
  }

  console.log(`✅ ${verification.message}\n`);

  if (targetRecipient) {
    console.log(`Sending test email via Brevo HTTP API to: ${targetRecipient}...`);
    try {
      const result = await sendEmail({
        to: targetRecipient,
        subject: 'Dentrivo - Brevo HTTP API Integration Test',
        text: 'Hello! This is a test email from Dentrivo to verify that your Brevo HTTP API integration is working in Production.',
        html: `<div style="font-family:sans-serif; padding:20px; color:#1e293b; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0;">
          <h2 style="color:#0891b2; margin-top:0;">Dentrivo Dental Clinic</h2>
          <p style="font-size:16px;">Congratulations! Your Brevo HTTP API email service is <strong>fully functional</strong> and sending real emails over HTTPS.</p>
          <hr style="border:none; border-top:1px solid #cbd5e1; margin:20px 0;" />
          <p style="font-size:12px; color:#64748b;">Dentrivo Dental AI Platform &bull; Automated System Verification</p>
        </div>`,
      });
      console.log(`✅ Test email dispatched successfully to ${targetRecipient}!`);
      console.log('Brevo response:', result);
    } catch (err) {
      console.error(`❌ Failed to send test email: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('💡 Tip: Pass an email address to send a test message:');
    console.log('   node src/scripts/test-mail.js your-email@example.com\n');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
