import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: SERVER_DIR, env: { ...process.env, ...env }, shell: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

console.log('=== STARTING CHAT & AUTH TEST SUITE ===');

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();

const env = {
  MONGODB_URI: uri,
  PORT: '8126',
  JWT_SECRET: 'test-chat-secret-key-9999',
  APP_ENV: 'testing',
  BCRYPT_ROUNDS: '4',
};

await run('node', ['src/scripts/migrate.js'], env);
await run('node', ['src/scripts/seed.js'], env);

const server = spawn('node', ['src/server.js'], {
  cwd: SERVER_DIR, env: { ...process.env, ...env }, shell: true,
});

const BASE = 'http://127.0.0.1:8126';

for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`${BASE}/up`);
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
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
  // 1. Patient Login
  const loginRes = await fetch(`${BASE}/api/patient/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'amit@example.com', password: 'password' }),
  });
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  assert(loginRes.status === 200, 'Patient login succeeds (200)');

  // 2. Fetch Chat History
  const historyRes = await fetch(`${BASE}/api/patient/chat/history`, {
    headers: { Cookie: cookie },
  });
  const historyData = await historyRes.json();
  assert(historyRes.status === 200, 'Fetch chat history succeeds (200)');
  assert(historyData.status === 'success', 'History response status is success');

  // 3. Send AI Chat Message
  const sendRes = await fetch(`${BASE}/api/patient/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ message: 'I need to book an appointment for tooth pain' }),
  });
  const sendData = await sendRes.json();
  assert(sendRes.status === 200, 'Send chat message succeeds (200)');
  assert(sendData.status === 'success', 'Chat message status is success');
  assert(Boolean(sendData.reply), `AI bot generated reply: "${sendData.reply?.substring(0, 50)}..."`);

} catch (err) {
  console.error('Test execution error:', err);
  failed++;
} finally {
  console.log(`\n=== CHAT TEST SUMMARY ===`);
  console.log(` Passed: ${passed}`);
  console.log(` Failed: ${failed}`);
  server.kill();
  await mongod.stop();
  process.exit(failed > 0 ? 1 : 0);
}
