'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { log, warn, error as logError } from './logger';

export const TERMINAL_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  RUNNING: 'running',
  CLOSED: 'closed',
  ERROR: 'error',
};

// Один WS-фрейм exec за раз (backend wsHandler.js running-guard) —
// хук сам не шле новий exec, поки статус не повернувся в OPEN.
// `connect` — useCallback з deps [wsUrl, apiKey]: якщо apiKey зміниться
// при вже змонтованому й підключеному <Terminal> (напр. живий login-флоу
// на тій самій сторінці), ефект нижче перестворить WS посеред сесії,
// обірвавши RUNNING-команду без попередження. lib/auth.js це навмисно
// обходить, а не вирішує — register/login/oauth-complete є окремими
// роутами від /tools, там немає живого Terminal-WS, який можна перебити;
// новий ключ підхоплюється на наступному чистому монтуванні після
// редіректу (docs/architecture/auth.md).
export function useTerminalSocket({ wsUrl, apiKey, onChunk, onDone, onError, onChallengeRequired }) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState(TERMINAL_STATUS.IDLE);
  const callbacksRef = useRef({ onChunk, onDone, onError, onChallengeRequired });
  callbacksRef.current = { onChunk, onDone, onError, onChallengeRequired };

  const connect = useCallback(() => {
    if (!wsUrl) {
      warn('[ws] no wsUrl set — create .env.local (see .env.example) and restart the dev server');
      return;
    }
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus(TERMINAL_STATUS.CONNECTING);
    const url = apiKey ? `${wsUrl}?apiKey=${encodeURIComponent(apiKey)}` : wsUrl;
    log('[ws] connecting', url);

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      // Кривий NEXT_PUBLIC_BACKEND_WS_URL (не ws://ws://https:// схема
      // тощо) кидає SyntaxError синхронно з конструктора — без цього
      // необроблена помилка вилітала б із mount-ефекту.
      logError('[ws] failed to create WebSocket — check NEXT_PUBLIC_BACKEND_WS_URL', err);
      setStatus(TERMINAL_STATUS.ERROR);
      return;
    }
    wsRef.current = ws;

    // React StrictMode (dev) монтує ефекти двічі: перше з'єднання може
    // бути обірване cleanup-функцією ще до хендшейку. Без цієї перевірки
    // такий "чернетковий" сокет усе одно встигає прислати власні
    // close/error-події, які виглядають як справжній збій, хоча реальне
    // друге з'єднання вже підключилось. Ігноруємо події від сокета, який
    // більше не є поточним (wsRef.current його вже замінив).
    ws.addEventListener('open', () => {
      if (wsRef.current !== ws) return;
      log('[ws] connected');
      setStatus(TERMINAL_STATUS.OPEN);
    });
    ws.addEventListener('close', (event) => {
      if (wsRef.current !== ws) return;
      warn('[ws] closed', { code: event.code, reason: event.reason, wasClean: event.wasClean });
      setStatus(TERMINAL_STATUS.CLOSED);
    });
    ws.addEventListener('error', () => {
      if (wsRef.current !== ws) return;
      logError('[ws] connection error');
      setStatus(TERMINAL_STATUS.ERROR);
    });
    ws.addEventListener('message', (event) => {
      if (wsRef.current !== ws) return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch (err) {
        logError('[ws] failed to parse server frame', err);
        return;
      }
      const cb = callbacksRef.current;
      switch (frame.type) {
        case 'chunk':
          cb.onChunk?.(frame);
          break;
        case 'done':
          setStatus(TERMINAL_STATUS.OPEN);
          cb.onDone?.(frame);
          break;
        case 'error':
          setStatus(TERMINAL_STATUS.OPEN);
          cb.onError?.(frame);
          break;
        case 'challenge-required':
          // Сервер відхилив exec ще до запуску команди (протермінований/
          // відсутній токен) — з'єднання лишається робочим, як і після
          // done/error, інакше наступний submit назавжди впирався б у
          // "не підключено", хоча WS насправді відкритий.
          setStatus(TERMINAL_STATUS.OPEN);
          cb.onChallengeRequired?.();
          break;
        default:
          warn('[ws] unknown frame type', frame);
          break;
      }
    });
  }, [wsUrl, apiKey]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const submitCommand = useCallback((command, turnstileToken) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      warn('[ws] submitCommand rejected — socket not open');
      return false;
    }
    log('[ws] sending exec', command);
    setStatus(TERMINAL_STATUS.RUNNING);
    ws.send(JSON.stringify({ type: 'exec', command, turnstileToken }));
    return true;
  }, []);

  return { status, submitCommand, reconnect: connect };
}
