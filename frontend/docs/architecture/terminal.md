# Термінал — `components/Terminal/`

Обгортка над `@xterm/xterm` + `@xterm/addon-fit`. Єдиний UI-компонент,
що реально спілкується з бекендом (через `lib/useTerminalSocket.js`)
і з Turnstile (через `lib/turnstile.js`).

## Чому dynamic import ssr:false

`Terminal.jsx` ніколи не рендериться на сервері — і `HomeView.jsx`, і
`ToolsView.jsx` підключають його через:

```js
const Terminal = dynamic(() => import('@/components/Terminal/Terminal'), { ssr: false });
```

xterm.js працює з `document`/DOM напряму при створенні інстансу —
несумісно з server-side рендерингом. `dynamic(..., { ssr: false })`
доступний лише в Client Component (сам `HomeView`/`ToolsView` мають
`'use client'`), тому серверна частина (`app/page.jsx`,
`app/tools/page.jsx`) лишається тонкою: тільки `metadata` + рендер
клієнтського "View"-компонента.

### CLS: `TerminalSkeleton` (фікс 18-08-2026)

`ssr: false` означає, що в первинному HTML/статичному експорті
`.terminal-widget` взагалі відсутній — і сам `Terminal.jsx`, і його
`Terminal.scss` довантажуються окремим чанком лише на клієнті. Без
плейсхолдера це давало видимий стрибок сторінки (CLS): порожнє місце
→ раптова поява термінала (статус-бар + `.terminal-container`
420px) щойно довантажувався xterm.js-чанк.

`components/TerminalSkeleton/` — статично імпортований (не через
`dynamic()`) компонент-заглушка, переданий як `loading:` у
`dynamic()`-виклику в `HomeView.jsx`/`ToolsView.jsx`. Оскільки він
імпортується звичайним `import`, його CSS потрапляє в первинний
CSS-бандл сторінки й займає місце під термінал ще до того, як
JS-чанк `Terminal.jsx` взагалі почав завантажуватись. Розміри
(`.terminal-skeleton-statusbar` — `height: 2.25rem`,
`.terminal-skeleton-body` — `height: 420px`) продубльовані вручну з
`Terminal.scss` (`.terminal-statusbar { min-height: 2.25rem }`,
`.terminal-container { height: 420px }`) — якщо міняти висоту
статус-бару чи контейнера термінала, оновлювати обидва місця,
інакше заміна скелетона на реальний термінал сама дасть маленький
стрибок.

`.terminal-wrap` (зовнішні відступи) теж переїхав із `Terminal.scss`
у `TerminalSkeleton.scss` з тієї самої причини — інакше й сам відступ
з'являвся б лише після довантаження чанка термінала.

## Кастомний line-editor

xterm.js сам по собі не дає readline — сирі keystrokes ловляться
через `term.onData(handleData)`, підключений **один раз** у
mount-ефекті (`useEffect(..., [])`). Це свідомо: пересоздавати xterm
на кожен рендер компонента не можна (втратиться стан термінала).

Наслідок — **усе, що `handleData`/`handleSubmit` читають із замикання
компонента, замерзає на значенні першого рендера.** Це вже раз
спричинило реальний баг: `handleSubmit` читав `socketStatus` напряму
(JS-змінна з замикання), тому назавжди бачив статус `idle` з першого
рендера, навіть коли з'єднання реально відкривалось. Виправлено через
`socketStatusRef` — ref оновлюється в окремому `useEffect(() => {...},
[socketStatus])` на кожен реальний апдейт статусу, а `handleSubmit`
читає `socketStatusRef.current`, не саму змінну:

```js
useEffect(() => {
  socketStatusRef.current = socketStatus;  // "міст" від state до замороженого замикання
  lockedRef.current = socketStatus === TERMINAL_STATUS.RUNNING;
}, [socketStatus]);
```

**Правило для будь-яких майбутніх змін у `handleData`/`handleSubmit`:**
якщо потрібне свіже значення з пропів/стану компонента — заводити
`useRef` + синхронізувати в ефекті з відповідним deps-масивом, не
читати змінну напряму.

### Підтримувані клавіші

| Клавіша | Дія |
|---|---|
| Enter | submit поточного буфера |
| Backspace / Delete | видалити символ перед/під курсором |
| ArrowLeft/Right | рух курсора в межах буфера |
| Home/End | курсор на початок/кінець буфера |
| ArrowUp/Down | history back/forward (`historyRef`, без дедуплікації й без ліміту розміру) |
| будь-який друкований символ | вставляється в позицію курсора (не завжди в кінець) |
| інші escape-послідовності | ігноруються (`data.startsWith('\x1b')`) |

