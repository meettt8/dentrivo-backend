import 'express-async-errors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import config from './config/index.js';
import { connectDatabase, disconnectDatabase, explainConnectionError } from './config/db.js';
import { resolveAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import routes from './routes/index.js'; // Routes loaded with patient OTP endpoints


const app = express();

app.set('trust proxy', 1);

app.use(cors({ origin: config.app.clientUrl, credentials: true }));

// Keep the raw body so the Razorpay webhook signature can be verified.
app.use(express.json({
  limit: '25mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (config.app.env !== 'testing') app.use(morgan('dev'));

// Automatically rewrite double '/api/api/' prefixes to '/api/'
app.use((req, res, next) => {
  if (req.url.startsWith('/api/api/')) {
    req.url = req.url.replace('/api/api/', '/api/');
  }
  next();
});

// API-02: a baseline limit on the whole API surface.
app.use('/api', rateLimit(600, 1));

// Equivalent of Laravel's global `web` middleware group.
app.use(resolveAuth);

app.get('/up', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

// Uploaded medical files are served through their authenticated routes, but the
// clinic logos and doctor avatars the views link to as `/storage/...` are static.
app.use('/storage', express.static(config.filesystem.storagePath));

/**
 * When the React client has been built, serve it from here so the whole app runs
 * on one origin — the way Laravel served the Blade views and the routes together.
 * In development Vite serves the client and proxies `/api` back to this server.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));
  // Any non-API path falls through to the SPA so react-router can handle it.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

async function start() {
  await connectDatabase();
  const server = app.listen(config.app.port, () => {
    console.log(`${config.app.name} API listening on http://localhost:${config.app.port}`);
  });

  server.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\nPort ${config.app.port} is already in use — another copy of the`);
      console.error('server is probably still running. Stop it, or set PORT in .env.\n');
    } else {
      console.error(error);
    }
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });

  // Close the database cleanly so the bundled server flushes its data to disk.
  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close();
    await disconnectDatabase().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('\nFailed to start server.\n');
  console.error(explainConnectionError(error));
  console.error('');
  process.exit(1);
});

export default app;
