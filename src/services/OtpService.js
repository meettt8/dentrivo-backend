import config from '../config/index.js';
import { Patient } from '../models/index.js';
import { getOtpEmailHtml } from './NotificationService.js';
import { sendEmail } from '../utils/mailer.js';

/** In-memory OTP storage map: key -> { code, channel, expiresAt, attempts, patient, keys } */
const otpStore = new Map();

/** OTP valid for 5 minutes (300,000 ms) */
const OTP_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Flexible patient lookup helper supporting email, formatted phone, and digit-only phone matching.
 */
export async function findPatientByIdentifier(identifier) {
  const rawKey = String(identifier || '').trim().toLowerCase();
  if (!rawKey) return null;

  // 1. Direct match on email
  let patient = await Patient.findOne({ email: rawKey });
  if (patient) return patient;

  // 2. Direct match on phone
  patient = await Patient.findOne({ phone: rawKey });
  if (patient) return patient;

  // 3. Match digits-only of phone number (e.g. 9111111111 vs +91 9111111111)
  const digitsOnly = rawKey.replace(/\D/g, '');
  if (digitsOnly.length >= 7) {
    const allPatients = await Patient.find({});
    patient = allPatients.find((p) => {
      const pDigits = String(p.phone || '').replace(/\D/g, '');
      return pDigits.length >= 7 && (pDigits === digitsOnly || pDigits.endsWith(digitsOnly) || digitsOnly.endsWith(pDigits));
    });
    if (patient) return patient;
  }

  return null;
}

class OtpService {
  /**
   * Generate a 6-digit numeric OTP code.
   */
  generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate and store OTP for a given patient & identifier.
   */
  createOtp(patient, identifier, channel = 'email') {
    const code = this.generateCode();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;
    const record = {
      code,
      channel,
      expiresAt,
      attempts: 0,
      patient,
      keys: [],
    };

    const keySet = new Set();
    if (identifier) keySet.add(String(identifier).trim().toLowerCase());
    if (patient?.email) keySet.add(String(patient.email).trim().toLowerCase());
    if (patient?.phone) {
      keySet.add(String(patient.phone).trim().toLowerCase());
      const pDigits = String(patient.phone).replace(/\D/g, '');
      if (pDigits) keySet.add(pDigits);
    }
    const inputDigits = String(identifier || '').replace(/\D/g, '');
    if (inputDigits) keySet.add(inputDigits);

    record.keys = Array.from(keySet);

    for (const k of record.keys) {
      otpStore.set(k, record);
    }

    return { code, expiresAt };
  }

  /**
   * Send OTP via Email.
   */
  async sendOtp(identifier, channel = 'email') {
    const patient = await findPatientByIdentifier(identifier);

    if (!patient) {
      throw new Error('No registered patient account found with this email or phone number.');
    }

    const { code } = this.createOtp(patient, identifier, 'email');
    const messageText = `Your Dentrivo login OTP is ${code}. Valid for 5 minutes. Do not share this code with anyone.`;

    const patientName = patient?.name || 'Patient';
    const subject = 'Dentrivo - Your Login Verification Code';
    const htmlBody = getOtpEmailHtml(code, patientName);

    // Send email via Brevo HTTP API (10s timeout, raises on failure)
    await sendEmail({
      to: patient.email,
      subject,
      text: messageText,
      html: htmlBody,
    });

    return {
      success: true,
      channel: 'email',
      recipient: patient.email,
    };
  }

  /**
   * Verify an OTP code for a given identifier.
   */
  verifyOtp(identifier, inputCode) {
    const rawKey = String(identifier || '').trim().toLowerCase();
    const digitsOnly = rawKey.replace(/\D/g, '');

    let record = otpStore.get(rawKey);
    if (!record && digitsOnly) {
      record = otpStore.get(digitsOnly);
    }

    // Fallback search across active records
    if (!record) {
      for (const r of otpStore.values()) {
        if (r.keys.includes(rawKey) || (digitsOnly && r.keys.includes(digitsOnly))) {
          record = r;
          break;
        }
      }
    }

    if (!record) {
      return { valid: false, message: 'OTP not found or expired. Please request a new OTP.' };
    }

    if (Date.now() > record.expiresAt) {
      for (const k of record.keys) otpStore.delete(k);
      return { valid: false, message: 'OTP has expired. Please request a new code.' };
    }

    if (record.attempts >= 5) {
      for (const k of record.keys) otpStore.delete(k);
      return { valid: false, message: 'Too many invalid attempts. Please request a new OTP.' };
    }

    if (record.code !== String(inputCode).trim()) {
      record.attempts += 1;
      return { valid: false, message: 'Invalid OTP code. Please check and try again.' };
    }

    // Success - consume the OTP across all associated keys
    for (const k of record.keys) otpStore.delete(k);
    return { valid: true, patient: record.patient };
  }
}

export default new OtpService();
