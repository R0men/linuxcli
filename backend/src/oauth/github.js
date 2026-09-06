import { config } from '../config.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

export const configured = Boolean(config.oauth.github.clientId && config.oauth.github.clientSecret);

export function getAuthorizeUrl(state, redirectUri) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.oauth.github.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  // user:email, не read:user — потрібен лише email, не публічний профіль.
  url.searchParams.set('scope', 'user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.oauth.github.clientId,
      client_secret: config.oauth.github.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`github token exchange failed: ${data.error ?? 'no access_token'}`);
  return data.access_token;
}

// /user.email частіше за все null (приватний профіль) — реальний адрес
// беремо з /user/emails, primary+verified; без verified GitHub-акаунта
// email узагалі може бути відсутній.
export async function fetchProfile(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };

  const userRes = await fetch(USER_URL, { headers });
  if (!userRes.ok) throw new Error(`github /user failed: ${userRes.status}`);
  const user = await userRes.json();

  let email = user.email;
  if (!email) {
    const emailsRes = await fetch(EMAILS_URL, { headers });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      email = primary?.email ?? null;
    }
  }

  if (!email) throw new Error('github account has no verified email');
  // user.login — хендл, завжди присутній (на відміну від user.name, який
  // юзер міг не заповнити) — стабільніший дефолт для username.
  return { providerId: String(user.id), email: email.toLowerCase(), username: user.login };
}
