import { randomBytes, createHash } from 'node:crypto';
import { getDb } from '../db/mongo.js';
import { config } from '../config.js';

export class ApiKeyExistsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiKeyExistsError';
  }
}

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

// Не больше одного непротухшего ключа на ipHash одновременно — иначе
// генерация ключей (сама по себе дешёвая) размножает независимые квоты
// быстрее, чем anon rate-limit на саму генерацию их ограничивает
// (docs/architecture/abuse.md, "farming ключей"). Гвардія тільки для
// анонімного шляху (userId відсутній) — залогинений юзер видає ключ через
// revokeApiKeysForUser()+generateApiKey(), і не повинен впиратись у
// ipHash іншого анонімного відвідувача на тій самій NAT/спільній адресі.
// `db` injectable для тестів (test/apiKey.test.js) — за замовчуванням
// реальний Mongo через getDb().
export async function generateApiKey(ipHash, db = getDb(), userId = null) {
  if (!userId) {
    const existing = await db
      .collection('api_keys')
      .findOne({ ipHash, userId: null, expiresAt: { $gt: new Date() } });
    if (existing) {
      throw new ApiKeyExistsError('an active API key already exists for this IP');
    }
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const result = await db.collection('api_keys').insertOne({
    tokenHash,
    ipHash,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.apiKeyIdleTtlSeconds * 1000),
    lastUsedAt: null,
  });

  return { apiKey: rawToken, keyId: result.insertedId.toString() };
}

// Sliding TTL: каждое успешное использование отодвигает expiresAt заново,
// поэтому активно используемый ключ не протухает, а заброшенный — да.
// Повертає { keyId, userId } — userId проброшується у wsHandler.js для
// майбутнього tool-gating (userId === null для анонімних ключів).
export async function lookupApiKey(rawToken, db = getDb()) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const doc = await db
    .collection('api_keys')
    .findOneAndUpdate(
      { tokenHash, expiresAt: { $gt: now } },
      {
        $set: {
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + config.apiKeyIdleTtlSeconds * 1000),
        },
      }
    );

  return doc ? { keyId: doc._id.toString(), userId: doc.userId ?? null } : null;
}

// Логін/register/oauth-логін видають рівно одну живу сесію на юзера —
// попередня відкликається перед видачею нової (TECH.md: паралельні
// сесії з кількох пристроїв — свідомо поза скоупом цієї ітерації).
export async function revokeApiKeysForUser(userId, db = getDb()) {
  await db.collection('api_keys').deleteMany({ userId });
}

// Logout — відкликає конкретний токен пред'явника, не всі ключі юзера.
export async function revokeApiKey(rawToken, db = getDb()) {
  if (!rawToken) return;
  await db.collection('api_keys').deleteOne({ tokenHash: hashToken(rawToken) });
}
