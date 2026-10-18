import {
  Appointment, Doctor, Invoice, InvoiceItem, MedicalFile, PaymentOrder,
} from '../../models/index.js';
import { abort, abortUnless } from '../../utils/http.js';
import { streamFile } from '../admin/fileController.js';

/**
 * PAT-PORT-01 to PAT-PORT-05: Patient Portal.
 * Appointment management lives in the patient appointment controller; this
 * covers invoices, medical records and file downloads.
 */

/** PAT-PORT-03: List patient invoices with payment status. */
export async function invoices(req, res) {
  const patient = req.auth.user;

  const paginated = await Invoice.paginate({
    where: { patient_id: patient.id },
    orderBy: 'created_at DESC, id DESC',
    page: req.query.page,
    perPage: 15,
  });

  const appointmentIds = [...new Set(paginated.data.map((i) => i.appointment_id).filter(Boolean))];
  const appointments = appointmentIds.length ? await Appointment.find({ id: { in: appointmentIds } }) : [];
  const doctorIds = [...new Set(appointments.map((a) => a.doctor_id).filter(Boolean))];
  const doctors = doctorIds.length ? await Doctor.find({ id: { in: doctorIds } }) : [];

  const appointmentMap = new Map(appointments.map((a) => [String(a.id), a]));
  const doctorMap = new Map(doctors.map((d) => [String(d.id), d]));

  paginated.data = paginated.data.map((invoice) => {
    const appointment = invoice.appointment_id ? appointmentMap.get(String(invoice.appointment_id)) : null;
    const doctor = appointment?.doctor_id ? doctorMap.get(String(appointment.doctor_id)) : null;

    return {
      ...invoice,
      appointment_id: appointment
        ? { id: appointment.id, doctor_id: doctor ? { name: doctor.name } : null }
        : null,
    };
  });

  return res.json({ patient, invoices: paginated });
}

/** PAT-PORT-03: Invoice detail with the payment option. */
export async function showInvoice(req, res) {
  const patient = req.auth.user;

  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) abort(404, 'Invoice not found.');
  abortUnless(String(invoice.patient_id) === String(patient.id), 403, 'Unauthorised');

  const [items, paymentOrder] = await Promise.all([
    InvoiceItem.find({ invoice_id: invoice.id }, { orderBy: '`id` ASC' }),
    PaymentOrder.findOne({ invoice_id: invoice.id }, { orderBy: '`created_at` DESC' }),
  ]);

  return res.json({
    patient,
    invoice: { ...invoice, items },
    paymentOrder,
  });
}

/** PAT-PORT-04: List the patient's medical records. */
export async function medicalRecords(req, res) {
  const patient = req.auth.user;

  const files = await MedicalFile.paginate({
    where: { patient_id: patient.id },
    orderBy: '`created_at` DESC, `id` DESC',
    page: req.query.page,
    perPage: 20,
  });

  return res.json({ patient, files });
}

/** PAT-PORT-04: Download one of the patient's own files. */
export async function downloadFile(req, res) {
  const patient = req.auth.user;

  const file = await MedicalFile.findById(req.params.id);
  if (!file) abort(404, 'File not found.');
  abortUnless(String(file.patient_id) === String(patient.id), 403, 'Unauthorised');

  return streamFile(res, file, { download: true });
}
