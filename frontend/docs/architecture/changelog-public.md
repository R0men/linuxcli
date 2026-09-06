# Публічний changelog (`/changelog`, "What's new")

Реалізовано 23-08-2026. Не плутати з внутрішнім `docs/changelog/`
(українською, детальний технічний журнал для розробника) — це два
повністю незалежні джерела: різна мова (публічний — англійська, як і
весь інший контент сайту), різна аудиторія, різний рівень деталізації.
Публічний запис не є перекладом внутрішнього — він пишеться окремо,
маркетинговою мовою, орієнтованою на користувача, а не на git-історію.

## Джерело даних

`content/changelog/*.mdx` — один файл на запис, той самий патерн
експорту, що й `content/commands/**/*.mdx` (`commandMeta`):

```js
export const changelogMeta = {
  date: '2026-08-18',      // YYYY-MM-DD, використовується і для сортування, і для <time dateTime>
  title: '...',
  summary: '...',           // короткий опис для віджета на / і JSON-LD
};
```

Далі — звичайний MDX-текст (заголовок статті всередині MDX не
дублюється — `title` з `changelogMeta` уже є `<h2>` на сторінці).

Ім'я файлу (без `.mdx`) — це `slug`, використовується як `id` секції
на `/changelog` (`#slug`) і як anchor-посилання з віджета на `/`.
Порядок файлів на диску не має значення — сортування завжди за
`date` (найновіші зверху).

## `lib/changelogContent.js`

`fs`-based loader, **server-only** — той самий підхід, що й
`commandsContent.js` (`docs/architecture/content.md`), і те саме
обмеження: не можна імпортувати в client-компонент (`'fs'` не
резолвиться в браузерному бандлі).

- `getAllChangelogEntries()` — читає всі `.mdx`, повертає масив
  `{ slug, date, title, summary, Content }` (`Content` — React-
  компонент, default-експорт MDX-файлу), відсортований за `date` desc.
- `getLatestChangelogEntries(n)` — перші `n` записів, **без** `Content`
  (тільки серіалізовані поля) — саме це передається в client-
  компонент нижче.

## Дві точки рендеру

**`/changelog`** (`app/changelog/page.jsx` → `components/ChangelogView/`)
— одна сторінка, усі записи повністю, найновіші зверху. Свідомо **не**
hub→стаття, як `/commands`: записи короткі, окрема сторінка на кожен
не дала б SEO-виграшу (на відміну від command-гайдів, де кожен —
самостійна стаття на кілька тисяч слів під свій пошуковий запит).
`ChangelogView` — Server Component (не client), тому може напряму
рендерити `<entry.Content />` — той самий трюк, що й `CommandArticle`
із `<Post />`.

**Віджет на `/`** (`components/HomeView/HomeView.jsx`) — останні 3
записи (title, date, посилання на `/changelog#slug`), без тіла MDX.
`HomeView` — client-компонент (`'use client'`, монтує `<Terminal>`
через `dynamic(ssr:false)`), тому **не може** викликати
`changelogContent.js` напряму. Дані дістаються в `app/page.jsx`
(Server Component) через `getLatestChangelogEntries(3)` і передаються
в `<HomeView whatsNew={...} />` як звичайний серіалізований проп —
той самий патерн, яким і решта Server→Client меж у проєкті передають
дані (напр. `metadata`/JSON-LD обчислюються в `page.jsx`, а не
всередині client-дерева).

## `lib/formatDate.js`

Окремий файл без `fs`-залежностей навмисно — `formatChangelogDate()`
потрібен і в `ChangelogView` (server), і в `HomeView` (client). Якби
хелпер жив у `changelogContent.js`, імпорт у `HomeView` зламав би
клієнтський бандл (`Module not found: Can't resolve 'fs'`).

## Sitemap

`/changelog` доданий у `app/sitemap.js` з `changeFrequency: 'weekly'`
(єдиний виняток із дефолтного `'monthly'` для решти маршрутів) —
оновлюється частіше за статичні сторінки. Окремих sitemap-записів на
кожен запис (`/changelog#slug`) немає — це якорі на одній сторінці, не
окремі URL, той самий підхід, що й `/tools#dig` тощо.

## Додавання нового запису

Новий файл у `content/changelog/`, ім'я на розсуд (стає `slug` і
anchor-URL), обов'язковий `changelogMeta` (`date`/`title`/`summary`) і
MDX-текст нижче. Нічого більше міняти не треба — і `/changelog`, і
віджет на `/`, і sitemap підхоплюють новий файл на наступному білді.
