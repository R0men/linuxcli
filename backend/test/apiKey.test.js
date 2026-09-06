import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateApiKey,
  lookupApiKey,
  revokeApiKeysForUser,
  revokeApiKey,
  ApiKeyExistsError,
} from '../src/abuse/apiKey.js';

// Мінімальна in-memory заглушка Mongo-колекції — покриває лише те
// підмножину API (findOne/insertOne/findOneAndUpdate), яку реально
// використовує apiKey.js. Жодного живого Mongo не потрібно.
function makeFakeDb() {
  const docs = [];
  let nextId = 1;

  function matches(doc, filter) {
    for (const [key, cond] of Object.entries(filter)) {
      if (cond && typeof cond === 'object' && '$gt' in cond) {
        if (!(doc[key] > cond.$gt)) return false;
        continue;
      }
      if (doc[key] !== cond) return false;
    }
    return true;
  }

  const collection = {
    async findOne(filter) {
      return docs.find((d) => matches(d, filter)) ?? null;
    },
    async insertOne(doc) {
      const id = nextId++;
      const _id = { toString: () => `id${id}` };
      docs.push({ _id, ...doc });
      return { insertedId: _id };
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return null;
      const before = { ...doc };
      Object.assign(doc, update.$set);
      return before;
    },
    async deleteMany(filter) {
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], filter)) docs.splice(i, 1);
      }
    },
    async deleteOne(filter) {
      const i = docs.findIndex((d) => matches(d, filter));
      if (i !== -1) docs.splice(i, 1);
    },
  };

  return { collection: () => collection, docs };
}

test('generateApiKey binds the key to ipHash and lookupApiKey resolves it', async () => {
  const db = makeFakeDb();
  const { apiKey, keyId } = await generateApiKey('ip-hash-a', db);
  assert.ok(apiKey);
  const resolved = await lookupApiKey(apiKey, db);
  assert.equal(resolved.keyId, keyId);
  assert.equal(resolved.userId, null);
});

test('account-scoped key: userId is stored and returned by lookup', async () => {
  const db = makeFakeDb();
  const { apiKey } = await generateApiKey('ip-hash-a', db, 'user-1');
  const resolved = await lookupApiKey(apiKey, db);
  assert.equal(resolved.userId, 'user-1');
});

test('account-scoped keys are exempt from the anonymous one-key-per-ipHash guard', async () => {
  const db = makeFakeDb();
  await generateApiKey('ip-hash-a', db); // anonymous key already active for this IP
  await assert.doesNotReject(() => generateApiKey('ip-hash-a', db, 'user-1'));
});

test('revokeApiKeysForUser removes only that user\'s keys', async () => {
  const db = makeFakeDb();
  const { apiKey: keyA } = await generateApiKey('ip-hash-a', db, 'user-1');
  const { apiKey: keyB } = await generateApiKey('ip-hash-b', db, 'user-2');

  await revokeApiKeysForUser('user-1', db);

  assert.equal(await lookupApiKey(keyA, db), null);
  assert.ok(await lookupApiKey(keyB, db));
});

test('revokeApiKey removes exactly the presented token', async () => {
  const db = makeFakeDb();
  const { apiKey } = await generateApiKey('ip-hash-a', db);
  await revokeApiKey(apiKey, db);
  assert.equal(await lookupApiKey(apiKey, db), null);
});

test('farming fix: a second key for the same ipHash is refused while the first is still active', async () => {
  const db = makeFakeDb();
  await generateApiKey('ip-hash-a', db);
  await assert.rejects(() => generateApiKey('ip-hash-a', db), ApiKeyExistsError);
});

test('a different ipHash is not blocked by another IP\'s active key', async () => {
  const db = makeFakeDb();
  await generateApiKey('ip-hash-a', db);
  await assert.doesNotReject(() => generateApiKey('ip-hash-b', db));
});

test('once the previous key expires, the same ipHash can generate a new one', async () => {
  const db = makeFakeDb();
  await generateApiKey('ip-hash-a', db);
  db.docs[0].expiresAt = new Date(Date.now() - 1000); // симулюємо протухання

  await assert.doesNotReject(() => generateApiKey('ip-hash-a', db));
});

test('sliding TTL: a successful lookup pushes expiresAt forward', async () => {
  const db = makeFakeDb();
  const { apiKey } = await generateApiKey('ip-hash-a', db);
  const expiresBefore = db.docs[0].expiresAt.getTime();

  await new Promise((r) => setTimeout(r, 5));
  await lookupApiKey(apiKey, db);

  assert.ok(db.docs[0].expiresAt.getTime() > expiresBefore);
});

test('lookupApiKey returns null for unknown or expired tokens', async () => {
  const db = makeFakeDb();
  assert.equal(await lookupApiKey('not-a-real-token', db), null);
  assert.equal(await lookupApiKey('', db), null);
  assert.equal(await lookupApiKey(null, db), null);

  const { apiKey } = await generateApiKey('ip-hash-a', db);
  db.docs[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal(await lookupApiKey(apiKey, db), null);
});
