/**
 * Middleware to restrict patient file uploads/deletions to Doctors and Receptionists (Clinic Admins).
 */
export function requireDoctorOrReceptionist(req, res, next) {
  if (!req.auth || !['doctor', 'clinic_admin'].includes(req.auth.guard)) {
    return res.status(403).json({
      message: 'You are not authorized to upload patient files.',
    });
  }
  return next();
}
