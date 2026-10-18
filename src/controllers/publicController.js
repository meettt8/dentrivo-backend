import {
  Appointment, Clinic, Conversation, Doctor, Patient, Treatment,
} from '../models/index.js';
import aiEngine from '../services/AiEngineService.js';
import notificationService from '../services/NotificationService.js';
import { validate } from '../utils/validate.js';
import { nextPatientCode } from './auth/authController.js';

/** `Route::get('/pricing', ...)` supplied active plans to the pricing page. */
export async function pricing(req, res) {
  return res.json({ plans: [] });
}

/** Get clinic contact & profile info for public website */
export async function publicClinic(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  let clinic = await Clinic.findOne({});
  if (!clinic) {
    clinic = {
      name: 'Dentrivo Dental Clinic',
      email: 'info@dentalai.com',
      phone: '+31 12345-67890',
      address: '123 Health Care Ave, Suite 400',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    };
  }
  return res.json({ clinic });
}

/** Get list of active dental treatments for public booking */
export async function publicTreatments(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const treatments = await Treatment.find({});
  return res.json({ treatments });
}

/** Get list of active doctors for public booking */
export async function publicDoctors(req, res) {
  const doctors = await Doctor.find({ is_active: 1 });
  return res.json({ doctors });
}

/** Public Chat Endpoint - Chatbot is disabled in guest mode */
export async function publicChat(req, res) {
  // Enforce authentication: Guest mode chat is disabled
  if (!req.auth || !req.auth.user) {
    return res.status(401).json({
      status: 'error',
      message: 'Chatbot is disabled in guest mode. Please log in to chat with Dentrivo AI Assistant.',
    });
  }

  await validate(req.body, { message: 'required|string' });

  const userId = String(req.body.user_id || req.auth.user.email || `patient-${req.auth.user.id}`).trim();

  let conversation = await Conversation.findOne({
    patient_phone: userId,
    status: 'active',
  });

  if (!conversation) {
    conversation = await Conversation.create({
      patient_name: req.auth.user.name || 'Patient',
      patient_phone: req.auth.user.phone || userId,
      channel: 'web',
      status: 'active',
      context_memory: { turn_count: 0 },
    });
  }

  const result = await aiEngine.processInput(conversation, req.body.message);

  return res.json({
    status: 'success',
    reply: result.response,
    intent: result.intent,
    wants_to_book: result.intent === 'booking',
  });
}

/** Book appointment directly without logging in (Guest Booking) */
export async function bookAppointment(req, res) {
  await validate(req.body, {
    name: 'required|string',
    email: 'required|email',
    age: 'required|numeric|min:1|max:120',
    blood_group: 'required|string',
    gender: 'required|string',
    phone: 'nullable|string',
    appointment_date: 'required|date',
    start_time: 'required|string',
  });

  const email = req.body.email.trim().toLowerCase();
  const phone = (req.body.phone || '').trim();
  const name = req.body.name.trim();
  const age = Number(req.body.age);
  const bloodGroup = req.body.blood_group ? req.body.blood_group.trim() : null;
  const gender = req.body.gender ? req.body.gender.trim().toLowerCase() : null;

  // Approximate date of birth from age
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - age;
  const dateOfBirth = `${birthYear}-01-01`;

  // Find or auto-create patient profile
  const searchConditions = [{ email }];
  if (phone) {
    searchConditions.push({ phone });
  }

  let patient = await Patient.findOne({
    or: searchConditions,
  });

  if (!patient) {
    const patientCode = await nextPatientCode();
    patient = await Patient.create({
      patient_code: patientCode,
      name,
      email,
      phone: phone || null,
      age,
      date_of_birth: dateOfBirth,
      blood_group: bloodGroup,
      gender,
      patient_type: 'new',
      is_active: 1,
    });
  } else {
    // Update existing patient with the latest provided details
    await Patient.update(patient.id, {
      name,
      age,
      date_of_birth: patient.date_of_birth || dateOfBirth,
      blood_group: bloodGroup || patient.blood_group,
      gender: gender || patient.gender,
      ...(phone ? { phone } : {}),
    });
    patient = await Patient.findById(patient.id);
  }

  // Assign doctor
  let doctorId = req.body.doctor_id;
  if (!doctorId) {
    const defaultDoctor = await Doctor.findOne({ is_active: 1 });
    doctorId = defaultDoctor ? defaultDoctor.id : null;
  }

  // Get treatment details
  let treatmentId = req.body.treatment_id || null;
  let treatmentName = 'General Dental Consultation';
  if (treatmentId) {
    const tr = await Treatment.findById(treatmentId);
    if (tr) treatmentName = tr.name;
  }

  const startTime = req.body.start_time;
  const formattedStartTime = startTime.length === 5 ? `${startTime}:00` : startTime;

  const [h, m] = formattedStartTime.split(':').map(Number);
  const endHour = String(m >= 30 ? h + 1 : h).padStart(2, '0');
  const endMin = String((m + 30) % 60).padStart(2, '0');
  const formattedEndTime = `${endHour}:${endMin}:00`;

  const bookedVia = req.body.booked_via || (req.body.notes?.includes('Chatbot') ? 'ai_chat' : 'public_website');

  const appointment = await Appointment.create({
    patient_id: patient.id,
    doctor_id: doctorId,
    treatment_id: treatmentId,
    appointment_date: req.body.appointment_date,
    start_time: formattedStartTime,
    end_time: formattedEndTime,
    status: 'pending',
    booked_via: bookedVia,
    notes: req.body.notes || `Guest Booking without login (${treatmentName})`,
  });

  // Dispatch treatment booking email
  try {
    const doctor = doctorId ? await Doctor.findById(doctorId) : null;
    const treatment = treatmentId ? await Treatment.findById(treatmentId) : { name: treatmentName };
    await notificationService.sendTreatmentBookingEmail(appointment, patient, treatment, doctor);
  } catch (err) {
    console.error('Failed to send public treatment booking confirmation email:', err.message);
  }

  return res.status(201).json({
    success: true,
    message: `Appointment successfully booked for ${name} on ${req.body.appointment_date} at ${formattedStartTime}!`,
    appointment,
    patient,
  });
}
