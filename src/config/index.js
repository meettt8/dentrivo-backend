import 'dotenv/config';

function normalizeOrigin(url) {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

const rawClientUrl = process.env.CLIENT_URL || 'https://dentrivo-frontend.vercel.app';
const clientUrl = normalizeOrigin(rawClientUrl) || 'https://dentrivo-frontend.vercel.app';

const configuredOrigins = rawClientUrl
  .split(',')
  .map((u) => normalizeOrigin(u.trim()))
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([
    clientUrl,
    ...configuredOrigins,
    'https://dentrivo-frontend.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
  ])
);

const config = {
  app: {
    name: process.env.APP_NAME || 'Dentrivo',
    env: process.env.APP_ENV || 'local',
    debug: process.env.APP_DEBUG === 'true',
    url: process.env.APP_URL || clientUrl,
    port: Number(process.env.PORT || 8000),
    clientUrl,
    allowedOrigins,
  },
  db: {
    uri: process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dentrivo',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '120m',
    jwtRememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN || '30d',
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
    cookieName: 'dentrivo_session',
  },
  filesystem: {
    disk: process.env.FILESYSTEM_DISK || 'local',
    storagePath: process.env.STORAGE_PATH || './storage',
  },
  mail: {
    mailer: process.env.MAIL_MAILER || 'smtp',
    host: process.env.MAIL_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.MAIL_PORT || 587),
    username: process.env.MAIL_USERNAME,
    password: process.env.MAIL_PASSWORD,
    fromAddress: process.env.MAIL_FROM_ADDRESS,
    fromName: process.env.MAIL_FROM_NAME,
  },
  services: {
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID || '',
      keySecret: process.env.RAZORPAY_KEY_SECRET || '',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    },
  },
};

export default config;
