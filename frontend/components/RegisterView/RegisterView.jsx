'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerAccount } from '@/lib/auth';
import OAuthButtons from '@/components/OAuthButtons/OAuthButtons';
import './RegisterView.scss';

const HTTP_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL;

export default function RegisterView() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await registerAccount(HTTP_URL, email, password, username);
      router.push('/tools');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="auth-view">
      <h1>Sign up</h1>

      <OAuthButtons />

      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="register-username">
          Username
          <input
            id="register-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={40}
            required
          />
        </label>
        <label htmlFor="register-email">
          Email
          <input
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label htmlFor="register-password">
          Password
          <input
            id="register-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <a href="/login">Log in</a>
      </p>
    </div>
  );
}
