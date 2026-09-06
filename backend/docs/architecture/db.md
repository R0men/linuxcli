# DB-клієнти — `src/db/`

Сирі клієнти-синглтони, без ORM/query-builder (`../../TECH.md` §7 —
vanilla-підхід послідовно і тут).

## `mongo.js`

```js
export async function connectMongo() {
  if (db) return db;               // синглтон — повторний виклик безкоштовний
  client = new MongoClient(config.mongoUrl);
  await client.connect();
  db = client.db(config.mongoDb);
  await auditLogs.createIndex(...);   // TTL, audit.md
  await apiKeys.createIndex({ tokenHash: 1 }, { unique: true });
  return db;
}

export function getDb() {
  if (!db) throw new Error('Mongo not connected yet — call connectMongo() first');
  return db;
}
```

`getDb()` кидає явну помилку, якщо викликана до `connectMongo()` —
`src/index.js` викликає `connectMongo()` першим дільом у `main()`,
перш ніж піднімати сервер, тож у нормальному потоці ця помилка не
досяжна; страхує тільки від помилки порядку ініціалізації при
рефакторингу.

Унікальний індекс на `api_keys.tokenHash` — на рівні бази гарантує,
що колізія sha256-хешів (астрономічно малоймовірна) не створить два
документи з однаковим хешем.

### `users` (реєстрація/логін, 14-08-2026)

`{ _id, provider ('local'|'github'|'google'), providerId (null для
local), email, passwordHash (null для oauth), salt (null для oauth),
createdAt }`. Два часткові унікальні індекси:

```js
await users.createIndex({ email: 1 },
  { unique: true, partialFilterExpression: { provider: 'local' } });
await users.createIndex({ provider: 1, providerId: 1 },
  { unique: true, partialFilterExpression: { provider: { $in: ['github', 'google'] } } });
```

`partialFilterExpression`, не звичайний унікальний індекс на `email` —
акаунт-лінкінг за email між провайдерами навмисно не робиться
(`auth.md`), тому один і той самий email може легально належати
одразу кільком записам (окремий `local`-акаунт і окремий `github`-
акаунт), а звичайний унікальний індекс на `email` це заборонив би.

`api_keys` отримав новий індекс `{ userId: 1 }` — `userId: null` для
анонімних ключів (як і раніше), реальний `ObjectId` для ключів,
виданих через `/register`/`/login`/`/oauth/*` (`auth.md`).

## `redis.js`

```js
export function getRedis() {
  if (!redis) redis = new Redis(config.redisUrl, { lazyConnect: false });
  return redis;
}
```

`lazyConnect: false` — з'єднання встановлюється одразу при першому
`getRedis()`, не при першій реальній команді. `src/index.js` викликає
`getRedis()` у `main()` "щоб з'єднання підняти раніше" (коментар:
"лениво подключается сам при первом реальном обращении" — насправді,
з `lazyConnect: false`, з'єднання стартує одразу при виклику
`getRedis()`, сам виклик у `main()` — це і є той перший виклик,
формулювання коментаря трохи вводить в оману щодо того, що саме тут
"ліниве").

## Немає явного retry/reconnect-налаштування

Ні `mongo.js`, ні `redis.js` не передають додаткових опцій
надійності (`ioredis` має вбудований reconnect за замовчуванням,
`MongoClient` теж — обидва покладаються на дефолти драйверів, без
explicit tuning під профіль навантаження проєкту). Для MVP-масштабу
(`../../TECH.md` — невеликий VPS) дефолти, ймовірно, достатні, але
жодних явних рішень щодо retry-політики в коді не зафіксовано.

## Graceful shutdown

**Фікс (13-08-2026):** `src/index.js`'s `shutdown()` тепер викликає й
`closeMongo()`, поряд із `closeRedis()` — симетрично, обидва клієнти
закриваються явно при SIGTERM/SIGINT перед `process.exit(0)`.
