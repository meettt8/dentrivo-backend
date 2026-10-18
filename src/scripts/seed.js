/**
 * Wipes the domain tables and reseeds the Dentrivo demo dataset.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase, explainConnectionError, getDb } from '../config/db.js';
import {
  Appointment, Clinic, ClinicAdmin, Doctor, Invoice, InvoiceItem,
  NotificationTemplate, Patient, Permission, Role, RolePermission,
  Treatment, WorkflowRule, WorkingHour,
} from '../models/index.js';
import { hashPassword } from '../utils/auth.js';
import { padLeft, toDateString } from '../utils/helpers.js';

/** Emptied with FK checks off so order does not matter. */
const TABLES = [
  'workflow_executions', 'workflow_rules', 'payment_orders', 'audit_logs',
  'medical_files', 'ai_interaction_logs', 'messages', 'conversations',
  'notifications_log', 'invoice_items', 'invoices', 'appointments',
  'working_hours', 'treatments', 'patients', 'doctors', 'clinic_admins',
  'user_roles', 'role_permission', 'roles', 'permissions', 'notification_templates',
  'webhook_deliveries', 'webhook_endpoints', 'api_keys', 'clinics',
];

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

function randomInt(max) {
  return Math.floor(Math.random() * (max + 1));
}

async function seedNotificationTemplates() {
  const templates = [
    {
      type: 'appointment_reminder',
      channel: 'sms',
      subject: null,
      body: 'Hi {{patient_name}}, this is a reminder for your appointment with Dr. {{doctor_name}} on {{appointment_date}} at {{appointment_time}}. Reply CANCEL to cancel.',
      variables: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
    },
    {
      type: 'appointment_reminder',
      channel: 'email',
      subject: 'Appointment Reminder - Smile Dental Clinic',
      body: 'Dear {{patient_name}},\n\nThis is a friendly reminder that you have an appointment scheduled:\n\nDoctor: Dr. {{doctor_name}}\nDate: {{appointment_date}}\nTime: {{appointment_time}}\n\nIf you need to reschedule, please contact us.\n\nBest regards,\nSmile Dental Clinic',
      variables: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
    },
    {
      type: 'appointment_confirmation',
      channel: 'sms',
      subject: null,
      body: 'Your appointment with Dr. {{doctor_name}} on {{appointment_date}} at {{appointment_time}} has been confirmed. - Smile Dental Clinic',
      variables: ['doctor_name', 'appointment_date', 'appointment_time'],
    },
    {
      type: 'appointment_confirmation',
      channel: 'email',
      subject: 'Appointment Confirmed - Smile Dental Clinic',
      body: 'Dear {{patient_name}},\n\nYour appointment has been confirmed!\n\nDoctor: Dr. {{doctor_name}}\nDate: {{appointment_date}}\nTime: {{appointment_time}}\n\nPlease arrive 10 minutes early.\n\nBest regards,\nSmile Dental Clinic',
      variables: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
    },
    {
      type: 'payment_receipt',
      channel: 'email',
      subject: 'Payment Receipt - Smile Dental Clinic',
      body: 'Dear {{patient_name}},\n\nWe have received your payment of {{currency}} {{amount}} for Invoice #{{invoice_number}}.\n\nThank you for your payment.\n\nBest regards,\nSmile Dental Clinic',
      variables: ['patient_name', 'amount', 'currency', 'invoice_number'],
    },
    {
      type: 'invoice_overdue',
      channel: 'sms',
      subject: null,
      body: 'Hi {{patient_name}}, your invoice #{{invoice_number}} of {{currency}} {{amount}} is overdue. Please make your payment at your earliest convenience. - Smile Dental Clinic',
      variables: ['patient_name', 'invoice_number', 'amount', 'currency'],
    },
  ];

  for (const tmpl of templates) {
    // eslint-disable-next-line no-await-in-loop
    await NotificationTemplate.updateOrCreate(
      { type: tmpl.type, channel: tmpl.channel },
      {
        subject: tmpl.subject,
        body: tmpl.body,
        variables: tmpl.variables,
        is_active: 1,
      },
    );
  }
}

