import { getRedis } from '../db/redis.js';
import { config } from '../config.js';

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// Настоящее скользящее окно на sorted set: score = timestamp, снизу
// обрезаем всё старше windowMs, ZCARD = число событий внутри окна.
// Дешевле, чем кажется — три sorted-set операции за pipeline на вызов.
async function withinWindow(redis, id, windowMs, limit) {
  const now = Date.now();
  const key = `ratelimit:${id}:${windowMs}`;

  const pipeline = redis.multi();
  pipeline.zremrangebyscore(key, 0, now - windowMs);
  pipeline.zadd(key, now, `${now}:${Math.random()}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, windowMs);
  const results = await pipeline.exec();

  const count = results[2][1];
  return count <= limit;
}

export async function checkRateLimit({ id, isApiKey }) {
  const redis = getRedis();
  const limits = isApiKey
    ? [
        [60_000, config.rateLimit.keyPerMin],
        [3_600_000, config.rateLimit.keyPerHour],
      ]
    : [
        [60_000, config.rateLimit.anonPerMin],
        [3_600_000, config.rateLimit.anonPerHour],
      ];

  for (const [windowMs, limit] of limits) {
    const ok = await withinWindow(redis, id, windowMs, limit);
    if (!ok) {
      throw new RateLimitError(`rate limit exceeded: ${limit} per ${windowMs / 1000}s`);
    }
  }
}
