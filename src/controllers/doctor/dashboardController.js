import { Appointment } from '../../models/index.js';
import { currentWeekRange, today, whereDate } from '../../utils/helpers.js';
import { hydrateAppointments } from '../admin/appointmentPresenter.js';

export async function index(req, res) {
  const doctor = req.auth.user;

  const distinctPatientsList = await Appointment.distinct('patient_id', { doctor_id: doctor.id });

  const [todayCount, completedToday, pending, thisWeek] = await Promise.all([
    Appointment.count({ doctor_id: doctor.id, appointment_date: whereDate(today()) }),
    Appointment.count({
      doctor_id: doctor.id,
      appointment_date: whereDate(today()),
      status: 'completed',
    }),
    Appointment.count({ doctor_id: doctor.id, status: 'pending' }),
    Appointment.count({ doctor_id: doctor.id, appointment_date: currentWeekRange() }),
  ]);

  const stats = {
    today_appointments: todayCount,
    total_patients: distinctPatientsList.length,
    completed_today: completedToday,
    pending,
    this_week: thisWeek,
  };

  const todayRaw = await Appointment.find(
    { doctor_id: doctor.id, appointment_date: whereDate(today()) },
    { orderBy: 'start_time ASC' },
  );
  const todayAppointments = await hydrateAppointments(todayRaw);

  const upcomingRaw = await Appointment.find(
    { doctor_id: doctor.id, appointment_date: { gt: whereDate(today()) } },
    { orderBy: 'appointment_date ASC, start_time ASC', limit: 5 },
  );
  const upcoming = await hydrateAppointments(upcomingRaw);

  return res.json({
    doctor, stats, todayAppointments, upcoming,
  });
}
