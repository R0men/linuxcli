# Anti-abuse — `src/abuse/`

Заміна повноцінного Auth Service (`../../TECH.md` §5.2): rate-limit
(`rateLimiter.js`), anti-bot (`turnstile.js`), опційний API key
(`apiKey.js`), псевдонімізація IP (`ipHash.js`), хешування паролів
(`password.js`, 14-08-2026 — реєстрація/логін, повний опис у
`auth.md`).

## `rateLimiter.js` — ковзне вікно на Redis sorted set

```js
pipeline.zremrangebyscore(key, 0, now - windowMs);     // прибрати застаріле
pipeline.zadd(key, now, `${now}:${Math.random()}`);     // додати цю подію
pipeline.zcard(key);                                      // порахувати вікно
pipeline.pexpire(key, windowMs);
const count = results[2][1];
return count <= limit;
```

Атомарно (одна Redis-транзакція через pipeline/MULTI) — без гонок
між конкурентними запитами того самого `id`. Дві незалежні перевірки
на кожен `exec` — хвилинне й годинне вікно, кожне свій ключ
(`ratelimit:${id}:60000`/`ratelimit:${id}:3600000`); перше, що
провалюється, кидає `RateLimitError`, друге вікно в такому разі
взагалі не перевіряється (і не отримує запис у зсеті для цієї
конкретної спроби).

## `ipHash.js`

```js
export function hmacIp(ip) {
  return createHmac('sha256', config.ipHashSecret).update(ip).digest('hex');
}
```

### Фікс (13-08-2026): startup-guard на дефолтний секрет

`config.ipHashSecret` — `process.env.IP_HASH_SECRET || 'dev-secret-
change-me'`. Якщо змінна не виставлена в `.env` (легко забути,
`../SETUP.md` §7 інструктує `openssl rand -hex 32`, але нічого це не
форсує) — усі IP-хеші в `audit_logs` рахуються цим публічно відомим
рядком. HMAC — однонаправлена функція, тому "розшифрувати" хеш назад
у IP напряму не можна, **але** простір IPv4-адрес — кінцевий і
невеликий (~4 млрд): маючи відомий секрет, можна пере-хешувати ВСІ
можливі IPv4 за розумний час і зіставити з будь-яким записом
`audit_logs`, повністю знявши "приватність" псевдонімізації.

`src/index.js`'s `warnInsecureDefaults()` тепер друкує явний
`console.warn` при старті, якщо секрет лишився дефолтним — не блокує
запуск (проект ніде не використовує `NODE_ENV`-розрізнення dev/prod,
вводити його тільки заради цього не виправдано), але більше не
непомічений мовчки в проді.

## `turnstile.js`

```js
export async function verifyTurnstile(token, remoteIp) {
  if (!token) return false;
  const response = await fetch(VERIFY_URL, { ... });
  if (!response.ok) return false;
  const data = await response.json();
  return data.success === true;
}
```

### Фікс (13-08-2026): логування кожної гілки невдачі + таймаут на `fetch`

Раніше жодна гілка невдачі (порожній `token`, неправильний
`config.turnstile.secretKey`, мережева помилка до Cloudflare, HTTP-
помилка від `siteverify`) не логувалась — усе однаково тихо
поверталось `false`, невідрізнюване від "користувач дійсно не пройшов
перевірку". Якщо `TURNSTILE_SECRET_KEY` порожній чи невірний,
застосунок відхиляв би кожну команду challenge-реквестом назавжди без
жодного сліду в логах.

Тепер: `console.warn` один раз при першому виклику, якщо секрет
порожній; `console.error` окремо для мережевої помилки, не-2xx
відповіді й `data.success !== true` (з `error-codes` від Cloudflare).
Плюс `AbortSignal.timeout(config.turnstile.verifyTimeoutMs)` (дефолт
5с, `TURNSTILE_VERIFY_TIMEOUT_MS`) на сам `fetch` — раніше зависання
`challenges.cloudflare.com` зависало б і весь `execCommand` для
з'єднання без ліміту очікування.

