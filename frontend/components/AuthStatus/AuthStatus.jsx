'use client';

import { useEffect, useState } from 'react';
import { getStoredApiKey } from '@/lib/apiKey';
import { getAccountName, logoutAccount, onAuthChange } from '@/lib/auth';
import './AuthStatus.scss';

const HTTP_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL;

export default function AuthStatus() {
  // null = ще не змонтовано на клієнті (уникає SSR/hydration mismatch,
  // той самий патерн, що й ThemeToggle) — не "не залогинений".
  const [username, setUsername] = useState(null);

  useEffect(() => {
    const refresh = () => setUsername(getAccountName() ?? '');
    refresh();
    // Компонент живе в кореневому layout і не перемонтовується при
    // client-side переходах між сторінками — без цієї підписки
    // register/login/logout на іншій сторінці не оновили б хедер аж до
    // ручного перезавантаження (lib/auth.js).
    return onAuthChange(refresh);
  }, []);

  async function handleLogout() {
    await logoutAccount(HTTP_URL, getStoredApiKey());
  }

  // Порожній span тут раніше давав 0 ширини до гідратації, а після неї
  // раптово наповнювався текстом — у вузькому viewport це перекидало
  // .site-header на другий рядок і зсувало весь <main> вниз (CLS).
  // visibility:hidden з тим самим "Log in · Sign up" резервує місце під
  // найчастіший (анонімний) кейс заздалегідь, як і .theme-toggle робить
  // фіксованим 2rem×2rem до свого mount.
  if (username === null) {
    return (
      <span className="auth-status" aria-hidden="true" style={{ visibility: 'hidden' }}>
        <a>Log in</a> · <a>Sign up</a>
      </span>
    );
  }

  if (!username) {
    return (
      <span className="auth-status">
        <a href="/login">Log in</a> · <a href="/register">Sign up</a>
      </span>
    );
  }

  return (
    <span className="auth-status">
      <a className="auth-status-name" href="/account" title={username}>
        {username}
      </a>{' '}
      ·{' '}
      <button type="button" className="auth-status-logout" onClick={handleLogout}>
        Log out
      </button>
    </span>
  );
}
