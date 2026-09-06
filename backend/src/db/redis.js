import Redis from 'ioredis';
import { config } from '../config.js';

let redis;

export function getRedis() {
  if (!redis) {
    redis = new Redis(config.redisUrl, { lazyConnect: false });
  }
  return redis;
}

export async function closeRedis() {
  if (redis) await redis.quit();
  redis = undefined;
}
