import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, env, { collect = true } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: SERVER_DIR, env: { ...process.env, ...env }, shell: true,
    });
    let out = '';
    if (collect) {
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
    }
    child.on('close', (code) => resolve({ code, out }));
  });
}

console.log('=== STARTING PATIENT DOCUMENTS TEST SUITE ===');

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
console.log('MongoDB Memory Server up at', uri);

const env = {
  MONGODB_URI: uri,
  PORT: '8124',
  JWT_SECRET: 'test-document-secret-key-12345',
  APP_ENV: 'testing',
  BCRYPT_ROUNDS: '4',
};

console.log('Running Migration...');
const migrate = await run('node', ['src/scripts/migrate.js'], env);
if (migrate.code !== 0) {
  console.error('Migration failed:', migrate.out);
  await mongod.stop();
  process.exit(1);
}

console.log('Running Seeder...');
const seed = await run('node', ['src/scripts/seed.js'], env);
if (seed.code !== 0) {
  console.error('Seeder failed:', seed.out);
  await mongod.stop();
  process.exit(1);
}

console.log('Booting Express API server...');
const server = spawn('node', ['src/server.js'], {
  cwd: SERVER_DIR, env: { ...process.env, ...env }, shell: true,
});

let serverOutput = '';
server.stdout.on('data', (d) => { serverOutput += d; });
server.stderr.on('data', (d) => { serverOutput += d; });

const BASE = 'http://127.0.0.1:8124';

// Helper for HTTP requests with cookie retention
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`${BASE}/up`);
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

