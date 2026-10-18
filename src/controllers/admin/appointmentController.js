import {
  Appointment, Doctor, Patient, Treatment,
} from '../../models/index.js';
import { getDb } from '../../config/db.js';
import { toObjectId } from '../../db/Table.js';
import workflowService from '../../services/WorkflowService.js';
import {
  filled, likeTerm, toDateString, whereDate, whereMonthDate,
} from '../../utils/helpers.js';
import { abort, ValidationError } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';
import { hydrateAppointments } from './appointmentPresenter.js';

export async function index(req, res) {
  const filter = {};

  if (filled(req.query.date)) {
    filter.appointment_date = whereDate(req.query.date);
  }
  if (filled(req.query.status)) {
    filter.status = req.query.status;
  }
  if (filled(req.query.doctor)) {
    filter.doctor_id = req.query.doctor;
  }
  if (filled(req.query.search)) {
    const term = likeTerm(req.query.search);
    const matchingPatients = await Patient.find(
      {
        or: [
          { name: { like: term } },
          { phone: { like: term } },
          { email: { like: term } },
          { patient_code: { like: term } },
        ],
      },
      { select: 'id' },
    );
    const patientIds = matchingPatients.map((p) => p.id);
    filter.patient_id = { in: patientIds };
  }

  const appointments = await Appointment.paginate({
    where: filter,
    orderBy: 'appointment_date DESC, start_time ASC',
    page: req.query.page,
    perPage: 20,
  });

  appointments.data = await hydrateAppointments(appointments.data);

  const doctors = await Doctor.find(
    { is_active: 1 },
    { orderBy: '`id` ASC' },
  );
  const calendar = await getCalendarData(req.query.month ?? currentMonth());

  return res.json({ appointments, doctors, calendar });
}

export async function create(req, res) {
  const [doctors, patients, treatments] = await Promise.all([
    Doctor.find({ is_active: 1 }, { orderBy: '`id` ASC' }),
    Patient.find({ is_active: 1 }, { orderBy: '`id` ASC' }),
    Treatment.find({ is_active: 1 }, { orderBy: '`id` ASC' }),
  ]);

  return res.json({ doctors, patients, treatments });
}

export async function store(req, res) {
  await validate(req.body, {
    patient_id: 'required|exists:Patient,id',
    doctor_id: 'required|exists:Doctor,id',
    treatment_id: 'nullable|exists:Treatment,id',
    appointment_date: 'required|date|after_or_equal:today',
    start_time: 'required',
    end_time: 'required|after:start_time',
  }, { Patient, Doctor, Treatment });

  const {
    doctor_id: doctorId, appointment_date: date, start_time: start, end_time: end,
  } = req.body;

  // Double-booking check: any non-cancelled appointment overlapping the slot.
  const clash = await Appointment.findOne({
    doctor_id: doctorId,
    appointment_date: toDateString(date),
    status: { ne: 'cancelled' },
    or: [
      { start_time: { between: [start, end] } },
      { end_time: { between: [start, end] } },
      { and: [{ start_time: { lte: start } }, { end_time: { gte: end } }] },
    ],
  });

  if (clash) {
    throw new ValidationError({
      start_time: ['Doctor already has an appointment in this time slot.'],
    });
  }

  const appointment = await Appointment.create({
    patient_id: req.body.patient_id,
    doctor_id: doctorId,
    treatment_id: req.body.treatment_id || null,
    appointment_date: toDateString(date),
    start_time: start,
    end_time: end,
    notes: req.body.notes ?? null,
    booked_via: 'admin',
  });

  await workflowService.fireEvent('appointment_created', appointment, 'Appointment');

  return res.status(201).json({
    success: true,
    message: 'Appointment booked successfully.',
    appointment,
    redirect: '/admin/appointments',
  });
}

export async function updateStatus(req, res) {
  await validate(req.body, {
    status: 'required|in:pending,confirmed,completed,cancelled,no_show',
  });

  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) abort(404, 'Appointment not found.');

  const previousStatus = appointment.status;
  const changes = { status: req.body.status };

  if (req.body.status === 'cancelled') {
    changes.cancelled_at = new Date();
    changes.cancellation_reason = req.body.reason ?? null;
  }

  const updated = await Appointment.update(appointment.id, changes);

  // When treatment/appointment is marked completed, promote patient to 'visited' and update last_visit_at
  if (req.body.status === 'completed') {
    const pid = appointment.patient_id;
    if (pid) {
      await Patient.update(pid, {
        patient_type: 'visited',
        last_visit_at: new Date(),
      });
      const db = getDb();
      const oid = toObjectId(pid);
      const orClauses = [{ id: String(pid) }, { _id: String(pid) }];
      if (oid) orClauses.unshift({ _id: oid });
      await db.collection('patients').updateOne(
        { $or: orClauses },
        {
          $set: {
            patient_type: 'visited',
            last_visit_at: new Date(),
            updated_at: new Date(),
          },
        },
      );
    }
  }

  await fireStatusWorkflow(updated, previousStatus);

  return res.json({ success: true, message: 'Appointment status updated.', appointment: updated });
}

export async function destroy(req, res) {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) abort(404, 'Appointment not found.');

  await Appointment.delete(appointment.id);

  return res.json({ success: true, message: 'Appointment deleted.' });
}

export async function fireStatusWorkflow(appointment, previousStatus) {
  if (appointment.status === previousStatus) return;

  const EVENT_BY_STATUS = {
    no_show: 'appointment_no_show',
    completed: 'appointment_completed',
    cancelled: 'appointment_cancelled',
  };

  const event = EVENT_BY_STATUS[appointment.status];
  if (event) {
    await workflowService.fireEvent(event, appointment, 'Appointment');
  }
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getCalendarData(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const range = whereMonthDate(year, monthNumber);

  const col = Appointment.collection;
  const rows = await col.aggregate([
    {
      $match: {
        deleted_at: null,
        appointment_date: { $gte: range.gte, $lt: range.lt },
      },
    },
    {
      $group: {
        _id: { appointment_date: '$appointment_date', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const calendar = {};
  for (const row of rows) {
    const dateStr = row._id.appointment_date;
    const status = row._id.status;
    calendar[dateStr] ??= [];
    calendar[dateStr].push({
      appointment_date: dateStr,
      status,
      count: Number(row.count),
    });
  }
  return calendar;
}
