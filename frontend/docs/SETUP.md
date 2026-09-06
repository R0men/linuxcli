# SETUP.md — від репозиторію до живого сайту на Cloudflare Pages

На відміну від бекенда (`../backend/docs/SETUP.md` — VPS, systemd,
Docker), фронтенд — статичні файли (`output: 'export'`, `../TECH.md`
§4). Тут немає VPS, немає systemd-юнітів — Cloudflare Pages сам
будує (`npm run build`) і роздає `out/` на CDN, і сам перебудовує на
кожен push у `main` (`../TECH.md` §11, окремий GitHub Actions workflow
не потрібен, на відміну від бекенда).

## 0. Що треба мати заздалегідь

- Акаунт GitHub і акаунт Cloudflare (обидва безкоштовні для цього
  сценарію).
- Задеплоєний бекенд (`../backend/docs/SETUP.md`) з відомим доменом
  (напр. `api.example.com`) — без нього термінал не працюватиме, але
  сам фронтенд задеплоїться і без цього.
- (Опційно, рекомендовано) домен для фронтенда, доданий у Cloudflare
  (напр. `app.example.com`).

## 1. GitHub-репозиторій

Окремий репозиторій, сиблінг до `backend` (`../TECH.md` §11 —
`../backend/TECH.md` §7 "Frontend термінал ... окремий проєкт/репо").
Локально:

```bash
cd frontend
git init
git add .
git commit -m "Initial frontend scaffold"
```

Створи порожній репозиторій на GitHub (без README/gitignore — вони
вже є локально) і запуш:

```bash
git remote add origin git@github.com:<user>/linuxcli-frontend.git
git branch -M main
git push -u origin main
```

> Це дія, яку варто робити свідомо й самостійно (створення
> віддаленого репо, перший push) — не покладайся на автоматичне
> виконання цього кроку без явного підтвердження.

## 2. Підключення до Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Pages** → **Connect to Git** → обери щойно створений репозиторій.
2. **Build settings**:
   | Поле | Значення |
   |---|---|
   | Framework preset | `Next.js (Static HTML Export)` |
   | Build command | `npm run build` |
   | Build output directory | `out` |
   | Root directory | `/` (репозиторій — сам фронтенд, не монорепо) |
3. **Environment variables** (Production, і окремо Preview, якщо
   потрібні прев'ю-деплої з іншими значеннями) — з `.env.example`:

   | Змінна | Значення |
   |---|---|
   | `NEXT_PUBLIC_BACKEND_WS_URL` | `wss://api.example.com/terminal` (реальний домен бекенда) |
   | `NEXT_PUBLIC_BACKEND_HTTP_URL` | `https://api.example.com` |
   | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | з кроку 4 нижче |

   Static export = ці значення вшиваються в білд — зміна вимагає
   redeploy (Cloudflare Pages: **Retry deployment** або новий push).

4. **Save and Deploy** — перший білд стартує одразу.

## 3. Кастомний домен

Pages-проєкт → **Custom domains** → **Set up a custom domain** →
`app.example.com` (чи обраний домен). Якщо домен вже в тому самому
Cloudflare-акаунті — DNS-запис додається автоматично.

**Важливо:** цей домен має **точно збігатись** зі значенням
`ALLOWED_ORIGINS` в `.env` бекенда (`../backend/.env`,
`../backend/docs/SETUP.md` крок 7) — інакше бекенд відхилятиме
WS-хендшейк по `Origin`.

## 4. Реєстрація Cloudflare Turnstile site key

1. Cloudflare dashboard → **Turnstile** → **Add site**.
2. Domain: домен фронтенда з кроку 3 (`app.example.com`).
3. Widget mode: **Invisible**.
4. Після створення — скопіюй **Site Key** (публічний) у
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (крок 2 вище) і **Secret Key** —
   окремо, для бекенда (`../backend/.env` → `TURNSTILE_SECRET_KEY`,
   встановлюється на самому сервері, не через цей репозиторій).
5. Redeploy фронтенда, щоб новий site key потрапив у білд.

## 5. Перевірка живого деплою

Після першого успішного білду Cloudflare Pages видає URL вигляду
`<project>.pages.dev` (працює одразу, до підключення кастомного
домену). Перевір:

- `/`, `/tools`, `/about`, `/commands`, `/login`, `/register` віддають
  200 і коректний HTML (не порожню сторінку — `output: 'export'` мав
  пререндерити контент на білді).
- `/sitemap.xml`, `/robots.txt` доступні.
- Термінал на `/` чи `/tools` намагається з'єднатись із
  `NEXT_PUBLIC_BACKEND_WS_URL` (Network-вкладка браузера → WS-запит,
  навіть якщо бекенд ще не готовий приймати з цього Origin).

Детальніша покрокова перевірка кожного компонента — `docs/VERIFY.md`.

## 6. Локальна розробка проти локального бекенда

Бекенд локально (`../backend`) слухає `HOST=127.0.0.1 PORT=8080` без
TLS (`../backend/.env.example`) — тому для фронтенда локально потрібен
**окремий** `.env.local` (не той, що в проді, і не комітиться —
`.gitignore`):

```bash
cd frontend
cp .env.example .env.local
```

Онови в `.env.local`:
```
NEXT_PUBLIC_BACKEND_WS_URL=ws://127.0.0.1:8080/terminal
NEXT_PUBLIC_BACKEND_HTTP_URL=http://127.0.0.1:8080
```

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` можна лишити `changeme` —
`lib/turnstile.js` тоді просто не завантажує Cloudflare-скрипт і шле
`turnstileToken: null` (бекенд без тестового `TURNSTILE_SECRET_KEY`
таке відхилить — див. `docs/VERIFY.md` §3 про тестовий secret key для
smoke-тесту).

```bash
npm install
npm run dev
```