async function login(path, email, password) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: res.status, json, cookie };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(` ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(` ❌ FAIL: ${message}`);
    failed++;
  }
}

try {
  console.log('\n--- AUTHENTICATION ---');
  // 1. Login Admin (Receptionist)
  const adminRes = await login('/api/admin/login', 'dr.priya@dentalai.com', 'password');
  const adminCookie = adminRes.cookie;
  assert(adminRes.status === 200, `Receptionist (Admin) login succeeds (200) - ${adminRes.json.message}`);

  // 2. Login Doctor
  const doctorRes = await login('/api/doctor/login', 'rahul@dentalai.com', 'password');
  const doctorCookie = doctorRes.cookie;
  assert(doctorRes.status === 200, `Doctor login succeeds (200) - ${doctorRes.json.message || doctorRes.json.redirect}`);

  // 3. Login Patient
  const patientRes = await login('/api/patient/login', 'amit@example.com', 'password');
  const patientCookie = patientRes.cookie;
  assert(patientRes.status === 200, `Patient login succeeds (200) - ${patientRes.json.message || patientRes.json.redirect}`);

  // Fetch a valid patient ID from database
  const patientsListRes = await fetch(`${BASE}/api/admin/patients`, {
    headers: { Cookie: adminCookie },
  });
  const patientsData = await patientsListRes.json();
  const targetPatient = patientsData.patients?.data?.[0] || patientsData.patients?.[0];
  const targetPatientId = targetPatient?._id || targetPatient?.id;

  assert(Boolean(targetPatientId), `Found target patient ID: ${targetPatientId} (${targetPatient?.name})`);

  console.log('\n--- TEST 1: ROLE AUTHORIZATION CHECK ---');
  // Attempt file upload as Patient (unauthorized role)
  const patientForm = new FormData();
  const fakeBlob = new Blob(['Dummy PDF content'], { type: 'application/pdf' });
  patientForm.append('file', fakeBlob, 'test-report.pdf');
  patientForm.append('type', 'pdf');

  const unauthUpload = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    method: 'POST',
    headers: { Cookie: patientCookie },
    body: patientForm,
  });
  const unauthJson = await unauthUpload.json();
  assert(unauthUpload.status === 403, 'Unauthorized patient upload rejected with status 403');
  assert(
    unauthJson.message === 'You are not authorized to upload patient files.',
    `Returned correct message: "${unauthJson.message}"`,
  );

  console.log('\n--- TEST 2: INVALID FILE TYPE VALIDATION ---');
  // Attempt invalid PDF upload (text file pretending to be PDF)
  const invalidForm = new FormData();
  const textBlob = new Blob(['Plain text'], { type: 'text/plain' });
  invalidForm.append('file', textBlob, 'test-script.txt');
  invalidForm.append('type', 'pdf');

  const invalidUpload = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    method: 'POST',
    headers: { Cookie: doctorCookie },
    body: invalidForm,
  });
  const invalidJson = await invalidUpload.json();
  assert(invalidUpload.status === 422, 'Invalid PDF MIME type rejected with status 422');
  assert(
    invalidJson.message === 'Only PDF files are allowed.',
    `Returned correct message: "${invalidJson.message}"`,
  );

  // Attempt invalid X-Ray upload (PDF file under xray type)
  const invalidXrayForm = new FormData();
  invalidXrayForm.append('file', fakeBlob, 'test-xray.pdf');
  invalidXrayForm.append('type', 'xray');

  const invalidXrayUpload = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    method: 'POST',
    headers: { Cookie: doctorCookie },
    body: invalidXrayForm,
  });
  const invalidXrayJson = await invalidXrayUpload.json();
  assert(invalidXrayUpload.status === 422, 'Invalid X-Ray image MIME type rejected with status 422');
  assert(
    invalidXrayJson.message === 'Only JPG, PNG, and WEBP images are allowed for X-rays.',
    `Returned correct message: "${invalidXrayJson.message}"`,
  );

  console.log('\n--- TEST 3: VALID PDF UPLOAD BY DOCTOR ---');
  const validPdfForm = new FormData();
  const pdfHeader = '%PDF-1.4\n%...\n';
  const pdfBlob = new Blob([pdfHeader], { type: 'application/pdf' });
  validPdfForm.append('file', pdfBlob, 'dental-treatment-report.pdf');
  validPdfForm.append('type', 'pdf');

  const pdfUploadRes = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    method: 'POST',
    headers: { Cookie: doctorCookie },
    body: validPdfForm,
  });
  const pdfUploadJson = await pdfUploadRes.json();
  assert(pdfUploadRes.status === 201, 'Valid PDF document upload succeeded with status 201');
  assert(pdfUploadJson.document?.fileName === 'dental-treatment-report.pdf', 'Document fileName matches');
  assert(pdfUploadJson.document?.type === 'pdf', 'Document type is "pdf"');
  assert(pdfUploadJson.document?.mimeType === 'application/pdf', 'MIME type is application/pdf');

  const uploadedPdfId = pdfUploadJson.document?._id;

  console.log('\n--- TEST 4: VALID X-RAY IMAGE UPLOAD BY RECEPTIONIST ---');
  const validXrayForm = new FormData();
  // 1x1 transparent PNG binary bytes
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  const pngBlob = new Blob([pngBytes], { type: 'image/png' });
  validXrayForm.append('file', pngBlob, 'molar-xray-scan.png');
  validXrayForm.append('type', 'xray');

  const xrayUploadRes = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: validXrayForm,
  });
  const xrayUploadJson = await xrayUploadRes.json();
  assert(xrayUploadRes.status === 201, 'Valid X-Ray upload by Receptionist succeeded with status 201');
  assert(xrayUploadJson.document?.fileName === 'molar-xray-scan.png', 'X-Ray fileName matches');
  assert(xrayUploadJson.document?.type === 'xray', 'Document type is "xray"');

  const uploadedXrayId = xrayUploadJson.document?._id;

  console.log('\n--- TEST 5: GET PATIENT DOCUMENTS LIST ---');
  const getDocsRes = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    headers: { Cookie: doctorCookie },
  });
  const docsList = await getDocsRes.json();
  assert(getDocsRes.status === 200, 'GET patient documents list succeeded with status 200');
  assert(Array.isArray(docsList), 'Returned array of document items');
  assert(docsList.some((d) => d._id === uploadedPdfId && d.type === 'pdf'), 'List contains uploaded PDF document');
  assert(docsList.some((d) => d._id === uploadedXrayId && d.type === 'xray'), 'List contains uploaded X-Ray image');

  console.log('\n--- TEST 6: VIEW & STREAM FILE ---');
  const viewPdfRes = await fetch(`${BASE}/api/patients/${targetPatientId}/documents/${uploadedPdfId}/view`, {
    headers: { Cookie: doctorCookie },
  });
  assert(viewPdfRes.status === 200, 'View PDF document stream succeeded with status 200');
  assert(viewPdfRes.headers.get('content-type') === 'application/pdf', 'Content-Type header is application/pdf');

  console.log('\n--- TEST 7: DELETE DOCUMENT BY RECEPTIONIST ---');
  const deleteRes = await fetch(`${BASE}/api/patients/${targetPatientId}/documents/${uploadedPdfId}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });
  const deleteJson = await deleteRes.json();
  assert(deleteRes.status === 200, 'Delete document by Receptionist succeeded with status 200');
  assert(deleteJson.success === true, 'Returned success = true');

  console.log('\n--- TEST 8: VERIFY REMOVAL FROM LIST ---');
  const getDocsAfterRes = await fetch(`${BASE}/api/patients/${targetPatientId}/documents`, {
    headers: { Cookie: doctorCookie },
  });
  const docsListAfter = await getDocsAfterRes.json();
  assert(!docsListAfter.some((d) => d._id === uploadedPdfId), 'Deleted PDF is no longer in document list');

} catch (err) {
  console.error('Test execution error:', err);
  failed++;
} finally {
  console.log(`\n=== TEST SUMMARY ===`);
  console.log(` Passed: ${passed}`);
  console.log(` Failed: ${failed}`);
  server.kill();
  await mongod.stop();
  process.exit(failed > 0 ? 1 : 0);
}
