import mongoose from 'mongoose';
import config from './index.js';

let isConnected = false;

/**
 * Connect to MongoDB using Mongoose.
 */
export async function connectDatabase(uri = config.db.uri) {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection.db;
  }

  mongoose.set('strictQuery', false);

  const connection = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  isConnected = true;
  const dbName = mongoose.connection.name || mongoose.connection.db?.databaseName;
  console.log(`MongoDB connected: ${dbName} (host: ${mongoose.connection.host})`);

  return mongoose.connection.db;
}

export function getDb() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return mongoose.connection.db;
}

export function getMongoose() {
  return mongoose;
}

export async function disconnectDatabase() {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

/**
 * Turn a MongoDB connection failure into actionable advice.
 */
export function explainConnectionError(error) {
  const uri = config.db.uri;
  const sanitizedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');

  if (error.name === 'MongoServerSelectionError' || error.message?.includes('Server selection timed out')) {
    return [
      `Could not connect to MongoDB cluster at ${sanitizedUri}.`,
      '',
      '  Possible causes:',
      '  1. Network access/IP Whitelist: Ensure your current IP address is whitelisted in MongoDB Atlas (Network Access -> Add IP Address).',
      '  2. Cluster is paused or offline: Check MongoDB Atlas cluster status.',
      '  3. Database credentials: If using <db_password>, make sure you replaced <db_password> with your real user password in server/.env.',
      '  4. Local MongoDB: If running locally, make sure mongod is running (e.g. net start MongoDB).',
    ].join('\n');
  }

  if (error.name === 'MongoAuthenticationError' || error.message?.includes('auth') || error.code === 18) {
    return [
      `MongoDB rejected credentials for ${sanitizedUri}.`,
      '',
      '  Check MONGODB_URI in server/.env: verify username, password, and authentication database.',
      '  Remember to replace "<db_password>" with the actual user password in server/.env.',
    ].join('\n');
  }

  if (error.name === 'MongoParseError' || error.message?.includes('Invalid scheme') || error.message?.includes('URI')) {
    return `Invalid MongoDB connection string: "${sanitizedUri}". Check MONGODB_URI in server/.env.`;
  }

  return `${error.name ?? 'MongoError'}: ${error.message}`;
}

export default getDb;
