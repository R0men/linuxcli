'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { completeOAuthLogin } from '@/lib/auth';
import './AuthComplete.scss';

export default function AuthComplete() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const apiKey = searchParams.get('apiKey');
    const username = searchParams.get('username');
    if (!apiKey || !username) {
      setFailed(true);
      return;
    }

    completeOAuthLogin(apiKey, username);
    // Токен щойно був у query — прибираємо з URL/історії браузера перед
    // редіректом, а не лишаємо висіти в back-стеку чи адресному рядку.
    window.history.replaceState(null, '', '/auth/complete');
    router.replace('/tools');
  }, [router, searchParams]);

  if (failed) {
    return (
      <div className="auth-complete">
        <p>
          Something went wrong — <a href="/login">try logging in again</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="auth-complete">
      <p>Signing you in…</p>
    </div>
  );
}
