import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/abuse/password.js';
import {
  registerLocalUser,
  verifyLocalLogin,
  findOrCreateOAuthUser,
  deleteUser,
  EmailExistsError,
  InvalidCredentialsError,
} from '../src/users/users.js';

// Той самий стиль фейкової Mongo-колекції, що й test/apiKey.test.js —
// покриває лише findOne/insertOne, більше users.js нічого не викликає.
function makeFakeDb() {
  const docs = [];
  let nextId = 1;

  function matches(doc, filter) {
    for (const [key, cond] of Object.entries(filter)) {
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
    async deleteOne(filter) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index === -1) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
  };

  return { collection: () => collection, docs };
}

test('password.js: correct password verifies, wrong password does not', async () => {
  const { salt, hash } = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', salt, hash), true);
  assert.equal(await verifyPassword('wrong password', salt, hash), false);
});

test('password.js: same password hashed twice yields different salts/hashes', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('registerLocalUser + verifyLocalLogin: happy path', async () => {
  const db = makeFakeDb();
  const { userId } = await registerLocalUser('user@example.com', 'hunter2hunter2', 'devuser', db);
  const result = await verifyLocalLogin('user@example.com', 'hunter2hunter2', db);
  assert.equal(result.userId, userId);
  assert.equal(result.username, 'devuser');
});

test('registerLocalUser: email is case-normalized and duplicate is rejected', async () => {
  const db = makeFakeDb();
  await registerLocalUser('User@Example.com', 'hunter2hunter2', 'devuser', db);
  await assert.rejects(
    () => registerLocalUser('user@example.com', 'different-pw', 'other', db),
    EmailExistsError
  );
});

test('verifyLocalLogin: wrong password and unknown email give the same error', async () => {
  const db = makeFakeDb();
  await registerLocalUser('user@example.com', 'hunter2hunter2', 'devuser', db);

  await assert.rejects(() => verifyLocalLogin('user@example.com', 'wrong-password', db), InvalidCredentialsError);
  await assert.rejects(() => verifyLocalLogin('nobody@example.com', 'hunter2hunter2', db), InvalidCredentialsError);
});

test('findOrCreateOAuthUser: creates once, reuses on subsequent calls, username fixed at creation', async () => {
  const db = makeFakeDb();
  const first = await findOrCreateOAuthUser('github', '12345', 'dev@example.com', 'octocat', db);
  const second = await findOrCreateOAuthUser('github', '12345', 'dev@example.com', 'renamed-later', db);
  assert.equal(first.userId, second.userId);
  assert.equal(second.username, 'octocat'); // не перезаписується новим значенням з провайдера
  assert.equal(db.docs.length, 1);
});

test('findOrCreateOAuthUser: different providers with the same providerId stay separate accounts', async () => {
  const db = makeFakeDb();
  const gh = await findOrCreateOAuthUser('github', 'same-id', 'a@example.com', 'gh-name', db);
  const gg = await findOrCreateOAuthUser('google', 'same-id', 'a@example.com', 'gg-name', db);
  assert.notEqual(gh.userId, gg.userId);
});

test('findOrCreateOAuthUser: falls back to the email local-part when the provider gives no username', async () => {
  const db = makeFakeDb();
  const user = await findOrCreateOAuthUser('google', 'no-name-id', 'nameless@example.com', null, db);
  assert.equal(user.username, 'nameless');
});

test('deleteUser: removes the user document', async () => {
  const db = makeFakeDb();
  const { userId } = await registerLocalUser('user@example.com', 'hunter2hunter2', 'devuser', db);
  assert.equal(db.docs.length, 1);

  await deleteUser(userId, db);
  assert.equal(db.docs.length, 0);
});

test('deleteUser: deleted account can no longer log in', async () => {
  const db = makeFakeDb();
  const { userId } = await registerLocalUser('user@example.com', 'hunter2hunter2', 'devuser', db);
  await deleteUser(userId, db);

  await assert.rejects(() => verifyLocalLogin('user@example.com', 'hunter2hunter2', db), InvalidCredentialsError);
});
