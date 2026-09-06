# Контент-дата-layer — `lib/toolsContent.js` + `lib/content/`

Єдине джерело тексту для `/tools`-секцій (§3 TECH.md) і локальної
довідки `help`/`?` (§7 TECH.md) — компоненти й `help`-вивід у
`Terminal.jsx` **завжди** йдуть через ці функції, ніколи не
імпортують JSON напряму.

## Структура

```
lib/
  content/
    en/
      tools.json   — 8 записів (id, binary, label, h2, intro,
                      exampleCommand, helpSyntax, description, useCases[])
      site.json    — home/tools/about/help/privacy/terms тексти, nav, footer
  toolsContent.js  — loader-функції
```

```js
export function getToolsList(locale)              // → масив 8 тулів (порядок = порядок у tools.json)
export function getToolContent(id, locale)         // → один тул за id, або null
export function getSiteContent(locale)             // → { brand, nav, home, tools, about, help, footer }
```

`locale` необов'язковий — дефолт `DEFAULT_LOCALE = 'en'`; невідома
локаль тихо фолбечиться на дефолтну (`CONTENT[locale] ??
CONTENT[DEFAULT_LOCALE]`).

## Locale-ready, але без i18n-роутингу

Це навмисно half-built: `lib/content/<locale>/*.json` — будь-яка
кількість мов, без зміни компонентів. Але **немає** ані визначення
поточної локалі з URL/заголовків браузера, ані UI-перемикача мови —
все зараз жорстко `'en'` (параметр `locale` ніде не передається явно
за межами дефолтного значення). Додавання другої мови зараз означає:

1. Новий `lib/content/uk/tools.json` + `site.json`.
2. Механізм вибору локалі (query param? окремий `/uk` prefix? cookie?)
   — **не спроєктований**, свідомо відкладено до моменту, коли
   реально знадобиться друга мова.

## Блог (`/commands`) — `lib/commandsContent.js`

Окремий data-layer від `toolsContent.js`, для MDX-блогу (§3 TECH.md).
Джерело правди — сама файлова структура `content/commands/<module>/
<command>.mdx`, не окремий реєстр: новий пост = новий `.mdx`-файл,
нічого більше міняти не треба (`getModules()`/`getCommandIdsInModule()`
читають директорію напряму через `fs.readdirSync`).

```js
export function getModules()                 // → масив назв категорій (директорій), sorted
export function getAllCommandParams()         // → [{ module, command }, ...] — усі статті, для generateStaticParams і sitemap.js
export function getCommandsInModule(module)   // → масив commandMeta (async, динамічний import .mdx)
export function getAllCommands()              // → усі статті з усіх модулів (async)
export function getModuleSummaries()          // → [{ module, label, count }] — для CommandsHub
export function commandUrl({ module, command }) // → "/commands/{module}/{command}"
```

Компоненти: `components/CommandsHub/` (hub-сторінка, список категорій),
`components/CommandModule/` (список статей у категорії),
`components/CommandArticle/` (сама стаття, рендерить MDX),
`components/Breadcrumb/` (хлібні крихти для всіх трьох рівнів).
`app/commands/[module]/[command]/page.jsx` також імпортує
`getToolContent` із `toolsContent.js` — перелінковка статті з
відповідною секцією `/tools`.

### Категорія `troubleshooting` — сценарні статті (18-08-2026)

На відміну від `dns`/`network`/`tls`/`web` (одна стаття = один тул),
`content/commands/troubleshooting/*.mdx` — статті-сценарії на кілька
тулів одразу (`website-down`, `email-not-arriving`,
`ssl-certificate-errors`, `slow-or-unreachable-server`), бо саме такий
контент найбільше підсилює topical authority (`docs/tasks/14-08-2026/
02-growth-backlog.md`). Через це `commandMeta` таких статей **не
задає `toolId`** — нема одного "цього" тула для CTA-кнопки:

- `components/CommandArticle/CommandArticle.jsx` рендерить нижню
  CTA-кнопку ("Run `x` in the terminal →") лише коли `toolId` задано
  — сценарні статті посилаються на кожен потрібний тул **inline**,
  просто в тексті (`[nc guide](/commands/network/nc)`,
  `[Run it →](/tools#nc)`), тим самим патерном, що вже
  використовується між звичайними tool-статтями.
- Новий опційний `commandMeta.label` — людяна назва для списків/
  breadcrumb (`CommandModule.jsx`: `c.label ?? c.command`,
  `[command]/page.jsx`: `commandMeta.label ?? commandMeta.command`),
  бо `commandMeta.command`-слаг (`website-down`) для tool-статей
  органічно читається як назва бінарника (`dig`), а для сценарних —
  ні. Зворотно сумісно: існуючі 8 tool-статей `label` не задають,
  fallback на `command` не змінює їхній рендер.

`getModules()`/`getAllCommandParams()`/`app/sitemap.js` нічого не
знають про цю різницю — вони читають директорії/файли generic-но, нова
категорія й нові статті підхопились без жодної додаткової зміни коду
там.

## Privacy Policy / Terms of Service (17-08-2026)

`site.json`'s `privacy`/`terms` ключі — той самий патерн, що
`about`/`tools`/`home`: `PrivacyView`/`TermsView` (`components/`)
рендерять їх через `getSiteContent()`, нічого не хардкодять. Текст
написаний на основі реальної поведінки бекенда
(`../../../backend/docs/architecture/{auth,abuse,audit}.md`: hashed
IP, scrypt-паролі, 90-денний TTL аудит-логів).

**"Draft — pending legal review" банер прибрано 17-08-2026** за
прямим запитом користувача (схвалив текст). Це не означає, що
реальна юридична перевірка відбулась — просто попередження на сторінці
більше не показується. `privacy`/`terms` не мають більше
`draftNotice`-поля; контактний email у Privacy Policy теж свідомо
прибрано (не показувати, поки немає реального контактного каналу).

## Синхронізація з бекендом

`tools.json`, поле `exampleCommand` і `helpSyntax` для кожного тула —
мають лишатись у межах дозволених форм виклику з
`../../../backend/TECH.md` §5.3 (`../../../backend/src/validator/tools/*.js`).
Фронтенд ніяк не валідує це автоматично — розбіжність виявиться
тільки коли реальна команда з прикладу отримає `error`-фрейм від
бекенда. При зміні backend-схеми якогось тула — оновлювати
`tools.json` вручну (той самий підхід, що й довідка §7 TECH.md:
"ручна синхронізація прийнятна, бо таблиця міняється рідко").

## Використання за межами `toolsContent.js`

`getToolContent` тепер імпортується й використовується в
`app/commands/[module]/[command]/page.jsx` (стаття блогу підтягує
опис тула для перелінковки `/commands` ↔ `/tools`). `DEFAULT_LOCALE`
досі ніде не імпортується за межами самого `toolsContent.js` — не
видалено навмисно, знадобиться, коли з'явиться реальний
locale-switch.
