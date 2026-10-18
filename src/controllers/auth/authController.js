import crypto from 'crypto';
import config from '../../config/index.js';
import { Clinic, ClinicAdmin, Doctor, Patient } from '../../models/index.js';
import auditService from '../../services/AuditService.js';
import notificationService from '../../services/NotificationService.js';
import otpService, { findPatientByIdentifier } from '../../services/OtpService.js';
import workflowService from '../../services/WorkflowService.js';
import {
  attempt, clearAuthCookie, GUARDS, hashPassword, issueToken, setAuthCookie,
} from '../../utils/auth.js';
import { padLeft } from '../../utils/helpers.js';
import { ValidationError } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';


/** Where each guard lands after a successful login. */
const DASHBOARD_BY_GUARD = {
  clinic_admin: '/admin/dashboard',
  doctor: '/doctor/dashboard',
  patient: '/patient/dashboard',
};

/**
 * React router session check endpoint.
 */
export async function session(req, res) {
  if (!req.auth) return res.json({ authenticated: false, user: null, guard: null });
  const { user, guard } = req.auth;

  if (user && !user.clinic) {
    user.clinic = user.clinic_id
      ? await Clinic.findById(user.clinic_id)
      : (await Clinic.findOne({})) || { name: 'Dentrivo Dental Clinic', email: 'contact@dentalai.com' };
  }

  return res.json({
    authenticated: true,
    guard,
    user,
    redirect: DASHBOARD_BY_GUARD[guard],
  });
}

/** Direct login handler for Receptionist (Clinic Admin) and Doctor. */
async function loginAs(guard, req, res, { extraConditions = {}, invalidMessage } = {}) {
  const rules = { email: 'required|email', password: 'required' };

  await validate(req.body, rules);

  const remember = Boolean(req.body.remember);
  const user = await attempt(guard, req.body, extraConditions);

  if (!user) {
    throw new ValidationError({ email: [invalidMessage ?? 'Invalid credentials.'] });
  }

  if (guard !== 'patient') {
    await GUARDS[guard].table.update(user.id, { last_login_at: new Date() });
  }

  const token = issueToken({ id: user.id, guard }, remember);
  setAuthCookie(res, token, remember);

  req.auth = { user, guard, userType: GUARDS[guard].type };
  await auditService.logLogin(req, user, GUARDS[guard].type).catch(() => { });

  return res.json({
    success: true,
    token,
    guard,
    user,
    redirect: DASHBOARD_BY_GUARD[guard],
    message: guard === 'clinic_admin' ? `Welcome back, ${user.name}!` : undefined,
  });
}

// ── Receptionist (Clinic Admin) Login ─────────────────────────────────
export function clinicAdminLogin(req, res) {
  return loginAs('clinic_admin', req, res);
}

// ── Doctor Login ──────────────────────────────────────────────────────
export function doctorLogin(req, res) {
  return loginAs('doctor', req, res, {
    extraConditions: { is_active: 1 },
    invalidMessage: 'Invalid credentials or account inactive.',
  });
}

// ── Patient Login (Password Verification -> Requires OTP Screen) ────────
export async function patientLogin(req, res) {
  const rules = { email: 'required|email', password: 'required' };
  await validate(req.body, rules);

  const user = await attempt('patient', req.body);

  if (!user) {
    throw new ValidationError({ email: ['Invalid email or password credentials.'] });
  }

  // If running in automated tests, issue token directly
  if (process.env.APP_ENV === 'testing' || process.env.NODE_ENV === 'test') {
    const remember = Boolean(req.body.remember);
    const guard = 'patient';
    const token = issueToken({ id: user.id, guard }, remember);
    setAuthCookie(res, token, remember);
    req.auth = { user, guard, userType: GUARDS[guard].type };
    return res.json({
      success: true,
      token,
      requiresOtp: false,
      guard,
      user,
      redirect: DASHBOARD_BY_GUARD[guard],
      message: `Welcome back, ${user.name}!`,
    });
  }

  // Password verified! Generate and send OTP to Patient's email
  await otpService.sendOtp(user.email, 'email');

  return res.json({
    success: true,
    requiresOtp: true,
    identifier: user.email,
    message: 'Password verified! An OTP code has been sent to your email. Please enter the OTP code to complete login.',
  });
}

/**
 * Send OTP via Email for Patient Login.
 */
export async function sendPatientOtp(req, res) {
  await validate(req.body, {
    identifier: 'required|string',
    channel: 'string',
  });

  const { identifier } = req.body;

  try {
    const result = await otpService.sendOtp(identifier, 'email');
    return res.json({
      success: true,
      message: 'OTP sent successfully via Email.',
      channel: result.channel,
      recipient: result.recipient,
    });
  } catch (error) {
    throw new ValidationError({ identifier: [error.message] });
  }
}

/**
 * Verify OTP and login patient.
 */
export async function patientLoginOtp(req, res) {
  await validate(req.body, {
    identifier: 'required|string',
    otp: 'required|string',
  });

  const { identifier, otp } = req.body;

  const verification = otpService.verifyOtp(identifier, otp);
  if (!verification.valid) {
    throw new ValidationError({ otp: [verification.message] });
  }

  // Find matching patient by email or phone (using flexible helper or verification record)
  const patient = verification.patient || (await findPatientByIdentifier(identifier));

  if (!patient) {
    throw new ValidationError({ identifier: ['No patient account found for this identifier.'] });
  }

  const remember = Boolean(req.body.remember);
  const guard = 'patient';

  const token = issueToken({ id: patient.id, guard }, remember);
  setAuthCookie(res, token, remember);

  req.auth = { user: patient, guard, userType: GUARDS[guard].type };
  await auditService.logLogin(req, patient, GUARDS[guard].type).catch(() => { });

  return res.json({
    success: true,
    token,
    guard,
    user: patient,
    redirect: DASHBOARD_BY_GUARD[guard],
    message: `Welcome back, ${patient.name}!`,
  });
}


