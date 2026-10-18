import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { ClinicAdmin, Doctor, Patient } from '../models/index.js';

/**
 * Three session guards (`clinic_admin`, `doctor`, `patient`).
 * Here the identities are carried in a signed, httpOnly
 * JWT cookie whose `guard` claim selects the table to load.
 */
export const GUARDS = {
  clinic_admin: { table: ClinicAdmin, type: 'ClinicAdmin' },
  doctor: { table: Doctor, type: 'Doctor' },
  patient: { table: Patient, type: 'Patient' },
};

export const GUARD_ORDER = ['clinic_admin', 'doctor', 'patient'];

export function hashPassword(plain) {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export function checkPassword(plain, hashed) {
  if (!hashed) return Promise.resolve(false);
  return bcrypt.compare(plain, hashed);
}

export function issueToken({ id, guard }, remember = false) {
  return jwt.sign({ sub: String(id), guard }, config.auth.jwtSecret, {
    expiresIn: remember ? config.auth.jwtRememberExpiresIn : config.auth.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    return null;
  }
}

/** Write the session cookie — the equivalent of `Auth::guard(...)->login()`. */
export function setAuthCookie(res, token, remember = false) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.app.env === 'production',
    maxAge: remember ? 30 * 24 * 60 * 60 * 1000 : 120 * 60 * 1000,
    path: '/',
  });
}

/** `Auth::guard(...)->logout()` + `session()->invalidate()`. */
export function clearAuthCookie(res) {
  res.clearCookie(config.auth.cookieName, { path: '/' });
}

/**
 * `Auth::guard($guard)->attempt([...])`. Extra equality constraints (such as
 * the doctor guard's `is_active => true`) go in `extraConditions`.
 */
export async function attempt(guard, { email, password }, extraConditions = {}) {
  const definition = GUARDS[guard];
  if (!definition) return null;

  // The password column is hidden by default; ask for it explicitly.
  const user = await definition.table.findOne(
    { email, ...extraConditions },
    { keepHidden: ['password'] },
  );

  if (!user) return null;
  if (!(await checkPassword(password, user.password))) return null;

  delete user.password;
  return user;
}

/** Load the user a request's token points at, or null. */
export async function resolveUserFromToken(token) {
  const payload = verifyToken(token);
  if (!payload) return null;

  const definition = GUARDS[payload.guard];
  if (!definition) return null;

  const user = await definition.table.findById(payload.sub);
  if (!user) return null;

  return { user, guard: payload.guard, userType: definition.type };
}
