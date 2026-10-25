import 'dotenv/config';
import config from '../config/index.js';
import notificationService from '../services/NotificationService.js';

async function main() {
  const targetRecipient = process.argv[2];

  console.log('================================================================');
  console.log('       Dentrivo Production Mail Verification Script            ');
  console.log('================================================================');
  console.log(`Mailer Driver:  ${config.mail.mailer}`);
  console.log(`SMTP Host:      ${config.mail.host}`);
  console.log(`SMTP Port:      ${config.mail.port}`);
  console.log(`SMTP Username:  ${config.mail.username ? config.mail.username : '(NOT SET - required for Brevo)'}`);
  console.log(`SMTP Password:  ${config.mail.password ? config.mail.password.slice(0, 15) + '...' : '(NOT SET)'}`);
  console.log(`From Address:   ${config.mail.fromAddress}`);
  console.log(`From Name:      ${config.mail.fromName}`);
  console.log('----------------------------------------------------------------');

  if (config.mail.mailer === 'log') {
    console.log('⚠️  Notice: MAIL_MAILER is set to "log". Set MAIL_MAILER=smtp to test real SMTP delivery.');
    process.exit(0);
  }

  if (!config.mail.username) {
    console.error('❌ Error: MAIL_USERNAME is empty. For Brevo, specify your Brevo account email/login in .env.');
    process.exit(1);
  }

  console.log('Connecting to SMTP server and verifying authentication...');
  const verification = await notificationService.verifyConnection();

  if (!verification.success) {
    console.error(`\n❌ SMTP Connection Failed:\n   ${verification.message}\n`);
    console.log('Troubleshooting tips:');
    console.log('1. Check that MAIL_USERNAME matches your Brevo SMTP Login under "SMTP & API" in Brevo.');
    console.log('2. Ensure your Brevo account has completed email verification.');
    console.log('3. Ensure port 587 is not blocked by your local firewall or cloud provider.');
    process.exit(1);
  }

  console.log('✅ SMTP connection and authentication SUCCESSFUL!\n');

  if (targetRecipient) {
    console.log(`Sending test email to: ${targetRecipient}...`);
    try {
      await notificationService.sendEmail(
        targetRecipient,
        'Dentrivo - SMTP Integration Test',
        'Hello! This is a test email from Dentrivo to verify that your Brevo SMTP integration is working in Production.',
        `<div style="font-family:sans-serif; padding:20px; color:#1e293b; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0;">
          <h2 style="color:#0891b2; margin-top:0;">Dentrivo Dental Clinic</h2>
          <p style="font-size:16px;">Congratulations! Your Brevo SMTP email service is <strong>fully functional</strong> and sending real emails in Production.</p>
          <hr style="border:none; border-top:1px solid #cbd5e1; margin:20px 0;" />
          <p style="font-size:12px; color:#64748b;">Dentrivo Dental AI Platform &bull; Automated System Verification</p>
        </div>`
      );
      console.log(`✅ Test email dispatched successfully to ${targetRecipient}!`);
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