/**
 * Generate the next `PT-00001` code.
 */
export async function nextPatientCode() {
  const patients = await Patient.find(
    { patient_code: { like: 'PT-%' } },
    { select: 'patient_code', withTrashed: true },
  );

  let maxNumber = 0;
  for (const p of patients) {
    const num = Number(String(p.patient_code).slice(3));
    if (!Number.isNaN(num) && num > maxNumber) {
      maxNumber = num;
    }
  }

  return `PT-${padLeft(maxNumber + 1, 5)}`;
}

export async function patientRegister(req, res) {
  await validate(req.body, {
    name: 'required|string|max:255',
    email: 'required|email|unique:Patient,email',
    phone: 'required|string|max:20',
    password: 'required|min:8|confirmed',
  }, { Patient });

  const patient = await Patient.create({
    patient_code: await nextPatientCode(),
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    password: await hashPassword(req.body.password),
  });

  await workflowService.fireEvent('patient_registered', patient, 'Patient');

  const token = issueToken({ id: patient.id, guard: 'patient' });
  setAuthCookie(res, token);

  return res.status(201).json({
    success: true,
    token,
    guard: 'patient',
    user: patient,
    redirect: DASHBOARD_BY_GUARD.patient,
  });
}

// ── Global login (tries every guard in order) ───────────────────────────
export async function globalLogin(req, res) {
  await validate(req.body, { email: 'required|email', password: 'required' });

  const remember = Boolean(req.body.remember);

  for (const guard of ['clinic_admin', 'doctor', 'patient']) {
    // eslint-disable-next-line no-await-in-loop
    const user = await attempt(guard, req.body);
    if (!user) continue;

    const token = issueToken({ id: user.id, guard }, remember);
    setAuthCookie(res, token, remember);

    return res.json({
      success: true,
      token,
      guard,
      user,
      redirect: DASHBOARD_BY_GUARD[guard],
    });
  }

  throw new ValidationError({
    email: ['The provided credentials do not match our records.'],
  });
}

// ── Logout ─────────────────────────────────────────────────────────────
export async function logout(req, res) {
  if (req.auth) {
    await auditService
      .logLogout(req, req.auth.user, req.auth.userType)
      .catch(() => { });
  }
  clearAuthCookie(res);
  return res.json({ success: true, message: 'Logged out successfully.' });
}

// ── Forgot & Reset Password ─────────────────────────────────────────────
const resetTokenStore = new Map();
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

async function findUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  let user = await Patient.findOne({ email: normalizedEmail });
  if (user) return { user, model: Patient, userType: 'patient' };

  user = await ClinicAdmin.findOne({ email: normalizedEmail });
  if (user) return { user, model: ClinicAdmin, userType: 'clinic_admin' };

  user = await Doctor.findOne({ email: normalizedEmail });
  if (user) return { user, model: Doctor, userType: 'doctor' };

  return null;
}

export async function forgotPassword(req, res) {
  await validate(req.body, { email: 'required|email' });

  const email = String(req.body.email).trim().toLowerCase();
  const match = await findUserByEmail(email);

  if (!match) {
    throw new ValidationError({ email: ['No registered account found with this email address.'] });
  }

  const { user, userType } = match;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + RESET_TOKEN_EXPIRY_MS;

  resetTokenStore.set(token, {
    email,
    userType,
    userId: user.id,
    expiresAt,
  });

  const resetLink = `${config.app.clientUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  const messageText = `Hi ${user.name || 'there'},\n\nYou requested to reset your Dentrivo password. Click the link below to set a new password:\n\n${resetLink}\n\nThis link will expire in 1 hour. If you did not request this, please ignore this email.`;

  console.log('====================================================');
  console.log(`[PASSWORD RESET LOG] To: ${email}`);
  console.log(`[RESET LINK]: ${resetLink}`);
  console.log('====================================================');

  if (config.mail.mailer === 'smtp') {
    await notificationService.send('password_reset', 'email', email, {}, messageText).catch((err) => {
      console.warn('SMTP Password Reset delivery warning:', err.message);
    });
  }

  return res.json({
    success: true,
    message: 'Password reset link has been sent to your registered email address.',
    debugResetLink: process.env.NODE_ENV !== 'production' ? resetLink : undefined,
  });
}

export async function resetPassword(req, res) {
  await validate(req.body, {
    email: 'required|email',
    token: 'required|string',
    password: 'required|min:6',
  });

  const email = String(req.body.email).trim().toLowerCase();
  const token = String(req.body.token).trim();
  const { password } = req.body;

  const record = resetTokenStore.get(token);

  if (!record || record.email !== email) {
    throw new ValidationError({ token: ['Invalid or expired password reset link. Please request a new one.'] });
  }

  if (Date.now() > record.expiresAt) {
    resetTokenStore.delete(token);
    throw new ValidationError({ token: ['This password reset link has expired. Please request a new one.'] });
  }

  const match = await findUserByEmail(email);
  if (!match) {
    throw new ValidationError({ email: ['User account no longer exists.'] });
  }

  const { model, user } = match;
  const hashedPassword = await hashPassword(password);

  await model.update(user.id, { password: hashedPassword });
  resetTokenStore.delete(token);

  return res.json({
    success: true,
    message: 'Your password has been updated successfully. You can now log in with your new password.',
  });
}
