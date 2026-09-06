'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTerminalSocket, TERMINAL_STATUS } from '@/lib/useTerminalSocket';
import { createTurnstileClient } from '@/lib/turnstile';
import { getStoredApiKey } from '@/lib/apiKey';
import { getToolsList } from '@/lib/toolsContent';
import { warn, error as logError } from '@/lib/logger';
import './Terminal.scss';

const PROMPT = '$ ';

const XTERM_THEME = {
  light: { background: '#f5f5f0', foreground: '#1a1a1a', cursor: '#1a1a1a' },
  dark: { background: '#12141a', foreground: '#e6e6e0', cursor: '#e6e6e0' },
};

function currentPageTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function rowColOf(offset, cols) {
  // offset, кратний cols, за наївною floor/mod-формулою дав би col=0 на
  // наступному рядку, але xterm відкладає перенос до наступного символу —
  // курсор насправді ще в кінці попереднього рядка (pending wrap), тому -1.
  if (offset <= 0) return { row: 0, col: 0 };
  const row = Math.floor((offset - 1) / cols);
  return { row, col: offset - row * cols };
}

// \r повертає лише на початок ПОТОЧНОГО рядка, а \x1b[K чистить лише його —
// щойно PROMPT+buffer переноситься на кілька рядків (soft wrap), рядки вище
// лишаються на екрані й дублюються на кожен наступний рендер (кожне
// натискання клавіші чи стрілки). lastRenderRef зберігає позицію курсора
// з попереднього рендера, щоб піднятись на правильну кількість рядків і
// зачистити \x1b[0J (від курсора до кінця екрана) увесь попередній блок.
// Усі escape-коди пакуються в ОДИН term.write() — кілька окремих write
// теж коректні (xterm сам батчить у межах тіку), але один рядок гарантує
// відсутність проміжного "порожнього" стану екрана між erase і рендером,
// звідки й бралось мерехтіння на кожне натискання клавіші.
function refreshLine(term, buffer, cursorPos = buffer.length, lastRenderRef) {
  const cols = term.cols || 80;
  const prev = lastRenderRef.current;

  let out;
  if (prev) {
    const { row: curRow } = rowColOf(PROMPT.length + prev.cursorPos, cols);
    out = (curRow > 0 ? `\x1b[${curRow}A` : '') + '\r\x1b[0J';
  } else {
    out = '\r\x1b[K';
  }

  out += `${PROMPT}${buffer}`;

  const { row: endRow } = rowColOf(PROMPT.length + buffer.length, cols);
  const { row: targetRow, col: targetCol } = rowColOf(PROMPT.length + cursorPos, cols);
  const upBy = endRow - targetRow;
  if (upBy > 0) out += `\x1b[${upBy}A`;
  out += '\r';
  if (targetCol > 0) out += `\x1b[${targetCol}C`;

  term.write(out);
  lastRenderRef.current = { cursorPos };
}

// Рух курсора (стрілки, Home/End) без зміни тексту — не потребує erase і
// перемальовування всього рядка взагалі, тільки відносне переміщення від
// попередньої позиції курсора. Це прибирає мерехтіння рядка при навігації
// стрілками, яке давав повний refreshLine навіть коли текст не змінювався.
// Повертає false, якщо немає базової позиції для відносного руху (перший
// рендер ще не відбувся) — виклик має відкотитись на refreshLine.
function moveCursorTo(term, cursorPos, lastRenderRef) {
  const prev = lastRenderRef.current;
  if (!prev) return false;

  const cols = term.cols || 80;
  const { row: curRow, col: curCol } = rowColOf(PROMPT.length + prev.cursorPos, cols);
  const { row: targetRow, col: targetCol } = rowColOf(PROMPT.length + cursorPos, cols);

  let out = '';
  const rowDiff = targetRow - curRow;
  if (rowDiff > 0) out += `\x1b[${rowDiff}B`;
  else if (rowDiff < 0) out += `\x1b[${-rowDiff}A`;
  const colDiff = targetCol - curCol;
  if (colDiff > 0) out += `\x1b[${colDiff}C`;
  else if (colDiff < 0) out += `\x1b[${-colDiff}D`;

  if (out) term.write(out);
  lastRenderRef.current = { cursorPos };
  return true;
}

