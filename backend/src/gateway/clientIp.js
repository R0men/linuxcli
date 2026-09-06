const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// X-Forwarded-For — це заголовок, який може виставити будь-який клієнт;
// довіряти йому можна, тільки якщо TCP-з'єднання прийшло від довіреного
// reverse proxy. Раніше це було операційним припущенням (backend нібито
// слухає лише 127.0.0.1, SETUP.md §11), нічим у коді не перевіреним —
// якщо колись HOST=0.0.0.0, заголовок ставав повністю контрольованим
// атакуючим (rate-limit і audit ipHash тривіально підробні). Тепер
// перевіряється явно: заголовку довіряємо, тільки якщо сам сокет прийшов
// з loopback (саме так підключається локальний reverse proxy).
export function getClientIp(req) {
  const socketAddr = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for'];

  if (
    LOOPBACK_ADDRESSES.has(socketAddr) &&
    typeof forwarded === 'string' &&
    forwarded.length > 0
  ) {
    return forwarded.split(',')[0].trim();
  }

  return socketAddr;
}
