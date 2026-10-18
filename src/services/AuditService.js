import { AuditLog } from '../models/index.js';

/**
 * AUD-01 to AUD-04: Audit & Logging Service.
 * `req` carries what Laravel read off the Request facade (IP, user agent, guard).
 */
class AuditService {
  /** Log an auditable event. */
  async log(req, model, modelType, event, oldValues = null, newValues = null) {
    const user = req?.auth?.user ?? null;
    const userType = req?.auth?.userType ?? null;

    await AuditLog.create({
      auditable_type: modelType,
      auditable_id: model.id,
      user_type: userType,
      user_id: user?.id ?? null,
      event,
      old_values: oldValues,
      new_values: newValues,
      ip_address: req?.ip ?? null,
      user_agent: (req?.headers?.['user-agent'] ?? '').slice(0, 255) || null,
      device_info: this.parseDeviceInfo(req?.headers?.['user-agent']),
      created_at: new Date(),
    });
  }

  logCreated(req, model, modelType) {
    return this.log(req, model, modelType, 'created', null, model);
  }

  logUpdated(req, model, modelType, oldValues, newValues) {
    return this.log(req, model, modelType, 'updated', oldValues, newValues);
  }

  logDeleted(req, model, modelType) {
    return this.log(req, model, modelType, 'deleted', model, null);
  }

  logLogin(req, user, userType) {
    return this.log(req, user, userType, 'login');
  }

  logLogout(req, user, userType) {
    return this.log(req, user, userType, 'logout');
  }

  /** Parse basic device info from the User-Agent. */
  parseDeviceInfo(userAgent) {
    if (!userAgent) return null;
    if (userAgent.includes('Mobile')) return 'Mobile';
    if (userAgent.includes('Tablet')) return 'Tablet';
    return 'Desktop';
  }
}

export default new AuditService();
