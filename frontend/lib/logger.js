// Використовувати замість console.log/warn/error. У `next dev`
// додатково шле запис на dev-only колектор (`scripts/log-server.mjs`,
// `npm run logs`), який дописує в `logs/YYYY-MM-DD.log`. У проді
// (static export) і мережевий виклик, і сам console.log/warn
// відсікаються — лишається тільки console.error (реальні помилки
// корисні навіть у проді, коли користувач відкриває devtools).
const LOG_SERVER_URL = 'http://127.0.0.1:4319/log';
const isDev = process.env.NODE_ENV === 'development';

function stringify(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function ship(level, args) {
  if (!isDev || typeof fetch !== 'function') return;
  fetch(LOG_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time: new Date().toISOString(), level, message: args.map(stringify).join(' ') }),
    keepalive: true,
  }).catch(() => {});
}

export function log(...args) {
  if (isDev) console.log(...args);
  ship('log', args);
}

export function warn(...args) {
  if (isDev) console.warn(...args);
  ship('warn', args);
}

export function error(...args) {
  console.error(...args);
  ship('error', args);
}
