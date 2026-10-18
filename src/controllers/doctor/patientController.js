import { Appointment, Patient } from '../../models/index.js';
import { filled, likeTerm } from '../../utils/helpers.js';
import { abort } from '../../utils/http.js';
import { hydrateAppointments } from '../admin/appointmentPresenter.js';

export async function index(req, res) {
  const doctorId = req.auth.user.id;

  const patientIds = await Appointment.distinct('patient_id', { doctor_id: doctorId });
  const filter = { id: { in: patientIds } };

  if (filled(req.query.search)) {
    const term = likeTerm(req.query.search);
    filter.or = [
      { name: { like: term } },
      { phone: { like: term } },
      { email: { like: term } },
      { patient_code: { like: term } },
    ];
  }

  const patients = await Patient.paginate({
    where: filter,
    orderBy: '`created_at` DESC, `id` DESC',
    page: req.query.page,
    perPage: 20,
  });

  return res.json({ patients });
}

export async function show(req, res) {
  const doctorId = req.auth.user.id;

  const patient = await Patient.findById(req.params.id);
  if (!patient) abort(404, 'Patient not found.');

  const rawAppointments = await Appointment.find(
    { patient_id: patient.id, doctor_id: doctorId },
    { orderBy: 'appointment_date DESC' },
  );
  const appointments = await hydrateAppointments(rawAppointments);

  return res.json({ patient, appointments });
}
