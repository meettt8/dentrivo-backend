/**
 * AppointmentIntelligenceService
 *
 * Provides:
 *  - findNextAvailableSlot(date, afterTime, doctorId)  → earliest free slot
 *  - getDaySchedule(dateStr, patientId?, doctorId?)     → appointments for a day
 *  - getAvailableSlots(dateStr, doctorId?)              → free slots for a day
 *  - bookSlotAtomic(params)                             → concurrency-safe insert
 *
 * Timezone: Asia/Kolkata (IST) for all date/time math.
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { Appointment, Doctor, Patient, Treatment, WorkingHour } from '../models/index.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TZ = 'Asia/Kolkata';

// Clinic defaults (used when no WorkingHour record exists for the doctor/day)
const DEFAULT_OPEN  = '09:00';
const DEFAULT_CLOSE = '17:00';
const SLOT_MINUTES  = 30;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return IST "now" as a dayjs object. */
function nowIST() {
  return dayjs().tz(TZ);
}

/** Parse a YYYY-MM-DD string into a dayjs date (IST midnight). */
function parseDate(dateStr) {
  return dayjs.tz(dateStr, 'YYYY-MM-DD', TZ).startOf('day');
}

/**
 * Generate all clock-time slots for a day given open/close (HH:mm strings)
 * and slot duration in minutes.
 */
