import {
  Appointment, Invoice, InvoiceItem, Patient, Treatment,
} from '../../models/index.js';
import {
  filled, likeTerm, padLeft, whereMonth,
} from '../../utils/helpers.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';
import notificationService, { getInvoiceEmailHtml } from '../../services/NotificationService.js';
import InvoicePdfService from '../../services/InvoicePdfService.js';


export async function index(req, res) {
  const filter = {};

  if (filled(req.query.status)) {
    filter.status = req.query.status;
  }
  if (filled(req.query.search)) {
    const term = likeTerm(req.query.search);
    const matchingPatients = await Patient.find(
      { name: { like: term } },
      { select: 'id' },
    );
    const patientIds = matchingPatients.map((p) => p.id);
    filter.or = [
      { patient_id: { in: patientIds } },
      { invoice_number: { like: term } },
    ];
  }

  const invoices = await Invoice.paginate({
    where: filter,
    orderBy: 'created_at DESC, id DESC',
    page: req.query.page,
    perPage: 20,
  });

  const invoiceList = invoices.data;
  const patientIds = [...new Set(invoiceList.map((i) => i.patient_id).filter(Boolean))];
  const appointmentIds = [...new Set(invoiceList.map((i) => i.appointment_id).filter(Boolean))];

  const [patients, appointments, itemCounts] = await Promise.all([
    patientIds.length ? Patient.find({ id: { in: patientIds } }, { withTrashed: true }) : [],
    appointmentIds.length ? Appointment.find({ id: { in: appointmentIds } }, { withTrashed: true }) : [],
    Promise.all(invoiceList.map((i) => InvoiceItem.count({ invoice_id: i.id }))),
  ]);

  const patientMap = new Map(patients.map((p) => [String(p.id), p]));
  const appointmentMap = new Map(appointments.map((a) => [String(a.id), a]));

  const treatmentIds = [...new Set(appointments.map((a) => a.treatment_id).filter(Boolean))];
  const treatments = treatmentIds.length ? await Treatment.find({ id: { in: treatmentIds } }) : [];
  const treatmentMap = new Map(treatments.map((t) => [String(t.id), t]));

  invoices.data = invoiceList.map((invoice, idx) => {
    const patient = invoice.patient_id ? patientMap.get(String(invoice.patient_id)) : null;
    const appointment = invoice.appointment_id ? appointmentMap.get(String(invoice.appointment_id)) : null;
    const treatment = appointment?.treatment_id ? treatmentMap.get(String(appointment.treatment_id)) : null;

    return {
      ...invoice,
      items_count: itemCounts[idx] ?? 0,
      patient_id: patient ? {
        id: patient.id,
        name: patient.name,
        phone: patient.phone,
        avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(patient.name ?? '')}&background=6366F1&color=fff`,
      } : null,
      appointment_id: appointment ? {
        id: appointment.id,
        treatment_id: treatment ? { name: treatment.name } : null,
      } : null,
    };
  });

  const now = new Date();
  const [totalRevenue, pending, overdue, thisMonth] = await Promise.all([
    Invoice.sum('total', { status: 'paid' }),
    Invoice.sum('total', { status: { in: ['sent', 'draft'] } }),
    Invoice.count({ status: 'overdue' }),
    Invoice.sum('total', {
      status: 'paid',
      paid_at: whereMonth(now.getFullYear(), now.getMonth() + 1),
    }),
  ]);

  const allPatients = await Patient.find({}, { orderBy: '`id` ASC' });

  return res.json({
    invoices,
    stats: {
      total_revenue: totalRevenue,
      pending,
      overdue,
      this_month: thisMonth,
    },
    patients: allPatients,
  });
}

export async function store(req, res) {
  await validate(req.body, {
    patient_id: 'required|exists:Patient,id',
    due_date: 'nullable|date',
  }, { Patient });

  const invoiceNumber = await nextInvoiceNumber();

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.quantity ?? 1) * Number(item.unit_price ?? 0),
    0,
  );
  const tax = subtotal * (Number(req.body.tax_rate ?? 0) / 100);
  const discount = Number(req.body.discount ?? 0);
  const total = subtotal + tax - discount;

  const invoice = await Invoice.create({
    patient_id: req.body.patient_id,
    appointment_id: req.body.appointment_id || null,
    invoice_number: invoiceNumber,
    subtotal,
    tax,
    discount,
    total,
    status: 'draft',
    due_date: req.body.due_date || null,
    notes: req.body.notes ?? null,
  });

  if (items.length > 0) {
    await InvoiceItem.createMany(items.map((item) => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: Number(item.quantity ?? 1),
      unit_price: Number(item.unit_price),
      tax_rate: 0,
      total: Number(item.quantity ?? 1) * Number(item.unit_price),
    })));
  }

  return res.status(201).json({
    success: true,
    message: `Invoice ${invoiceNumber} created.`,
    invoice,
  });
}

export async function sendInvoice(req, res) {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) abort(404, 'Invoice not found.');

  const [patient, items] = await Promise.all([
    invoice.patient_id ? Patient.findById(invoice.patient_id) : null,
    InvoiceItem.find({ invoice_id: invoice.id }, { orderBy: '`id` ASC' }),
  ]);

  let appointment = null;
  if (invoice.appointment_id) {
    appointment = await Appointment.findById(invoice.appointment_id);
    if (appointment?.treatment_id) {
      appointment.treatment_id = await Treatment.findById(appointment.treatment_id);
    }
  }

  const clinic = {
    name: 'Dentrivo Dental Clinic',
    email: 'contact@dentrivo.com',
    phone: '+91 9876543210',
    address: '123 Health Care Ave, Suite 400',
    city: 'Mumbai',
    state: 'Maharashtra',
  };

  const fullInvoice = {
    ...invoice,
    clinic,
    patient_id: patient,
    appointment,
    items,
  };

  const htmlEmail = getInvoiceEmailHtml(fullInvoice, patient, clinic);
  const pdfResult = await InvoicePdfService.renderPdf(fullInvoice);

  const attachments = [];
  if (pdfResult.type === 'pdf' && pdfResult.buffer) {
    attachments.push({
      filename: `Invoice-${invoice.invoice_number}.pdf`,
      content: pdfResult.buffer,
      contentType: 'application/pdf',
    });
  } else if (pdfResult.html) {
    attachments.push({
      filename: `Invoice-${invoice.invoice_number}.html`,
      content: pdfResult.html,
      contentType: 'text/html',
    });
  }

  let emailSent = false;
  if (patient?.email) {
    const symbol = invoice.currency === 'INR' ? 'Rs.' : '$';
    const textSummary = `Dear ${patient.name},\n\nPlease find attached your billing statement (${invoice.invoice_number}) from ${clinic.name}.\nTotal Amount: ${symbol} ${invoice.total}\n\nThank you for choosing Dentrivo!`;

    try {
      await notificationService.sendEmail(
        patient.email,
        `Invoice ${invoice.invoice_number} from ${clinic.name}`,
        textSummary,
        htmlEmail,
        attachments,
      );
      emailSent = true;
    } catch (err) {
      console.error('Failed to dispatch invoice email:', err.message);
    }
  }

  const updated = invoice.status === 'draft'
    ? await Invoice.update(invoice.id, { status: 'sent' })
    : invoice;

  return res.json({
    success: true,
    message: emailSent
      ? `Bill invoice ${invoice.invoice_number} sent to ${patient.email} with PDF attachment.`
      : `Invoice ${invoice.invoice_number} marked as sent. (No registered email address found for patient)`,
    invoice: updated,
  });
}

export async function markPaid(req, res) {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) abort(404, 'Invoice not found.');

  const updated = await Invoice.update(invoice.id, {
    status: 'paid',
    paid_at: new Date(),
    payment_method: req.body.payment_method ?? 'cash',
  });

  const [patient, items] = await Promise.all([
    updated.patient_id ? Patient.findById(updated.patient_id) : null,
    InvoiceItem.find({ invoice_id: updated.id }, { orderBy: '`id` ASC' }),
  ]);

  let appointment = null;
  if (updated.appointment_id) {
    appointment = await Appointment.findById(updated.appointment_id);
    if (appointment?.treatment_id) {
      appointment.treatment_id = await Treatment.findById(appointment.treatment_id);
    }
  }

  const clinic = {
    name: 'Dentrivo Dental Clinic',
    email: 'contact@dentrivo.com',
    phone: '+91 9876543210',
    address: '123 Health Care Ave, Suite 400',
    city: 'Mumbai',
    state: 'Maharashtra',
  };

  const fullInvoice = {
    ...updated,
    clinic,
    patient_id: patient,
    appointment,
    items,
  };

  if (patient?.email) {
    try {
      const htmlEmail = getInvoiceEmailHtml(fullInvoice, patient, clinic);
      const pdfResult = await InvoicePdfService.renderPdf(fullInvoice);
      const attachments = [];
      if (pdfResult.type === 'pdf' && pdfResult.buffer) {
        attachments.push({
          filename: `Receipt-${updated.invoice_number}.pdf`,
          content: pdfResult.buffer,
          contentType: 'application/pdf',
        });
      }

      const symbol = updated.currency === 'INR' ? 'Rs.' : '$';
      const textSummary = `Dear ${patient.name},\n\nYour payment of ${symbol} ${updated.total} for invoice ${updated.invoice_number} has been received. Attached is your official payment receipt PDF.\n\nThank you for choosing ${clinic.name}!`;

      await notificationService.sendEmail(
        patient.email,
        `Payment Receipt for Invoice ${updated.invoice_number} - Dentrivo`,
        textSummary,
        htmlEmail,
        attachments,
      );
    } catch (err) {
      console.error('Failed to send payment receipt email:', err.message);
    }
  }

  return res.json({ success: true, message: 'Invoice marked as paid and receipt emailed.', invoice: updated });
}

export async function nextInvoiceNumber() {
  const invoices = await Invoice.find(
    { invoice_number: { like: 'INV-%' } },
    { select: 'invoice_number', withTrashed: true },
  );

  let maxNumber = 0;
  for (const inv of invoices) {
    const num = Number(String(inv.invoice_number).slice(4));
    if (!Number.isNaN(num) && num > maxNumber) {
      maxNumber = num;
    }
  }

  return `INV-${padLeft(maxNumber + 1, 6)}`;
}