## `apiKey.js`

```js
export async function generateApiKey(ipHash) {
  const existing = await getDb().collection('api_keys')
    .findOne({ ipHash, expiresAt: { $gt: new Date() } });
  if (existing) throw new ApiKeyExistsError(...);   // 1 живий ключ на ipHash

  const rawToken = randomBytes(32).toString('hex');   // 256 біт ентропії
  const tokenHash = hashToken(rawToken);                // sha256, у базі тільки хеш
  await getDb().collection('api_keys').insertOne({
    tokenHash, ipHash, createdAt: new Date(),
    expiresAt: new Date(Date.now() + config.apiKeyIdleTtlSeconds * 1000),
    lastUsedAt: null,
  });
  return { apiKey: rawToken, keyId: ... };
}
```

Сирий токен віддається рівно один раз, у базі — тільки sha256-хеш
(коректна практика, аналогічно до зберігання паролів). Пошук —
`lookupApiKey(rawToken)`: хешує вхідний токен, шукає точний збіг серед
непротухших (`expiresAt > now`) і **відсуває** `expiresAt` заново
(sliding TTL, `API_KEY_IDLE_TTL_SECONDS`, дефолт 24г) — активно
використовуваний ключ не протухає, покинутий — так.

### Фікс (13-08-2026): farming ключів більше не обходить IP-based rate-limit

Раніше генерація була обмежена лише anon-тіром **на IP** (до 200
ключів/год), а кожен ключ давав свою окрему квоту (`keyPerHour: 1000`),
**не прив'язану назад до IP** — одна адреса могла нафармити до 200
незалежних кредитів по 1000 команд/год кожен.

Тепер `generateApiKey(ipHash)` зберігає `ipHash` на документі й
відмовляє (`ApiKeyExistsError` → HTTP 409 у `server.js`), якщо для
цього `ipHash` вже є непротухший ключ. Разом зі sliding TTL це
обмежує кожен IP рівно **одним живим ключем одночасно** — щоб
отримати другий, попередній має протухнути (не використовуватись
`API_KEY_IDLE_TTL_SECONDS`). Індекси в `db/mongo.js`:
`{ipHash: 1}` (пошук існуючого) і `{expiresAt: 1}` з
`expireAfterSeconds: 0` (TTL по значенню поля, не по віку документа).

### `generateApiKey` тепер приймає `userId` (14-08-2026)

`generateApiKey(ipHash, db, userId = null)` — анти-farming гвардія
("1 живий ключ на ipHash") діє лише коли `userId` відсутній: акаунт-
ключ (виданий через `/register`/`/login`/`/oauth/*`) не повинен
впиратись у чужий анонімний ключ на тій самій NAT-адресі. Замість
цього — `revokeApiKeysForUser(userId)` перед видачею нового
(одна жива сесія на юзера). Деталі — `auth.md`.

### Фікс (06-09-2026): `/api-key` тепер перевіряє Origin

Раніше ендпоінт не перевіряв `Origin` — сторонній сайт міг сліпо
викликати `POST /api-key` (браузер не блокує сам запит, лише читання
відповіді без ACAO-заголовка) і згенерувати ключ "від імені" IP свого
відвідувача. Крадіжки самого ключа це не давало (JS на чужому сайті не
міг прочитати body), але через анти-фарм гвардію (1 живий ключ на
`ipHash`, `ApiKeyExistsError`) жертва після цього отримувала `409` при
спробі згенерувати **свій** ключ на реальному фронтенді — грифінг на
`API_KEY_IDLE_TTL_SECONDS` (дефолт 24г), бо непрочитаний "чужий" ключ
ніхто не освіжає.

`handleApiKeyRequest` тепер починається з того самого
`checkOriginHttp()`, що й `/register`/`/login`/`/account/delete` —
запит зі стороннього Origin відхиляється `403` до генерації ключа.