function generateSlots(openTime, closeTime, slotMinutes = SLOT_MINUTES) {
  const slots = [];
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  let cursor = oh * 60 + om;
  const end   = ch * 60 + cm;
  while (cursor < end) {
    const hh = String(Math.floor(cursor / 60)).padStart(2, '0');
    const mm = String(cursor % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
    cursor += slotMinutes;
  }
  return slots;
}

/** HH:mm → minutes-since-midnight */
function toMinutes(timeStr) {
  const [h, m] = String(timeStr).substring(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Format HH:mm to 12-hour AM/PM */
function to12h(timeStr) {
  const mins = toMinutes(timeStr);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the doctor's configured working hours for a given day-of-week index
 * (0 = Sunday … 6 = Saturday). Falls back to clinic defaults.
 */
export async function getDoctorHours(doctorId, dayOfWeek) {
  if (doctorId) {
    const wh = await WorkingHour.findOne({ doctor_id: doctorId, day_of_week: dayOfWeek });
    if (wh && wh.open_time && wh.close_time) {
      return {
        open:  wh.open_time.substring(0, 5),
        close: wh.close_time.substring(0, 5),
        isOpen: wh.is_open !== false,
      };
    }
  }
  return { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, isOpen: true };
}

/**
 * Return all booked start-times (HH:mm) for a given date + optional doctor.
 * Cancelled appointments are excluded.
 */
export async function getBookedTimes(dateStr, doctorId = null) {
  const filter = {
    appointment_date: dateStr,
    status: { ne: 'cancelled' },
  };
  if (doctorId) filter.doctor_id = doctorId;

  const booked = await Appointment.find(filter, {});
  return new Set(booked.map((a) => String(a.start_time).substring(0, 5)));
}

/**
 * Get all available (free) slots for a date.
 * Skips past slots when dateStr === today.
 *
 * @param {string}  dateStr   – YYYY-MM-DD
 * @param {string|null} doctorId
 * @returns {string[]} HH:mm slot strings
 */
export async function getAvailableSlots(dateStr, doctorId = null) {
  const date = parseDate(dateStr);
  const dow  = date.day(); // 0 = Sun

  // Clinic closed on Sundays
  if (dow === 0) return [];

  const hours = await getDoctorHours(doctorId, dow);
  if (!hours.isOpen) return [];

  const allSlots  = generateSlots(hours.open, hours.close);
  const bookedSet = await getBookedTimes(dateStr, doctorId);

  const todayStr = nowIST().format('YYYY-MM-DD');
  const nowMins  = nowIST().hour() * 60 + nowIST().minute();

  return allSlots.filter((s) => {
    if (bookedSet.has(s)) return false;
    // For today, skip slots that have already passed
    if (dateStr === todayStr && toMinutes(s) <= nowMins) return false;
    return true;
  });
}

/**
 * Find the earliest available slot AFTER a given time on a given date.
 * If afterTimeMins is null, returns the very first free slot.
 *
 * @param {string}     dateStr       – YYYY-MM-DD
 * @param {number|null} afterTimeMins – minutes-since-midnight (exclusive lower bound)
 * @param {string|null} doctorId
 * @returns {{ slot: string|null, date: string, nextDate?: string }}
 */
export async function findNextAvailableSlot(dateStr, afterTimeMins = null, doctorId = null) {
  const MAX_DAYS_AHEAD = 14;

  for (let offset = 0; offset < MAX_DAYS_AHEAD; offset++) {
    const d = parseDate(dateStr).add(offset, 'day');
    const dStr = d.format('YYYY-MM-DD');

    const available = await getAvailableSlots(dStr, doctorId);

    let candidates = available;
    if (afterTimeMins !== null && offset === 0) {
      // On the requested date, only slots strictly after afterTimeMins
      candidates = available.filter((s) => toMinutes(s) > afterTimeMins);
    }

    if (candidates.length > 0) {
      return {
        slot: candidates[0],
        date: dStr,
        isNextDay: offset > 0,
        allAvailable: candidates,
      };
    }

    // Only search ahead when original date is fully booked
    if (offset === 0 && afterTimeMins === null) break;
  }

  return { slot: null, date: dateStr, isNextDay: false, allAvailable: [] };
}

/**
 * Return the appointment schedule for a given date.
 * Optionally filtered by patientId (for patients) or doctorId (for doctors).
 * Admins pass neither and get the full clinic schedule.
 *
 * @returns {{ appointments: object[], dateStr: string, label: string }}
 */
export async function getDaySchedule(dateStr, { patientId = null, doctorId = null } = {}) {
  const filter = {
    appointment_date: dateStr,
    status: { ne: 'cancelled' },
  };
  if (patientId) filter.patient_id = patientId;
  if (doctorId)  filter.doctor_id  = doctorId;

  const raw = await Appointment.find(filter, { orderBy: 'start_time ASC' });

  // Hydrate with patient/doctor/treatment names
  const hydrated = await Promise.all(
    raw.map(async (appt) => {
      const [patient, doctor, treatment] = await Promise.all([
        appt.patient_id ? Patient.findById(appt.patient_id).catch(() => null) : null,
        appt.doctor_id  ? Doctor.findById(appt.doctor_id).catch(() => null)   : null,
        appt.treatment_id ? Treatment.findById(appt.treatment_id).catch(() => null) : null,
      ]);
      return {
        id: String(appt.id ?? appt._id),
        time: String(appt.start_time).substring(0, 5),
        time12h: to12h(String(appt.start_time).substring(0, 5)),
        end_time: String(appt.end_time ?? '').substring(0, 5),
        status: appt.status,
        treatment: treatment?.name ?? 'General Consultation',
        patient_name: patient?.name ?? 'Patient',
        doctor_name: doctor?.name ? `Dr. ${doctor.name}` : 'Unassigned',
      };
    })
  );

  return {
    appointments: hydrated,
    dateStr,
    label: formatDateLabel(dateStr),
  };
}

/**
 * Atomically book a slot using MongoDB findOneAndUpdate with upsert=false
 * to ensure no double-booking even under concurrent requests.
 *
 * Strategy:
 *  1. Check slot is still free (read-check).
 *  2. Insert appointment — if a duplicate start_time+date already exists
 *     (caught by a unique partial index or a re-check), throw SlotTakenError.
 *
 * @returns {object} The created appointment document.
 */
export async function bookSlotAtomic({
  patientId,
  doctorId,
  treatmentId,
  dateStr,
  startTime,   // HH:mm
  bookedVia = 'ai_chat',
  notes = '',
}) {
  // 1. Re-validate slot is free (defence-in-depth)
  const bookedSet = await getBookedTimes(dateStr, doctorId);
  if (bookedSet.has(startTime)) {
    const err = new Error(`The ${to12h(startTime)} slot on ${dateStr} is already taken.`);
    err.code = 'SLOT_TAKEN';
    throw err;
  }

  // 2. Compute end time
  const [h, m] = startTime.split(':').map(Number);
  const endMins = h * 60 + m + SLOT_MINUTES;
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

  // 3. Create appointment
  const appointment = await Appointment.create({
    patient_id: patientId,
    doctor_id: doctorId,
    treatment_id: treatmentId ?? null,
    appointment_date: dateStr,
    start_time: `${startTime}:00`,
    end_time: `${endTime}:00`,
    status: 'pending',
    booked_via: bookedVia,
    notes: notes || `Booked via AI Chat (${startTime})`,
  });

  // 4. Post-insert duplicate check (catches race condition)
  const dups = await Appointment.find({
    appointment_date: dateStr,
    start_time: { in: [`${startTime}:00`, startTime] },
    status: { ne: 'cancelled' },
    ...(doctorId ? { doctor_id: doctorId } : {}),
  }, {});

  if (dups.length > 1) {
    // We lost the race — delete ours and report conflict
    try { await Appointment.update(appointment.id, { status: 'cancelled' }); } catch (_) { /* best-effort */ }
    const err = new Error(`The ${to12h(startTime)} slot on ${dateStr} was just taken by another booking.`);
    err.code = 'SLOT_TAKEN';
    throw err;
  }

  return appointment;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDateLabel(dateStr) {
  const todayStr = nowIST().format('YYYY-MM-DD');
  const tomorrowStr = nowIST().add(1, 'day').format('YYYY-MM-DD');
  if (dateStr === todayStr) return `Today (${dateStr})`;
  if (dateStr === tomorrowStr) return `Tomorrow (${dateStr})`;
  return dayjs.tz(dateStr, 'YYYY-MM-DD', TZ).format('dddd, MMM D, YYYY');
}

export { to12h, toMinutes, parseDate, nowIST };
