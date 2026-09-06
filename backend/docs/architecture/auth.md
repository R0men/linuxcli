# Реєстрація/логін — `src/abuse/password.js`, `src/users/`, `src/oauth/`

Email+пароль і GitHub/Google OAuth (14-08-2026) — розширення наявного
анонімного API-key флоу (`abuse.md`), не паралельна auth-система:
`register`/`login`/`oauth-callback` усі закінчуються тим самим викликом
`generateApiKey(ipHash, db, userId)`, що й анонімний `/api-key`, просто
з непорожнім `userId`. `wsHandler.js`, `rateLimiter.js`, `lookupApiKey`
далі працюють без змін — акаунт-ключ і анонімний ключ невідмінні для
решти системи, крім значення `userId`.

## Схема `users` (`db.md`)

`{ _id, provider ('local'|'github'|'google'), providerId (null для
local), email, username, passwordHash (null для oauth), salt (null для
oauth), createdAt }`. Акаунт-лінкінг за email між провайдерами **не
робиться** — окремий `local`-акаунт і окремий `github`-акаунт з тим
самим email лишаються різними записами. Свідомий non-goal цієї
ітерації, не недогляд.

**`username` — псевдонім для UI, не логін-ідентифікатор** (той і далі
— email, унікальний серед `local`-акаунтів). Для `/register` —
обов'язкове поле форми (1-40 символів, `isValidUsername`, `server.js`).
Для OAuth — з профілю провайдера при **першому** логіні
(`src/oauth/github.js`: `user.login`, завжди присутній хендл;
`src/oauth/google.js`: `profile.name`, потребує scope `profile`, з
фолбеком на локальну частину email, якщо провайдер імені не дав) і
**фіксується назавжди** — наступні OAuth-логіни НЕ перезаписують його
свіжим значенням з провайдера (`findOrCreateOAuthUser`, `users.js`) —
стабільність важливіша, поки нема окремої функції "редагувати
профіль". Немає жодної унікальності на `username` — суто display-
label, не ідентифікатор.

## `password.js` — scrypt, не sha256

`apiKey.js` хешує **токен** (sha256 достатньо — токен уже 256 біт
випадковості, швидкість пошуку важлива). Пароль людини — інша задача:
`hashPassword`/`verifyPassword` через `crypto.scrypt` (memory-hard KDF,
`SCRYPT_COST`, дефолт `N=32768`) + `crypto.timingSafeEqual` при
порівнянні (не `===` — уникнути timing-атаки на порівняння хешів).

`SCRYPT_OPTS.maxmem` виставлений явно (`128 * N * r * 2`) — Node-івський
дефолтний `maxmem` (32MB) замалий для `N=32768` і кидає `RangeError`
ще до самого хешування.

## `POST /register`, `POST /login` (`server.js`)

- Відповідь обох — `{ apiKey, username }`, не просто `{ apiKey }` —
  фронтенд показує `username` в хедері (`AuthStatus.jsx`), не email.
- Ручна валідація (email-регексп, пароль ≥ 8 символів, `/register`
  додатково `username` 1-40 символів) — без validation-бібліотеки, той
  самий стиль, що й Command Validator.
- `/login` віддає **однакове повідомлення** `"invalid email or
  password"` і для невідомого email, і для невірного пароля
  (`InvalidCredentialsError`, `users.js`) — без цього список email міг
  би бути enumerable через різницю відповідей.
- Rate-limit: `register:${ipHash}`, `login:${ipHash}` **і**
  `login:email:${sha256(email)}` окремо — перший стримує один IP, що
  перебирає паролі для багатьох акаунтів, другий — розподілений
  credential-stuffing по одному акаунту з багатьох IP.
- `checkOriginHttp()` — на відміну від `/api-key`, ці два ендпоінти
  перевіряють `Origin` (`gateway.md`) — реальні креденшли, вища ставка.
- Успішний логін: `revokeApiKeysForUser(userId)` перед видачею нового
  ключа — одна жива сесія на юзера, паралельні пристрої поза скоупом
  цієї ітерації.

## `POST /account/delete` — видалення акаунту (17-08-2026)

