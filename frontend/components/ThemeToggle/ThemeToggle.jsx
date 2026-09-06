'use client';

import { useEffect, useState } from 'react';
import './ThemeToggle.scss';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem('theme', next);
    window.dispatchEvent(new CustomEvent('linuxcli-theme-change', { detail: next }));
    setTheme(next);
  }

  if (!theme) {
    return <button type="button" className="theme-toggle" aria-hidden="true" tabIndex={-1} />;
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Toggle color theme">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
