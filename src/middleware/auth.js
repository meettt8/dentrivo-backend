import config from '../config/index.js';
import { clearAuthCookie, resolveUserFromToken } from '../utils/auth.js';

/**
 * Populates `req.auth` from the session cookie on every request. Never rejects; the
 * `requireGuard` middlewares below do the rejecting.
 */
export async function resolveAuth(req, res, next) {
  req.auth = null;
  let token = req.cookies?.[config.auth.cookieName];
  if (!token && req.headers?.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  if (!token) return next();

  const resolved = await resolveUserFromToken(token);
  if (resolved) {
    req.auth = resolved;
    req.user = resolved.user;
  }
  return next();
}

/** Guard-specific gate. */
export function requireGuard(guard) {
  return async function guardMiddleware(req, res, next) {
    if (!req.auth || req.auth.guard !== guard) {
      return res.status(401).json({ message: 'Please login to continue.', guard });
    }

    const { user } = req.auth;

    if (guard === 'doctor' && !user.is_active) {
      clearAuthCookie(res);
      return res.status(403).json({ message: 'Your account is inactive.', guard });
    }

    return next();
  };
}

export const requireClinicAdmin = requireGuard('clinic_admin');
export const requireDoctor = requireGuard('doctor');
export const requirePatient = requireGuard('patient');