function statusLabel(status) {
  switch (status) {
    case TERMINAL_STATUS.CONNECTING:
      return 'Connecting…';
    case TERMINAL_STATUS.OPEN:
      return 'Connected';
    case TERMINAL_STATUS.RUNNING:
      return 'Running…';
    case TERMINAL_STATUS.CLOSED:
      return 'Disconnected';
    case TERMINAL_STATUS.ERROR:
      return 'Connection error';
    default:
      return 'Idle';
  }
}

export default function Terminal({ prefill }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const lineBufferRef = useRef('');
  const cursorPosRef = useRef(0);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(0);
  const lockedRef = useRef(false);
  const lastRenderRef = useRef(null);
  const socketStatusRef = useRef(TERMINAL_STATUS.IDLE);
  const turnstileRef = useRef(null);
  const [status, setStatusDisplay] = useState(TERMINAL_STATUS.IDLE);
  const [fullscreen, setFullscreen] = useState(false);

  const wsUrl = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const { status: socketStatus, submitCommand, reconnect } = useTerminalSocket({
    wsUrl,
    apiKey: getStoredApiKey(),
    onChunk: (frame) => {
      termRef.current?.write(String(frame.data).replace(/\n/g, '\r\n'));
    },
    onDone: (frame) => {
      lockedRef.current = false;
      const term = termRef.current;
      if (!term) return;
      term.write('\r\n');
      // Тихо на щасливому шляху (exit 0, вклався в час) — рядок статусу
      // показуємо тільки коли є на що звернути увагу, як у звичайному shell.
      if (frame.exitCode !== 0 || frame.timedOut) {
        const timedOut = frame.timedOut ? ', timed out' : '';
        term.write(`\x1b[2m[exit ${frame.exitCode}, ${frame.durationMs}ms${timedOut}]\x1b[0m\r\n`);
      }
      if (frame.outputTruncated) {
        term.write('\x1b[33m[output truncated — command produced more output than the size limit]\x1b[0m\r\n');
      }
      refreshLine(term, lineBufferRef.current, undefined, lastRenderRef);
    },
    onError: (frame) => {
      lockedRef.current = false;
      const term = termRef.current;
      if (!term) return;
      term.write(`\r\n\x1b[31m${frame.message}\x1b[0m\r\n`);
      refreshLine(term, lineBufferRef.current, undefined, lastRenderRef);
    },
    onChallengeRequired: () => {
      lockedRef.current = false;
      turnstileRef.current?.refresh().catch(() => {});
      const term = termRef.current;
      if (!term) return;
      term.write('\r\n\x1b[33mSecurity check expired — press Enter to retry your last command.\x1b[0m\r\n');
      refreshLine(term, lineBufferRef.current, undefined, lastRenderRef);
    },
  });

  useEffect(() => {
    setStatusDisplay(socketStatus);
    // handleData/handleSubmit підключаються до xterm ОДИН раз при
    // монтуванні (ефект нижче з порожнім deps-масивом) — тому їм не
    // можна читати `socketStatus` напряму: це буде значення, замкнуте
    // на момент першого рендера, і воно ніколи не оновиться. Читають
    // через socketStatusRef, який ми оновлюємо тут на кожен реальний
    // апдейт статусу.
    socketStatusRef.current = socketStatus;
    // Локальний ввід/echo не блокуємо через статус з'єднання — інпут
    // блокується тільки на час виконання команди (§6 TECH.md: один
    // exec за раз). Спробу submit без відкритого з'єднання перехоплює
    // handleSubmit нижче й показує повідомлення, а не мовчазно ковтає
    // натискання клавіш.
    lockedRef.current = socketStatus === TERMINAL_STATUS.RUNNING;
  }, [socketStatus]);

  function printHelp(term) {
    const tools = getToolsList();
    term.write('\r\nAvailable commands:\r\n');
    tools.forEach((tool) => {
      term.write(`  \x1b[36m${tool.binary.padEnd(9)}\x1b[0m ${tool.helpSyntax}\r\n`);
    });
    term.write('  \x1b[36mhelp / ?\x1b[0m  show this list\r\n');
  }

  function handleDownloadLog() {
    const term = termRef.current;
    if (!term) return;
    // xterm.js буфер, а не окремий акумулятор — читає рівно те, що
    // реально на екрані (з прокруткою), без ручного дублювання кожного
    // term.write() у паралельний лог; translateToString(true) віддає
    // видимий текст без ANSI-кодів кольору.
    const buffer = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linuxcli-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function handleToggleFullscreen() {
    setFullscreen((prev) => !prev);
  }

  function handleSubmit(raw) {
    const term = termRef.current;
    const cmd = raw.trim();
    lineBufferRef.current = '';
    cursorPosRef.current = 0;

    if (!cmd) {
      refreshLine(term, '', undefined, lastRenderRef);
      return;
    }

    historyRef.current.push(cmd);
    historyIndexRef.current = historyRef.current.length;

    if (cmd === 'help' || cmd === '?') {
      printHelp(term);
      refreshLine(term, '', undefined, lastRenderRef);
      return;
    }

    if (socketStatusRef.current !== TERMINAL_STATUS.OPEN) {
      warn('[terminal] submit rejected — socket not open', cmd);
      term.write('\r\n\x1b[31mNot connected to the server yet — please wait and try again.\x1b[0m\r\n');
      refreshLine(term, '', undefined, lastRenderRef);
      return;
    }

    lockedRef.current = true;
    turnstileRef.current
      .getToken()
      .catch(() => null)
      .then((token) => {
        const sent = submitCommand(cmd, token);
        if (!sent) {
          lockedRef.current = false;
          term.write('\r\n\x1b[31mConnection lost — reconnecting…\x1b[0m\r\n');
          refreshLine(term, '', undefined, lastRenderRef);
        }
      });
  }

  function handleData(data) {
    const term = termRef.current;
    if (!term || lockedRef.current) return;

    if (data === '\r') {
      const cmd = lineBufferRef.current;
      term.write('\r\n');
      // Курсор щойно перейшов на новий рядок, не пов'язаний з математикою
      // редрожу інпута (далі йде вивід команди/help/помилки) — наступний
      // refreshLine має стартувати з чистого аркуша, а не намагатись
      // піднятись до рядка, який вже проскролило.
      lastRenderRef.current = null;
      handleSubmit(cmd);
      return;
    }

    if (data === '\x7f' || data === '\b') {
      const pos = cursorPosRef.current;
      if (pos > 0) {
        const buf = lineBufferRef.current;
        lineBufferRef.current = buf.slice(0, pos - 1) + buf.slice(pos);
        cursorPosRef.current = pos - 1;
        refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      }
      return;
    }

    if (data === '\x1b[3~') {
      const pos = cursorPosRef.current;
      const buf = lineBufferRef.current;
      if (pos < buf.length) {
        lineBufferRef.current = buf.slice(0, pos) + buf.slice(pos + 1);
        refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      }
      return;
    }

    if (data === '\x1b[D') {
      cursorPosRef.current = Math.max(0, cursorPosRef.current - 1);
      if (!moveCursorTo(term, cursorPosRef.current, lastRenderRef)) {
        refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      }
      return;
    }

    if (data === '\x1b[C') {
      cursorPosRef.current = Math.min(lineBufferRef.current.length, cursorPosRef.current + 1);
      if (!moveCursorTo(term, cursorPosRef.current, lastRenderRef)) {
        refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      }
      return;
    }

    if (data === '\x1b[H' || data === '\x1bOH') {
      cursorPosRef.current = 0;
      if (!moveCursorTo(term, cursorPosRef.current, lastRenderRef)) {
        refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      }
      return;
    }

    if (data === '\x1b[F' || data === '\x1bOF') {
      cursorPosRef.current = lineBufferRef.current.length;
      if (!moveCursorTo(term, cursorPosRef.current, lastRenderRef)) {
        refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      }
      return;
    }

    if (data === '\x1b[A') {
      const history = historyRef.current;
      if (history.length === 0) return;
      historyIndexRef.current = Math.max(0, historyIndexRef.current - 1);
      lineBufferRef.current = history[historyIndexRef.current] ?? '';
      cursorPosRef.current = lineBufferRef.current.length;
      refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      return;
    }

    if (data === '\x1b[B') {
      const history = historyRef.current;
      historyIndexRef.current = Math.min(history.length, historyIndexRef.current + 1);
      lineBufferRef.current = history[historyIndexRef.current] ?? '';
      cursorPosRef.current = lineBufferRef.current.length;
      refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
      return;
    }

    if (data.startsWith('\x1b')) return; // інші escape-послідовності ігноруємо

    // Вставка через буфер обміну приходить одним шматком, не посимвольно —
    // багаторядковий текст містить \r/\n усередині data. Необроблені вони
    // ламають \r-based refreshLine (керівні символи самі рухають курсор під
    // час term.write) і пішли б на бекенд як частина "команди". Один WS
    // виконує рівно один exec за раз (§CLAUDE.md) — автосабміт кожного
    // рядка окремою командою сюди не вписується, тому просто схлопуємо в
    // один рядок, як і зробив би користувач, вставляючи в звичайний інпут.
    let clean = data.includes('\r') || data.includes('\n') ? data.replace(/[\r\n]+/g, ' ') : data;
    // Мобільні клавіатури (Gboard, iOS) підставляють видимо-ідентичні, але
    // інші байти — NBSP замість пробілу, "розумні" лапки/тире — які на
    // екрані виглядають так само, але ламають строгі regex бекенд-валідатора
    // (напр. whois приймає рівно один IP/domain-токен). Нормалізація сирих
    // клавіш до ASCII-еквівалентів тут — не копія Command Validator (не
    // вирішує, яка команда/аргумент дозволені), а той самий рівень, що й
    // \r/\n-схлопування вище.
    clean = clean
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-');
    // \u0422\u0435 \u0441\u0430\u043C\u0435, \u0448\u0438\u0440\u0448\u0435: \u0431\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0456\u043D\u0443 (\u043E\u0441\u043E\u0431\u043B\u0438\u0432\u043E \u043A\u043E\u043F\u0456\u044E\u0432\u0430\u043D\u043D\u044F \u0437 \u0432\u0435\u0431-\u0441\u0442\u043E\u0440\u0456\u043D\u043E\u043A/\u0447\u0430\u0442\u0456\u0432
    // \u043D\u0430 Android) \u043D\u0435\u0440\u0456\u0434\u043A\u043E \u0442\u044F\u0433\u043D\u0435 \u0437\u0430 \u0441\u043E\u0431\u043E\u044E bidi-\u043C\u0456\u0442\u043A\u0438, word joiner, \u043C'\u044F\u043A\u0438\u0439
    // \u043F\u0435\u0440\u0435\u043D\u043E\u0441 \u0442\u0430 \u0456\u043D\u0448\u0456 invisible-\u0441\u0438\u043C\u0432\u043E\u043B\u0438 \u2014 \u0436\u043E\u0434\u0435\u043D \u0437 \u043D\u0438\u0445 \u043D\u0435 \u0432\u0445\u043E\u0434\u0438\u0442\u044C \u0443 \u0441\u043F\u0438\u0441\u043E\u043A
    // "\u0441\u0445\u043E\u0436\u0438\u0445" \u0437\u0430\u043C\u0456\u043D \u0432\u0438\u0449\u0435, \u0430\u043B\u0435 \u0442\u0430\u043A \u0441\u0430\u043C\u043E \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442\u044C \u043A\u0440\u0456\u0437\u044C ASCII-\u0441\u0442\u0440\u043E\u0433\u0456 regex
    // \u0431\u0435\u043A\u0435\u043D\u0434-\u0432\u0430\u043B\u0456\u0434\u0430\u0442\u043E\u0440\u0430 \u043D\u0435\u043F\u043E\u043C\u0456\u0447\u0435\u043D\u0438\u043C (isValidHost/whitelist \u0431\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u0439\u0432\u0438\u0439
    // \u0431\u0430\u0439\u0442 \u0443 \u0442\u043E\u043A\u0435\u043D\u0456 \u0439 \u0432\u0456\u0434\u0445\u0438\u043B\u044F\u044E\u0442\u044C \u043A\u043E\u043C\u0430\u043D\u0434\u0443, \u0445\u043E\u0447\u0430 \u043D\u0430 \u0435\u043A\u0440\u0430\u043D\u0456 \u0432\u0441\u0435 \u0432\u0438\u0433\u043B\u044F\u0434\u0430\u0454
    // \u0456\u0434\u0435\u043D\u0442\u0438\u0447\u043D\u043E \u0437\u0432\u0438\u0447\u0430\u0439\u043D\u043E\u043C\u0443 \u0432\u0432\u043E\u0434\u0443). C0/C1-\u043A\u043E\u043D\u0442\u0440\u043E\u043B\u043A\u0438 \u043D\u0430 \u0446\u044C\u043E\u043C\u0443 \u0435\u0442\u0430\u043F\u0456 \u0442\u0435\u0436
    // \u0441\u0438\u0440\u0456 \u2014 data \u0432\u0436\u0435 \u043D\u0435 \u043C\u0456\u0441\u0442\u0438\u0442\u044C \r/\n (\u0441\u0445\u043B\u043E\u043F\u043D\u0443\u0442\u043E \u0432\u0438\u0449\u0435), \u0442\u043E\u043C\u0443 \u0440\u0435\u0448\u0442\u0430
    // \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u043E\u043A \u2014 \u0446\u0435 \u0432\u0436\u0435 \u0441\u043C\u0456\u0442\u0442\u044F \u0437 \u0431\u0443\u0444\u0435\u0440\u0430 \u043E\u0431\u043C\u0456\u043D\u0443, \u043D\u0435 \u043D\u0430\u0432\u043C\u0438\u0441\u043D\u0438\u0439 \u0432\u0432\u0456\u0434.
    clean = clean
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\u2060-\u2064\u00AD\u061C]/g, '')
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '');

    const buf = lineBufferRef.current;
    const pos = cursorPosRef.current;
    lineBufferRef.current = buf.slice(0, pos) + clean + buf.slice(pos);
    cursorPosRef.current = pos + clean.length;

    // Найчастіший випадок — друк у кінець буфера: термінал сам виведе й
    // перенесе символи, erase не потрібен взагалі. Вставка всередину рядка
    // (pos < buf.length) досі йде через повний refreshLine — хвіст після
    // курсора треба перемалювати, тут швидкий шлях не підходить.
    if (pos === buf.length && lastRenderRef.current) {
      term.write(clean);
      lastRenderRef.current = { cursorPos: cursorPosRef.current };
      return;
    }

    refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
  }

  useEffect(() => {
    turnstileRef.current = createTurnstileClient(turnstileSiteKey);
    turnstileRef.current.getToken().catch((err) => logError('[terminal] initial turnstile token fetch failed', err));

    const term = new XTerm({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 14,
      theme: XTERM_THEME[currentPageTheme()],
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    term.write('LinuxCLI — type a command (dig, whois, host, curl, openssl, mtr, ping, nc) or `help`.\r\n');
    refreshLine(term, '', undefined, lastRenderRef);
    term.focus();

    termRef.current = term;
    fitRef.current = fitAddon;

    const dataSub = term.onData(handleData);

    // Дебаунс: сирий resize сиплеться десятками разів під час анімації
    // появи/зникнення мобільної клавіатури, кожен виклик fit() перераховує
    // rows/cols і смикає xterm-viewport зі скролбеку — звідси відчуття
    // "дьоргання" скролу під час друку на мобільному. visualViewport, де
    // доступний, — точніший сигнал саме для клавіатури (layout viewport на
    // iOS Safari часто взагалі не змінюється, коли клавіатура відкрита).
    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitAddon.fit(), 120);
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    const onThemeChange = (event) => {
      term.options.theme = XTERM_THEME[event.detail === 'dark' ? 'dark' : 'light'];
    };
    window.addEventListener('linuxcli-theme-change', onThemeChange);

    // xterm.js 6 замінив старий нативний overflow-y:scroll viewport на
    // кастомний скролбар-віджет, перенесений з VS Code
    // (browser/Viewport.ts → vs/base/.../scrollableElement.ts) — той слухає
    // лише wheel-події й драг повзунка мишею, жодного touch-обробника в
    // ньому немає взагалі. Тому на мобільному свайп пальцем по терміналу не
    // скролить його — не CSS-баг, а відсутня фіча в самій бібліотеці.
    // Нижче не додається "зовнішній" скрол — це той самий term.scrollLines(),
    // яким користується колесо миші, просто підключений до touch-жесту.
    const container = containerRef.current;
    let touchStartY = null;
    let touchAccumPx = 0;

    const onTouchStart = (event) => {
      if (event.touches.length !== 1) return;
      touchStartY = event.touches[0].clientY;
      touchAccumPx = 0;
    };

    const onTouchMove = (event) => {
      if (touchStartY === null || event.touches.length !== 1) return;
      // preventDefault одразу на весь жест, що почався в терміналі — сторінка
      // позаду не повинна рухатись ні на піксель, поки скролимо термінал;
      // touch-action: none у Terminal.scss прибирає нативний scroll/pinch
      // ще до JS, це — компенсація для браузерів, які його не зважають.
      event.preventDefault();
      const y = event.touches[0].clientY;
      touchAccumPx += touchStartY - y;
      touchStartY = y;

      const lineHeightPx = container.clientHeight / (term.rows || 24);
      if (Math.abs(touchAccumPx) < lineHeightPx) return;
      const lines = Math.trunc(touchAccumPx / lineHeightPx);
      term.scrollLines(lines);
      touchAccumPx -= lines * lineHeightPx;
    };

    const onTouchEnd = () => {
      touchStartY = null;
      touchAccumPx = 0;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('linuxcli-theme-change', onThemeChange);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
      turnstileRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!prefill || !prefill.command) return;
    const term = termRef.current;
    if (!term) return;
    lineBufferRef.current = prefill.command;
    cursorPosRef.current = lineBufferRef.current.length;
    refreshLine(term, lineBufferRef.current, cursorPosRef.current, lastRenderRef);
    term.focus();
  }, [prefill]);

  useEffect(() => {
    // CSS-based fullscreen (position: fixed overlay), не Fullscreen API —
    // requestFullscreen на довільному елементі на iOS Safari ненадійний/
    // недоступний, а саме мобільні браузери — головна ціль цієї кнопки.
    const raf = requestAnimationFrame(() => fitRef.current?.fit());
    if (!fullscreen) return () => cancelAnimationFrame(raf);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);

  return (
    <div className={`terminal-widget${fullscreen ? ' terminal-widget--fullscreen' : ''}`}>
      <div className="terminal-statusbar">
        <span className={`terminal-status terminal-status--${socketStatus}`}>{statusLabel(status)}</span>
        {(socketStatus === TERMINAL_STATUS.CLOSED || socketStatus === TERMINAL_STATUS.ERROR) && (
          <button type="button" className="terminal-reconnect" onClick={reconnect}>
            Reconnect
          </button>
        )}
        <button
          type="button"
          className="terminal-fullscreen"
          onClick={handleToggleFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? '✖' : '⛶'}
        </button>
        <button type="button" className="terminal-download" onClick={handleDownloadLog}>
          Download log
        </button>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}