Право на видалення (frontend `/account`, `docs/architecture/auth.md`
у фронтенд-репо) — `deleteUser(userId)` (`users.js`, hard delete
документа `users`) + `revokeApiKeysForUser(userId)` (усі живі
`api_keys` юзера, не тільки пред'явлений). Автентифікація — сам
`apiKey` у тілі запиту, той самий рівень довіри, що вже авторизує
`/logout`: без повторного пароля, бо OAuth-акаунти пароля взагалі не
мають. `lookupApiKey(apiKey)` з `userId === null` (анонімний ключ) чи
неіснуючий ключ → `400`, видаляти нічого. `checkOriginHttp` + окремий
rate-limit `account-delete:${ipHash}`, той самий підхід, що й
`/register`/`/login` (реальний вплив на дані користувача).

**Що НЕ видаляється:** записи в `audit_logs`, уже створені до
видалення акаунту. `audit_logs` — insert-only (`audit.md`), прив'язані
до `apiKeyId`/`ipHash`, не напряму до `userId`, і вже псевдонімізовані
(hashed IP, не сирий). Видалення `users`/`api_keys` розриває
можливість пов'язати майбутні дії з акаунтом, але не ретроактивно
чистить історію — вона зникає сама через 90-денний TTL-індекс
(`db/mongo.js`). Це усвідомлений компроміс, зафіксований у
Privacy Policy фронтенда, не недогляд.

**Що НЕ обривається негайно: уже відкрите WS-з'єднання.**
`wsHandler.js`'s `handleConnection` резолвить `apiKeyId` через
`lookupApiKey()` **рівно один раз**, при апгрейді з'єднання (рядок з
`const apiKeyId = ...`), і тримає це значення в замиканні на все life-
time сокета — жоден наступний `exec`-фрейм не перепитує базу, чи
`api_keys`-документ (а тепер і сам `users`-документ) досі існує.
Наслідок: якщо юзер видаляє акаунт, поки в іншій вкладці відкритий
живий `Terminal`, та вкладка й далі виконує команди (rate-limit і
audit-запис підуть під уже "осиротілий" `apiKeyId`) аж до закриття/
переконекту WS — видалення блокує нові підключення й логіни, але не
вбиває активні. Той самий кеш-інваріант, що вже описаний як "WS
reconnect gotcha" у `../../../frontend/docs/architecture/auth.md` для
логіну/логауту — видалення акаунту йому підвладне так само. Privacy
Policy фронтенда (`site.json`'s `privacy.yourRights.caveat`) явно
попереджає про це користувача, а не мовчить.

## OAuth (`src/oauth/`) — чому весь флоу на бекенді

Фронтенд — `output: 'export'`, без SSR/API-роутів
(`../../../frontend/TECH.md` §2). Callback від GitHub/Google **не може**
приземлитись на серверний код фронтенда — його там немає. Тому весь
обмін `code`→токен→профіль робить бекенд:

```
/login (кнопка) → GET /oauth/:provider/start (бекенд генерує state,
редіректить на github.com/accounts.google.com)
  → провайдер редіректить на GET /oauth/:provider/callback (бекенд)
    → бекенд звіряє state, exchangeCode(), fetchProfile(),
      findOrCreateOAuthUser(), видає apiKey
      → 302 на {FRONTEND_URL}/auth/complete?apiKey=...&username=...
        (фронтенд, тонка сторінка-приймач токена, кладе в localStorage
        і чистить URL — frontend/docs/architecture/auth.md)
```

`CLIENT_SECRET` обох провайдерів лишається виключно на бекенді
(`.env`, як `TURNSTILE_SECRET_KEY`) — фронтенду не потрібні навіть
публічні `client_id`, він лише лінкує на `{BACKEND_URL}/oauth/
github/start`.

**`state` (`oauth/state.js`), не Origin — CSRF-захист callback'а.**
Одноразовий нонс у Redis (`oauth:state:<random>`, TTL 5 хв, видаляється
при першому читанні) — без нього сторонній сайт міг би підсунути
жертві посилання на `/oauth/:provider/callback` із `code`, виданим
зловмиснику, і прив'язати сесію жертви до чужого акаунта провайдера
(login CSRF). Origin-перевірка тут не працює в принципі — callback
приходить як top-level навігація від github.com/accounts.google.com,
не з фронтенда.

**Graceful degradation без конфігурації** — `GITHUB_CLIENT_ID`/
`GOOGLE_CLIENT_ID` відсутні → `configured === false` у відповідному
модулі (`src/oauth/github.js`/`google.js`) → `/oauth/:provider/start`
віддає 404, `/oauth/providers` не включає цей провайдер у список.
Той самий патерн, що й `lib/turnstile.js` на фронтенді для відсутнього
site key — код коректно працює й без зовнішньої реєстрації застосунку,
просто відповідні кнопки не з'являються. Покроковий гайд, як
зареєструвати застосунки в GitHub Developer Settings/Google Cloud
Console і заповнити `.env` — `../OAUTH_SETUP.md`.

### `src/oauth/github.js`

`/user.email` часто `null` (приватний профіль) — реальний email береться
з `/user/emails` (primary+verified). Немає верифікованого email на
GitHub-акаунті → `fetchProfile` кидає, callback редіректить на
`/login?error=oauth_failed`. `username` — `user.login` (хендл, завжди
присутній, на відміну від `user.name`, який юзер міг не заповнити).

### `src/oauth/google.js`

`fetchProfile` вимагає `email_verified === true` з `userinfo`-відповіді
— той самий принцип: не довіряти неверифікованому email як ідентифікатору
акаунта. Scope включає `profile` (не тільки `openid email`) — без нього
`userinfo` не віддає `name` узагалі; якщо все ж `name` порожній
(рідкісний випадок), `findOrCreateOAuthUser` підставляє локальну
частину email.

## CORS (фікс 14-08-2026 — без цього нічого з вищого не працювало з браузера)

Перша реальна перевірка в проді показала: `curl` бачив коректні
відповіді на всі ці ендпоінти, а браузерний `fetch()` з фронтенда
мовчки провалювався (ні `Access-Control-Allow-Origin`, ні обробки
preflight `OPTIONS`) — деталі й фікс у `gateway.md`. Урок: `curl`-
перевірка ендпоінта не доводить, що він працює з реального браузера,
CORS — суто браузерний механізм.

## Тести

`test/auth.test.js` — `password.js` (правильний/неправильний пароль,
різні salt на однаковий пароль), `users.js` (register/login happy path,
дублікат email, однакове повідомлення для невірного пароля й невідомого
email, find-or-create для OAuth, різні провайдери з однаковим
`providerId` лишаються окремими акаунтами, `deleteUser` видаляє
документ і робить подальший логін неможливим). OAuth-обмін код-на-токен
(мережевий виклик до реального провайдера) не тестується — покриті
тільки `state`-верифікація опосередковано через `users.js`/`password.js`
логіку, яку `handleOAuthCallback` перевикористовує.
