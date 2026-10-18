/**
 * Create collections and indexes in MongoDB. Run with `npm run migrate`.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase, explainConnectionError, getDb } from '../config/db.js';

async function run() {
  console.log('Connecting to MongoDB...');
  await connectDatabase();
  const db = getDb();

  console.log('Creating collections and indexes...');

  const indexes = [
    { collection: 'clinic_admins', key: { email: 1 }, options: { unique: true } },
    { collection: 'doctors', key: { email: 1 }, options: { unique: true } },
    { collection: 'patients', key: { email: 1 }, options: { unique: true, sparse: true } },
    { collection: 'patients', key: { patient_code: 1 }, options: { unique: true, sparse: true } },
    { collection: 'roles', key: { slug: 1 }, options: { unique: true } },
    { collection: 'permissions', key: { slug: 1 }, options: { unique: true } },
    { collection: 'invoices', key: { invoice_number: 1 }, options: { unique: true } },
    { collection: 'invoices', key: { patient_id: 1 }, options: {} },
    { collection: 'appointments', key: { appointment_date: 1 }, options: {} },
    { collection: 'appointments', key: { doctor_id: 1 }, options: {} },
    { collection: 'appointments', key: { patient_id: 1 }, options: {} },
    { collection: 'invoice_items', key: { invoice_id: 1 }, options: {} },
    { collection: 'working_hours', key: { doctor_id: 1 }, options: {} },
    { collection: 'treatments', key: { name: 1 }, options: {} },
    { collection: 'user_roles', key: { user_type: 1, user_id: 1, role_id: 1 }, options: {} },
    { collection: 'role_permission', key: { role_id: 1, permission_id: 1 }, options: {} },
    { collection: 'workflow_rules', key: { trigger_event: 1 }, options: {} },
    { collection: 'workflow_executions', key: { status: 1 }, options: {} },
    { collection: 'notification_templates', key: { type: 1, channel: 1 }, options: {} },
    { collection: 'notifications_log', key: { status: 1 }, options: {} },
    { collection: 'payment_orders', key: { gateway_order_id: 1 }, options: {} },
    { collection: 'audit_logs', key: { created_at: -1 }, options: {} },
    { collection: 'medical_files', key: { patient_id: 1 }, options: {} },
    { collection: 'conversations', key: { patient_id: 1, status: 1 }, options: {} },
    { collection: 'messages', key: { conversation_id: 1 }, options: {} },
  ];

  let count = 0;
  for (const { collection, key, options } of indexes) {
    try {
      await db.collection(collection).createIndex(key, options);
      count += 1;
    } catch (err) {
      console.warn(`Index on ${collection} (${JSON.stringify(key)}): ${err.message}`);
    }
  }

  console.log(`MongoDB migration complete: verified indexes across ${count} collection configurations.`);
  await disconnectDatabase();
}

run().catch((error) => {
  console.error('\nMigration failed.\n');
  console.error(explainConnectionError(error));
  console.error('');
  process.exit(1);
});
