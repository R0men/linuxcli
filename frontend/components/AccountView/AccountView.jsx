'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredApiKey } from '@/lib/apiKey';
import { getAccountName, logoutAccount, deleteAccount, onAuthChange } from '@/lib/auth';
import './AccountView.scss';

const HTTP_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL;

export default function AccountView() {
  const router = useRouter();
  // null = ще не змонтовано на клієнті (той самий mount-guard патерн,
  // що й AuthStatus/ThemeToggle) — не "не залогинений".
  const [username, setUsername] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  // logoutAccount/deleteAccount both fire linuxcli-auth-change, which the
  // effect below reacts to by redirecting to /login — without this guard
  // that redirect races the explicit router.replace('/') in the handlers
  // below and can win, leaving the user on /login instead of / right after
  // an intentional logout/delete.
  const leavingRef = useRef(false);

  useEffect(() => {
    const refresh = () => setUsername(getAccountName() ?? '');
    refresh();
    return onAuthChange(refresh);
  }, []);

  useEffect(() => {
    // username === '' (не null) — уже змонтовано і точно нема сесії,
    // на цій сторінці нема чого показувати анониму.
    if (username === '' && !leavingRef.current) router.replace('/login');
  }, [username, router]);

  async function handleLogout() {
    leavingRef.current = true;
    await logoutAccount(HTTP_URL, getStoredApiKey());
    router.replace('/');
  }

  async function handleDelete() {
    setError('');
    setDeleting(true);
    try {
      leavingRef.current = true;
      await deleteAccount(HTTP_URL, getStoredApiKey());
      router.replace('/');
    } catch (err) {
      leavingRef.current = false;
      setError(err.message);
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (!username) {
    return <div className="account-view" aria-hidden="true" />;
  }

  return (
    <div className="account-view">
      <h1>Account</h1>
      <p className="account-username">
        Signed in as <strong>{username}</strong>
      </p>

      <button type="button" className="account-logout" onClick={handleLogout}>
        Log out
      </button>

      <section className="account-danger-zone" aria-labelledby="account-danger-heading">
        <h2 id="account-danger-heading">Danger zone</h2>
        <p>
          Deleting your account removes your login and username permanently. See what this does and
          doesn&apos;t remove in the <a href="/privacy#data-retention">privacy policy</a>.
        </p>

        {!confirming && (
          <button type="button" className="account-delete-start" onClick={() => setConfirming(true)}>
            Delete account
          </button>
        )}

        {confirming && (
          <div className="account-delete-confirm">
            <p role="alert">This permanently deletes your account. This cannot be undone.</p>
            <div className="account-delete-actions">
              <button type="button" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="account-delete-confirm-btn" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, delete my account'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
