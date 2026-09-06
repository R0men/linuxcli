import { MongoClient } from 'mongodb';
import { config } from '../config.js';

let client;
let db;

export async function connectMongo() {
  if (db) return db;

  client = new MongoClient(config.mongoUrl);
  await client.connect();
  db = client.db(config.mongoDb);

  const auditLogs = db.collection('audit_logs');
  await auditLogs.createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: config.auditLogRetentionSeconds }
  );

  const apiKeys = db.collection('api_keys');
  await apiKeys.createIndex({ tokenHash: 1 }, { unique: true });
  await apiKeys.createIndex({ ipHash: 1 });
  await apiKeys.createIndex({ userId: 1 });
  await apiKeys.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const users = db.collection('users');
  // partialFilterExpression — email унікальний тільки серед local-акаунтів
  // (oauth-записи мають email: null або дубльований email іншого провайдера,
  // акаунт-лінкінг за email навмисно не робимо, TECH.md §9).
  await users.createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { provider: 'local' } }
  );
  await users.createIndex(
    { provider: 1, providerId: 1 },
    { unique: true, partialFilterExpression: { provider: { $in: ['github', 'google'] } } }
  );

  return db;
}

export function getDb() {
  if (!db) throw new Error('Mongo not connected yet — call connectMongo() first');
  return db;
}

export async function closeMongo() {
  if (client) await client.close();
  db = undefined;
}
