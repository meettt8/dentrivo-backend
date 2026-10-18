import {
  AuditLog, NotificationLog, NotificationTemplate,
} from '../../models/index.js';
import { filled, likeTerm } from '../../utils/helpers.js';
import { validate } from '../../utils/validate.js';

export async function auditLogs(req, res) {
  const filter = {};

  if (filled(req.query.event)) {
    filter.event = req.query.event;
  }
  if (filled(req.query.search)) {
    filter.auditable_type = { like: likeTerm(req.query.search) };
  }

  const logs = await AuditLog.paginate({
    where: filter,
    orderBy: '`created_at` DESC, `id` DESC',
    page: req.query.page,
    perPage: 50,
  });
  logs.data = AuditLog.presentAll(logs.data);

  return res.json({ logs });
}

export async function notificationTemplates(req, res) {
  const templates = await NotificationTemplate.find(
    {},
    { orderBy: '`id` ASC' },
  );

  return res.json({ templates });
}

export async function saveNotificationTemplate(req, res) {
  await validate(req.body, {
    type: 'required|string',
    channel: 'required|in:sms,email,whatsapp,in_app',
    body: 'required|string',
  });

  const template = await NotificationTemplate.updateOrCreate(
    { type: req.body.type, channel: req.body.channel },
    {
      subject: req.body.subject ?? null,
      body: req.body.body,
      variables: parseJson(req.body.variables),
      is_active: req.body.is_active === undefined ? 1 : (req.body.is_active ? 1 : 0),
    },
  );

  return res.json({
    success: true,
    message: 'Notification template saved.',
    template,
  });
}

export async function notificationsLog(req, res) {
  const logs = await NotificationLog.paginate({
    where: {},
    orderBy: '`created_at` DESC, `id` DESC',
    page: req.query.page,
    perPage: 50,
  });
  logs.data = NotificationLog.presentAll(logs.data);

  const [total, sent, delivered, failed] = await Promise.all([
    NotificationLog.count({}),
    NotificationLog.count({ status: 'sent' }),
    NotificationLog.count({ status: 'delivered' }),
    NotificationLog.count({ status: 'failed' }),
  ]);

  return res.json({ logs, stats: { total, sent, delivered, failed } });
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
