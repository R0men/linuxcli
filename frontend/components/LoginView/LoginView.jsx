'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginAccount } from '@/lib/auth';
import OAuthButtons from '@/components/OAuthButtons/OAuthButtons';
import './LoginView.scss';

const HTTP_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL;

export default function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get('error') === 'oauth_failed') {
      setError('Sign-in with that provider failed — please try again.');
    }
  }, [searchParams]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginAccount(HTTP_URL, email, password);
      router.push('/tools');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="auth-view">
      <h1>Log in</h1>

      <OAuthButtons />

      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="login-email">
          Email
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label htmlFor="login-password">
          Password
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="auth-switch">
        Don&apos;t have an account? <a href="/register">Sign up</a>
      </p>
    </div>
  );
}
