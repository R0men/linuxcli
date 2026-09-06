# OAUTH_SETUP.md — реєстрація GitHub/Google OAuth-застосунків

Покроковий гайд, як отримати `client_id`/`client_secret` для GitHub і
Google та підключити їх до бекенда, щоб кнопки "Continue with
GitHub"/"Continue with Google" на фронтендовому `/login` запрацювали.
Без цього кроку реєстрація/логін через email+пароль працює повністю —
OAuth суто опційний шар зверху (`docs/architecture/auth.md`).

**Коли робити:** після `SETUP.md` кроку 7 (`.env` існує) і, бажано,
кроку 12 (reverse proxy + TLS) — обом провайдерам потрібен публічний
HTTPS-URL callback'а, `http://<IP>:8080/...` для реєстрації застосунків
не підійде (Google взагалі вимагає HTTPS для продакшн redirect URI,
GitHub технічно дозволяє `http://localhost` тільки для локальної
розробки).

**Хто це робить:** розробник вручну, у дашбордах GitHub/Google — це
зовнішня дія, не код, агент не може зареєструвати застосунок сам
(так само, як Cloudflare Turnstile site key раніше).

## 0. Що знадобиться заздалегідь

- Публічний домен бекенда з робочим HTTPS (`PUBLIC_API_URL` з `.env`,
  напр. `https://api.example.com`) — обидва провайдери після логіну
  редіректять сюди.
- Публічний домен фронтенда (`FRONTEND_URL` з `.env`, напр.
  `https://app.example.com`) — сюди бекенд редіректить після того, як
  сам обробить callback (`/auth/complete?apiKey=...&email=...`).
- Акаунт GitHub (для OAuth App) і акаунт Google (для Google Cloud
  Console) — окремі кроки нижче, незалежні один від одного. Можна
  налаштувати тільки один провайдер — кнопка іншого просто не
  з'явиться на `/login` (`GET /oauth/providers` віддає лише
  сконфігуровані).

**Точні redirect URI, які знадобляться в обох кроках нижче:**

```
{PUBLIC_API_URL}/oauth/github/callback
{PUBLIC_API_URL}/oauth/google/callback
```

Підстав реальний `PUBLIC_API_URL` замість плейсхолдера. **Має
збігатись символ-у-символ** з тим, що зареєстровано в дашборді
провайдера — протокол (`https://`, не `http://`), домен, без зайвого
`/` в кінці. Розбіжність — найчастіша причина помилки
`redirect_uri_mismatch` (розділ "Типові помилки" нижче).

## 1. GitHub OAuth App

1. Залогинься в GitHub, відкрий
   https://github.com/settings/developers → вкладка **OAuth Apps** →
   **New OAuth App** (якщо застосунок належатиме організації, а не
   особистому акаунту — той самий флоу під
   `https://github.com/organizations/<org>/settings/applications`).
2. Заповни форму:
   | Поле | Значення |
   |---|---|
   | **Application name** | `LinuxCLI` (чи інша впізнавана назва — це побачить юзер на екрані згоди GitHub) |
   | **Homepage URL** | `{FRONTEND_URL}` (напр. `https://app.example.com`) |
   | **Application description** | опційно, вільний текст |
   | **Authorization callback URL** | `{PUBLIC_API_URL}/oauth/github/callback` — **саме бекенд, не фронтенд** (`docs/architecture/auth.md` — весь обмін код-на-токен робить бекенд, static export фронтенду не має де прийняти callback) |
3. **Register application**.
4. На сторінці щойно створеного застосунку:
   - **Client ID** — видно одразу, скопіюй.
   - **Client secrets** → **Generate a new client secret** →
     скопіюй одразу (показується рівно один раз, як і наш власний
     `apiKey`-токен — загубиш, генеруй новий).
5. Постав обидва значення в `.env` бекенда (крок 4 нижче).

**GitHub OAuth App за замовчуванням публічний одразу** — на відміну
від Google (розділ 2), немає окремого режиму "тестування/схвалення" й
списку дозволених юзерів. Будь-хто може натиснути "Continue with
GitHub" одразу після цього кроку.

Офіційна довідка:
https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app

