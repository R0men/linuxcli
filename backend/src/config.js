import 'dotenv/config';

function int(name, fallback) {
  const v = process.env[name];
  return v === undefined ? fallback : parseInt(v, 10);
}

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: int('PORT', 8080),

  // Порожній список = дозволити будь-який Origin (зручно для локальної
  // розробки); на проді має бути явно виставлений домен фронтенда.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB || 'linuxcli',

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  sandboxImage: process.env.SANDBOX_IMAGE || 'linuxcli-sandbox:latest',
  sandboxNetwork: process.env.SANDBOX_NETWORK || 'linuxcli-sandbox-net',
  sandboxPoolMin: int('SANDBOX_POOL_MIN', 10),
  sandboxPoolLowWatermark: int('SANDBOX_POOL_LOW_WATERMARK', 5),
  // Жёсткий потолок на суммарное число живых sandbox-контейнеров (idle +
  // выданные), не только на pool minSize — pool.acquire() раньше мог
  // ad-hoc создавать контейнеры без ограничения при опустошении idle
  // (docs/architecture/orchestrator.md). Дефолт — 3x от pool min: с
  // запасом на burst, но не безлимитно; тюнить вместе с pool min под
  // память хоста (каждый контейнер — до 128MB, containerConfig.js).
  sandboxMaxConcurrent: int('SANDBOX_MAX_CONCURRENT', 3 * int('SANDBOX_POOL_MIN', 10)),

  commandTimeoutMs: int('COMMAND_TIMEOUT_MS', 20000),
  maxOutputBytes: int('MAX_OUTPUT_BYTES', 256 * 1024),
  // Верхня межа розміру одного WS-фрейму (JSON-серіалізований {type,
  // command, turnstileToken}) — без цього ws-бібліотека приймає дефолт
  // (по суті необмежений), і жоден код у застосунку сам розмір не
  // перевіряє (docs/architecture/gateway.md).
  wsMaxPayloadBytes: int('WS_MAX_PAYLOAD_BYTES', 16 * 1024),

  rateLimit: {
    anonPerMin: int('RATE_LIMIT_ANON_PER_MIN', 20),
    anonPerHour: int('RATE_LIMIT_ANON_PER_HOUR', 200),
    keyPerMin: int('RATE_LIMIT_KEY_PER_MIN', 60),
    keyPerHour: int('RATE_LIMIT_KEY_PER_HOUR', 1000),
  },

  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    requiredEveryNCommands: int('TURNSTILE_REQUIRED_EVERY_N_COMMANDS', 20),
    requiredEveryMs: int('TURNSTILE_REQUIRED_EVERY_MS', 30 * 60 * 1000),
    verifyTimeoutMs: int('TURNSTILE_VERIFY_TIMEOUT_MS', 5000),
  },

  ipHashSecret: process.env.IP_HASH_SECRET || 'dev-secret-change-me',

  // Публічні базові URL для OAuth redirect_uri (бекенд) і пост-login
  // редіректу назад у SPA (фронтенд, static export — немає SSR-роута, що
  // міг би сам собі знати свій origin).
  publicApiUrl: process.env.PUBLIC_API_URL || `http://${process.env.HOST || '127.0.0.1'}:${int('PORT', 8080)}`,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  oauth: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    },
  },

  // scrypt — пароль, не токен: N (cost) навмисно вище дефолту Node
  // (16384), щоб brute-force офлайн по витоку бази був дорожчим; вищий N
  // напряму сповільнює кожен login/register (сотні мс), прийнятно для
  // цього обсягу трафіку.
  scryptCost: int('SCRYPT_COST', 32768),

  auditLogRetentionSeconds: int('AUDIT_LOG_RETENTION_SECONDS', 90 * 24 * 3600),

  // Sliding TTL: продлевается при каждом успешном использовании ключа
  // (lookupApiKey), поэтому реально живые ключи не протухают, а
  // заброшенные — очищаются TTL-индексом. Плюс не больше одного
  // активного (непротухшего) ключа на ipHash одновременно — закрывает
  // фарминг ключей для обхода IP-based rate-limit (docs/architecture/abuse.md).
  apiKeyIdleTtlSeconds: int('API_KEY_IDLE_TTL_SECONDS', 24 * 3600),
};
