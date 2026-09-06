# Реєстрація/логін — `lib/auth.js`, `/login`, `/register`, `/auth/complete`

Email+пароль і GitHub/Google OAuth (14-08-2026) — розширення наявного
анонімного API-key флоу (`lib/apiKey.js`), не паралельна система:
`register`/`login`/OAuth усі кладуть той самий `linuxcli_api_key` в
`localStorage`, який `Terminal.jsx` уже читає через `getStoredApiKey()`.
Другий прапор, `linuxcli_account_name` — сам ключ непрозорий
(випадковий токен), тому UI інакше не міг би відрізнити анонімну
сесію від залогиненої без нього. **Зберігає `username` (псевдонім),
не email** — email ніде в UI не показується, лише як логін-
ідентифікатор при `/login` (`../../../backend/docs/architecture/
auth.md` — там же схема `users`, звідки береться `username`).

Повний бекенд-дизайн (схема `users`, `scrypt`, чому OAuth callback на
бекенді) — `../../../backend/docs/architecture/auth.md`. Тут — тільки
фронтенд-частина.

## `lib/auth.js`

`registerAccount(httpUrl, email, password, username)`/`loginAccount` —
`POST /register`/`/login` → `{ apiKey, username }`, кладе обидва в
`localStorage`. `logoutAccount` — `POST /logout`, best-effort (мережева
помилка не блокує локальний clear — `Terminal.jsx` на наступному
підключенні просто піде як анонім). `getOAuthProviders` — легкий `GET
/oauth/providers`, мережева помилка чи бекенд без цього ендпоінта не
ламає рендер `/login`/`/register`, просто жодна OAuth-кнопка не
з'являється.

### `onAuthChange` — синхронізація між компонентами (фікс 14-08-2026)

