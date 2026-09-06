# Архітектура бекенда — індекс

Технічна довідка "як влаштований код", по модулях (структура `src/`
1:1) — на відміну від [`../CLAUDE.md`](../CLAUDE.md) (правила роботи
в репозиторії), [`../SETUP.md`](../SETUP.md) (деплой на VPS) і
[`../VERIFY.md`](../VERIFY.md) (перевірка на живому хості).
Архітектурні *рішення* і їх обґрунтування — в
[`../../TECH.md`](../../TECH.md); тут — реалізація файл за файлом,
включно з відомими проблемами й трейд-офами, знайденими при
критичному ревʼю коду.

## Модулі

| Файл | Про що | `src/` |
|---|---|---|
| [`gateway.md`](gateway.md) | HTTP+WS вхідна точка, Origin-перевірка, per-connection стан | `gateway/` |
| [`validator.md`](validator.md) | Tokenizer + per-tool argument schema, без shell | `validator/` |
| [`orchestrator.md`](orchestrator.md) | Docker sandbox pool, життєвий цикл одноразового контейнера | `orchestrator/` |
| [`abuse.md`](abuse.md) | Rate-limit, Turnstile, API key — і головна знайдена діра | `abuse/` |
| [`audit.md`](audit.md) | Insert-only журнал команд, TTL retention | `audit/` + частина `db/mongo.js` |
| [`db.md`](db.md) | Mongo/Redis клієнти-синглтони | `db/` |
| [`auth.md`](auth.md) | Email+пароль, GitHub/Google OAuth — розширення `apiKey.js`, не паралельна система | `users/`, `oauth/`, частина `abuse/` |

## Потік одного `exec`-фрейму

```
WS message ──► wsHandler.js: running-guard (один exec за раз)
                    │
                    ▼
             ensureChallenge() ──not ok──► { type: "challenge-required" }
                    │ ok
                    ▼
             checkRateLimit() ──limit──► { type: "error" }
                    │ ok
                    ▼
             validateCommand() ──invalid──► { type: "error" } + logCommand(rejected)
                    │ { binary, args, timeoutMs }
                    ▼
             runCommand(pool, ...) ──► pool.acquire() → container.exec()
                    │  onChunk → { type: "chunk", ... } стрімом
                    ▼
             { type: "done", exitCode, durationMs, timedOut, aborted }
                    │
                    ▼
             logCommand(success) → audit_logs (insert-only)
                    │
             pool.destroy(container)  ← ЗАВЖДИ, у finally, незалежно від результату
```

## Найважливіші відомі проблеми (зведення)

Актуальний список відкритих проблем із пріоритетами — єдине місце
правди — [`../changelog/changelog.md`](../changelog/changelog.md),
розділ «Незакриті задачі / Known Issues». Нижче — історичний журнал
security/bugfix-sweep від 13-08-2026 (детально в модулях, дати й
перекреслення показують, що вже виправлено):

- ~~**`abuse.md`**: генерація API-ключів дозволяє на практиці
  помножити rate-limit~~ — **виправлено 13-08-2026**: sliding TTL +
  один живий ключ на ipHash одночасно, деталі в `abuse.md`.
- ~~**`gateway.md`**: `getClientIp()`/`X-Forwarded-For` і
  `ALLOWED_ORIGINS`-порожній-за-замовчуванням~~ — **виправлено
  13-08-2026**: `getClientIp` довіряє заголовку тільки з loopback-
  сокета, порожній `ALLOWED_ORIGINS` тепер друкує `console.warn` при
  старті, деталі в `gateway.md`.
- ~~**`orchestrator.md`**: немає глобальної стелі на кількість
  одночасних sandbox-контейнерів~~ — **виправлено 13-08-2026**:
  `SANDBOX_MAX_CONCURRENT` + `PoolExhaustedError`, деталі в
  `orchestrator.md`. Лишається: ліміт виводу не зупиняє сам процес
  достроково.
- ~~**`validator.md`**: `openssl s_client -connect` ламається на
  IPv6~~ — **виправлено 13-08-2026**, деталі в `validator.md`. `curl
  -X` дозволяє `PUT`/`DELETE` понад `TECH.md` §5.3 — залишено як є
  (рішення користувача 13-08-2026: `TECH.md` більше не звіряється як
  джерело істини на цьому рівні деталізації).
- ~~**`audit.md`**: `sandboxId` завжди `null`; `outputTruncated` не
  потрапляє ні користувачу, ні в audit-запис~~ — **виправлено
  13-08-2026**, деталі в `audit.md`/`orchestrator.md`.
- ~~**`db.md`**: `closeMongo()` не викликається при graceful
  shutdown~~ — **виправлено 13-08-2026**.

Разом з попереднім фіксом абʼюз-модуля: ~~дефолтний `IP_HASH_SECRET`
без startup-guard~~ — **виправлено 13-08-2026**, `console.warn` при
старті, деталі в `abuse.md`.

## Наскрізні проблеми (не належать одному модулю)

- ~~**Логування — сирі `console.log`/`console.error` по всьому коду**,
  без рівнів чи кореляційного id~~ — **виправлено 13-08-2026**:
  `src/logger.js` — легкий вейлловий логер (`info`/`warn`/`error`,
  без нових залежностей), `wsHandler.js` генерує короткий `connId`
  (4 байти hex) на кожне WS-з'єднання й пише `connection
  opened`/`closed` + всі помилки цього з'єднання під одним id — логи
  одного з'єднання тепер фільтруються по `[connId]` у виводі. Усі
  раніше сирі `console.*` виклики (`index.js`, `server.js`, `pool.js`,
  `turnstile.js`) переведено на `logger`/connection-scoped `log`.
- ~~**`deploy/linuxcli-backend.service`** хардить тільки
  `NoNewPrivileges=true`~~ — **виправлено 13-08-2026**:
  `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`,
  `CapabilityBoundingSet=` (порожній), `SystemCallFilter=
  @system-service`, `MemoryMax=768M` та інше — деталі й застереження
  щодо перевірки на реальному хості в самому файлі юніта й
  `docs/VERIFY.md` §7.
- ~~**Немає автоматичних тестів і лінтера**~~ — **виправлено
  13-08-2026** (рішення користувача: додати обидва). `node:test`
  (вбудований, без нових залежностей у `dependencies`) — `test/
  validator.test.js` (21 кейс на всі tools, включно з IPv6-фіксом і
  curl PUT/DELETE), `test/pool.test.js` (стеля `maxConcurrent`,
  `PoolExhaustedError`, `liveCount`), `test/apiKey.test.js` (farming-
  фікс: 1 живий ключ на ipHash, sliding TTL) — усі три проти
  fake-докера/fake-Mongo, без живої інфраструктури. `pool.js`/
  `apiKey.js` отримали injectable `docker`/`db`-параметри (опційні,
  дефолт — реальний клієнт, поведінка викликів без цього аргументу не
  змінилась). ESLint (`eslint.config.js`, тільки `eslint:recommended`,
  Node-globals вручну замість пакета `globals`) — `npm run lint`,
  чистий прохід. `npm test` / `npm run lint`.
