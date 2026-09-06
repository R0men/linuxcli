# Тема (light/dark) — CSS-змінні + per-компонентний `.scss`

## Стилі: звичайний CSS, не CSS Modules

Кожен компонент має власний `Name.scss`, імпортований прямо в
`Name.jsx` як side-effect (`import './Name.scss';`) — **не**
`Name.module.scss`. Це свідомий вибір користувача (CSS Modules
відхилені як незручні): класи глобальні, унікальність тримається на
префіксі компонента (`.terminal-*`, `.tool-*`, `.site-*`,
`.theme-toggle`). Перевір грепом перед додаванням нового класу — CSS
Modules захищали б від колізій автоматично, тут це відповідальність
розробника.

`app/globals.scss` — єдиний файл без компонента-власника: тільки
CSS-змінні кольору (`:root`, `:root[data-theme='dark']`) і
мінімальний reset (`box-sizing`, `body`/`html`/`a`/`h1-h3` базові
стилі). Ніяких `.component-name`-класів там немає навмисно.

## Токени кольору

```scss
:root {
  --color-bg: #f5f5f0;
  --color-bg-raised: #ffffff;
  --color-text: #1a1a1a;
  --color-text-muted: #55554f;
  --color-border: #d8d8d0;
  --color-accent: #0a6e46;
  --color-accent-contrast: #ffffff;
  --color-danger: #b3261e;
  --color-link: #0a6e46;
}
:root[data-theme='dark'] { /* ті самі імена, темні значення */ }
```

Усі компонентні `.scss`-файли читають ці змінні через `var(--color-*)`
— перевірено (`grep` по хекс-кодах поза `globals.scss` не знаходить
жодного хардкоду кольору деінде), тобто перемикання теми не вимагає
змін поза `globals.scss`.

## Механізм перемикання

1. **Анти-FOUC**: інлайн-скрипт у `<head>` (`app/layout.jsx`,
   `THEME_INIT_SCRIPT`) виставляє `data-theme` на `<html>` **до**
   першого фарбування — читає `localStorage.theme`, фолбек на
   `prefers-color-scheme`.
2. **`suppressHydrationWarning`** на `<html>` і `<body>` — React
   інакше сварився б, що серверний HTML не має `data-theme`, а
   клієнтський вже має (скрипт відпрацював до гідратації). Це
   офіційний Next.js-патерн саме для такого анти-FOUC скрипта.
3. **`ThemeToggle.jsx`** — клієнтський компонент, читає поточне
   значення `data-theme` в `useEffect` (не в самому рендері — знову
   щоб не зіткнутись із сервером, який про тему нічого не знає),
   перемикає атрибут + пише в `localStorage` + діспатчить
   `window.dispatchEvent(new CustomEvent('linuxcli-theme-change', ...))`.
4. **`Terminal.jsx`** слухає `linuxcli-theme-change` і оновлює
   `term.options.theme` наживо — xterm.js не бачить CSS-змінних (це
   canvas/DOM-рендерер із власною системою кольору), тому для нього
   окремо захардкожені `XTERM_THEME.light`/`.dark` в самому
   `Terminal.jsx`, синхронізовані вручну зі значеннями
   `--color-bg`/`--color-text` з `globals.scss`. **Якщо змінюєш
   палітру в `globals.scss` — не забудь оновити `XTERM_THEME` в
   `Terminal.jsx`, вони не пов'язані автоматично.**

## Відомий "флеш" на `ThemeToggle`

Кнопка рендериться `aria-hidden`/порожньою, поки `useState(null)` не
оновиться в `useEffect` (перший клієнтський тік) — свідомий трейд-оф:
альтернатива (синхронно читати `document.documentElement` в лейзі-
ініціалізаторі `useState`) дала б миттєву іконку, але викликала б
hydration mismatch саме на цій кнопці (сервер не знає теми). Один
короткий кадр порожньої кнопки визнано прийнятною ціною.
