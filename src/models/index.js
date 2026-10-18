import Table from '../db/Table.js';

/**
 * One repository per table. The `appends` callbacks reproduce the accessors the
 * Blade views used (`avatar_url`, `logo_url`, `age`, `human_file_size`), so the
 * JSON the API returns keeps the exact shape the React pages already read.
 */

const avatar = (name, background) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name ?? '')}&background=${background}&color=fff`;

/** FILE-04: the `human_file_size` accessor from the Eloquent model. */
function humanFileSize(bytes) {
  const size = Number(bytes ?? 0);
  if (size >= 1048576) return `${Math.round((size / 1048576) * 100) / 100} MB`;
  if (size >= 1024) return `${Math.round((size / 1024) * 100) / 100} KB`;
  return `${size} B`;
}

export const Clinic = new Table('clinics');

export const ClinicAdmin = new Table('clinic_admins', {
  hidden: ['password', 'remember_token'],
  casts: { is_active: 'boolean' },
  appends: (row) => ({
    avatar_url: row.avatar ? `/storage/${row.avatar}` : avatar(row.name, 'F0305E'),
  }),
});

export const Doctor = new Table('doctors', {
  hidden: ['password', 'remember_token'],
  casts: { is_active: 'boolean', consultation_fee: 'number' },
  appends: (row) => ({
    avatar_url: row.avatar ? `/storage/${row.avatar}` : avatar(row.name, '10B981'),
  }),
});

export const Patient = new Table('patients', {
  softDeletes: true,
  hidden: ['password', 'remember_token'],
  casts: { is_active: 'boolean' },
  appends: (row) => ({
    avatar_url: row.avatar
      ? (row.avatar.startsWith('http') || row.avatar.startsWith('data:') ? row.avatar : `/storage/${row.avatar}`)
      : avatar(row.name, '06B6D4'),
    age: (row.age !== undefined && row.age !== null && row.age !== '')
      ? Number(row.age)
      : (row.date_of_birth
        ? Math.floor((Date.now() - new Date(row.date_of_birth).getTime()) / 31557600000)
        : null),
  }),
});

export const Treatment = new Table('treatments', {
  casts: { is_active: 'boolean', default_price: 'number' },
});

export const WorkingHour = new Table('working_hours', {
  casts: { is_open: 'boolean' },
});

export const Appointment = new Table('appointments', {
  softDeletes: true,
  casts: { amount: 'number' },
});

export const Invoice = new Table('invoices', {
  softDeletes: true,
  casts: {
    subtotal: 'number', tax: 'number', discount: 'number', total: 'number',
  },
});

export const InvoiceItem = new Table('invoice_items', {
  casts: { unit_price: 'number', tax_rate: 'number', total: 'number' },
});

export const Conversation = new Table('conversations', {
  casts: {
    context_memory: 'json',
    extracted_entities: 'json',
    escalated_to_human: 'boolean',
  },
});

export const Message = new Table('messages', {
  casts: {
    entities: 'json',
    confidence_score: 'number',
    flagged_sensitive: 'boolean',
    fallback_triggered: 'boolean',
  },
});

export const NotificationLog = new Table('notifications_log');

export const NotificationTemplate = new Table('notification_templates', {
  casts: { variables: 'json', is_active: 'boolean' },
});

export const AiInteractionLog = new Table('ai_interaction_logs', {
  casts: {
    entities: 'json',
    confidence_score: 'number',
    guardrail_triggered: 'boolean',
  },
});

export const WorkflowRule = new Table('workflow_rules', {
  casts: { conditions: 'json', action_payload: 'json', is_active: 'boolean' },
});

export const WorkflowExecution = new Table('workflow_executions');

export const PaymentOrder = new Table('payment_orders', {
  casts: {
    amount: 'number',
    refund_amount: 'number',
    webhook_payload: 'json',
  },
});

// AUD-03: audit rows are immutable — only `created_at`, never updated.
export const AuditLog = new Table('audit_logs', {
  timestamps: false,
  casts: { old_values: 'json', new_values: 'json' },
});

export const MedicalFile = new Table('medical_files', {
  softDeletes: true,
  casts: { is_sensitive: 'boolean', file_size: 'number' },
  appends: (row) => ({ human_file_size: humanFileSize(row.file_size) }),
});

export const Role = new Table('roles', {
  casts: { is_system: 'boolean' },
});

export const Permission = new Table('permissions');

export const UserRole = new Table('user_roles');

export const RolePermission = new Table('role_permission');

export const ApiKey = new Table('api_keys', {
  hidden: ['secret_hash'],
  casts: { scopes: 'json', is_active: 'boolean' },
});

export const WebhookEndpoint = new Table('webhook_endpoints', {
  hidden: ['secret'],
  casts: { events: 'json', is_active: 'boolean' },
});

export const WebhookDelivery = new Table('webhook_deliveries', {
  casts: { payload: 'json' },
});

/** Which table backs each guard, for the polymorphic audit/role columns. */
export const TABLE_BY_TYPE = {
  ClinicAdmin,
  Doctor,
  Patient,
};
