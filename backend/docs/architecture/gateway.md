# Gateway — `src/gateway/`

HTTP + WebSocket вхідна точка (`server.js`), per-connection стан і
протокол-логіка (`wsHandler.js`), IP-екстракція (`clientIp.js`).

## `server.js`

Plain `node:http` сервер (без Express/Fastify — `../../TECH.md` §7,
"vanilla, мінімум залежностей"):

- `GET /health` → `{status:"ok"}` — **поверхневий чек**, не звіряє
  реальний стан Mongo/Redis/Docker. Якщо Redis відвалився, а HTTP-
  сервер живий — `/health` все одно скаже "ok". Для реального
  моніторингу вартий deep-check варіант (пінгнути кожну залежність),
  окремо від легкого liveness-проба.
- `POST /api-key` → `{apiKey}` (див. `abuse.md` — і головну знайдену
  проблему з rate-limit-обходом через це).
- `POST /register`, `POST /login`, `POST /logout`, `GET /oauth/
  providers`, `GET /oauth/:provider/start`, `GET /oauth/:provider/
  callback` (14-08-2026) — деталі флоу, схема `users`, чому OAuth
  callback обробляється саме бекендом (static export не має SSR) —
  `auth.md`.
- `server.on('upgrade', ...)` → перевіряє `pathname === '/terminal'`,
  інакше `socket.destroy()`; далі `wss.handleUpgrade` →
  `handleConnection` (wsHandler.js).

### CORS-заголовки на відповідях (фікс 14-08-2026)

Знайдено вже в проді: `curl` бачив коректні відповіді на всі нові
ендпоінти, але реальний браузерний `fetch()` з фронтенда мовчки
провалювався — жодного `Access-Control-Allow-Origin` на відповідях, і
`OPTIONS`-preflight (браузер сам шле його перед `POST` із
`Content-Type: application/json`) падав у 404. Симптом на фронтенді
був непрямий: `getOAuthProviders()` тихо повертав `[]` через свій
власний `catch`, тому й `/register`/`/login` теж не працювали з
браузера, не тільки OAuth-кнопки.

Виправлено на самому верху `createServer`'s request-хендлера, до будь-
якого роутингу: `Access-Control-Allow-Origin` віддзеркалює `Origin`
запиту, якщо той проходить `isOriginAllowed()`; окремо оброблено
`OPTIONS` (204 + `Access-Control-Allow-Methods`/`-Headers`). Це
**інший механізм**, ніж `checkOriginHttp()` нижче — CORS-заголовки
керують тим, чи браузер **дозволить JS прочитати** відповідь; вони не
заважають серверу обробити сам запит. `test/cors.test.js` — реальний
HTTP-раунд-тріп через `createServer` (не юніт-тест внутрішньої
логіки), саме тому, що баг був у плумбінгу, невидимому для curl.

**`/api-key` — CORS-заголовок тепер є, але `checkOriginHttp()` і далі
нема.** Це не закриває вектор нижче: CORS блокує лише ЧИТАННЯ
відповіді сторонньою сторінкою, сам запит (і побічний ефект — видача
ключа) виконується сервером незалежно від CORS. Зловмисна сторінка й
далі може мовчки згенерувати ключ "від імені" відвідувача, навіть не
прочитавши відповідь.

Доступний cross-origin з будь-якого сайту — не CSRF-загроза в
класичному сенсі (немає cookie-сесії, яку можна вкрасти), але дозволяє
стороннім сторінкам тихо генерувати ключі "від імені" IP відвідувача —
той самий вектор, що і в `abuse.md`. **Не закрито й тут** — свідомо,
нижчі ставки (анонімний ключ, не креденшли).

`/register` і `/login` (14-08-2026) — реальні креденшли, вища ставка —
**перевіряють Origin** через ту саму функцію, що й WS upgrade нижче
(`isOriginAllowed`, тепер винесена в спільний `origin.js`, а не
дубльована). `/oauth/:provider/start`/`/callback` — навмисно **без**
Origin-перевірки: це full-page навігації браузера через github.com/
accounts.google.com і назад, не fetch з поточної сторінки, тому
Origin-заголовок на них здебільшого відсутній; CSRF там закриває
одноразовий `state`-параметр (`auth.md`), не Origin.

## Логування (фікс 13-08-2026)

Кожне з'єднання отримує короткий `connId` (`randomBytes(4).toString('hex')`)
і connection-scoped логер (`createLogger(connId)`, `src/logger.js`) —
`connection opened`/`closed` і всі помилки цього з'єднання пишуться під
одним id, `verifyTurnstile()` отримує той самий логер третім
аргументом (раніше налагодження Turnstile-збоїв не давало жодного
сліду в логах — саме той клас проблеми, що забрав час під час
розробки фронтенда).

