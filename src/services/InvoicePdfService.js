import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INVOICE_CSS = fs.readFileSync(
  path.join(__dirname, 'templates', 'invoice.css'),
  'utf8',
);

function e(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function numberFormat(value, decimals = 2) {
  return Number(value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function ucfirst(value) {
  const str = String(value ?? '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function fmtDate(value) {
  return value ? dayjs(value).format('DD MMM YYYY') : '';
}

function fmtTime(value) {
  if (!value) return '';
  const [hour, minute] = String(value).split(':');
  return dayjs().hour(Number(hour)).minute(Number(minute)).format('hh:mm A');
}

function currencySymbol(invoice) {
  return invoice.currency === 'INR' ? 'Rs.' : '$';
}

function renderLineItems(invoice) {
  const symbol = currencySymbol(invoice);

  if (invoice.items && invoice.items.length > 0) {
    return invoice.items.map((item, index) => `
          <tr>
            <td style="color:#94a3b8; font-size:12px">${index + 1}</td>
            <td class="desc-cell">
              <div class="desc-name">${e(item.description)}</div>
            </td>
            <td style="text-align:center; color:#475569">${e(item.quantity)}</td>
            <td style="text-align:right">${symbol} ${numberFormat(item.unit_price)}</td>
            <td>${symbol} ${numberFormat(item.total)}</td>
          </tr>`).join('');
  }

  const treatmentName = invoice.appointment?.treatment_id?.name ?? 'Dental Services';
  const dateNote = invoice.appointment
    ? `<div class="desc-note">Date: ${fmtDate(invoice.appointment.appointment_date)}</div>`
    : '';

  return `
          <tr>
            <td style="color:#94a3b8; font-size:12px">1</td>
            <td class="desc-cell">
              <div class="desc-name">${e(treatmentName)}</div>
              ${dateNote}
            </td>
            <td style="text-align:center">1</td>
            <td style="text-align:right">${symbol} ${numberFormat(invoice.subtotal)}</td>
            <td>${symbol} ${numberFormat(invoice.subtotal)}</td>
          </tr>`;
}

function renderAppointmentBox(invoice) {
  if (!invoice.appointment) return '';
  const treatment = invoice.appointment.treatment_id?.name ?? 'General Consultation';
  return `
    <div class="appt-box">
      <div class="appt-cell">
        <div class="appt-label">Appointment Date</div>
        <div class="appt-value">${fmtDate(invoice.appointment.appointment_date)}</div>
      </div>
      <div class="appt-cell">
        <div class="appt-label">Time</div>
        <div class="appt-value">${fmtTime(invoice.appointment.start_time)}</div>
      </div>
      <div class="appt-cell">
        <div class="appt-label">Treatment</div>
        <div class="appt-value">${e(treatment)}</div>
      </div>
    </div>`;
}

function renderTotals(invoice) {
  const symbol = currencySymbol(invoice);
  const taxPercent = invoice.tax > 0
    ? `${Math.round((invoice.tax / Math.max(invoice.subtotal, 1)) * 1000) / 10}%`
    : '0%';

  const discountRow = invoice.discount > 0 ? `
            <tr class="discount">
              <td>Discount</td>
              <td>- ${symbol} ${numberFormat(invoice.discount)}</td>
            </tr>` : '';

  const paidStamp = invoice.status === 'paid' ? `
          <div class="paid-stamp">
            <div class="paid-stamp-text">Paid</div>
            <div class="paid-stamp-sub">
              ${fmtDate(invoice.paid_at)} via ${e(ucfirst(invoice.payment_method ?? 'cash'))}
            </div>
          </div>` : '';

  return `
      <div class="totals-wrapper">
        <div class="totals-spacer">${paidStamp}
        </div>
        <div class="totals-box">
          <table class="totals-table">
            <tr class="subtotal">
              <td>Subtotal</td>
              <td>${symbol} ${numberFormat(invoice.subtotal)}</td>
            </tr>${discountRow}
            <tr class="tax-row">
              <td>Tax (${taxPercent})</td>
              <td>${symbol} ${numberFormat(invoice.tax)}</td>
            </tr>
            <tr class="grand-total">
              <td>Total Due</td>
              <td>${symbol} ${numberFormat(invoice.total)}</td>
            </tr>
          </table>
        </div>
      </div>`;
}

export function renderHtml(invoice) {
  const clinic = invoice.clinic || invoice.clinic_id || {
    name: 'Smile Dental Clinic',
    address: '123 MG Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    phone: '+91 9876543210',
    email: 'clinic@dentalai.com',
  };
  const patient = invoice.patient_id || {};

  const watermark = invoice.status === 'cancelled'
    ? '<div class="watermark">CANCELLED</div>'
    : '';

  const clinicAddress = [
    clinic.address ? `${e(clinic.address)},` : '',
    e(clinic.city ?? ''),
    clinic.state ? `, ${e(clinic.state)}` : '',
  ].join(' ').trim();

  const patientEmail = patient.email ? `<div class="party-line">${e(patient.email)}</div>` : '';
  const patientAddress = patient.address ? `<div class="party-line">${e(patient.address)}</div>` : '';

  const paymentCell = invoice.status === 'paid'
    ? e(ucfirst(invoice.payment_method ?? 'Cash'))
    : 'Pending';

  const notesBox = invoice.notes ? `
    <div class="notes-box">
      <div class="notes-label">Notes</div>
      <div class="notes-text">${e(invoice.notes)}</div>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>Invoice ${e(invoice.invoice_number)}</title>
  <style>
${INVOICE_CSS}
  </style>
</head>
<body>
<div class="page">
${watermark}
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <div class="brand"><span class="brand-dent">Dent</span><span class="brand-rivo">rivo</span></div>
        <div class="brand-tagline">Dental Practice Management</div>
      </div>
      <div class="header-right">
        <div class="invoice-label">Tax Invoice</div>
        <div class="invoice-number">${e(invoice.invoice_number)}</div>
        <div class="invoice-date">Issued: ${fmtDate(invoice.created_at)}</div>
        <div>
          <span class="status-badge status-${e(invoice.status)}">
            ${e(String(invoice.status).toUpperCase())}
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class="body">

    <div class="parties">
      <div class="party">
        <div class="party-label">From</div>
        <div class="party-name">${e(clinic.name)}</div>
        <div class="party-line">${clinicAddress}</div>
        <div class="party-line">${e(clinic.phone)}</div>
        <div class="party-line">${e(clinic.email)}</div>
      </div>
      <div class="party">
        <div class="party-label">Billed To</div>
        <div class="party-name">${e(patient.name)}</div>
        <div class="party-line">${e(patient.patient_code)}</div>
        <div class="party-line">${e(patient.phone)}</div>
        ${patientEmail}
        ${patientAddress}
      </div>
    </div>

    <hr class="divider">

    <div class="meta-row">
      <div class="meta-cell">
        <div class="meta-label">Invoice #</div>
        <div class="meta-value">${e(invoice.invoice_number)}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">Issue Date</div>
        <div class="meta-value">${fmtDate(invoice.created_at)}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">Due Date</div>
        <div class="meta-value">${invoice.due_date ? fmtDate(invoice.due_date) : 'On Receipt'}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">Payment</div>
        <div class="meta-value">${paymentCell}</div>
      </div>
    </div>
${renderAppointmentBox(invoice)}
    <table class="items-table">
      <thead>
        <tr>
          <th style="width:5%">#</th>
          <th style="width:45%">Description</th>
          <th style="width:15%; text-align:center">Qty</th>
          <th style="width:17%; text-align:right">Unit Price</th>
          <th style="width:18%; text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${renderLineItems(invoice)}
      </tbody>
    </table>

    <div style="margin-top:0">${renderTotals(invoice)}
    </div>
${notesBox}
    <div class="thank-you-box">
      <div class="thank-you-label">Thank You</div>
      <div class="thank-you-text">
        Thank you for choosing ${e(clinic.name)}. We look forward to caring for your dental health.
        For any queries regarding this invoice, please contact us at ${e(clinic.email)} or ${e(clinic.phone)}.
      </div>
    </div>

  </div>

  <div class="footer">
    <div class="footer-inner">
      <div class="footer-left">
        <div class="footer-brand">Dentrivo Platform</div>
        <div class="footer-text">This is a computer-generated invoice and does not require a signature.</div>
      </div>
      <div class="footer-right">
        <div class="footer-page">Generated: ${dayjs().format('DD MMM YYYY, hh:mm A')}</div>
        <div class="footer-text" style="margin-top:4px">${e(invoice.invoice_number)}</div>
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}

export async function renderPdf(invoice) {
  const html = renderHtml(invoice);

  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer'));
  } catch {
    return { type: 'html', html };
  }

  let browser;
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const bytes = await page.pdf({ format: 'A4', printBackground: true });
    return { type: 'pdf', buffer: Buffer.from(bytes) };
  } catch (error) {
    console.warn('PDF rendering unavailable, serving printable HTML:', error.message);
    return { type: 'html', html };
  } finally {
    await browser?.close();
  }
}

export default { renderHtml, renderPdf };