**Баг, знайдений у проді:** після OAuth-редіректу (і так само після
звичайного `register`/`login`) хедер сайту показував "не залогинений"
аж до ручного перезавантаження сторінки. Причина: `AuthStatus` живе в
кореневому `layout.jsx` (`SiteHeader.jsx`), а `router.push`/
`router.replace` — це client-side навігація, яка **не перемонтовує**
layout, тільки контент сторінки. `AuthStatus`'s `useEffect(() => {...},
[])` уже відпрацював один раз задовго до логіну й ніколи не читав
`localStorage` знову.

Фікс — той самий патерн, що вже є для теми
(`linuxcli-theme-change`, `ThemeToggle.jsx`): `notifyAuthChange()`
кличе `window.dispatchEvent(new CustomEvent('linuxcli-auth-change'))`
після кожного запису в `localStorage` (`registerAccount`,
`loginAccount`, `completeOAuthLogin`, `logoutAccount`).
`onAuthChange(callback)` — обгортка над `addEventListener`, повертає
cleanup-функцію. `AuthStatus.jsx` підписується в своєму mount-ефекті й
перечитує `getAccountName()` на кожну подію — без цього ЖОДЕН із трьох
шляхів логіну (email/пароль, OAuth) не оновлював хедер без reload.

**Крос-табова синхронізація (фікс 17-08-2026).** `linuxcli-auth-change`
— `window.dispatchEvent`, летить тільки в межах тієї вкладки, де
викликали `notifyAuthChange()`. Знайдено при рев'ю `/account`: логаут
в одній вкладці не оновлював `AccountView`/`AuthStatus` в іншій — та
лишалась із "живим" username, і клік "Delete account" там пішов би з
уже недійсним/порожнім `apiKey` (перша вкладка вже почистила
`localStorage`) замість чіткого повідомлення "ти вже не залогинений".
`onAuthChange` тепер додатково слухає нативну `storage`-подію
(летить саме в ІНШІ вкладки на зміну `localStorage`, ніколи в ту, що
змінила) і фільтрує її за ключем (`API_KEY_STORAGE_KEY` з `apiKey.js`,
`linuxcli_account_name`) — обидва механізми покривають одна одну:
`linuxcli-auth-change` для тієї самої вкладки, `storage` для решти.

## OAuth — чому кнопка веде прямо на бекенд, не на клієнтський флоу

Фронтенд — `output: 'export'`, без SSR/API-роутів (`../../TECH.md`
§2). Кнопка "Continue with GitHub/Google" — звичайне `<a
href="{BACKEND_URL}/oauth/github/start">` (`components/OAuthButtons/`,
спільний для `/login` і `/register` — OAuth не розрізняє "новий"/
"існуючий" акаунт, `findOrCreateOAuthUser` на бекенді, тож той самий
блок доречний на обох сторінках без дублювання логіки походу за `GET
/oauth/providers`), без жодного клієнтського JS-обміну кодом на токен.
Увесь танець (state, обмін `code`, виклик provider API) робить бекенд;
фронтенду не потрібні навіть публічні `client_id`.

Провайдер після успіху редіректить браузер на
`{BACKEND_URL}/oauth/:provider/callback` (бекенд, не фронтенд), бекенд
видає власний `apiKey` і робить 302 на
`{FRONTEND_URL}/auth/complete?apiKey=...&username=...` — оце вже
приземляється на `AuthComplete.jsx` (`components/AuthComplete/`):
читає обидва query-параметри, `completeOAuthLogin()` кладе їх у
`localStorage` (і шле `linuxcli-auth-change`, розділ вище), одразу
`history.replaceState` (щоб токен не лишався в URL-барі/історії
браузера), і `router.replace('/tools')`.

`useSearchParams()` у `LoginView`/`AuthComplete` вимагає `<Suspense>`
на static export — обидві `app/*/page.jsx` загортають клієнтський View
у `<Suspense>` без fallback (короткий редирект/помилка, не варта
власного skeleton).

## WS reconnect gotcha (важливо при майбутніх змінах)

`useTerminalSocket`'s `connect` — `useCallback` з deps `[wsUrl,
apiKey]`; якби `apiKey` змінився при вже змонтованому й підключеному
`<Terminal>`, ефект перестворив би WS посеред сесії, обірвавши
`RUNNING`-команду. Це навмисно обійдено, а не вирішено в загальному
вигляді: `/login`, `/register`, `/auth/complete` — окремі роути від
`/tools`/`/`, там нема живого `Terminal`-WS, який можна перебити; новий
ключ підхоплюється на наступному чистому монтуванні після
`router.push`/`router.replace`. **Якщо колись знадобиться логін
на тій самій сторінці, де вже відкритий термінал** (напр. модалка
замість окремої сторінки) — цю гарантію треба переглянути.

## `AuthStatus` (`components/AuthStatus/`)

Client-компонент у `SiteHeader.jsx`, той самий mount-guard патерн, що
й `ThemeToggle` (`username === null` — ще не змонтовано на клієнті,
уникає SSR/hydration mismatch; не плутати з "не залогинений", це
порожній рядок). "Log in / Sign up" коли `getAccountName()` порожній,
`username · Log out` коли є. Підписаний на `onAuthChange` (розділ
вище) — без цього не оновлювався б після логіну без reload сторінки.

## `/account` — кабінет і видалення акаунту (17-08-2026)

`components/AccountView/` — той самий mount-guard патерн, що й
`AuthStatus` (`getAccountName() === ''` після монтування, а не `null`
→ нема сесії → `router.replace('/login')`). Показує `username`,
кнопку "Log out" (`logoutAccount`, як в `AuthStatus`) і "Danger zone"
з кнопкою "Delete account".

**Підтвердження видалення — лише apiKey + double-click у UI, без
повторного пароля.** Свідоме рішення: `apiKey` вже той самий рівень
довіри, що авторизує `logout`/`exec`; OAuth-акаунти взагалі не мають
пароля, тож уніфікований UX без password-reconfirm простіший і працює
для обох типів акаунтів однаково. Клік "Delete account" розкриває
inline-підтвердження ("This permanently deletes your account...") —
явна друга дія, а не миттєве видалення з першого кліка.

`lib/auth.js`'s `deleteAccount(httpUrl, apiKey)` — `POST
/account/delete` (бекенд: `../../../backend/docs/architecture/auth.md`),
**не** best-effort на відміну від `logoutAccount`: мережева помилка
не чистить локальний `localStorage`, інакше UI показав би "видалено",
хоча акаунт на сервері живий. Успіх → та сама послідовність, що й
logout (`removeStoredApiKey`, `clearAccountName`, `notifyAuthChange`),
плюс `router.replace('/')` з `AccountView`.

`AuthStatus.jsx`: `username` тепер `<a href="/account">`, не голий
`<span>` — дає шлях у кабінет прямо з хедера.

## Чому `/login`/`/register`/`/auth/complete`/`/account` не в `app/sitemap.js`

Службові сторінки, не SEO-актив — `../../TECH.md` §3. Все ще
crawlable/indexable за замовчуванням через посилання в `SiteHeader`
(sitemap лише підказує пріоритет, не gate-ить індексацію сам по собі),
просто не заявлені як контентні сторінки для ранжування. `/privacy` і
`/terms` — навпаки, реальний контент, тому вони **є** в
`app/sitemap.js` (низький пріоритет).
