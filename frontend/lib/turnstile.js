'use client';

import { log, warn, error as logError } from './logger';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
// Трохи менше реального ~5-хвилинного строку дії токена (§8 TECH.md) —
// щоб токен у exec-фреймі майже завжди був свіжим.
const TOKEN_TTL_MS = 4.5 * 60 * 1000;

let scriptPromise = null;

function loadScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        logError('[turnstile] failed to load script');
        reject(new Error('failed to load Turnstile script'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// siteKey відсутній (локальна розробка без зареєстрованого Cloudflare
// site key) — getToken() одразу віддає null, а не блокує термінал.
export function createTurnstileClient(siteKey) {
  if (!siteKey || siteKey === 'changeme') {
    warn('[turnstile] no site key configured — sending turnstileToken: null');
    return { getToken: async () => null, refresh: async () => null, destroy: () => {} };
  }

  let widgetId = null;
  let container = null;
  let cachedToken = null;
  let cachedAt = 0;
  let pendingResolvers = [];

  function handleToken(token) {
    cachedToken = token;
    cachedAt = Date.now();
    pendingResolvers.forEach((resolve) => resolve(token));
    pendingResolvers = [];
  }

  async function ensureWidget() {
    await loadScript();
    if (widgetId !== null) return;
    container = document.createElement('div');
    document.body.appendChild(container);
    widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      execution: 'execute',
      callback: handleToken,
    });
  }

  // Terminal.jsx кличе це в cleanup mount-ефекту — без цього і
  // зареєстрований віджет, і його <div>-контейнер лишались висіти в
  // document.body назавжди (StrictMode double-mount у dev; будь-який
  // майбутній demount термінала в проді).
  function destroy() {
    if (widgetId !== null) {
      window.turnstile?.remove?.(widgetId);
      widgetId = null;
    }
    container?.remove();
    container = null;
    pendingResolvers = [];
  }

  let executed = false;

  async function refresh() {
    log('[turnstile] refreshing token');
    await ensureWidget();
    cachedToken = null;
    const promise = new Promise((resolve) => pendingResolvers.push(resolve));
    if (executed) window.turnstile.reset(widgetId);
    executed = true;
    window.turnstile.execute(widgetId);
    return promise;
  }

  async function getToken() {
    if (cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS) return cachedToken;
    return refresh();
  }

  return { getToken, refresh, destroy };
}
