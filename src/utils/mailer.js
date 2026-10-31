/**
 * Brevo HTTP API Email Sender
 *
 * Sends transactional emails via HTTPS (Port 443) using the Brevo v3 API,
 * bypassing cloud provider SMTP port blocks (e.g. Render free tier blocks ports 25, 465, 587).
 */

export async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM || process.env.MAIL_FROM_ADDRESS;
  const fromName = process.env.MAIL_FROM_NAME || 'Dentrivo';

  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured in environment variables.');
  }
  if (!fromEmail) {
    throw new Error('MAIL_FROM is not configured in environment variables.');
  }

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  };

  if (Array.isArray(attachments) && attachments.length > 0) {
    payload.attachment = attachments.map((att) => {
      let content = att.content;
      if (Buffer.isBuffer(content)) {
        content = content.toString('base64');
      } else if (typeof content === 'string' && !att.isBase64) {
        content = Buffer.from(content).toString('base64');
      }
      return {
        name: att.filename || att.name || 'attachment',
        content,
      };
    });
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Brevo API ${res.status}: ${errorBody}`);
  }

  return res.json();
}

export default sendEmail;