## 2. Google Cloud OAuth Client

Довший флоу, ніж GitHub — Google вимагає спершу налаштувати **OAuth
consent screen** (екран згоди), тільки потім можна створити самі
credentials.

1. Відкрий https://console.cloud.google.com/, залогинься. Якщо ще нема
   жодного проєкту — створи (верхній селектор проєктів → **New
   Project**, довільна назва, напр. `linuxcli`).
2. **APIs & Services** → **OAuth consent screen**:
   - **User Type**: **External** (якщо акаунт не в Google Workspace-
     організації — **Internal** там навіть не буде опції).
   - **App name**: `LinuxCLI`.
   - **User support email**: свій email.
   - **App logo**: опційно, можна пропустити.
   - **Authorized domains**: домен фронтенда без протоколу (напр.
     `example.com`, якщо `FRONTEND_URL=https://app.example.com`).
   - **Developer contact information**: свій email.
   - **Save and Continue**.
3. **Scopes** → **Add or Remove Scopes** → познач `.../auth/userinfo.email`
   і `openid` (не більше — код запитує рівно `openid email`,
   `src/oauth/google.js`, зайві scope тут нічого не додають, тільки
   зайве питання в консенті користувача) → **Update** → **Save and
   Continue**.
4. **Test users** (з'явиться, поки застосунок у статусі **Testing** —
   дивись "Публікація" нижче) — додай сюди email-адреси, якими
   плануєш тестувати логін **зараз**, інакше Google покаже "Access
   blocked: this app's request is invalid" для будь-кого, окрім
   акаунта, з якого сам застосунок створювався.
5. **Summary** → **Back to Dashboard**.
6. **Credentials** → **Create Credentials** → **OAuth client ID**:
   - **Application type**: **Web application**.
   - **Name**: `LinuxCLI backend` (довільно, не видно юзерам).
   - **Authorized redirect URIs** → **Add URI** →
     `{PUBLIC_API_URL}/oauth/google/callback`.
   - **Create**.
7. У вікні, що з'явиться, — **Client ID** і **Client Secret**,
   скопіюй обидва (доступні пізніше теж, через **Credentials** →
   клік на створений client, на відміну від GitHub secret це не
   one-time показ).

### Публікація застосунку (Testing → In production)

Поки consent screen у статусі **Testing** (дефолт після кроку 2) —
логінитись можуть **тільки** email-адреси зі списку **Test users**
(до 100). Для реального публічного продукту:

**OAuth consent screen** → **Publishing status** → **Publish App**.

Для застосунку з мінімальними scope (`openid`, `email` — саме наш
випадок, жодних "sensitive"/"restricted" scope на кшталт доступу до
Drive/Gmail) Google **зазвичай не вимагає** повної ручної верифікації
(security assessment) — публікація проходить одразу або з коротким
автоматичним ревʼю. Якщо Google все ж покаже попередження
"unverified app" юзерам — це вирішується проходженням верифікації в
тому ж розділі (може зайняти кілька днів); для MVP-масштабу можна
почати без публікації, тестуючи тільки заздалегідь доданими Test
users, і опублікувати пізніше.

Офіційна довідка:
https://developers.google.com/identity/protocols/oauth2/web-server

## 3. Значення в `.env` бекенда

Додай/онови (значення з кроків 1 і 2):

```
GITHUB_CLIENT_ID=<Client ID з кроку 1>
GITHUB_CLIENT_SECRET=<Client secret з кроку 1>
GOOGLE_CLIENT_ID=<Client ID з кроку 2>
GOOGLE_CLIENT_SECRET=<Client secret з кроку 2>

PUBLIC_API_URL=https://api.example.com   # без слеша в кінці
FRONTEND_URL=https://app.example.com     # без слеша в кінці
```

`PUBLIC_API_URL`/`FRONTEND_URL` могли вже бути виставлені раніше
(`SETUP.md` крок 7) — просто звір, що значення точно ті самі, що
підставлялись у redirect URI на кроках 1.2 і 2.6 вище.

Перезапусти застосунок, щоб нові значення підхопились:

```bash
sudo systemctl restart linuxcli-backend.service
```

