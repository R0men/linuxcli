import { randomBytes } from 'node:crypto';
import { getRedis } from '../db/redis.js';

const STATE_TTL_SECONDS = 5 * 60;

// CSRF-нонс для OAuth authorize→callback: без нього сторонній сайт міг би
// підсунути жертві посилання на /oauth/:provider/callback з довільним
// code, виданим ЗЛОВМИСНИКОВІ, і прив'язати жертву до чужого акаунта
// провайдера (login CSRF). Одноразовий — видаляється при першому читанні.
export async function createOAuthState(provider) {
  const redis = getRedis();
  const state = randomBytes(24).toString('hex');
  await redis.set(`oauth:state:${state}`, provider, 'EX', STATE_TTL_SECONDS);
  return state;
}

export async function consumeOAuthState(state, provider) {
  if (!state) return false;
  const redis = getRedis();
  const key = `oauth:state:${state}`;
  const stored = await redis.get(key);
  await redis.del(key);
  return stored === provider;
}
