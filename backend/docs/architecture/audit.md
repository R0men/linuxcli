# Audit Logger — `src/audit/logger.js` (+ TTL у `db/mongo.js`)

Insert-only журнал кожної спроби виконання команди — і успішної, і
відхиленої валідатором (`../../TECH.md` §5.6): для investigation по
abuse-репортах за відсутності обов'язкових акаунтів обидва типи
записів потрібні однаково.

## `logCommand(entry)`

```js
const doc = {
  timestamp: new Date(),
  ipHash: entry.ipHash,              // HMAC, не сирий IP (abuse.md)
  apiKeyId: entry.apiKeyId ?? null,
  rawCommand: entry.rawCommand ?? null,   // тільки для rejected — сирий рядок, що не пройшов валідатор
  binary: entry.binary ?? null,           // тільки для успішних — вже розібраний
  args: entry.args ?? null,
  target: entry.target ?? deriveTarget(entry.args),
  ...
  rejected: entry.rejected ?? false,
  rejectionReason: entry.rejectionReason ?? null,
};
await getDb().collection('audit_logs').insertOne(doc);
```

`deriveTarget` — евристика "перший аргумент, що не починається з
`-`" — для швидкого пошуку по цілі без парсингу кожного тула окремо
під час читання логів.

**Insert-only навмисно** — жодного `updateOne`/`deleteOne` в
app-коді, коментар у файлі прямо це підкреслює. Видалення старих
записів — виключно через TTL-індекс, не через код цього модуля.

## TTL retention (`db/mongo.js`)

```js
await auditLogs.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: config.auditLogRetentionSeconds }  // дефолт 90 днів
);
```

Нативний MongoDB TTL-індекс — видалення старих записів без окремої
cron-джоби чи коду в застосунку. Індекс створюється ідемпотентно при
кожному `connectMongo()` виклику (MongoDB сам не робить нічого, якщо
індекс із такими параметрами вже існує).

## Що НЕ логується

- ~~**`sandboxId`** завжди `null`~~ — **виправлено 13-08-2026**:
  `sandbox.js` повертає `sandboxId: container.id`, `wsHandler.js`
  передає його в `logCommand()`. Audit-запис тепер прив'язаний до
  конкретного Docker-контейнера.
- ~~**`outputTruncated`** не доходить нікуди~~ — **виправлено
  13-08-2026**: тепер і в `done`-фреймі клієнту, і в audit-записі
  (`logger.js` доповнено полем `outputTruncated`).
- Жодного логування **на рівні самого audit-модуля** при помилці
  запису в Mongo (`insertOne` може кинути виняток, наприклад при
  відвалі з'єднання) — виняток пролетить нагору до `wsHandler.js`'s
  зовнішнього `catch` (`internal error` користувачу), але сам факт
  "audit-запис не був записаний" ніде окремо не позначається/не
  ретраїться.