(Локальна розробка без systemd — просто перестартуй `node
src/index.js`/`npm start`, `dotenv` читає `.env` при старті процесу,
гарячого релоаду нема.)

## 4. Перевірка

**1. Бекенд бачить обидва провайдери:**

```bash
curl https://api.example.com/oauth/providers
```

Очікується `{"providers":["github","google"]}` (порядок не важливий;
якщо секрет заповнений лише для одного — у списку буде тільки він).
Якщо список порожній — `GITHUB_CLIENT_ID`/`GOOGLE_CLIENT_ID` не
дочитались із `.env` (друк, зайвий пробіл, застосунок не перезапущено
після кроку 3).

**2. Кнопки на фронтенді.** Відкрий `{FRONTEND_URL}/login` — має
з'явитись "Continue with GitHub"/"Continue with Google" над формою
email/пароля (`LoginView.jsx` показує їх лише якщо `GET
/oauth/providers` повернув відповідний рядок).

**3. Наскрізний клік.** Натисни кнопку → редірект на github.com/
accounts.google.com → підтверди доступ → маєш повернутись на
`{FRONTEND_URL}/tools` уже залогиненим (хедер сайту показує email).
Якщо натомість опинився на `/login?error=oauth_failed` — дивись
"Типові помилки" нижче.

## 5. Типові помилки

| Симптом | Причина | Фікс |
|---|---|---|
| `redirect_uri_mismatch` (сторінка провайдера, до повернення на наш сайт) | `PUBLIC_API_URL` у `.env` не збігається символ-у-символ із callback URL, зареєстрованим у дашборді (http vs https, домен, слеш у кінці) | Звір обидва значення буквально, онови в дашборді провайдера (крок 1.2/2.6) або в `.env` |
| Google: "Access blocked: this app's request is invalid" / "…has not completed the Google verification process" | Consent screen у статусі **Testing**, юзер, яким логінишся, не в списку **Test users** | Додай email у Test users (крок 2.4) або опублікуй застосунок (розділ "Публікація") |
| GitHub/Google повернули код, але наш сайт показує `/login?error=oauth_failed` | Найімовірніше — `state` протух (TTL 5 хв, `src/oauth/state.js`) або Redis недоступний у момент callback'а | Спробуй логін заново без затримки на екрані згоди; перевір `redis-cli -a "$REDIS_PASSWORD" ping` |
| `invalid_client` при обміні коду на токен (видно в `journalctl -u linuxcli-backend.service`, не на сторінці юзера) | `GITHUB_CLIENT_SECRET`/`GOOGLE_CLIENT_SECRET` у `.env` невірний або застосунок не перезапущено після зміни | Перевір значення, `sudo systemctl restart linuxcli-backend.service` |
| Кнопка провайдера взагалі не з'являється на `/login` | `GET /oauth/providers` не повернув цей провайдер — `configured === false` (`src/oauth/{github,google}.js`) | `client_id`/`client_secret` порожні чи не задані в `.env` — крок 3 |

## 6. Безпека

- `GITHUB_CLIENT_SECRET`/`GOOGLE_CLIENT_SECRET` — лишаються виключно
  в `.env` бекенда, ніколи не в git, ніколи у фронтенд-змінних
  (`NEXT_PUBLIC_*` потрапляють у публічний JS-бандл — фронтенду ці
  секрети взагалі не потрібні, `docs/architecture/auth.md`).
- Якщо секрет протік (закомічений у git, показаний у публічному
  логу тощо) — у відповідному дашборді (GitHub: **OAuth Apps** → твій
  застосунок → **Generate a new client secret**, стара версія одразу
  інвалідується; Google: **Credentials** → клік на client → **Reset
  Secret**) згенеруй новий і онови `.env` + рестарт.
- `redirect_uri`/`Authorized redirect URIs` — тримай список лише з
  реально потрібних записів (продакшн `PUBLIC_API_URL`, окремо
  dev-запис типу `http://localhost:8080/oauth/github/callback`, якщо
  тестуєш локально) — зайвий зареєстрований redirect URI розширює
  поверхню атаки (open redirect у гіршому випадку).
