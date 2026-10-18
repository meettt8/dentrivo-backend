import {
  Appointment, Invoice, InvoiceItem, Patient, Treatment,
} from '../../models/index.js';
import { renderPdf } from '../../services/InvoicePdfService.js';
import { abortIf } from '../../utils/http.js';

/** Download the invoice as a PDF. */
export async function download(req, res) {
  const invoice = await loadAuthorisedInvoice(req);
  return respond(res, invoice, { download: true });
}

/** Preview the invoice PDF in the browser. */
export async function preview(req, res) {
  const invoice = await loadAuthorisedInvoice(req);
  return respond(res, invoice, { download: false });
}

/** Load an invoice with the relations the template renders. */
async function loadAuthorisedInvoice(req) {
  const invoice = await Invoice.findById(req.params.id);
  abortIf(!invoice, 404, 'Invoice not found.');

  const clinic = {
    name: 'Smile Dental Clinic',
    email: 'clinic@dentalai.com',
    phone: '+91 9876543210',
    address: '123 MG Road',
    city: 'Mumbai',
    state: 'Maharashtra',
  };

  const [patient, items] = await Promise.all([
    Patient.findById(invoice.patient_id),
    InvoiceItem.find({ invoice_id: invoice.id }, { orderBy: '`id` ASC' }),
  ]);

  let appointment = null;
  if (invoice.appointment_id) {
    appointment = await Appointment.findById(invoice.appointment_id);
    if (appointment?.treatment_id) {
      appointment.treatment_id = await Treatment.findById(appointment.treatment_id);
    }
  }

  return {
    ...invoice,
    clinic,
    patient_id: patient,
    appointment,
    items,
  };
}

async function respond(res, invoice, { download: asAttachment }) {
  const result = await renderPdf(invoice);
  const filename = `invoice-${invoice.invoice_number}.pdf`;

  if (result.type === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asAttachment ? 'attachment' : 'inline'}; filename="${filename}"`,
    );
    return res.send(result.buffer);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const printScript = asAttachment
    ? '<script>window.addEventListener("load", () => window.print());</script>'
    : '';
  return res.send(result.html.replace('</body>', `${printScript}</body>`));
}
