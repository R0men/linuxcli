# VERIFY.md — як перевірити фронтенд

На відміну від `../backend/docs/VERIFY.md` (виконується на Linux-
сервері, бо там перевіряється sysctl/iptables/cgroups), більшість тут
виконується **на дев-машині** — фронтенд не має серверної частини.
Розділ §3 (наскрізний WS-тест) вимагає піднятого бекенда, локально або
на реальному хості.

Після кожного розділу онови "Критерії готовності" у відповідному
`docs/tasks/12-08-2026/NN-*.md` і статус у `docs/tasks/PLAN.md`.

---

## 1. Dev-сервер (`npm run dev`)

```bash
cd frontend
npm install
npm run dev
```

Відкрий `http://localhost:3000` і перевір руками:

- **`/`** — hero-текст рендериться, під ним власний термінал (банер
  `LinuxCLI — type a command...`, `$`-промпт), без prefill.
- **`/tools`** — H1 хаб-запиту, один термінал зверху, якорна навігація
  по 8 тулах, 8 секцій нижче. Клік на "Run `dig` →" у секції `#dig`:
  скролить до терміналу зверху й прописує `dig example.com A +short` у
  промпт **без** перезавантаження сторінки й без видимого
  переконекту WS (перевір у Network-вкладці — WS-фрейм `open` один,
  не повторюється при кліках по кількох тулах поспіль).
- **`/about`** — текст про проєкт + секція `#acceptable-use`.
- **Тема:** клік на перемикач у хедері міняє `data-theme` на `<html>`
  без спалаху білого фону; після `location.reload()` тема лишається
  тією ж, що обрана (localStorage `theme`).
- **Без запущеного бекенда:** статус-бар терміналу показує
  "Connecting…" → "Disconnected" (не "Connected"), з'являється кнопка
  "Reconnect", сторінка не падає й не показує білий екран/React-помилку
  в консолі.

## 2. Static export білд (`npm run build`)

```bash
npm run build
```

Критерії:
- Білд завершується без помилок (немає `ssr: false` у Server
  Component — якщо ця помилка з'явиться, значить якийсь `dynamic(...,
  { ssr: false })` виклик витік із клієнтського компонента в
  серверний).
- `out/index.html`, `out/tools/index.html` (або `out/tools.html`,
  залежно від версії Next), `out/about/index.html` існують і містять
  реальний текст (`grep` на H1 кожної сторінки — не порожній `<div
  id="root">`).
- `out/sitemap.xml` містить `/`, `/tools`, `/about`, `/commands` і по
  записі на кожну категорію/статтю блогу (`TECH.md` §3) — не рівно 3
  `<url>`, список росте разом із `content/commands/**`.
- `out/robots.txt` існує і посилається на `sitemap.xml`.

## 3. Наскрізний WS-тест проти бекенда

Піднятий бекенд потрібен — локально (`../backend`, після його
власного `docs/SETUP.md`/прямого запуску `node src/index.js` з
живими Mongo/Redis/Docker) або реальний задеплоєний.

**З браузера** (найближче до реального UX): `.env.local` вказує на
бекенд (`docs/SETUP.md` §6), `npm run dev`, ввести на `/tools`
команду з prefill (напр. клік "Run `dig`" → Enter). Очікується:
статус-бар "Running…" → вивід у термінал стрімиться посимвольно →
підсумковий рядок `[exit 0, ...ms]` → інпут розблоковується.

**Без браузера** (швидший smoke-тест, той самий підхід, що в
`../backend/docs/SETUP.md` §11, тільки з боку фронтенда — Node 22 має
глобальний `WebSocket`, окремий пакет не потрібен):

```bash
node -e '
const ws = new WebSocket("ws://127.0.0.1:8080/terminal");
ws.onopen = () => {
  console.log("connected, sending...");
  ws.send(JSON.stringify({ type: "exec", command: "dig example.com +short", turnstileToken: "test" }));
};
ws.onmessage = (e) => {
  const frame = JSON.parse(e.data);
  console.log(frame);
  if (frame.type === "done" || frame.type === "error") ws.close();
};
ws.onerror = (e) => { console.error("error", e); process.exit(1); };
ws.onclose = () => process.exit(0);
setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 15000);
'
```

(`turnstileToken: "test"` працює тільки якщо на бекенді тимчасово
виставлено тестовий `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`
— `../backend/docs/SETUP.md` §11 крок 3. Обов'язково повернути
реальний ключ після тесту.)

**Критерій `challenge-required`:** з реальним (не тестовим)
`TURNSTILE_SECRET_KEY` і без `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
(`.env.local` лишає `changeme`) — фронтенд шле `turnstileToken: null`,
бекенд має відповісти `{ type: "error" }` або зажадати challenge;
термінал не повинен зациклюватись чи падати — просто показати
повідомлення й розблокувати інпут.

## 4. Чеклист

| Перевірка | Розділ | Де відмітити |
|---|---|---|
| Dev-сервер, усі 3 сторінки, тема, prefill без переконекту | §1 | `docs/tasks/12-08-2026/01-scaffold-frontend.md` |
| Static export (`out/`, sitemap, robots) | §2 | там само |
| Наскрізний WS-тест (браузер або Node-скрипт) | §3 | там само |
