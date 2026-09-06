# Логування — `lib/logger.js` + `scripts/log-server.mjs`

Заміна `console.log`/`warn`/`error` для всього клієнтського коду, з
опційною доставкою у файли на диску під час локальної розробки.

## `lib/logger.js`

```js
export function log(...args)    // console.log + ship('log', args)
export function warn(...args)   // console.warn + ship('warn', args)
export function error(...args)  // console.error + ship('error', args)
```

`ship()` — best-effort `fetch(...)` на `http://127.0.0.1:4319/log`,
**тільки коли `process.env.NODE_ENV === 'development'`**. У
`next build` (у т.ч. static export, те, що реально йде на Cloudflare
Pages) `NODE_ENV` — завжди `'production'` незалежно від
`output: 'export'`; бандлер constant-folds `isDev` у `false`, і
мережевий виклик не виконується для жодного реального користувача
сайту. Помилка `fetch` (колектор не запущений) проковтується мовчки
— логування ніколи не повинно ламати застосунок.

## `scripts/log-server.mjs`

Окремий, незалежний від Next.js Node-процес (тільки вбудовані модулі
— `node:http`, `node:fs`, `node:path`) — **не частина білду**, не
деплоїться нікуди. Запускається вручну поряд із `npm run dev`:

```bash
npm run logs
```

Приймає `POST /log` з JSON `{ time, level, message }`, дописує
рядок у `logs/YYYY-MM-DD.log` (створюється автоматично, у
`.gitignore`). CORS обмежений одним origin
(`LOG_SERVER_ALLOWED_ORIGIN`, дефолт `http://localhost:3000`), сервер
слухає тільки `127.0.0.1` — недосяжний ззовні хоста розробника.

**Навмисно без автентифікації й без санітизації `message` перед
записом у файл** — це localhost-only dev-утиліта, а не production
API; будь-який процес на тій самій машині технічно міг би написати
туди довільний рядок, але це не incident-worthy для локального
інструмента діагностики.

## Чому не через API route в самому Next.js

Очевидна альтернатива — `app/api/log/route.js` у самому Next.js
проєкті. Свідомо **не зроблено**: `next.config.js` має
`output: 'export'`, а Route Handler, що приймає `POST` з довільним
тілом, органічно динамічний — Next.js відмовляється експортувати
такий build статично (та сама помилка класу, що виникла з
`app/sitemap.js`/`app/robots.js` без `export const dynamic =
'force-static'`, тільки тут її взагалі не можна обійти для `POST`).
Тримати лог-колектор окремим процесом — єдиний спосіб не порушити
static-export архітектуру (`../CLAUDE.md`: "Не додавати SSR/data-
фетчинг на запиті").