### Multiline paste (фікс 14-08-2026)

`onData` віддає вставлений через буфер обміну текст одним шматком, не
посимвольно. Перевірка `data === '\r'` — точне порівняння: вставка, що
містить кілька рядків (`"dig a.com\nwhois b.com"`), НЕ співпадає з
`'\r'`, тому весь шматок (із вбудованими `\r`/`\n`) провалювався б в
останню гілку і дописувався в `lineBufferRef.current` як є — ламало
`refreshLine`'s перемальовування (вбудовані `\r` самі рухають курсор
під час `term.write`) і на бекенд ішла б "команда" з керівними
символами всередині.

У гілці "друкований символ" (`handleData`) тепер `data.replace(/[\r\n]+/g,
' ')`, коли в шматку є `\r`/`\n` — багаторядкова вставка схлопується в
один рядок, як зробив би звичайний однорядковий інпут. Автосабміт
кожного рядка окремою командою навмисно не робимо — один WS виконує
рівно один `exec` за раз, чергу з кількох команд одним Enter додавати
без потреби не станемо.

### Multiline redraw (soft wrap)

`refreshLine` (`Terminal.jsx`) рахує рядок/колонку курсора через
`term.cols`, а не просто `\r\x1b[K` на поточному рядку — раніше саме
це ламалось, щойно `PROMPT+buffer` переносився на 2+ візуальні рядки:
`\r` повертав лише на початок поточного рядка, `\x1b[K` чистив лише
його, і кожен наступний рендер (будь-яка клавіша чи стрілка)
дублював рядки вище замість їх заміни.

`lastRenderRef` зберігає `cursorPos` попереднього рендера. Наступний
виклик: підіймає курсор на потрібну кількість рядків (`\x1b[nA`),
чистить `\x1b[0J` (від курсора до кінця екрана — увесь попередній
блок, а не один рядок), пише `PROMPT+buffer` заново (xterm сам
переносить), і рахує цільову row/col для фінальної позиції курсора.
`rowColOf()` компенсує xterm-івський pending-wrap (курсор на
рядку, кратному `cols`, лишається в кінці попереднього рядка, а не
стрибає на початок наступного, доки не прийде ще один символ).

### Мерехтіння: коли erase непотрібен

Повний `refreshLine` (erase + перемальовування всього `PROMPT+buffer`)
на кожне натискання клавіші видно як мерехтіння рядка — навіть коли
текст не змінюється (стрілки) або міняється лише в кінці (звичайний
друк). Два швидкі шляхи в `handleData`, що обходять erase:

- **Рух курсора без зміни тексту** (`ArrowLeft/Right`, `Home`/`End`) —
  `moveCursorTo()` рахує відносний зсув рядок/колонка від
  `lastRenderRef.current.cursorPos` і шле лише CUU/CUD/CUB/CUF, без
  жодного `\x1b[0J`. Повертає `false`, якщо базової позиції ще нема
  (`lastRenderRef.current === null`) — виклик відкочується на
  `refreshLine`.
