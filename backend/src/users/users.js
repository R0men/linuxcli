import { getDb } from '../db/mongo.js';
import { hashPassword, verifyPassword } from '../abuse/password.js';

export class EmailExistsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmailExistsError';
  }
}

// Один клас помилки для "юзера нема" і "пароль невірний" — виклик боку
// (server.js) навмисно віддає однакове повідомлення для обох, щоб не
// давати enumeration-оракул (чи існує email у базі).
export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

// `db` injectable для тестів, як і в apiKey.js — за замовчуванням реальний
// Mongo через getDb().
export async function registerLocalUser(email, password, username, db = getDb()) {
  const normalizedEmail = email.toLowerCase();
  const existing = await db.collection('users').findOne({ provider: 'local', email: normalizedEmail });
  if (existing) {
    throw new EmailExistsError('an account with this email already exists');
  }

  const { salt, hash } = await hashPassword(password);
  const result = await db.collection('users').insertOne({
    provider: 'local',
    providerId: null,
    email: normalizedEmail,
    username,
    passwordHash: hash,
    salt,
    createdAt: new Date(),
  });

  return { userId: result.insertedId, email: normalizedEmail, username };
}

export async function verifyLocalLogin(email, password, db = getDb()) {
  const normalizedEmail = email.toLowerCase();
  const user = await db.collection('users').findOne({ provider: 'local', email: normalizedEmail });
  if (!user) throw new InvalidCredentialsError();

  const ok = await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) throw new InvalidCredentialsError();

  return { userId: user._id, email: user.email, username: user.username };
}

// OAuth-логін: find-or-create за (provider, providerId). Акаунт-лінкінг за
// email між провайдерами/local навмисно не робиться — окремий "github"-
// акаунт і окремий "local"-акаунт з тим самим email лишаються різними
// записами (TECH.md §9, свідомий non-goal цієї ітерації).
//
// username фіксується один раз, на створенні акаунта, з профілю
// провайдера в момент першого логіну — наступні логіни НЕ перезаписують
// його новим значенням із провайдера (стабільність без функції
// редагування важливіша за завжди-свіже ім'я; можна переглянути, коли
// з'явиться реальний "edit profile").
// Hard delete, не soft-delete — insert-only принцип (audit.md) стосується
// лише audit_logs, тут навпаки: видалення документа users і є "право на
// видалення" (frontend/docs/architecture/auth.md). api_keys юзера
// відкликаються окремо, revokeApiKeysForUser() в server.js.
export async function deleteUser(userId, db = getDb()) {
  await db.collection('users').deleteOne({ _id: userId });
}

export async function findOrCreateOAuthUser(provider, providerId, email, username, db = getDb()) {
  const existing = await db.collection('users').findOne({ provider, providerId });
  if (existing) {
    return { userId: existing._id, email: existing.email, username: existing.username };
  }

  const normalizedEmail = email.toLowerCase();
  // Фолбек, якщо провайдер не дав жодного імені (Google без profile.name
  // тощо) — локальна частина email, краще за порожній рядок у UI.
  const resolvedUsername = username || normalizedEmail.split('@')[0];

  const result = await db.collection('users').insertOne({
    provider,
    providerId,
    email: normalizedEmail,
    username: resolvedUsername,
    passwordHash: null,
    salt: null,
    createdAt: new Date(),
  });

  return { userId: result.insertedId, email: normalizedEmail, username: resolvedUsername };
}
