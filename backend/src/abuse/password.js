import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
// Node вимагає maxmem >= приблизно 128*N*r (r=8 за замовчуванням) —
// інакше кидає RangeError ще до того, як почне рахувати. Дефолтний
// maxmem Node (32MB) якраз замалий для N=32768 (config.scryptCost).
const SCRYPT_OPTS = { N: config.scryptCost, maxmem: 128 * config.scryptCost * 8 * 2 };

// scrypt, не sha256 — на відміну від apiKey.js (де хешується випадковий
// 256-бітний токен і швидкість не має значення), тут хешується пароль
// людини: потрібен memory-hard KDF, щоб офлайн brute-force по витоку бази
// був дорогим.
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTS);
  return { salt, hash: derived.toString('hex') };
}

// timingSafeEqual, не === — порівняння хешів на рівність не повинно
// витікати через час виконання (branch на першому байті розбіжності).
export async function verifyPassword(password, salt, hash) {
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTS);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
