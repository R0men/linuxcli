'use client';

import { useEffect, useState } from 'react';
import { getOAuthProviders } from '@/lib/auth';
import './OAuthButtons.scss';

const HTTP_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL;

const PROVIDER_LABELS = {
  github: 'Continue with GitHub',
  google: 'Continue with Google',
};

// Той самий блок на /login і /register — OAuth не розрізняє "новий" і
// "існуючий" акаунт (findOrCreateOAuthUser на бекенді), тому кнопки
// однакові й однаково доречні на обох сторінках.
export default function OAuthButtons() {
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    getOAuthProviders(HTTP_URL).then(setProviders);
  }, []);

  if (providers.length === 0) return null;

  return (
    <div className="auth-oauth">
      {providers.map((name) => (
        <a key={name} className="auth-oauth-button" href={`${HTTP_URL}/oauth/${name}/start`}>
          {PROVIDER_LABELS[name] ?? `Continue with ${name}`}
        </a>
      ))}
      <div className="auth-divider">or</div>
    </div>
  );
}