/** RBAC-01: default permissions and system roles. */
async function seedPermissions() {
  const permissions = [
    { name: 'View Appointments', slug: 'appointments.view', module: 'appointments' },
    { name: 'Create Appointments', slug: 'appointments.create', module: 'appointments' },
    { name: 'Update Appointments', slug: 'appointments.update', module: 'appointments' },
    { name: 'Delete Appointments', slug: 'appointments.delete', module: 'appointments' },

    { name: 'View Patients', slug: 'patients.view', module: 'patients' },
    { name: 'Create Patients', slug: 'patients.create', module: 'patients' },
    { name: 'Update Patients', slug: 'patients.update', module: 'patients' },
    { name: 'Delete Patients', slug: 'patients.delete', module: 'patients' },

    { name: 'View Doctors', slug: 'doctors.view', module: 'doctors' },
    { name: 'Create Doctors', slug: 'doctors.create', module: 'doctors' },
    { name: 'Update Doctors', slug: 'doctors.update', module: 'doctors' },

    { name: 'View Billing', slug: 'billing.view', module: 'billing' },
    { name: 'Create Invoices', slug: 'billing.create', module: 'billing' },
    { name: 'Process Payments', slug: 'billing.payment', module: 'billing' },
    { name: 'Issue Refunds', slug: 'billing.refund', module: 'billing' },

    { name: 'View Analytics', slug: 'analytics.view', module: 'analytics' },
    { name: 'Export Analytics', slug: 'analytics.export', module: 'analytics' },

    { name: 'View Settings', slug: 'settings.view', module: 'settings' },
    { name: 'Update Settings', slug: 'settings.update', module: 'settings' },

    { name: 'View Workflows', slug: 'workflows.view', module: 'workflows' },
    { name: 'Manage Workflows', slug: 'workflows.manage', module: 'workflows' },

    { name: 'Upload Files', slug: 'files.upload', module: 'files' },
    { name: 'View Files', slug: 'files.view', module: 'files' },
    { name: 'Delete Files', slug: 'files.delete', module: 'files' },

    { name: 'View Audit Logs', slug: 'system.audit', module: 'system' },
    { name: 'Manage Notifications', slug: 'system.notifications', module: 'system' },
    { name: 'Manage API Keys', slug: 'system.api-keys', module: 'system' },
  ];

  for (const perm of permissions) {
    // eslint-disable-next-line no-await-in-loop
    await Permission.updateOrCreate({ slug: perm.slug }, perm);
  }

  const allPermissions = await Permission.find({});
  const idsFor = (slugs) => allPermissions.filter((p) => slugs.includes(p.slug)).map((p) => p.id);

  /** Replace a role's rows in the `role_permission` pivot. */
  const syncPermissions = async (roleId, permissionIds) => {
    await RolePermission.collection.deleteMany({ role_id: roleId });
    if (permissionIds.length === 0) return;
    await RolePermission.createMany(
      permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })),
    );
  };

  // RBAC-02: system roles
  const adminRole = await Role.updateOrCreate(
    { slug: 'clinic-admin' },
    { name: 'Clinic Admin', description: 'Full access to clinic management', is_system: 1 },
  );
  await syncPermissions(adminRole.id, allPermissions.map((p) => p.id));

  const doctorRole = await Role.updateOrCreate(
    { slug: 'doctor' },
    { name: 'Doctor', description: 'Doctor access — appointments, patients', is_system: 1 },
  );
  await syncPermissions(doctorRole.id, idsFor([
    'appointments.view', 'appointments.update',
    'patients.view', 'patients.update',
    'files.view', 'files.upload',
  ]));

  const receptionistRole = await Role.updateOrCreate(
    { slug: 'receptionist' },
    { name: 'Receptionist', description: 'Front desk — appointments, patients', is_system: 1 },
  );
  await syncPermissions(receptionistRole.id, idsFor([
    'appointments.view', 'appointments.create', 'appointments.update',
    'patients.view', 'patients.create',
    'billing.view', 'billing.create',
  ]));
}