- **Друк у кінець буфера** (`pos === buf.length` у гілці "друкований
  символ") — `term.write(data)` напряму, без `\r`/erase: термінал сам
  виводить і переносить символи, ідентично до того, що дав би повний
  редрож. Вставка всередину рядка (`pos < buf.length`) і далі йде
  через `refreshLine`, бо хвіст після курсора треба перемалювати.

Обидва шляхи так само підтримують `lastRenderRef.current` актуальним
(`{ cursorPos }`), тому наступний повний `refreshLine` (Backspace,
Delete, історія) однаково коректно порахує, на скільки рядків
підніматись — не важливо, повним чи швидким шляхом дійшли до
поточного стану.

**Інваріант:** `lastRenderRef.current` має бути `null` щоразу, коли
курсор переходить на рядок, не пов'язаний з математикою редрожу
інпута (вивід команди, `printHelp`, повідомлення помилок) — інакше
наступний `refreshLine` підніметься не туди. Скидається в гілці
Enter (`handleData`) одразу після `term.write('\r\n')`, до
`handleSubmit`.

## Prefill (кнопки "Run X →" на `/tools`)

`Terminal` приймає проп `prefill: { command, nonce }`. `ToolsView`
підіймає це в `useState`, генерує новий об'єкт (новий `nonce`) при
кожному кліку — React бачить нову reference й ефект
`useEffect(() => {...}, [prefill])` спрацьовує щоразу, навіть якщо
клікнули той самий тул двічі поспіль:

```js
useEffect(() => {
  if (!prefill || !prefill.command) return;
  lineBufferRef.current = prefill.command;
  refreshLine(term, lineBufferRef.current);
  term.focus();
}, [prefill]);
```

Тільки прописує текст у буфер і фокусує — **не сабмітить
автоматично**, користувач сам тисне Enter (свідоме рішення, щоб клік
по кнопці не запускав мережевий запит без явної дії).

## `outputTruncated` (фікс 13-08-2026)

Бекенд (`../../../backend/src/orchestrator/sandbox.js`) обрізає вивід
команди по `MAX_OUTPUT_BYTES` і з 13-08-2026 передає це в `done`-
фреймі (`frame.outputTruncated`, раніше поле рахувалось на бекенді, але
ніде не пробрасувалось — `../../../backend/docs/architecture/orchestrator.md`).
`onDone` у `Terminal.jsx` тепер пише жовте попередження одразу після
рядка `[exit N, Xms]`, якщо `frame.outputTruncated === true` — без
цього обрізаний вивід виглядав так, ніби команда сама так відпрацювала.

## Touch-скрол (фікс 15/17-08-2026)

xterm.js 6 замінив старий нативний `overflow-y: scroll` viewport на
кастомний скролбар-віджет (перенесений з VS Code), який слухає лише
`wheel`-події й драг повзунка мишею — жодного touch-обробника немає.
Свайп пальцем по терміналу на мобільному не скролив би сам по собі.

Mount-ефект підключає `touchstart`/`touchmove`/`touchend`/`touchcancel`
на `containerRef.current`, рахує накопичене вертикальне зміщення
(`touchAccumPx`) і конвертує його в рядки через `term.scrollLines()` —
той самий виклик, яким користується колесо миші. `touchmove` —
`{ passive: false }` з `event.preventDefault()` на весь жест, що
почався в терміналі (сторінка позаду не скролиться поки скролиться
термінал; `touch-action: none` у `Terminal.scss` — компенсація для
браузерів, які ігнорують `preventDefault`).

Той самий mount-ефект дебаунсить `resize`/`visualViewport.resize` перед
викликом `fitAddon.fit()` (120мс) — сирий resize сиплеться десятками
разів під час анімації появи/зникнення мобільної клавіатури,
`visualViewport` точніший сигнал за layout viewport (iOS Safari часто
взагалі не змінює layout viewport, коли клавіатура відкрита).

## Fullscreen-кнопка

`.terminal-fullscreen` у статус-барі перемикає `fullscreen`-стан
(`useState`), що додає клас `terminal-widget--fullscreen` (CSS
`position: fixed`-оверлей). Свідомо не Fullscreen API
(`requestFullscreen`) — ненадійний/недоступний на iOS Safari, а
мобільні браузери — головна ціль цієї кнопки. Ефект на зміну
`fullscreen`: `document.body.style.overflow = 'hidden'` (не скролити
сторінку позаду), `Escape` виходить із fullscreen, `fitAddon.fit()`
перераховується на наступному кадрі (`requestAnimationFrame`).

## Download log

Кнопка "Download log" у `.terminal-statusbar` (`handleDownloadLog`)
читає `term.buffer.active` напряму — не окремий акумулятор поряд з
кожним `term.write()`. `IBufferLine.translateToString(true)` віддає
видимий текст рядка без ANSI-кодів кольору; проходить весь
`buffer.length` (включно зі scrollback, не тільки видима частина
термінала), обрізає порожні рядки в кінці, пакує в `Blob` і скачує
через тимчасовий `<a download>`. Суто client-side, без бекенда —
відповідає static export.

## Локальні псевдо-команди

`help`/`?` обробляються повністю локально (`printHelp`, дані з
`lib/toolsContent.js`) — ніколи не йдуть на сервер (§7 TECH.md).

## Ресурси, які потребують явного cleanup

Mount-ефект створює: xterm-інстанс, `FitAddon`, два
`window.addEventListener` (`resize`, `linuxcli-theme-change`),
Turnstile-клієнт (`turnstileRef.current`). Return-функція прибирає
все чотирьох: xterm, обидва listeners і `turnstileRef.current?.destroy()`
(деталі самого `destroy()` — `turnstile.md`).
