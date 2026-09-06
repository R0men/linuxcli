# WebSocket — `lib/useTerminalSocket.js`

Хук-обгортка над одним WebSocket-з'єднанням до бекенда
(`../../TECH.md` §6). Джерело правди по самому протоколу —
`../../../backend/src/gateway/wsHandler.js`; тут — тільки клієнтська
сторона.

## Стан-машина

```
IDLE ──connect()──► CONNECTING ──open──► OPEN ──submitCommand()──► RUNNING
                          │                │                          │
                        error            close                   done/error/
                          │                │                   challenge-required
                          ▼                ▼                          │
                        ERROR           CLOSED                        ▼
                                                                     OPEN
```

`TERMINAL_STATUS` (`idle`/`connecting`/`open`/`running`/`closed`/
`error`) — єдине джерело статусу для UI (`Terminal.jsx` малює
статус-бар і вирішує, чи блокувати інпут).

**Важливо:** `challenge-required` повертає статус назад у `OPEN`, так
само як `done`/`error` — з'єднання лишається робочим, сервер просто
відхилив конкретний `exec` ще до запуску команди (протермінований/
відсутній Turnstile-токен). Без цього наступний `submitCommand()`
назавжди впирався б у "socket not open", хоча WS насправді живий —
саме така поведінка спостерігалась і була виправлена в межах цієї
задачі (`../tasks/12-08-2026/01-scaffold-frontend.md`).

## Один `exec` за раз

Бекенд (`wsHandler.js`, `running`-guard) виконує рівно одну команду на
з'єднання одночасно. Хук підтримує цей інваріант з клієнтського боку:
`submitCommand()` переводить статус у `RUNNING`; `Terminal.jsx`
блокує локальний ввід (`lockedRef.current`), тільки поки статус —
`RUNNING`, не раніше і не пізніше (§6 TECH.md).

## Захист від React StrictMode double-invoke

`next dev` монтує ефекти двічі (навмисно, для виявлення забутих
cleanup). Перший `WebSocket` встигає стартувати й одразу обривається
cleanup-функцією ще до хендшейку — браузер і сервер це бачать як
реальний збій (`error` + `close` з кодом `1006`), хоча по факту це
одноразовий "чернетковий" сокет, і одразу після нього стартує другий,
справжній.

Кожен listener (`open`/`close`/`error`/`message`) звіряє
`wsRef.current !== ws` і ігнорує подію, якщо цей сокет уже не є
поточним (тобто — застарілий, від скасованої спроби):

```js
ws.addEventListener('error', () => {
  if (wsRef.current !== ws) return;   // подія від чернеткового сокета — ігнор
  logError('[ws] connection error');
  setStatus(TERMINAL_STATUS.ERROR);
});
```

Це прибирає хибний шум із логів у dev-режимі, не змінюючи реальної
поведінки в проді (де StrictMode double-invoke не відбувається).

## `new WebSocket(url)` в try/catch (фікс 14-08-2026)

```js
let ws;
try {
  ws = new WebSocket(url);
} catch (err) {
  logError('[ws] failed to create WebSocket — check NEXT_PUBLIC_BACKEND_WS_URL', err);
  setStatus(TERMINAL_STATUS.ERROR);
  return;
}
```

Якщо `NEXT_PUBLIC_BACKEND_WS_URL` заданий з неправильною схемою
(напр. `https://` замість `wss://` — саме таку помилку кілька разів
робили при первинному налаштуванні `.env.local`), конструктор кидає
`SyntaxError` синхронно всередині ефекту. Раніше це був необроблений
виняток; тепер `try/catch` переводить статус у `ERROR` і пише в лог
людяне повідомлення замість краху ефекту.

## `reconnect`

Повертається з хука як синонім `connect` — викликається кнопкою
"Reconnect" у статус-барі, коли статус `CLOSED`/`ERROR`. Жодного
автоматичного retry з таймером немає навмисно (§8 TECH.md — той самий
принцип, що й для `challenge-required`: явна дія користувача, не
прихована магія).

## `apiKey`

`useTerminalSocket({ apiKey, ... })` дописує `?apiKey=` у URL, якщо
значення передане. `Terminal.jsx` читає його через
`getStoredApiKey()` (`lib/apiKey.js`, `localStorage`). Сам механізм
генерації ключа (`generateApiKey()`) існує в `lib/apiKey.js`, але UI
для нього не реалізований (`../../TECH.md` §9, не завершено) — див.
`content.md`/головний `README.md` цього розділу.

**На майбутнє, якщо `apiKey` стане динамічним (генеруватиметься
під час сесії):** `connect` у хуку має `useCallback(..., [wsUrl,
apiKey])` — зміна `apiKey` перестворює `connect`, і ефект
(`useEffect(() => { connect(); ... }, [connect])`) перезапустить
з'єднання. Якщо це станеться посеред виконання команди — обірве
`RUNNING`-стан без явного попередження користувача. Вартий уваги при
реалізації UI генерації ключа.
