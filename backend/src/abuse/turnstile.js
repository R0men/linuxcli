import { config } from '../config.js';
import { logger as defaultLogger } from '../logger.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let warnedEmptySecret = false;

// Раніше кожна гілка невдачі (порожній token, мережева помилка, HTTP-
// помилка від Cloudflare, невірний TURNSTILE_SECRET_KEY) однаково тихо
// повертала false — з погляду wsHandler.js це виглядало як звичайний
// "користувач не пройшов challenge", і жоден лог не підказував чому.
// Якщо секрет виставлений неправильно — застосунок відхиляв би кожну
// команду назавжди без жодного сліду. Тепер кожна гілка логується;
// опційний `log` — connection-scoped логер з wsHandler.js (correlation id).
export async function verifyTurnstile(token, remoteIp, log = defaultLogger) {
  if (!token) return false;

  if (!config.turnstile.secretKey && !warnedEmptySecret) {
    warnedEmptySecret = true;
    log.warn('turnstile: TURNSTILE_SECRET_KEY is empty — every challenge will fail verification');
  }

  let response;
  try {
    response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.turnstile.secretKey,
        response: token,
        remoteip: remoteIp ?? '',
      }),
      signal: AbortSignal.timeout(config.turnstile.verifyTimeoutMs),
    });
  } catch (err) {
    log.error('turnstile: siteverify request failed:', err.message);
    return false;
  }

  if (!response.ok) {
    log.error(`turnstile: siteverify returned HTTP ${response.status}`);
    return false;
  }

  const data = await response.json();
  if (data.success !== true) {
    log.error('turnstile: verification failed:', data['error-codes'] ?? data);
    return false;
  }
  return true;
}
