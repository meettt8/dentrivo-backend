import nodemailer from 'nodemailer';
import dayjs from 'dayjs';
import config from '../config/index.js';
import { Clinic, NotificationLog, NotificationTemplate } from '../models/index.js';

export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const d = dayjs(dateStr);
  return d.isValid() ? d.format('dddd, MMMM D, YYYY') : String(dateStr);
}

export function formatDisplayTime(timeStr) {
  if (!timeStr) return '';
  const str = String(timeStr).trim();
  const parts = str.split(':');
  let h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (Number.isNaN(h)) return str;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Replace `{{merge}}` variables in a template body. */
function render(body, data = {}) {
  let out = body;
  for (const [key, value] of Object.entries(data)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/**
 * HTML Email Template for OTP Verification with Dentrivo Logo & Branding
 */
export function getOtpEmailHtml(code, patientName = 'Patient') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dentrivo - Login OTP Verification</title>
</head>
<body style="margin:0; padding:0; background-color:#090d16; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#090d16; padding:40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px; background-color:#0f172a; border-radius:16px; border:1px solid #1e293b; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
          
          <!-- Header Banner with Logo -->
          <tr>
            <td style="background:#ffffff; padding:32px 30px; text-align:center;">
              <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td style="background:#ffffff; border-radius:12px; padding:10px 18px; display:inline-block;">
                    <span style="font-size:24px; font-weight:900; color:#0891b2; letter-spacing:-0.5px; vertical-align:middle;">
                      <span style="color:#06b6d4;">Dent</span>rivo
                    </span>
                  </td>
                </tr>
              </table>
              <h1 style="color:#121829; font-size:18px; font-weight:700; margin:16px 0 0 0;">
                Dentrivo Dental Clinic
              </h1>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding:35px 30px; text-align:left;">
              <h2 style="color:#ffffff; font-size:20px; font-weight:700; margin:0 0 12px 0;">
                Login Verification Code
              </h2>
              <p style="color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 20px 0;">
                Hello <strong style="color:#f8fafc;">${patientName}</strong>,
              </p>
              <p style="color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 20px 0;">
                Use the following 6-digit OTP code to complete your verification and access your Dentrivo Patient account:
              </p>

              <!-- OTP Code Display Box -->
              <div style="background-color:#1e293b; border:2px dashed #06b6d4; border-radius:12px; padding:24px; text-align:center; margin:25px 0;">
                <span style="font-family:'Courier New', Courier, monospace; font-size:36px; font-weight:800; color:#38bdf8; letter-spacing:10px; display:inline-block;">
                  ${code}
                </span>
              </div>

              <div style="background-color:rgba(6, 182, 212, 0.1); border-left:4px solid #06b6d4; border-radius:4px; padding:12px 16px; margin-bottom:24px;">
                <p style="color:#38bdf8; font-size:13px; font-weight:600; margin:0;">
                  ⏱️ Valid for 5 minutes. Do not share this code with anyone.
                </p>
              </div>

              <p style="color:#64748b; font-size:13px; line-height:1.5; margin:0;">
                If you did not request this verification code, please ignore this email or contact support if you suspect unauthorized access.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#090d16; padding:20px 30px; border-top:1px solid #1e293b; text-align:center;">
              <p style="color:#475569; font-size:12px; margin:0 0 6px 0;">
                © ${new Date().getFullYear()} Dentrivo Dental Platform. All rights reserved.
              </p>
              <p style="color:#334155; font-size:11px; margin:0;">
                Intelligent Care. Effortless Smiles.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * HTML Email Template for Invoice / Billing Statement with PDF attachment
 */
export function getInvoiceEmailHtml(invoice, patient, clinic) {
  const symbol = invoice.currency === 'INR' ? 'Rs.' : '$';
  const clinicName = clinic?.name || 'Dentrivo Dental Clinic';
  const patientName = patient?.name || 'Valued Patient';

  const itemsHtml = (invoice.items && invoice.items.length > 0)
    ? invoice.items.map((item) => `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#f8fafc; font-size:14px;">${item.description}</td>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#94a3b8; font-size:14px; text-align:center;">${item.quantity}</td>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#94a3b8; font-size:14px; text-align:right;">${symbol} ${item.unit_price}</td>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#f8fafc; font-weight:600; font-size:14px; text-align:right;">${symbol} ${item.total}</td>
      </tr>
    `).join('')
    : `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#f8fafc; font-size:14px;">Dental Treatment Services</td>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#94a3b8; font-size:14px; text-align:center;">1</td>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#94a3b8; font-size:14px; text-align:right;">${symbol} ${invoice.subtotal}</td>
        <td style="padding:10px; border-bottom:1px solid #1e293b; color:#f8fafc; font-weight:600; font-size:14px; text-align:right;">${symbol} ${invoice.subtotal}</td>
      </tr>
    `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoice_number}</title>
</head>
<body style="margin:0; padding:0; background-color:#090d16; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#090d16; padding:40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:620px; background-color:#0f172a; border-radius:16px; border:1px solid #1e293b; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background:#000000; padding:30px; text-align:left;">
              <table width="100%">
                <tr>
                  <td>
                    <span style="background:#ffffff; border-radius:10px; padding:8px 14px; display:inline-block; font-size:22px; font-weight:900; color:#0891b2;">
                      <span style="color:#06b6d4;">Dent</span>rivo
                    </span>
                    <h2 style="color:#ffffff; font-size:18px; margin:12px 0 0 0; font-weight:700;">${clinicName}</h2>
                  </td>
                  <td style="text-align:right; vertical-align:top;">
                    <span style="background:rgba(255,255,255,0.2); color:#ffffff; font-size:12px; font-weight:700; padding:4px 12px; border-radius:20px; text-transform:uppercase;">
                      ${invoice.status}
                    </span>
                    <h3 style="color:#ffffff; font-size:16px; margin:8px 0 0 0;">${invoice.invoice_number}</h3>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding:30px;">
              <p style="color:#94a3b8; font-size:15px; margin:0 0 20px 0;">
                Dear <strong style="color:#f8fafc;">${patientName}</strong>,
              </p>
              <p style="color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 24px 0;">
                Thank you for visiting <strong>${clinicName}</strong>. Please find your billing statement details below. Your official invoice PDF document is attached to this email.
              </p>

              <!-- Items Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px; border-collapse:collapse;">
                <thead>
                  <tr style="background-color:#1e293b;">
                    <th style="padding:10px; color:#38bdf8; font-size:13px; text-align:left; font-weight:700;">Description</th>
                    <th style="padding:10px; color:#38bdf8; font-size:13px; text-align:center; font-weight:700;">Qty</th>
                    <th style="padding:10px; color:#38bdf8; font-size:13px; text-align:right; font-weight:700;">Unit Price</th>
                    <th style="padding:10px; color:#38bdf8; font-size:13px; text-align:right; font-weight:700;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>

              <!-- Totals Box -->
              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
                <tr>
                  <td width="50%"></td>
                  <td width="50%">
                    <table width="100%" style="background-color:#1e293b; border-radius:8px; padding:12px 16px;">
                      <tr>
                        <td style="color:#94a3b8; font-size:13px; padding:4px 0;">Subtotal</td>
                        <td style="color:#f8fafc; font-size:13px; text-align:right; padding:4px 0;">${symbol} ${invoice.subtotal}</td>
                      </tr>
                      ${invoice.tax > 0 ? `
                      <tr>
                        <td style="color:#94a3b8; font-size:13px; padding:4px 0;">Tax</td>
                        <td style="color:#f8fafc; font-size:13px; text-align:right; padding:4px 0;">${symbol} ${invoice.tax}</td>
                      </tr>` : ''}
                      ${invoice.discount > 0 ? `
                      <tr>
                        <td style="color:#94a3b8; font-size:13px; padding:4px 0;">Discount</td>
                        <td style="color:#ef4444; font-size:13px; text-align:right; padding:4px 0;">- ${symbol} ${invoice.discount}</td>
                      </tr>` : ''}
                      <tr>
                        <td style="color:#38bdf8; font-weight:700; font-size:15px; padding:8px 0 4px 0; border-top:1px solid #334155;">Total Amount</td>
                        <td style="color:#38bdf8; font-weight:800; font-size:16px; text-align:right; padding:8px 0 4px 0; border-top:1px solid #334155;">${symbol} ${invoice.total}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <div style="background-color:rgba(16, 185, 129, 0.1); border-left:4px solid #10b981; border-radius:4px; padding:12px 16px;">
                <p style="color:#34d399; font-size:13px; font-weight:600; margin:0;">
                  📎 Note: The complete tax invoice PDF is attached to this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#090d16; padding:20px 30px; border-top:1px solid #1e293b; text-align:center;">
              <p style="color:#475569; font-size:12px; margin:0;">
                © ${new Date().getFullYear()} ${clinicName}. Powered by Dentrivo.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getTreatmentBookingEmailHtml(appointment, patient, treatment, doctor, clinic) {
  const clinicName = clinic?.name || 'Dentrivo Dental Clinic';
  const patientName = patient?.name || 'Valued Patient';
  const treatmentName = treatment?.name || 'Dental Consultation';
  const doctorName = doctor?.name ? (doctor.name.startsWith('Dr.') ? doctor.name : `Dr. ${doctor.name}`) : 'Dentrivo Dental Specialist';
  const formattedDate = formatDisplayDate(appointment?.appointment_date);
  const formattedTime = formatDisplayTime(appointment?.start_time);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Treatment Booking Confirmation</title>
</head>
<body style="margin:0; padding:0; background-color:#090d16; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#e2e8f0;">
  <!-- Preheader text for email inbox previews -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#ffffff; opacity:0;">
    Your appointment for ${treatmentName} with ${doctorName} on ${formattedDate} at ${formattedTime} is confirmed. Pre-treatment instructions included.
    &#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#090d16; padding:40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:600px; background-color:#0f172a; border-radius:16px; border:1px solid #1e293b; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background:linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #0f172a 100%); padding:28px 30px; text-align:left;">
              <table width="100%">
                <tr>
                  <td>
                    <span style="background:#ffffff; border-radius:10px; padding:6px 14px; display:inline-block; font-size:20px; font-weight:900; color:#0891b2; letter-spacing:-0.5px;">
                      <span style="color:#06b6d4;">Dent</span>rivo
                    </span>
                    <p style="color:rgba(255,255,255,0.92); font-size:13px; margin:6px 0 0 0; font-weight:600;">Dental Care &amp; Implant Center</p>
                  </td>
                  <td style="text-align:right; vertical-align:top;">
                    <span style="background:rgba(16, 185, 129, 0.25); color:#34d399; font-size:12px; font-weight:700; padding:6px 14px; border-radius:20px; text-transform:uppercase; border:1px solid rgba(52, 211, 153, 0.3);">
                      Booking Confirmed
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding:32px 30px;">
              <h2 style="color:#ffffff; font-size:20px; font-weight:700; margin:0 0 12px 0;">
                Dental Treatment Scheduled!
              </h2>
              <p style="color:#94a3b8; font-size:15px; margin:0 0 16px 0;">
                Dear <strong style="color:#f8fafc;">${patientName}</strong>,
              </p>
              <p style="color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 24px 0;">
                Your upcoming dental treatment has been successfully booked at <strong>${clinicName}</strong>. Below are your appointment details:
              </p>

              <!-- Treatment Info Box -->
              <div style="background-color:#1e293b; border-radius:12px; padding:20px; border-left:4px solid #06b6d4; margin-bottom:24px;">
                <table width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px; width:130px;">🦷 Treatment:</td>
                    <td style="padding:8px 0; color:#38bdf8; font-size:15px; font-weight:700;">${treatmentName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">📅 Date:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-weight:600;">${formattedDate}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">⏰ Time:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-weight:600;">${formattedTime}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">👨‍⚕️ Specialist:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-weight:600;">${doctorName}</td>
                  </tr>
                  ${patient?.patient_code ? `
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">🆔 Patient Code:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-family:monospace;">${patient.patient_code}</td>
                  </tr>` : ''}
                </table>
              </div>

              <!-- Guidelines Box -->
              <div style="background-color:rgba(6, 182, 212, 0.08); border:1px solid rgba(6, 182, 212, 0.2); border-radius:10px; padding:16px; margin-bottom:24px;">
                <h4 style="color:#06b6d4; margin:0 0 8px 0; font-size:14px;">📋 Pre-Treatment Instructions:</h4>
                <ul style="color:#94a3b8; font-size:13px; line-height:1.6; margin:0; padding-left:20px;">
                  <li>Please arrive 10-15 minutes prior to your scheduled slot.</li>
                  <li>Brush and clean your teeth thoroughly before your visit.</li>
                  <li>Bring any previous dental records or X-rays if available.</li>
                  <li>If you need to reschedule, please notify us at least 24 hours in advance.</li>
                </ul>
              </div>

              <p style="color:#64748b; font-size:13px; margin:0;">
                For any questions or changes, contact us at <strong>${clinic?.phone || '+31 12345-67890'}</strong> or reply to this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#090d16; padding:20px 30px; border-top:1px solid #1e293b; text-align:center;">
              <p style="color:#475569; font-size:12px; margin:0 0 4px 0;">
                © ${new Date().getFullYear()} ${clinicName}. All rights reserved.
              </p>
              <p style="color:#334155; font-size:11px; margin:0;">
                Powered by Dentrivo Intelligent Care Platform
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getTreatmentReminderEmailHtml(appointment, patient, treatment, doctor, clinic) {
  const clinicName = clinic?.name || 'Dentrivo Dental Clinic';
  const patientName = patient?.name || 'Valued Patient';
  const treatmentName = treatment?.name || 'Dental Treatment';
  const doctorName = doctor?.name ? (doctor.name.startsWith('Dr.') ? doctor.name : `Dr. ${doctor.name}`) : 'Dentrivo Dental Specialist';
  const formattedDate = formatDisplayDate(appointment?.appointment_date);
  const formattedTime = formatDisplayTime(appointment?.start_time);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Treatment Reminder - Dentrivo</title>
</head>
<body style="margin:0; padding:0; background-color:#090d16; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#e2e8f0;">
  <!-- Preheader text for email inbox previews -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#ffffff; opacity:0;">
    Reminder: Your appointment for ${treatmentName} is scheduled for ${formattedDate} at ${formattedTime}.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#090d16; padding:40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:600px; background-color:#0f172a; border-radius:16px; border:1px solid #1e293b; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #0f172a 100%); padding:28px 30px; text-align:left;">
              <table width="100%">
                <tr>
                  <td>
                    <span style="background:#ffffff; border-radius:10px; padding:6px 14px; display:inline-block; font-size:20px; font-weight:900; color:#d97706; letter-spacing:-0.5px;">
                      <span style="color:#f59e0b;">Dent</span>rivo
                    </span>
                    <p style="color:rgba(255,255,255,0.92); font-size:13px; margin:6px 0 0 0; font-weight:600;">Dental Care &amp; Implant Center</p>
                  </td>
                  <td style="text-align:right; vertical-align:top;">
                    <span style="background:rgba(255,255,255,0.25); color:#ffffff; font-size:12px; font-weight:700; padding:6px 14px; border-radius:20px; text-transform:uppercase;">
                      ⏰ Treatment Reminder
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding:32px 30px;">
              <h2 style="color:#ffffff; font-size:20px; font-weight:700; margin:0 0 12px 0;">
                Upcoming Dental Treatment Reminder
              </h2>
              <p style="color:#94a3b8; font-size:15px; margin:0 0 16px 0;">
                Dear <strong style="color:#f8fafc;">${patientName}</strong>,
              </p>
              <p style="color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 24px 0;">
                This is a friendly reminder from <strong>${clinicName}</strong> for your scheduled dental treatment:
              </p>

              <!-- Treatment Info Box -->
              <div style="background-color:#1e293b; border-radius:12px; padding:20px; border-left:4px solid #f59e0b; margin-bottom:24px;">
                <table width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px; width:130px;">🦷 Treatment:</td>
                    <td style="padding:8px 0; color:#fbbf24; font-size:15px; font-weight:700;">${treatmentName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">📅 Date:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-weight:600;">${formattedDate}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">⏰ Scheduled Time:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-weight:600;">${formattedTime}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#94a3b8; font-size:14px;">👨‍⚕️ Attending Doctor:</td>
                    <td style="padding:8px 0; color:#f8fafc; font-size:14px; font-weight:600;">${doctorName}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color:rgba(245, 158, 11, 0.1); border-left:4px solid #f59e0b; border-radius:4px; padding:14px 18px; margin-bottom:24px;">
                <p style="color:#fbbf24; font-size:13px; font-weight:600; margin:0;">
                  📌 Please remember to arrive 10 minutes early. We look forward to seeing you!
                </p>
              </div>

              <p style="color:#64748b; font-size:13px; margin:0;">
                Need to reschedule or have questions? Contact us at <strong>${clinic?.phone || '+31 12345-67890'}</strong>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#090d16; padding:20px 30px; border-top:1px solid #1e293b; text-align:center;">
              <p style="color:#475569; font-size:12px; margin:0;">
                © ${new Date().getFullYear()} ${clinicName}. Powered by Dentrivo.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * NOT-01 to NOT-04: Central Notification Service.
 * Multi-channel notifications with templates, delivery tracking, and retry.
 */
class NotificationService {
  constructor() {
    this.transporter = null;
    this.lastUser = null;
    this.lastPass = null;
  }

  mailer() {
    if (config.mail.mailer === 'log') return null;
    const user = config.mail.username;
    const pass = config.mail.password;

    if (!this.transporter || this.lastUser !== user || this.lastPass !== pass) {
      this.lastUser = user;
      this.lastPass = pass;
      this.transporter = nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.port === 465,
        auth: user ? { user, pass } : undefined,
      });
    }
    return this.transporter;
  }

  /** Send a notification through the specified channel. */
  async send(type, channel, recipient, data = {}, forceMessage = null) {
    const template = await NotificationTemplate.findOne({
      type,
      channel,
      is_active: 1,
    });

    const message = forceMessage ?? (template ? render(template.body, data) : null);

    if (!message) {
      console.warn('No notification template found', { type, channel });
      return false;
    }

    const log = await NotificationLog.create({
      type,
      recipient,
      channel: channel === 'in_app' ? 'email' : channel,
      status: 'queued',
      message,
      retry_count: 0,
      max_retries: 3,
    });

    try {
      switch (channel) {
        case 'email':
          await this.sendEmail(recipient, template?.subject ?? type, message);
          break;
        case 'sms':
          await this.sendSms(recipient, message);
          break;
        case 'whatsapp':
          await this.sendWhatsApp(recipient, message);
          break;
        case 'in_app':
          await this.sendInApp(recipient, message);
          break;
        default:
          break;
      }

      await NotificationLog.update(log.id, { status: 'sent', sent_at: new Date() });
      return true;
    } catch (error) {
      await NotificationLog.update(log.id, { status: 'failed', error: error.message });
      console.error('Notification send failed', {
        log_id: log.id,
        channel,
        error: error.message,
      });
      return false;
    }
  }

  /** NOT-04: Retry failed notifications. */
  async retryFailed() {
    const allFailed = await NotificationLog.find({ status: 'failed' });
    const failed = allFailed.filter((n) => Number(n.retry_count || 0) < Number(n.max_retries || 3));

    let retried = 0;
    for (const notification of failed) {
      // eslint-disable-next-line no-await-in-loop
      await NotificationLog.update(notification.id, {
        retry_count: notification.retry_count + 1,
        status: 'queued',
        error: null,
      });

      // eslint-disable-next-line no-await-in-loop
      const result = await this.send(
        notification.type,
        notification.channel,
        notification.recipient,
        {},
        notification.message,
      );

      if (result) retried += 1;
    }

    return retried;
  }

  /** Fetch Admin-managed Clinic Profile */
  async getClinicInfo() {
    try {
      const clinic = await Clinic.findOne({});
      if (clinic) {
        return {
          name: clinic.name || 'Dentrivo Dental Clinic',
          phone: clinic.phone || '+31 12345-67890',
          email: clinic.email || 'info@dentalai.com',
          address: clinic.address || '123 Health Care Ave, Suite 400',
        };
      }
    } catch (e) {
      // fallback if DB error
    }
    return {
      name: 'Dentrivo Dental Clinic',
      phone: '+31 12345-67890',
      email: 'info@dentalai.com',
      address: '123 Health Care Ave, Suite 400',
    };
  }

  /** Dispatch Treatment Booking Email */
  async sendTreatmentBookingEmail(appointment, patient, treatment, doctor) {
    if (!patient?.email) return;

    const emailTo = String(patient.email).trim().toLowerCase();
    // Guard against dummy RFC test domains to prevent Google SMTP delivery bounce errors
    if (emailTo.endsWith('@example.com') || emailTo.endsWith('@test.com') || emailTo.endsWith('.invalid')) {
      console.log(`[NotificationService] Skipping live SMTP delivery to dummy demo email: ${emailTo}. Booking notification logged.`);
      return;
    }

    const clinic = await this.getClinicInfo();
    const html = getTreatmentBookingEmailHtml(appointment, patient, treatment, doctor, clinic);
    const treatmentTitle = treatment?.name || 'Dental Treatment';
    const formattedDate = formatDisplayDate(appointment?.appointment_date);
    const formattedTime = formatDisplayTime(appointment?.start_time);
    const text = `Dear ${patient.name},\n\nYour appointment for ${treatmentTitle} is confirmed for ${formattedDate} at ${formattedTime}.\n\nDoctor: ${doctor?.name ? (doctor.name.startsWith('Dr.') ? doctor.name : `Dr. ${doctor.name}`) : 'Dentrivo Dental Specialist'}\nClinic: ${clinic.name}\nPhone: ${clinic.phone}\n\nPre-treatment instructions:\n- Please arrive 10-15 minutes prior to your scheduled slot.\n- Bring any previous dental records or X-rays if available.`;

    await this.sendEmail(
      emailTo,
      `Treatment Booking Confirmation — ${treatmentTitle} on ${formattedDate}`,
      text,
      html,
    );
  }

  /** Dispatch Treatment Reminder Email */
  async sendTreatmentReminderEmail(appointment, patient, treatment, doctor) {
    if (!patient?.email) return;

    const emailTo = String(patient.email).trim().toLowerCase();
    if (emailTo.endsWith('@example.com') || emailTo.endsWith('@test.com') || emailTo.endsWith('.invalid')) {
      console.log(`[NotificationService] Skipping live SMTP reminder to dummy demo email: ${emailTo}.`);
      return;
    }

    const clinic = await this.getClinicInfo();
    const html = getTreatmentReminderEmailHtml(appointment, patient, treatment, doctor, clinic);
    const treatmentTitle = treatment?.name || 'Dental Treatment';
    const formattedDate = formatDisplayDate(appointment?.appointment_date);
    const formattedTime = formatDisplayTime(appointment?.start_time);
    const text = `Dear ${patient.name},\n\nFriendly reminder for your upcoming appointment for ${treatmentTitle} on ${formattedDate} at ${formattedTime}.\n\nClinic: ${clinic.name}\nPhone: ${clinic.phone}`;

    await this.sendEmail(
      emailTo,
      `⏰ Reminder: Upcoming ${treatmentTitle} Appointment on ${formattedDate}`,
      text,
      html,
    );
  }

  /** Send email supporting plain text, rich HTML, and attachments */
  async sendEmail(to, subject, textBody, htmlBody = null, attachments = []) {
    const emailTo = String(to || '').trim().toLowerCase();
    if (!emailTo) return;

    // Skip SMTP delivery for dummy or test domain emails to avoid Mail Delivery Subsystem bounces
    if (emailTo.endsWith('@example.com') || emailTo.endsWith('@test.com') || emailTo.endsWith('.invalid')) {
      console.log(`[NotificationService] Skipping live SMTP delivery to dummy demo email: ${emailTo} (Subject: ${subject})`);
      return;
    }

    const transport = this.mailer();
    const fromAddr = config.mail.fromAddress || config.mail.username || 'noreply@dentrivo.com';
    const fromHeader = `"${config.mail.fromName}" <${fromAddr}>`;

    if (!transport) {
      console.log(`Email to ${to} — ${subject}: ${textBody}`);
      return;
    }

    const mailOptions = {
      from: fromHeader,
      to,
      subject,
      text: textBody,
    };

    if (htmlBody) {
      mailOptions.html = htmlBody;
    }

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    await transport.sendMail(mailOptions);
  }

  async sendSms(to, message) {
    console.log(`SMS sent to ${to}: ${message}`);
  }

  async sendWhatsApp(to, message) {
    console.log(`WhatsApp sent to ${to}: ${message}`);
  }

  async sendInApp(recipientId, message) {
    console.log(`In-app notification for user ${recipientId}: ${message}`);
  }
}

export default new NotificationService();

