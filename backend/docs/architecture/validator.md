# Command Validator — `src/validator/`

Найкритичніший модуль з погляду безпеки (`../../TECH.md` §5.3).
Парсить сирий рядок команди в `{ binary, args: [] }` без жодного
виклику shell — метасимволи (`;`, `&&`, `|`, `` ` ``, `$()`) не мають
синтаксичного значення, бо інтерпретатор команд не викликається
взагалі.

## Конвеєр

```
rawLine
  → tokenize.js: rawLine → string[] (лапки як group-роздільники, без escape-семантики)
  → registry.js: tokens[0] → tool (Map<binary, tool>)
  → tool.parse(rest): tokens[1:] → args[] (кидає ValidationError або повертає allowlisted args)
  → { binary, args, timeoutMs }
```

## `tokenize.js`

Свій токенайзер, не `String.split(' ')` — підтримує `"..."`/`'...'`
для значень з пробілами (потрібно для `curl -H "Content-Type: json"`).
**Бэкслеш навмисно без escape-семантики** — літеральний символ
усередині токена. Незакрита лапка → `ValidationError` (не тихо
обрізає рядок).

## `registry.js`

```js
const tools = [dig, whois, host, curl, openssl, mtr, ping, nc];
export const registry = new Map(tools.map((tool) => [tool.binary, tool]));
```

Додати новий тул = новий файл у `tools/` + один рядок сюди — ядро
`validate.js`/`tokenize.js` не чіпається (`../../TECH.md` §5.3:
"легко розширюється").

## `net.js` — спільні валідатори

`isValidHostname`/`isValidIPv4`/`isValidIPv6`/`isValidHost`/
`isValidPort`/`isSafeHeaderValue`. Регулярки стандартні (253 симв.
максимум для hostname, per-label ≤63). `isSafeHeaderValue` блокує
`\r`/`\n`/`\0` — захист від header/CRLF-injection у `curl -H`.

> Стилістична нотатка: коментар "Deliberately permissive but bounded
> ..." у цьому файлі — англійською, хоча `../CLAUDE.md` вимагає
> російську для всіх коментарів `src/` (і всі інші коментарі в
> `validator/` їй і слідують). Єдиний виняток у кодовій базі.

## Per-tool схеми (`tools/*.js`)

| Тул | Ключове обмеження в коді |
|---|---|
| `dig.js` | опційний `@server`, один record type з allowlist, `+short`/`+dnssec` (у будь-якому порядку й кількості); `+trace` НЕ в allowlist (десятки запитів, несумісно з фіксованим таймаутом) |
| `whois.js` | рівно один аргумент — валідний host |
| `host.js` | 1-2 аргументи, обидва — валідний host |
| `curl.js` | схема лише `http(s)://` (URL_RE); `-o`/`-O`/`--output`/`-F`/`-K`/`--data-binary` тощо НЕ перелічені — deny-by-default через `if (t.startsWith('-')) throw` після явних allow-гілок |
| `openssl.js` | лише `s_client` підкоманда; `-cert`/`-key`/`-engine`/`-rand` — deny-by-default |
| `mtr.js` | `-r` форсується завжди (ігнорує user-переданий `-r` як окремий токен), `-c` ≤ 10 |
| `ping.js` | `-c` ≤ 5; `-f`/`-i` deny-by-default (flood/interval — обхід per-command обмежень через частоту пакетів) |
| `nc.js` | лише `-zv host port` (рівно 3 токени), без `-l`/`-e` |

Спільний патерн: **allowlist через явні `if`-гілки, усе інше —
`throw` у `else`/fallthrough**, не enumerated blacklist. Це означає
нова небезпечна опція якогось тула автоматично заблокована, поки її
явно не додадуть в allowlist — правильний напрямок за замовчуванням.

### Фікс (13-08-2026): `openssl s_client -connect` тепер приймає IPv6

Раніше `target.split(':')` ламався на IPv6-цілях (`-connect
[::1]:443`) — кожен `:` усередині адреси ставав окремим роздільником,
`targetHost`/`targetPort` не відповідали дійсності, і `isValidHost`
практично завжди провалювався. Функціонально IPv6-цілі були
недоступні, хоча `net.js` формально підтримує IPv6 як формат хоста.

`parseConnectTarget()` тепер розпізнає `[...]:port`-нотацію окремо
(брекети навколо хоста), а для звичайного `host:port` бере **останній**
`:` як роздільник (hostname/IPv4 самі колонів не містять — безпечно):

```js
function parseConnectTarget(target) {
  if (target.startsWith('[')) { /* [ipv6]:port */ }
  const lastColon = target.lastIndexOf(':');
  return { host: target.slice(0, lastColon), port: target.slice(lastColon + 1) };
}
```

### `curl -X` дозволяє `PUT`/`DELETE` — навмисно, поточна поведінка

```js
const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD', 'PUT', 'DELETE']);
```

`../../TECH.md` §5.3 (таблиця MVP-обсягу, писана до старту реалізації)
документує лише `-X GET|POST|HEAD` — код піднявся до
`PUT`/`DELETE`. Рішення користувача (13-08-2026): `TECH.md` більше не
звіряється як джерело істини для таких деталей рівня "що саме робить
код зараз" — цю роль виконує `docs/architecture/`, отут. Розходження
не є новим класом ризику (та сама схема — тільки http/https URL,
SSRF-поверхня не змінюється залежно від verb), тож лишаємо код як є;
`TECH.md` свідомо не оновлюється під це.

### `dig +dnssec` — доданий 23-08-2026

`+dnssec` встановлює DO-біт у запиті, через що резолвер (якщо зона
підписана) повертає ще й `RRSIG`-записи та виставляє `ad`-флаг у
відповіді — це не окремий запит і не ланцюжок запитів, а той самий
одиничний виклик з іншим набором даних у відповіді, тому вписується в
модель "один обмежений запит на виконання", на відміну від `+trace`
вище. Реалізовано як `Set(['+short', '+dnssec'])`, що приймається в
циклі — обидва прапорці незалежні один від одного й порядок не має
значення (`dig example.com +dnssec +short` і `dig example.com +short
+dnssec` рівнозначні). `../../TECH.md` §5.3 навмисно не оновлюється
під це — той самий прецедент, що й `curl -X PUT/DELETE` нижче: точна
argument-схема живе тут, а не в `TECH.md`.

## Що НЕ входить у validator

Ніякого мережевого resolve/reachability-чеку тут немає — `isValidHost`
перевіряє тільки СИНТАКСИС (виглядає як домен/IP), не факт існування
чи досяжності. Це навмисно правильно: перевірка резолву тут означала
б мережевий виклик із самого валідатора, до всіх rate-limit/sandbox
кроків — зайва поверхня і затримка. Реальна (не)досяжність з'ясується
вже під час виконання команди в sandbox.
