import dayjs from 'dayjs';
import { Appointment, Doctor, Patient, Treatment } from '../../models/index.js';
import workflowService from '../../services/WorkflowService.js';
import notificationService from '../../services/NotificationService.js';
import { toDateString } from '../../utils/helpers.js';
import { abort, ValidationError } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';
import { fireStatusWorkflow } from '../admin/appointmentController.js';
import { hydrateAppointments } from '../admin/appointmentPresenter.js';

export async function index(req, res) {
  const patient = req.auth.user;

  const appointments = await Appointment.paginate({
    where: { patient_id: patient.id },
    orderBy: 'appointment_date DESC, start_time ASC',
    page: req.query.page,
    perPage: 15,
  });

  appointments.data = await hydrateAppointments(appointments.data);

  return res.json({ appointments });
}

export async function book(req, res) {
  const [doctors, treatments] = await Promise.all([
    Doctor.find({ is_active: 1 }, { orderBy: '`id` ASC' }),
    Treatment.find({ is_active: 1 }, { orderBy: '`id` ASC' }),
  ]);

  return res.json({ doctors, treatments });
}

export async function store(req, res) {
  await validate(req.body, {
    doctor_id: 'required|exists:Doctor,id',
    appointment_date: 'required|date|after_or_equal:today',
    start_time: 'required',
  }, { Doctor });

  const requestedDateTime = dayjs(`${req.body.appointment_date} ${req.body.start_time}`);
  if (requestedDateTime.isBefore(dayjs())) {
    throw new ValidationError({
      start_time: ['You cannot book an appointment for a past time.'],
    });
  }

  const patient = req.auth.user;

  if (req.body.name && typeof req.body.name === 'string' && req.body.name.trim()) {
    const updatedName = req.body.name.trim();
    if (updatedName.length >= 2 && !['tomorrow', 'today'].includes(updatedName.toLowerCase())) {
      await Patient.update(patient.id, { name: updatedName });
      patient.name = updatedName;
    }
  }

  if (req.body.email && req.body.email.includes('@') && !req.body.email.endsWith('@example.com')) {
    const updatedEmail = req.body.email.trim().toLowerCase();
    await Patient.update(patient.id, { email: updatedEmail });
    patient.email = updatedEmail;
  }

  const treatment = req.body.treatment_id
    ? await Treatment.findById(req.body.treatment_id)
    : null;

  const endTime = requestedDateTime
    .add(treatment?.duration_mins ?? 30, 'minute')
    .format('HH:mm');

  const bookedVia = req.body.booked_via || (req.body.notes?.includes('Chatbot') ? 'ai_chat' : 'patient');

  const appointment = await Appointment.create({
    patient_id: patient.id,
    doctor_id: req.body.doctor_id,
    treatment_id: req.body.treatment_id || null,
    appointment_date: toDateString(req.body.appointment_date),
    start_time: req.body.start_time,
    end_time: endTime,
    booked_via: bookedVia,
    notes: req.body.notes ?? null,
    status: 'pending',
  });

  await workflowService.fireEvent('appointment_created', appointment, 'Appointment');

  try {
    const doctor = await Doctor.findById(req.body.doctor_id);
    await notificationService.sendTreatmentBookingEmail(appointment, patient, treatment, doctor);
  } catch (err) {
    console.error('Failed to send treatment booking email:', err.message);
  }

  return res.status(201).json({
    success: true,
    message: 'Appointment request submitted!',
    appointment,
    redirect: '/patient/appointments',
  });
}

export async function cancel(req, res) {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) abort(404, 'Appointment not found.');

  const previousStatus = appointment.status;
  const updated = await Appointment.update(appointment.id, {
    status: 'cancelled',
    cancelled_at: new Date(),
    cancellation_reason: req.body.reason ?? 'Cancelled by patient',
  });

  await fireStatusWorkflow(updated, previousStatus);

  return res.json({ success: true, message: 'Appointment cancelled.', appointment: updated });
}
