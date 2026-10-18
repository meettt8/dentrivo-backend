import { Appointment, Invoice, Patient } from '../../models/index.js';
import { getDb } from '../../config/db.js';
import workflowService from '../../services/WorkflowService.js';
import { hashPassword } from '../../utils/auth.js';
import {
  filled, likeTerm, randomString, today, whereDateTime,
} from '../../utils/helpers.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';
import { nextPatientCode } from '../auth/authController.js';
import { hydrateAppointments } from './appointmentPresenter.js';

/** Columns a clinic admin may set on a patient. */
const EDITABLE = [
  'name', 'email', 'phone', 'date_of_birth', 'gender', 'blood_group', 'address',
  'city', 'emergency_contact_name', 'emergency_contact_phone', 'insurance_provider',
  'insurance_policy_no', 'medical_notes', 'allergies', 'patient_type', 'is_active',
];

function editableFields(body) {
  const out = {};
  for (const column of EDITABLE) {
    if (body[column] !== undefined) out[column] = body[column] === '' ? null : body[column];
  }
  return out;
}

export async function index(req, res) {
  const filter = {};

  if (filled(req.query.search)) {
    const term = likeTerm(req.query.search);
    filter.or = [
      { name: { like: term } },
      { phone: { like: term } },
      { email: { like: term } },
      { patient_code: { like: term } },
    ];
  }
  if (filled(req.query.type)) {
    if (req.query.type === 'visited' || req.query.type === 'returning') {
      filter.patient_type = { in: ['visited', 'returning'] };
    } else {
      filter.patient_type = req.query.type;
    }
  }

  const patients = await Patient.paginate({
    where: filter,
    orderBy: '`created_at` DESC, `id` DESC',
    page: req.query.page,
    perPage: 20,
  });

  const db = getDb();
  const completedAppts = await db.collection('appointments').find({ status: 'completed' }).toArray();
  const completedPatientIdMap = new Map();
  for (const appt of completedAppts) {
    const pid = String(appt.patient_id);
    if (!completedPatientIdMap.has(pid) || (appt.appointment_date && appt.appointment_date > completedPatientIdMap.get(pid))) {
      completedPatientIdMap.set(pid, appt.appointment_date || new Date());
    }
  }

  for (const p of patients.data) {
    const hasCompletedAppt = completedPatientIdMap.has(String(p.id)) || completedPatientIdMap.has(String(p._id));
    if (p.patient_type === 'returning' || p.patient_type === 'visited' || hasCompletedAppt) {
      p.patient_type = 'visited';
      if (!p.last_visit_at && hasCompletedAppt) {
        p.last_visit_at = completedPatientIdMap.get(String(p.id)) || completedPatientIdMap.get(String(p._id));
      }
    }
  }

  const [total, newCount, visitedCount, todayCount] = await Promise.all([
    Patient.count({}),
    Patient.count({ patient_type: 'new' }),
    Patient.count({ patient_type: { in: ['visited', 'returning'] } }),
    Patient.count({ created_at: whereDateTime(today()) }),
  ]);

  return res.json({
    patients,
    stats: {
      total, new: newCount, visited: visitedCount, returning: visitedCount, today: todayCount,
    },
  });
}

export async function show(req, res) {
  const patient = await Patient.findById(req.params.id);
  if (!patient) abort(404, 'Patient not found.');

  const [rawAppointments, invoices] = await Promise.all([
    Appointment.find(
      { patient_id: patient.id },
      { orderBy: 'appointment_date DESC' },
    ),
    Invoice.find({ patient_id: patient.id }, { orderBy: '`created_at` DESC' }),
  ]);

  const appointments = await hydrateAppointments(rawAppointments);

  const hasCompleted = rawAppointments.some((a) => a.status === 'completed');
  if (patient.patient_type === 'returning' || patient.patient_type === 'visited' || hasCompleted) {
    patient.patient_type = 'visited';
    if (!patient.last_visit_at && hasCompleted) {
      const lastAppt = rawAppointments.find((a) => a.status === 'completed');
      patient.last_visit_at = lastAppt?.appointment_date || new Date();
    }
  }

  return res.json({ patient: { ...patient, appointments, invoices } });
}

export async function store(req, res) {
  await validate(req.body, {
    name: 'required|string|max:255',
    phone: 'required|string|max:20',
    email: 'nullable|email|unique:Patient,email',
    date_of_birth: 'nullable|date',
  }, { Patient });

  const patient = await Patient.create({
    ...editableFields(req.body),
    patient_code: await nextPatientCode(),
    password: await hashPassword(randomString(12)),
  });

  await workflowService.fireEvent('patient_registered', patient, 'Patient');

  return res.status(201).json({
    success: true,
    message: 'Patient added successfully.',
    patient,
  });
}

export async function update(req, res) {
  await validate(req.body, { name: 'required', phone: 'required' });

  const patient = await Patient.findById(req.params.id);
  if (!patient) abort(404, 'Patient not found.');

  const updated = await Patient.update(patient.id, editableFields(req.body));

  return res.json({ success: true, message: 'Patient updated.', patient: updated });
}

export async function destroy(req, res) {
  const patient = await Patient.findById(req.params.id);
  if (!patient) abort(404, 'Patient not found.');

  await Patient.delete(patient.id);

  return res.json({
    success: true,
    message: 'Patient removed.',
    redirect: '/admin/patients',
  });
}
