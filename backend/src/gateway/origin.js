import { config } from '../config.js';

// Спільний предикат для WS upgrade (wsHandler.js) і POST /register,
// /login (server.js) — реальні креденшли на цих ендпоінтах роблять
// відсутність Origin-перевірки вищою ставкою, ніж на /api-key (там
// прогалина лишається задокументованою, не закритою цього разу).
export function isOriginAllowed(origin) {
  if (config.allowedOrigins.length === 0) return true;
  return config.allowedOrigins.includes(origin);
}