async function seedWorkflows() {
  await WorkflowRule.createMany([
    {
      name: 'Patient Onboarding Welcome',
      description: 'Send welcome WhatsApp message when a new patient is registered.',
      trigger_event: 'patient_registered',
      conditions: JSON.stringify([{ field: 'patient_type', operator: '=', value: 'new' }]),
      action_type: 'send_whatsapp',
      action_payload: JSON.stringify({
        message: 'Welcome to Smile Dental Clinic! We are excited to have you as our patient. Feel free to reach out to book an appointment.',
      }),
      delay_minutes: 5,
      is_active: 1,
    },
    {
      name: 'Appointment Booking Follow-Up',
      description: 'Send a WhatsApp confirmation after AI appointment booking.',
      trigger_event: 'appointment_created',
      conditions: JSON.stringify([{ field: 'booked_via', operator: '=', value: 'ai_assistant' }]),
      action_type: 'send_whatsapp',
      action_payload: JSON.stringify({
        message: 'Great news! Your appointment has been booked via our AI Assistant. Check your patient portal for more details.',
      }),
      delay_minutes: 1,
      is_active: 1,
    },
    {
      name: 'No-Show Recovery',
      description: 'Send SMS to patients who missed an appointment to reschedule.',
      trigger_event: 'appointment_no_show',
      conditions: JSON.stringify([]),
      action_type: 'send_sms',
      action_payload: JSON.stringify({
        message: 'We missed you at your appointment. Please reply to reschedule or click the link in your patient portal.',
      }),
      delay_minutes: 60,
      is_active: 1,
    },
    {
      name: 'Payment Failed Alert',
      description: 'Send WhatsApp to patient when a payment attempt fails.',
      trigger_event: 'payment_failed',
      conditions: JSON.stringify([]),
      action_type: 'send_whatsapp',
      action_payload: JSON.stringify({
        message: 'Unfortunately, your recent payment attempt failed. Please check your patient portal and try again.',
      }),
      delay_minutes: 5,
      is_active: 1,
    },
  ]);
}

