import {
  Appointment, Doctor, Invoice, Patient,
} from '../../models/index.js';
import {
  groupByField, groupByMonth, today, whereDate, whereMonth, whereMonthDate,
} from '../../utils/helpers.js';
import { hydrateAppointments } from './appointmentPresenter.js';

export async function index(req, res) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [
    todayAppointmentsCount, totalPatients, monthlyRevenueTotal,
    pendingAppointments, totalDoctors, completedToday,
  ] = await Promise.all([
    Appointment.count({ appointment_date: whereDate(today()) }),
    Patient.count({}),
    Invoice.sum('total', {
      status: 'paid',
      paid_at: whereMonth(year, month),
    }),
    Appointment.count({ status: 'pending' }),
    Doctor.count({ is_active: 1 }),
    Appointment.count({
      appointment_date: whereDate(today()),
      status: 'completed',
    }),
  ]);

  const stats = {
    today_appointments: todayAppointmentsCount,
    total_patients: totalPatients,
    monthly_revenue: monthlyRevenueTotal,
    pending_appointments: pendingAppointments,
    total_doctors: totalDoctors,
    completed_today: completedToday,
  };

  const todayRawAppointments = await Appointment.find(
    { appointment_date: whereDate(today()) },
    { orderBy: 'start_time ASC' },
  );
  const todayAppointments = await hydrateAppointments(todayRawAppointments);

  const recentPatients = await Patient.find(
    {},
    { orderBy: '`created_at` DESC, `id` DESC', limit: 5 },
  );

  const monthlyRevenue = await groupByMonth('invoices', {
    dateField: 'paid_at',
    valueField: 'total',
    filter: {
      status: 'paid',
      paid_at: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
    },
  });

  const monthRange = whereMonthDate(year, month);
  const appointmentsByStatus = await groupByField('appointments', {
    field: 'status',
    filter: {
      appointment_date: { $gte: monthRange.gte, $lt: monthRange.lt },
    },
  });

  return res.json({
    stats,
    todayAppointments,
    recentPatients,
    monthlyRevenue,
    appointmentsByStatus,
  });
}
