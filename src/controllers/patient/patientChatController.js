/**
 * PatientChatController
 *
 * Handles:
 *  POST /patient/chat/book-slot    → intelligent slot booking
 *  GET  /patient/chat/slots        → available slots for a date
 *  GET  /patient/chat/schedule     → appointment schedule for a date
 *
 * All routes require requirePatient middleware.
 * Timezone: Asia/Kolkata (IST).
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { Doctor, Treatment } from '../../models/index.js';
import {
  bookSlotAtomic,
  findNextAvailableSlot,
  getAvailableSlots,
  getDaySchedule,
  nowIST,
  toMinutes,
} from '../../services/AppointmentIntelligenceService.js';
import notificationService from '../../services/NotificationService.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

// ---------------------------------------------------------------------------
// GET /patient/chat/slots?date=YYYY-MM-DD&doctor_id=...
// ---------------------------------------------------------------------------
export async function getSlots(req, res) {
  const dateStr = req.query.date || nowIST().format('YYYY-MM-DD');
  const doctorId = req.query.doctor_id || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return abort(422, 'Invalid date format. Use YYYY-MM-DD.');
  }

  const slots = await getAvailableSlots(dateStr, doctorId);
  return res.json({ date: dateStr, slots });
}

// ---------------------------------------------------------------------------
// GET /patient/chat/schedule?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
export async function getSchedule(req, res) {
  const dateStr = req.query.date || nowIST().format('YYYY-MM-DD');
  const patient = req.auth.user;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return abort(422, 'Invalid date format. Use YYYY-MM-DD.');
  }

  const schedule = await getDaySchedule(dateStr, { patientId: patient.id });
  return res.json(schedule);
}

// ---------------------------------------------------------------------------
// POST /patient/chat/book-slot
// Body: { date, start_after?, requested_time?, treatment_id?, doctor_id?, auto_select? }
//
//   start_after    – HH:mm or "11 AM" – find the FIRST free slot AFTER this time
//   requested_time – HH:mm            – book exactly this slot (or next if taken)
//   auto_select    – boolean          – pick the very first free slot on the date
// ---------------------------------------------------------------------------
export async function bookSlot(req, res) {
  await validate(req.body, {
    date: 'required|string',
  });

  const patient    = req.auth.user;
  const dateStr    = req.body.date;
  const startAfter = req.body.start_after    ?? null;   // "HH:mm" lower-bound (exclusive)
  const reqTime    = req.body.requested_time ?? null;   // exact time preference
  const autoSelect = req.body.auto_select    ?? false;  // take first available
  const doctorId   = req.body.doctor_id      ?? null;
  const treatmentId = req.body.treatment_id  ?? null;

  // Validate date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(422).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  const today = nowIST().format('YYYY-MM-DD');
  if (dateStr < today) {
    return res.status(422).json({ message: 'Cannot book appointments for past dates.' });
  }

  // Determine afterTimeMins
  let afterTimeMins = null;
  if (startAfter) {
    afterTimeMins = toMinutes(normalizeTimeString(startAfter));
  } else if (reqTime) {
    // For an exact time request, treat it as afterTimeMins - SLOT_MINUTES
    // so the exact slot itself is included in candidates
    afterTimeMins = toMinutes(normalizeTimeString(reqTime)) - 30;
    if (afterTimeMins < 0) afterTimeMins = null;
  }

  // Find the earliest available slot
  const result = await findNextAvailableSlot(dateStr, afterTimeMins, doctorId || null);

  if (!result.slot) {
    return res.status(409).json({
      message: `No available slots found${startAfter ? ` after ${startAfter}` : ''} on ${result.date}. The clinic may be fully booked for that day.`,
      available_dates: [],
    });
  }

  // If the slot landed on a different day, confirm with the user first
  if (result.isNextDay && !autoSelect && !req.body.confirmed_next_day) {
    return res.status(200).json({
      action: 'CONFIRM_NEXT_DAY',
      message: `No slots available${startAfter ? ` after ${startAfter}` : ''} on ${dateStr}. The next available slot is on ${result.date} at ${result.slot}. Reply with confirmed_next_day: true to book it.`,
      suggested_date: result.date,
      suggested_slot: result.slot,
      all_available: result.allAvailable,
    });
  }

  // Resolve doctor
  let doctor = doctorId ? await Doctor.findById(doctorId) : null;
  if (!doctor) doctor = await Doctor.findOne({ is_active: 1 });
  if (!doctor) {
    return res.status(503).json({ message: 'No active doctors available to assign the appointment.' });
  }

  // Resolve treatment
  let treatment = treatmentId ? await Treatment.findById(treatmentId) : null;

  // Book the slot (concurrency-safe)
  const finalDate = result.isNextDay ? result.date : dateStr;
  let appointment;
  try {
    appointment = await bookSlotAtomic({
      patientId:   patient.id,
      doctorId:    doctor.id,
      treatmentId: treatment?.id ?? null,
      dateStr:     finalDate,
      startTime:   result.slot,
      bookedVia:   'ai_chat',
      notes:       `Booked via AI Chat${startAfter ? ` (after ${startAfter})` : ''}${reqTime ? ` (requested ${reqTime})` : ''}`,
    });
  } catch (err) {
    if (err.code === 'SLOT_TAKEN') {
      // Race condition: retry with the next slot
      const retry = await findNextAvailableSlot(finalDate, toMinutes(result.slot), doctor.id);
      if (!retry.slot) {
        return res.status(409).json({
          message: `The ${result.slot} slot was just taken. No further slots available on ${finalDate}. Please try another date.`,
        });
      }
      try {
        appointment = await bookSlotAtomic({
          patientId:   patient.id,
          doctorId:    doctor.id,
          treatmentId: treatment?.id ?? null,
          dateStr:     retry.isNextDay ? retry.date : finalDate,
          startTime:   retry.slot,
          bookedVia:   'ai_chat',
          notes:       `Booked via AI Chat (auto-advanced due to conflict)`,
        });
        // Update finalDate if it moved
        if (retry.isNextDay) {
          Object.assign(result, { slot: retry.slot, date: retry.date });
        } else {
          result.slot = retry.slot;
        }
      } catch (err2) {
        return res.status(409).json({ message: err2.message });
      }
    } else {
      throw err;
    }
  }

  // Send confirmation email (non-blocking)
  try {
    await notificationService.sendTreatmentBookingEmail(appointment, patient, treatment, doctor);
  } catch (emailErr) {
    console.error('AI chat booking email failed:', emailErr.message);
  }

  const bookedDateLabel = appointment.appointment_date ?? finalDate;
  const bookedTime12h   = formatTime12h(String(appointment.start_time).substring(0, 5));

  return res.status(201).json({
    success: true,
    message: `Your appointment has been booked for ${formatDateFull(bookedDateLabel)} at ${bookedTime12h}.`,
    appointment: {
      id: String(appointment.id ?? appointment._id),
      date: bookedDateLabel,
      
      start_time: String(appointment.start_time).substring(0, 5),
      start_time_12h: bookedTime12h,
      end_time: String(appointment.end_time ?? '').substring(0, 5),
      treatment: treatment?.name ?? 'General Consultation',
      doctor: `Dr. ${doctor.name}`,
      status: appointment.status,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise loose time strings to HH:mm.
 * Handles: "11 AM", "11:30 AM", "14:00", "2pm", "11am" etc.
 */
function normalizeTimeString(raw) {
  if (!raw) return '09:00';
  const s = String(raw).trim().toLowerCase();

  // Try HH:mm 24h first
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) return `${hhmm[1].padStart(2, '0')}:${hhmm[2]}`;

  // Try 12h with optional minutes
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? 0);
    const mer = ampm[3];
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Bare number like "11" → assume AM if < 8 → PM otherwise
  const bare = s.match(/^(\d{1,2})$/);
  if (bare) {
    let h = Number(bare[1]);
    if (h < 8) h += 12; // 1–7 → PM (1pm–7pm)
    return `${String(h).padStart(2, '0')}:00`;
  }

  return '09:00';
}

function formatTime12h(timeStr) {
  const [h, m] = String(timeStr).substring(0, 5).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDateFull(dateStr) {
  return dayjs.tz(dateStr, 'YYYY-MM-DD', TZ).format('MMMM D, YYYY');
}
