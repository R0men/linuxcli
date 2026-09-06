# Архітектура фронтенда — індекс

Це технічна довідка по тому, **як влаштований код**, по модулях —
на відміну від `../CLAUDE.md` (правила роботи в репозиторії),
`../SETUP.md` (деплой) і `../VERIFY.md` (перевірка). Архітектурні
*рішення* і їх обґрунтування — в [`../../TECH.md`](../../TECH.md);
тут — як саме ці рішення реалізовані в коді, файл за файлом.

## Модулі

| Файл | Про що |
|---|---|
| [`websocket.md`](websocket.md) | `lib/useTerminalSocket.js` — WS-протокол, стан-машина, відомі проблеми |
| [`terminal.md`](terminal.md) | `components/Terminal/` — xterm.js, кастомний line-editor, prefill |
| [`turnstile.md`](turnstile.md) | `lib/turnstile.js` — anti-bot токен, життєвий цикл віджета |
| [`content.md`](content.md) | `lib/toolsContent.js` + `lib/content/` — locale-ready дані |
| [`logging.md`](logging.md) | `lib/logger.js` + `scripts/log-server.mjs` — dev-логування |
| [`theming.md`](theming.md) | `app/globals.scss` + per-компонентний `.scss` — light/dark тема |
| [`auth.md`](auth.md) | `lib/auth.js` + `/login`, `/register`, `/auth/complete` — email+пароль, GitHub/Google OAuth |
| [`content.md`](content.md) (§ блог) | `lib/commandsContent.js` + `components/{CommandsHub,CommandModule,CommandArticle,Breadcrumb}/` — MDX-блог `/commands`, hub → категорія → стаття |
| [`content.md`](content.md) (§ Privacy/Terms) | `components/{PrivacyView,TermsView}/` + `site.json` — `/privacy`, `/terms` (чернетка, потребує перевірки юриста) |
| [`auth.md`](auth.md) (§ `/account`) | `components/AccountView/` — кабінет: username, logout, видалення акаунту |
| [`changelog-public.md`](changelog-public.md) | `lib/changelogContent.js` + `components/ChangelogView/` — публічний `/changelog` ("What's new") і віджет на `/`, MDX, окремо від внутрішнього `docs/changelog/` |
| `components/CookieNotice/` | Інформаційний cookie-банер (не блокує Turnstile) — dismissal у `localStorage`, окремого архітектурного файлу не потребує, компонент самодостатній |

## Потік даних (загальна картина)

```
                     ┌─────────────────────────┐
                     │   lib/toolsContent.js     │  ← lib/content/en/*.json
                     │  (єдине джерело тексту)    │
                     └───────────┬─────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                         ▼
  app/page.jsx           app/tools/page.jsx          app/about/page.jsx
  (metadata, SSR)         (metadata, JSON-LD)          (metadata)
        │                        │                         │
        ▼                        ▼                         ▼
  HomeView (client)        ToolsView (client)          AboutView
        │                        │
        │ dynamic(ssr:false)     │ dynamic(ssr:false)
        ▼                        ▼
  ┌─────────────────────────────────────┐
  │        components/Terminal           │  ← ОКРЕМИЙ інстанс на
  │  (xterm.js + line-editor + WS-хук)    │    кожній із двох сторінок
  └───────────────┬─────────────────────┘
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
  useTerminalSocket  turnstile.js   apiKey.js
  (lib/)             (lib/)         (lib/ — anonymous generateApiKey
       │                             досі без UI; акаунт-ключ через
       │                             lib/auth.js: /register, /login,
       │                             OAuth, той самий localStorage)
       ▼
  wss://<backend>/terminal
```

`AuthStatus` (`components/`, у `SiteHeader.jsx`) — окремий client-
island, читає `lib/auth.js`, не частина дерева `Terminal`, показаний
на кожній сторінці незалежно від того, чи є на ній термінал.

Ключове: **немає жодного спільного React-контексту чи глобального
стану термінала** між `/` і `/tools` — це два незалежні дерева
компонентів, кожне зі своїм `<Terminal>`, своїм WS-з'єднанням і
своєю історією команд. Перехід між сторінками (навіть client-side)
демонтує один інстанс і монтує інший.

## Відомі проблеми

Єдине місце з повним списком і пріоритетами —
[`../changelog/changelog.md`](../changelog/changelog.md), розділ
«Незакриті задачі / Known Issues». Технічний розбір причини й місця в
коді — у відповідному файлі модуля (`websocket.md`, `terminal.md`,
`turnstile.md`).
