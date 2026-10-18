import 'dotenv/config';

const config = {
  app: {
    name: process.env.APP_NAME || 'Dentrivo',
    env: process.env.APP_ENV || 'local',
    debug: process.env.APP_DEBUG === 'true',
    url: process.env.APP_URL || 'http://localhost:5173',
    port: Number(process.env.PORT || 8000),
    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
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
    mailer: process.env.MAIL_MAILER || 'log',
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 2525),
    username: process.env.MAIL_USERNAME,
    password: process.env.MAIL_PASSWORD,
    fromAddress: process.env.MAIL_FROM_ADDRESS || 'hello@example.com',
    fromName: process.env.MAIL_FROM_NAME || 'Dentrivo',
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
