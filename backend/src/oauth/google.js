import { config } from '../config.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const configured = Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret);

export function getAuthorizeUrl(state, redirectUri) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.oauth.google.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  // profile — без нього userinfo не віддає `name` (лише email/sub), а нам
  // потрібне ім'я під дефолтний username.
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.oauth.google.clientId,
      client_secret: config.oauth.google.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`google token exchange failed: ${data.error ?? 'no access_token'}`);
  return data.access_token;
}

export async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google userinfo failed: ${res.status}`);
  const profile = await res.json();

  if (!profile.email_verified) throw new Error('google account has no verified email');
  // profile.name може бути відсутнім (юзер не заповнив) — фолбек на
  // локальну частину email, той самий фолбек, що й у findOrCreateOAuthUser
  // для будь-якого провайдера без username узагалі.
  return { providerId: profile.sub, email: profile.email.toLowerCase(), username: profile.name ?? null };
}
