import {
  Appointment, Doctor, Invoice, Patient,
} from '../../models/index.js';
import {
  dayOfYear, groupByField, groupByMonth, whereMonth,
} from '../../utils/helpers.js';

export async function index(req, res) {
  const now = new Date();
  const year = now.getFullYear();

  const monthlyRevenue = await groupByMonth('invoices', {
    dateField: 'paid_at',
    valueField: 'total',
    filter: {
      status: 'paid',
      paid_at: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
    },
  });

  const appointmentTrend = await groupByMonth('appointments', {
    dateField: 'appointment_date',
    filter: {
      appointment_date: { $gte: `${year}-01-01`, $lt: `${year + 1}-01-01` },
    },
  });

  const statusBreakdown = await groupByField('appointments', {
    field: 'status',
    filter: {
      appointment_date: { $gte: `${year}-01-01`, $lt: `${year + 1}-01-01` },
    },
  });

  const patientGrowth = await groupByMonth('patients', {
    dateField: 'created_at',
    filter: {
      created_at: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
    },
  });

  const doctors = await Doctor.find({}, { orderBy: '`id` ASC' });
  const doctorsWithCount = await Promise.all(
    doctors.map(async (doc) => ({
      ...doc,
      completed_count: await Appointment.count({
        doctor_id: doc.id,
        status: 'completed',
      }),
    })),
  );
  doctorsWithCount.sort((a, b) => b.completed_count - a.completed_count);
  const topDoctors = doctorsWithCount.slice(0, 5);

  const [totalRevenue, totalAppointments, completedAppointments, newPatients] = await Promise.all([
    Invoice.sum('total', { status: 'paid' }),
    Appointment.count({}),
    Appointment.count({ status: 'completed' }),
    Patient.count({
      created_at: whereMonth(now.getFullYear(), now.getMonth() + 1),
    }),
  ]);

  const kpis = {
    total_revenue: totalRevenue,
    avg_daily_appts: Math.round((totalAppointments / Math.max(dayOfYear(), 1)) * 10) / 10,
    completion_rate: totalAppointments > 0
      ? `${Math.round((completedAppointments / totalAppointments) * 1000) / 10}%`
      : '0%',
    new_patients: newPatients,
  };

  return res.json({
    monthlyRevenue,
    appointmentTrend,
    statusBreakdown,
    topDoctors,
    patientGrowth,
    kpis,
  });
}
