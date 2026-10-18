import { Appointment, Patient } from '../../models/index.js';
import { getDb } from '../../config/db.js';
import { toObjectId } from '../../db/Table.js';
import { filled, whereDate } from '../../utils/helpers.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';
import { fireStatusWorkflow } from '../admin/appointmentController.js';
import { hydrateAppointments } from '../admin/appointmentPresenter.js';

export async function index(req, res) {
  const doctorId = req.auth.user.id;
  const filter = { doctor_id: doctorId };

  if (filled(req.query.date)) {
    filter.appointment_date = whereDate(req.query.date);
  }
  if (filled(req.query.status)) {
    filter.status = req.query.status;
  }

  const appointments = await Appointment.paginate({
    where: filter,
    orderBy: 'appointment_date DESC, start_time ASC',
    page: req.query.page,
    perPage: 20,
  });

  appointments.data = await hydrateAppointments(appointments.data);

  return res.json({ appointments });
}

export async function updateStatus(req, res) {
  await validate(req.body, {
    status: 'required|in:confirmed,completed,cancelled,no_show',
  });

  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) abort(404, 'Appointment not found.');

  const previousStatus = appointment.status;
  const changes = { status: req.body.status };

  if (filled(req.body.diagnosis)) changes.diagnosis = req.body.diagnosis;
  if (filled(req.body.prescription)) changes.prescription = req.body.prescription;
  if (filled(req.body.notes)) changes.notes = req.body.notes;

  const updated = await Appointment.update(appointment.id, changes);

  // Completing a visit promotes the patient to `visited`.
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

  return res.json({ success: true, message: 'Appointment updated.', appointment: updated });
}
