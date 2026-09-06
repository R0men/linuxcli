// Легкий вейлловий логер без залежностей (TECH.md §7) — рівні
// info/warn/error і опційний correlation id (одне WS-з'єднання = один
// id), щоб можна було відфільтрувати логи одного з'єднання від інших
// без ручного зіставлення за часом (docs/architecture/README.md,
// наскрізна проблема "сирі console.log").
function write(level, connId, args) {
  const prefix = connId
    ? `${new Date().toISOString()} [${level}] [${connId}]`
    : `${new Date().toISOString()} [${level}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(prefix, ...args);
}

export function createLogger(connId) {
  return {
    info: (...args) => write('info', connId, args),
    warn: (...args) => write('warn', connId, args),
    error: (...args) => write('error', connId, args),
  };
}

export const logger = createLogger();
