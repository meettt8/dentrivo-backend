import { Appointment, Doctor, WorkingHour } from '../../models/index.js';
import { hashPassword } from '../../utils/auth.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';

/** Columns a clinic admin may set on a doctor. */
const EDITABLE = [
  'name', 'email', 'phone', 'specialisation', 'qualification', 'bio',
  'experience_years', 'consultation_fee', 'is_active',
];

function editableFields(body) {
  const out = {};
  for (const column of EDITABLE) {
    if (body[column] !== undefined) out[column] = body[column] === '' ? null : body[column];
  }
  return out;
}

export async function index(req, res) {
  const doctors = await Doctor.find(
    {},
    { orderBy: '`id` ASC' },
  );

  const doctorsWithCount = await Promise.all(
    doctors.map(async (doc) => ({
      ...doc,
      appointments_count: await Appointment.count({ doctor_id: doc.id }),
    })),
  );

  return res.json({ doctors: doctorsWithCount });
}

export async function store(req, res) {
  await validate(req.body, {
    name: 'required|string|max:255',
    email: 'required|email|unique:Doctor,email',
    phone: 'required|string|max:20',
    password: 'required|min:8|confirmed',
    specialisation: 'nullable|string|max:100',
  }, { Doctor });

  const doctor = await Doctor.create({
    ...editableFields(req.body),
    password: await hashPassword(req.body.password),
  });

  // Default working hours, Monday to Saturday.
  await WorkingHour.createMany([1, 2, 3, 4, 5, 6].map((day) => ({
    doctor_id: doctor.id,
    day_of_week: day,
    open_time: '09:00:00',
    close_time: '18:00:00',
    is_open: 1,
  })));

  return res.status(201).json({
    success: true,
    message: 'Doctor added. Login credentials sent.',
    doctor,
  });
}

export async function update(req, res) {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) abort(404, 'Doctor not found.');

  const changes = editableFields(req.body);

  if (req.body.password) {
    await validate(req.body, { password: 'min:8|confirmed' });
    changes.password = await hashPassword(req.body.password);
  }

  const updated = await Doctor.update(doctor.id, changes);

  return res.json({ success: true, message: 'Doctor updated.', doctor: updated });
}

export async function toggleStatus(req, res) {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) abort(404, 'Doctor not found.');

  const updated = await Doctor.update(doctor.id, { is_active: doctor.is_active ? 0 : 1 });

  return res.json({ success: true, message: 'Doctor status updated.', doctor: updated });
}