## `wsHandler.js` — per-connection стан

`handleConnection(ws, req, { pool })` створює closure-стан на кожне
WS-з'єднання:

```js
let turnstilePassedAt = 0;
let commandsSinceChallenge = 0;
let running = false;        // guard: один exec за раз
let activeAbort = null;     // AbortController поточної команди
```

### Origin-перевірка

```js
// gateway/origin.js — спільна і для WS upgrade, і для POST /register, /login
export function isOriginAllowed(origin) {
  if (config.allowedOrigins.length === 0) return true;  // ⚠ дефолт = дозволити все
  return config.allowedOrigins.includes(origin);
}
```

**Фікс (14-08-2026):** раніше `isOriginAllowed` була приватною
функцією тільки в `wsHandler.js`; винесена в `gateway/origin.js`, щоб
`server.js` міг перевіряти Origin на `/register`/`/login` тим самим
кодом, а не копією логіки, яка могла б розійтись.

`config.allowedOrigins` — порожній масив, якщо `ALLOWED_ORIGINS` не
задано в `.env` (`config.js`). **Порожньо = дозволити будь-який
Origin.** Задокументовано як "зручно для dev, не для проду"
(`config.js` коментар).

**Фікс (13-08-2026):** `src/index.js`'s `warnInsecureDefaults()`
друкує явний `console.warn` при старті, якщо `ALLOWED_ORIGINS`
порожній — не блокує запуск (SETUP.md §11 навмисно лишає цей стан як
проміжний крок першого smoke-тесту), але більше не залишається
непоміченим у логах при деплої в прод.

### `getClientIp` — тепер перевіряє джерело заголовка

```js
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function getClientIp(req) {
  const socketAddr = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for'];
  if (LOOPBACK_ADDRESSES.has(socketAddr) && typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return socketAddr;
}
```

**Фікс (13-08-2026):** раніше `X-Forwarded-For` довірявся
беззастережно, спираючись на операційне припущення "backend лише за
довіреним reverse proxy на `127.0.0.1`", нічим у коді не перевірене.
Тепер заголовку довіряємо, тільки якщо сам TCP-сокет прийшов з
loopback — саме так підключається локальний reverse proxy (`SETUP.md`
§12, Caddy на тому ж хості). Якщо колись `HOST=0.0.0.0` без
loopback-проксі попереду — заголовок просто ігнорується, використовується
реальна адреса сокета, підробити яку клієнт не може.

### `ensureChallenge` — коли саме перевіряється Turnstile

```js
const stale =
  Date.now() - turnstilePassedAt > config.turnstile.requiredEveryMs ||
  commandsSinceChallenge >= config.turnstile.requiredEveryNCommands;
```

`turnstilePassedAt = 0` спочатку → перша команда на з'єднанні завжди
"stale" → challenge форсується на першій-ліпшій команді, не строго
"на старті WS-сесії" (§8 TECH.md формулює як "на старті сесії", але
реалізація — лениво, при першій спробі `exec`). Функціонально майже
те саме (фронтенд і так проактивно тягне токен одразу після
монтування терміналу), але формально розходиться з буквальним
формулюванням.

### Один `exec` за раз

```js
if (running) {
  send(ws, { type: 'error', message: 'a command is already running on this connection' });
  return;
}
running = true;
try { await execCommand(frame); } finally { running = false; }
```

Простий, коректний guard — жодних гонок, бо `ws.on('message', async
...)` обробники виконуються послідовно для одного сокета (Node's
event loop, немає паралелізму всередині одного connection handler).

### Обрив з'єднання під час виконання

```js
ws.on('close', () => {
  activeAbort?.abort();
});
```

`activeAbort` — `AbortController` поточної команди; сигнал прокидується
в `runCommand` (`orchestrator.md`), яка гонить його проти `finished`/
`timeout` і вбиває контейнер. Немає витоку "завислого" sandbox при
розриві WS.

## Ліміт на розмір WS-повідомлення

**Фікс (13-08-2026):** `new WebSocketServer({ noServer: true, maxPayload:
config.wsMaxPayloadBytes })` — дефолт 16KB (`WS_MAX_PAYLOAD_BYTES`),
з запасом під найдовшу реалістичну команду (`curl -H "..." ...`).
Раніше створювався без `maxPayload` узагалі — діяв внутрішній дефолт
бібліотеки `ws`, ніде явно не заданий.