async function run() {
  await connectDatabase();
  const db = getDb();

  console.log('Clearing existing data...');
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await db.collection(table).deleteMany({});
  }

  const password = await hashPassword('password');

  await Clinic.create({
    name: 'Dentrivo Dental Clinic',
    email: 'info@dentalai.com',
    phone: '+31 12345-67890',
    address: '123 Health Care Ave, Suite 400',
    city: 'Amsterdam',
    state: 'North Holland',
    country: 'Netherlands',
    timezone: 'Europe/Amsterdam',
    currency: 'USD',
  });

  await ClinicAdmin.create({
    name: 'Dr. Priya Shah',
    email: 'dr.priya@dentalai.com',
    password,
    phone: '+91 9876543210',
    is_active: 1,
  });

  const doc1 = await Doctor.create({
    name: 'Dr. Rahul Verma',
    email: 'rahul@dentalai.com',
    password,
    phone: '+91 9876543211',
    specialisation: 'Orthodontics',
    qualification: 'BDS, MDS',
    experience_years: 8,
    consultation_fee: 500,
    is_active: 1,
  });
  const doc2 = await Doctor.create({
    name: 'Dr. Anita Singh',
    email: 'anita@dentalai.com',
    password,
    phone: '+91 9876543212',
    specialisation: 'Endodontics',
    qualification: 'BDS',
    experience_years: 5,
    consultation_fee: 400,
    is_active: 1,
  });

  for (const doctor of [doc1, doc2]) {
    // eslint-disable-next-line no-await-in-loop
    await WorkingHour.createMany([1, 2, 3, 4, 5, 6].map((day) => ({
      doctor_id: doctor.id,
      day_of_week: day,
      open_time: '09:00:00',
      close_time: '18:00:00',
      is_open: 1,
    })));
  }

  const treatments = [];
  for (const [name, description, duration, price, category] of [
    ['Dental Cleaning', 'Teeth scaling and polishing', 30, 600, 'Preventive'],
    ['Root Canal Treatment', 'Complete RCT procedure', 90, 5000, 'Restorative'],
    ['Tooth Extraction', 'Simple extraction', 20, 800, 'Surgical'],
    ['Dental Filling', 'Composite or amalgam filling', 45, 1200, 'Restorative'],
    ['Teeth Whitening', 'Professional whitening', 60, 3500, 'Cosmetic'],
    ['Crown Placement', 'Ceramic crown', 60, 8000, 'Restorative'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    treatments.push(await Treatment.create({
      name,
      description,
      duration_mins: duration,
      default_price: price,
      category,
      is_active: 1,
    }));
  }

  const patients = [];
  const patientSeed = [
    ['Amit Sharma', '+91 9111111111', 'amit@example.com', '1985-03-15', 'male', 'B+'],
    ['Sunita Patel', '+91 9222222222', 'sunita@example.com', '1990-07-22', 'female', 'O+'],
    ['Vikram Rao', '+91 9333333333', 'vikram@example.com', '1978-11-08', 'male', 'A+'],
    ['Pooja Mehta', '+91 9444444444', 'pooja@example.com', '1995-02-14', 'female', 'AB+'],
    ['Rajan Gupta', '+91 9555555555', 'rajan@example.com', '1982-09-30', 'male', 'O-'],
  ];
  for (const [index, seedRow] of patientSeed.entries()) {
    const [name, phone, email, dob, gender, bloodGroup] = seedRow;
    // eslint-disable-next-line no-await-in-loop
    patients.push(await Patient.create({
      patient_code: `PT-${padLeft(index + 1, 5)}`,
      name,
      phone,
      email,
      date_of_birth: dob,
      gender,
      blood_group: bloodGroup,
      password,
      patient_type: index < 3 ? 'returning' : 'new',
      is_active: 1,
    }));
  }

  // Sample appointments
  const statuses = ['completed', 'completed', 'confirmed', 'pending', 'completed'];
  for (const [index, patient] of patients.entries()) {
    const treatment = treatments[index % 6];

    // eslint-disable-next-line no-await-in-loop
    const appointment = await Appointment.create({
      patient_id: patient.id,
      doctor_id: index % 2 === 0 ? doc1.id : doc2.id,
      treatment_id: treatment.id,
      appointment_date: toDateString(daysAgo(randomInt(30))),
      start_time: '10:00:00',
      end_time: '10:30:00',
      status: statuses[index],
      booked_via: 'admin',
      amount: treatment.default_price,
    });

    if (statuses[index] === 'completed') {
      // eslint-disable-next-line no-await-in-loop
      const invoice = await Invoice.create({
        patient_id: patient.id,
        appointment_id: appointment.id,
        invoice_number: `INV-${padLeft(index + 1, 6)}`,
        subtotal: treatment.default_price,
        tax: 0,
        discount: 0,
        total: treatment.default_price,
        status: 'paid',
        paid_at: daysAgo(randomInt(20)),
        payment_method: 'cash',
      });

      // eslint-disable-next-line no-await-in-loop
      await InvoiceItem.create({
        invoice_id: invoice.id,
        description: treatment.name,
        quantity: 1,
        unit_price: treatment.default_price,
        tax_rate: 0,
        total: treatment.default_price,
      });
    }
  }

  // Today's appointments
  for (const i of [1, 2, 3]) {
    const treatment = treatments[i];
    // eslint-disable-next-line no-await-in-loop
    await Appointment.create({
      patient_id: patients[i - 1].id,
      doctor_id: i % 2 === 0 ? doc2.id : doc1.id,
      treatment_id: treatment.id,
      appointment_date: toDateString(new Date()),
      start_time: `${padLeft(9 + i, 2)}:00:00`,
      end_time: `${padLeft(9 + i, 2)}:30:00`,
      status: 'confirmed',
      booked_via: 'admin',
      amount: treatment.default_price,
    });
  }

  await seedNotificationTemplates();
  await seedPermissions();
  await seedWorkflows();

  console.log('Dentrivo single-clinic seeded successfully!');
  console.log('Receptionist: dr.priya@dentalai.com / password');
  console.log('Doctor:       rahul@dentalai.com / password');
  console.log('Patient:      amit@example.com / password');

  await disconnectDatabase();
}

run().catch(async (error) => {
  console.error('\nSeeding failed.\n');
  console.error(explainConnectionError(error));
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
