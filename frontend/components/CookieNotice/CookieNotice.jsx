'use client';

import { useEffect, useState } from 'react';
import './CookieNotice.scss';

const STORAGE_KEY = 'linuxcli_cookie_notice_dismissed';

export default function CookieNotice() {
  // null = ще не змонтовано на клієнті (той самий mount-guard патерн,
  // що й ThemeToggle/AuthStatus) — не рендеримо нічого на сервері,
  // щоб не блимнути банером, який миттю сховається після гідратації.
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  function handleDismiss() {
    window.localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  }

  if (dismissed !== false) return null;

  return (
    <div className="cookie-notice" role="note">
      <p>
        We use only essential cookies (Cloudflare Turnstile, for bot protection) — no tracking, no ads.{' '}
        <a href="/privacy#cookies">Privacy policy →</a>
      </p>
      <button type="button" onClick={handleDismiss}>
        Got it
      </button>
    </div>
  );
}
