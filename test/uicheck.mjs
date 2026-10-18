/**
 * Boots MySQL + the API (which also serves the built React client) and
 * screenshots every ported screen so the UI can be compared to the Blade original.
 * Each role runs in its own browser context so sessions never bleed across roles.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(SERVER_DIR, '_uishots');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
const env = {
  MONGODB_URI: uri,
  PORT: '8000',
  JWT_SECRET: 'ui-check',
  APP_ENV: 'testing',
  BCRYPT_ROUNDS: '4',
};

console.log('migrating...');
await new Promise((r) => spawn(process.execPath, [path.join(SERVER_DIR, 'src/scripts/migrate.js')], { env: { ...process.env, ...env } }).on('close', r));

console.log('seeding...');
await new Promise((r) => spawn(process.execPath, [path.join(SERVER_DIR, 'src/scripts/seed.js')], {
  env: { ...process.env, ...env },
}).on('close', r));

console.log('starting API + client...');
const api = spawn(process.execPath, [path.join(SERVER_DIR, 'src/server.js')], { env: { ...process.env, ...env } });
let apiLog = '';
api.stdout.on('data', (d) => { apiLog += d; });
api.stderr.on('data', (d) => { apiLog += d; });

const BASE = 'http://127.0.0.1:8000';
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`${BASE}/up`)).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (apiLog.includes('EADDRINUSE')) { console.log('PORT BUSY:', apiLog.trim()); process.exit(1); }
console.log('API ready');

const { default: puppeteer } = await import('puppeteer');
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

const problems = [];

function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
}

async function shot(page, name, urlPath, { fullPage = true } = {}) {
  await page.goto(`${BASE}${urlPath}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
  console.log(`  ${name}  <- ${page.url().replace(BASE, '')}  (${await page.title()})`);
}

/** Sign in inside a fresh, isolated browser context. */
async function signedInPage(email, password, loginPath) {
  const context = await browser.createBrowserContext();
  const page = watch(await context.newPage());
  await page.setViewport({ width: 1440, height: 1000 });

  await page.goto(`${BASE}${loginPath}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('form input[type=password]');
  await new Promise((r) => setTimeout(r, 600));

  for (const [selector, value] of [
    ['form input[type=email]', email],
    ['form input[type=password]', password],
  ]) {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(selector, value, { delay: 8 });
  }

  const typed = await page.$eval('form input[type=email]', (el) => el.value);
  if (typed !== email) throw new Error(`email field holds "${typed}", expected "${email}"`);

  await page.click('form button[type=submit]');
  await new Promise((r) => setTimeout(r, 2500));
  console.log(`  --- signed in ${email} -> ${page.url().replace(BASE, '')}`);
  return page;
}

console.log('\ncapturing public pages...');
{
  const page = watch(await browser.newPage());
  await page.setViewport({ width: 1440, height: 1000 });
  await shot(page, '01-landing', '/');
  await shot(page, '02-pricing', '/pricing');
  await shot(page, '03-about-us', '/about-us');
  await shot(page, '04-global-login', '/login', { fullPage: false });
  await shot(page, '05-admin-login', '/admin/login', { fullPage: false });
  await shot(page, '06-clinic-register', '/admin/register', { fullPage: false });
  await shot(page, '07-patient-login', '/patient/login', { fullPage: false });
  await page.close();
}

console.log('\ncapturing clinic admin...');
{
  const page = await signedInPage('dr.priya@dentalai.com', 'password', '/admin/login');
  await shot(page, '08-admin-dashboard', '/admin/dashboard');
  await shot(page, '09-admin-appointments', '/admin/appointments');
  await shot(page, '10-admin-appointment-create', '/admin/appointments/create');
  await shot(page, '11-admin-patients', '/admin/patients');
  await shot(page, '12-admin-doctors', '/admin/doctors');
  await shot(page, '13-admin-billing', '/admin/billing');
  await shot(page, '14-admin-analytics', '/admin/analytics');
  await shot(page, '15-admin-settings', '/admin/settings');
  await page.close();
}

console.log('\ncapturing doctor...');
{
  const page = await signedInPage('rahul@dentalai.com', 'password', '/doctor/login');
  await shot(page, '16-doctor-dashboard', '/doctor/dashboard');
  await shot(page, '17-doctor-appointments', '/doctor/appointments');
  await shot(page, '18-doctor-patients', '/doctor/patients');
  await page.close();
}

console.log('\ncapturing patient...');
{
  const page = await signedInPage('amit@example.com', 'password', '/patient/login');
  await shot(page, '19-patient-dashboard', '/patient/dashboard');
  await shot(page, '20-patient-appointments', '/patient/appointments');
  await shot(page, '21-patient-book', '/patient/appointments/book');
  await shot(page, '22-patient-chat', '/patient/chat', { fullPage: false });
  await shot(page, '23-patient-profile', '/patient/profile');
  await page.close();
}

console.log('\ncapturing super admin...');
{
  const page = await signedInPage('admin@dentalai.com', 'password', '/super-admin/login');
  await shot(page, '24-superadmin-dashboard', '/super-admin/dashboard');
  await shot(page, '25-superadmin-clinics', '/super-admin/clinics');
  await shot(page, '26-superadmin-subscriptions', '/super-admin/subscriptions');
  await page.close();
}

console.log('\nbrowser problems:');
const unique = [...new Set(problems)];
console.log(unique.length ? unique.map((e) => `  - ${e}`).join('\n') : '  (none)');

await browser.close();
api.kill();
await mongod.stop();
process.exit(0);
