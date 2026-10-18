import {
  Appointment, Doctor, Invoice, Patient, Treatment,
} from '../../models/index.js';
import {
  groupByField, today, whereDate, whereMonth,
} from '../../utils/helpers.js';
import { hydrateAppointments } from './appointmentPresenter.js';

/**
 * Admin Clinic Intelligence Chatbot Controller
 * Provides real-time insights, analytics, schedule overview, and dental operations data to logged-in Admins.
 */
export async function chat(req, res) {
  const userInput = (req.body.message || '').trim();
  const lower = userInput.toLowerCase();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 1. Detect Admin Insights Intent
  const isOverview = matchesAny(lower, [
    'overview', 'insight', 'insights', 'summary', 'stats', 'statistics', 'report',
    'kpi', 'dashboard', 'how are we doing', 'performance', 'metrics', 'clinic stats',
  ]);

  const isTodaySchedule = matchesAny(lower, [
    'schedule', 'appointments today', 'who is coming', 'agenda',
    'patients today', 'visits today', "today's appointment", "today's visit", "today's appt",
  ]) || (lower.includes('today') && !isOverview);

  const isRevenue = matchesAny(lower, [
    'revenue', 'income', 'earning', 'earnings', 'sales', 'billing', 'invoices', 'paid',
    'unpaid', 'finance', 'money', 'collection', 'profit', 'bills',
  ]);

  const isPatients = matchesAny(lower, [
    'patient', 'patients', 'new patient', 'registered', 'patient growth', 'demographic',
    'how many patients', 'client', 'clients',
  ]);

  const isDoctors = matchesAny(lower, [
    'doctor', 'doctors', 'dentist', 'dentists', 'specialist', 'specialists', 'staff',
    'who is working', 'team',
  ]);

  const isTreatments = matchesAny(lower, [
    'treatment', 'treatments', 'procedure', 'procedures', 'prices', 'rates', 'fees',
    'popular', 'most booked', 'services',
  ]);

  try {
    // ══════════════════════════════════════════════════════════════════
    // INTENT 1: Today's Schedule & Appointments
    // ══════════════════════════════════════════════════════════════════
    if (isTodaySchedule) {
      const todayDateStr = whereDate(today());
      const rawAppts = await Appointment.find(
        { appointment_date: todayDateStr },
        { orderBy: 'start_time ASC' },
      );
      const appts = await hydrateAppointments(rawAppts);

      if (appts.length === 0) {
        return res.json({
          reply: `📅 <strong>Today's Schedule (${todayDateStr}):</strong><br><br>`
            + 'There are no appointments scheduled for today yet.<br>'
            + '<em>Tip: You can schedule a walk-in or new appointment in the Appointments panel.</em>',
          intent: 'admin_schedule',
        });
      }

      const listHtml = appts.map((a, idx) => {
        const pName = a.patient_id?.name || 'Walk-in Patient';
        const pPhone = a.patient_id?.phone ? ` (${a.patient_id.phone})` : '';
        const dName = a.doctor_id?.name ? `Dr. ${a.doctor_id.name}` : 'Unassigned';
        const tName = a.treatment_id?.name || 'General Consultation';
        const time = a.start_time ? formatTime(a.start_time) : 'Time not set';

        let badgeColor = '#64748b';
        if (a.status === 'visited' || a.status === 'completed') badgeColor = '#10b981';
        else if (a.status === 'confirmed') badgeColor = '#06b6d4';
        else if (a.status === 'pending') badgeColor = '#f59e0b';
        else if (a.status === 'cancelled') badgeColor = '#ef4444';

        return `<strong>${idx + 1}. ${time}</strong> — <strong>${pName}</strong>${pPhone}<br>`
          + `&nbsp;&nbsp;&nbsp;🦷 Treatment: <em>${tName}</em> | 👨‍⚕️ ${dName}<br>`
          + `&nbsp;&nbsp;&nbsp;Status: <span style="background:${badgeColor}; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">${capitalize(a.status)}</span>`;
      }).join('<br><br>');

      return res.json({
        reply: `📅 <strong>Today's Clinic Schedule (${todayDateStr})</strong> — <strong>${appts.length} Appointment(s)</strong>:<br><br>`
          + `${listHtml}<br><br>`
          + '<em>Would you like to view detailed patient files or check doctor availability?</em>',
        intent: 'admin_schedule',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // INTENT 2: Revenue & Billing Analytics
    // ══════════════════════════════════════════════════════════════════
    if (isRevenue) {
      const [
        totalRevenueAllTime,
        monthlyRevenueCurrent,
        totalInvoices,
        paidInvoicesCount,
        unpaidInvoicesCount,
        unpaidInvoicesSum,
      ] = await Promise.all([
        Invoice.sum('total', { status: 'paid' }),
        Invoice.sum('total', {
          status: 'paid',
          paid_at: whereMonth(year, month),
        }),
        Invoice.count({}),
        Invoice.count({ status: 'paid' }),
        Invoice.count({ status: 'unpaid' }),
        Invoice.sum('total', { status: 'unpaid' }),
      ]);

      const formatInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

      return res.json({
        reply: `💰 <strong>Dentrivo Financial &amp; Billing Insights:</strong><br><br>`
          + `• <strong>Monthly Revenue (${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}):</strong> <span style="color:#10b981; font-weight:700;">${formatInr(monthlyRevenueCurrent)}</span><br>`
          + `• <strong>All-Time Revenue Collected:</strong> <strong>${formatInr(totalRevenueAllTime)}</strong><br>`
          + `• <strong>Total Invoices Issued:</strong> ${totalInvoices} invoices<br>`
          + `• <strong>Settled / Paid Invoices:</strong> <span style="color:#10b981;">${paidInvoicesCount}</span><br>`
          + `• <strong>Unpaid / Pending Invoices:</strong> <span style="color:#f59e0b; font-weight:600;">${unpaidInvoicesCount} (${formatInr(unpaidInvoicesSum)} outstanding)</span><br><br>`
          + `<em>Tip: You can manage invoice receipts and trigger payment reminders in the Billing tab.</em>`,
        intent: 'admin_revenue',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // INTENT 3: Patient Demographics & Growth
    // ══════════════════════════════════════════════════════════════════
    if (isPatients) {
      const [totalPatients, newPatientsMonth, recentPatients] = await Promise.all([
        Patient.count({}),
        Patient.count({
          created_at: whereMonth(year, month),
        }),
        Patient.find({}, { orderBy: 'created_at DESC, id DESC', limit: 4 }),
      ]);

      const recentList = recentPatients.map((p) => `• <strong>${p.name}</strong> (${p.phone || p.email || 'No contact'}, Code: ${p.patient_code || 'N/A'})`).join('<br>');

      return res.json({
        reply: `👥 <strong>Dentrivo Patient Insights:</strong><br><br>`
          + `• <strong>Total Registered Patients:</strong> <span style="font-size:1.05rem; font-weight:700; color:#06b6d4;">${totalPatients}</span><br>`
          + `• <strong>New Patients this Month:</strong> <strong>${newPatientsMonth}</strong><br><br>`
          + `📋 <strong>Recently Registered Patients:</strong><br>`
          + `${recentList || 'None recently.'}<br><br>`
          + `<em>Need to look up a specific patient record? You can ask by patient name or code.</em>`,
        intent: 'admin_patients',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // INTENT 4: Doctors & Clinical Staff
    // ══════════════════════════════════════════════════════════════════
    if (isDoctors) {
      const doctors = await Doctor.find({}, { orderBy: 'id ASC' });
      const doctorDetails = await Promise.all(
        doctors.map(async (doc) => {
          const completedCount = await Appointment.count({
            doctor_id: doc.id,
            status: { in: ['completed', 'visited'] },
          });
          const todayCount = await Appointment.count({
            doctor_id: doc.id,
            appointment_date: whereDate(today()),
          });
          return {
            ...doc,
            completedCount,
            todayCount,
          };
        }),
      );

      const docList = doctorDetails.map((d) => {
        const activeStatus = d.is_active ? '<span style="color:#10b981; font-weight:600;">Active</span>' : '<span style="color:#ef4444;">Inactive</span>';
        const docDisplayName = d.name?.startsWith('Dr') ? d.name : `Dr. ${d.name}`;
        return `• <strong>${docDisplayName}</strong> (${activeStatus})<br>`
          + `&nbsp;&nbsp;Specialization: <em>${d.specialisation || 'General Dentistry'}</em><br>`
          + `&nbsp;&nbsp;Fee: ₹${d.consultation_fee || 500} | Appts Today: <strong>${d.todayCount}</strong> | Completed: <strong>${d.completedCount}</strong>`;
      }).join('<br><br>');

      return res.json({
        reply: `👨‍⚕️ <strong>Dental Specialists &amp; Medical Staff:</strong><br><br>`
          + `Total Doctors: <strong>${doctors.length}</strong> (${doctors.filter((d) => d.is_active).length} active)<br><br>`
          + `${docList}`,
        intent: 'admin_doctors',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // INTENT 5: Treatments & Pricing
    // ══════════════════════════════════════════════════════════════════
    if (isTreatments) {
      const treatments = await Treatment.find({}, { orderBy: 'default_price DESC' });
      const tList = treatments.map((t) => `• <strong>${t.name}</strong>: ₹${t.default_price} (${t.duration_mins || 30} mins)`).join('<br>');

      return res.json({
        reply: `🦷 <strong>Dental Treatments &amp; Fee Schedule:</strong><br><br>`
          + `${tList}<br><br>`
          + `<em>Tip: Treatment prices can be modified anytime in Admin &gt; Settings &gt; Treatments.</em>`,
        intent: 'admin_treatments',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // INTENT 6: General Clinic Overview (Default for overview / stats)
    // ══════════════════════════════════════════════════════════════════
    if (isOverview) {
      const todayDateStr = whereDate(today());
      const [
        todayAppointmentsCount,
        completedToday,
        pendingAppointments,
        totalPatients,
        monthlyRevenueTotal,
        totalDoctors,
        unpaidInvoicesCount,
      ] = await Promise.all([
        Appointment.count({ appointment_date: todayDateStr }),
        Appointment.count({
          appointment_date: todayDateStr,
          status: { in: ['completed', 'visited'] },
        }),
        Appointment.count({ status: 'pending' }),
        Patient.count({}),
        Invoice.sum('total', {
          status: 'paid',
          paid_at: whereMonth(year, month),
        }),
        Doctor.count({ is_active: 1 }),
        Invoice.count({ status: 'unpaid' }),
      ]);

      const formatInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

      return res.json({
        reply: `📊 <strong>Dentrivo Clinic Executive Intelligence Overview</strong> 🦷<br><br>`
          + `📅 <strong>Today's Activity:</strong><br>`
          + `• Total Scheduled: <strong>${todayAppointmentsCount}</strong> appointments<br>`
          + `• Visited / Completed: <span style="color:#10b981; font-weight:600;">${completedToday}</span><br>`
          + `• Action Required: <span style="color:#f59e0b; font-weight:600;">${pendingAppointments} pending review</span><br><br>`
          + `👥 <strong>Patient Metrics:</strong><br>`
          + `• Total Registered Patients: <strong>${totalPatients}</strong><br><br>`
          + `💰 <strong>Financial Health (${new Date().toLocaleString('default', { month: 'long' })}):</strong><br>`
          + `• Revenue Collected: <span style="color:#10b981; font-weight:700;">${formatInr(monthlyRevenueTotal)}</span><br>`
          + `• Unsettled Invoices: <span style="color:#f59e0b;">${unpaidInvoicesCount} invoices pending</span><br><br>`
          + `👨‍⚕️ <strong>Staff:</strong> <strong>${totalDoctors}</strong> active dental specialists on duty.<br><br>`
          + `<em>Ask me: "Show today's schedule", "Show revenue stats", or "List doctor performance"!</em>`,
        intent: 'admin_overview',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // INTENT 7: Standard Dental & Clinical Queries
    // ══════════════════════════════════════════════════════════════════
    const dentalTerms = [
      'teeth', 'tooth', 'dentist', 'dental', 'root canal', 'cleaning', 'scaling', 'cavity',
      'implant', 'whitening', 'braces', 'aligner', 'gum', 'gums', 'extraction', 'decay',
    ];
    if (dentalTerms.some((t) => lower.includes(t))) {
      return res.json({
        reply: `🦷 <strong>Dental Information:</strong><br><br>`
          + `At Dentrivo, we specialize in comprehensive modern oral healthcare, including digital checkups, ultrasonic scaling, painless root canal therapy, and laser teeth whitening.<br><br>`
          + `Our clinic adheres to the highest sterilization and clinical standards. Would you like to check doctor schedules or review treatment pricing?`,
        intent: 'dental_info',
      });
    }

    // Default response for Admin
    return res.json({
      reply: `Hello Admin! 👑 I am your Dentrivo Clinic Intelligence Assistant.<br><br>`
        + `I can provide live clinic metrics and operational insights. You can ask me:<br>`
        + `• 📊 <strong>"Give me today's clinic overview"</strong><br>`
        + `• 📅 <strong>"Show today's appointments schedule"</strong><br>`
        + `• 💰 <strong>"What is our revenue and billing stats?"</strong><br>`
        + `• 👥 <strong>"How many patients do we have?"</strong><br>`
        + `• 👨‍⚕️ <strong>"Show doctor performance &amp; availability"</strong><br><br>`
        + `What insights would you like to explore?`,
      intent: 'admin_general',
    });
  } catch (error) {
    console.error('Admin chat error:', error);
    return res.status(500).json({
      reply: `⚠️ Error generating clinic insights: ${error.message}. Please try again shortly.`,
      error: error.message,
    });
  }
}

// ── Helper Utilities ───────────────────────────────────────────────────

function matchesAny(text, keywords) {
  return keywords.some((k) => text.includes(k));
}

function capitalize(str) {
  if (!str) return '';
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}
