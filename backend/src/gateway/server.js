import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { generateApiKey, revokeApiKeysForUser, revokeApiKey, lookupApiKey, ApiKeyExistsError } from '../abuse/apiKey.js';
import { checkRateLimit, RateLimitError } from '../abuse/rateLimiter.js';
import { hmacIp } from '../abuse/ipHash.js';
import { registerLocalUser, verifyLocalLogin, findOrCreateOAuthUser, deleteUser, EmailExistsError, InvalidCredentialsError } from '../users/users.js';
import { createOAuthState, consumeOAuthState } from '../oauth/state.js';
import * as githubOAuth from '../oauth/github.js';
import * as googleOAuth from '../oauth/google.js';
import { getClientIp } from './clientIp.js';
import { isOriginAllowed } from './origin.js';
import { handleConnection } from './wsHandler.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const OAUTH_PROVIDERS = { github: githubOAuth, google: googleOAuth };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

// Ліміт на розмір тіла — без цього клієнт міг би стрімити необмежену
// кількість байт у POST-хендлер до того, як JSON.parse взагалі викличеться.
function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 256;
}

function isValidUsername(username) {
  return typeof username === 'string' && username.length >= 1 && username.length <= 40;
}

function hashEmail(email) {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

// Перевіряємо Origin так само, як WS upgrade (wsHandler.js) — без цього
// сторонній сайт міг би сліпо смикати ці ендпоінти чужим відвідувачем
// (register/login тримають реальні креденшли; /api-key — грифінг анти-
// фарм гвардії, abuse.md).
function checkOriginHttp(req, res) {
  const origin = req.headers.origin ?? '';
  if (isOriginAllowed(origin)) return true;
  sendJson(res, 403, { error: 'origin not allowed' });
  return false;
}

async function handleApiKeyRequest(req, res) {
  if (!checkOriginHttp(req, res)) return;

  const ipHash = hmacIp(getClientIp(req));

  try {
    // Той самий лімітер, що й для команд, з окремим префіксом id — генерація
    // ключів не повинна ділити лічильник з виконанням команд, але й не
    // повинна бути необмеженою.
    await checkRateLimit({ id: `apikey:${ipHash}`, isApiKey: false });
  } catch (err) {
    if (err instanceof RateLimitError) {
      sendJson(res, 429, { error: err.message });
      return;
    }
    throw err;
  }

  try {
    const { apiKey } = await generateApiKey(ipHash);
    sendJson(res, 200, { apiKey });
  } catch (err) {
    if (err instanceof ApiKeyExistsError) {
      sendJson(res, 409, { error: err.message });
      return;
    }
    throw err;
  }
}

async function handleRegister(req, res) {
  if (!checkOriginHttp(req, res)) return;

  const ipHash = hmacIp(getClientIp(req));
  try {
    await checkRateLimit({ id: `register:${ipHash}`, isApiKey: false });
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    sendJson(res, 429, { error: err.message });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid request body' });
    return;
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';

  if (!isValidEmail(body.email) || !isValidPassword(body.password) || !isValidUsername(username)) {
    sendJson(res, 400, {
      error: 'invalid email, password (min 8 chars) or username (1-40 chars)',
    });
    return;
  }

  let userId;
  try {
    ({ userId } = await registerLocalUser(body.email, body.password, username));
  } catch (err) {
    if (err instanceof EmailExistsError) {
      sendJson(res, 409, { error: err.message });
      return;
    }
    throw err;
  }

  const { apiKey } = await generateApiKey(ipHash, undefined, userId);
  sendJson(res, 200, { apiKey, username });
}

async function handleLogin(req, res) {
  if (!checkOriginHttp(req, res)) return;

  const ipHash = hmacIp(getClientIp(req));

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid request body' });
    return;
  }

  if (!isValidEmail(body.email) || typeof body.password !== 'string') {
    sendJson(res, 400, { error: 'invalid email or password' });
    return;
  }

  try {
    // IP- і email-скоуповані ліміти окремо — перший стримує один IP, що
    // перебирає паролі для багатьох акаунтів, другий — розподілений
    // credential-stuffing по одному конкретному акаунту з багатьох IP.
    await checkRateLimit({ id: `login:${ipHash}`, isApiKey: false });
    await checkRateLimit({ id: `login:email:${hashEmail(body.email)}`, isApiKey: false });
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    sendJson(res, 429, { error: err.message });
    return;
  }

  let userId;
  let username;
  try {
    ({ userId, username } = await verifyLocalLogin(body.email, body.password));
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      sendJson(res, 401, { error: err.message });
      return;
    }
    throw err;
  }

  await revokeApiKeysForUser(userId);
  const { apiKey } = await generateApiKey(ipHash, undefined, userId);
  sendJson(res, 200, { apiKey, username });
}

async function handleLogout(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid request body' });
    return;
  }
  await revokeApiKey(body.apiKey);
  sendJson(res, 200, {});
}

// apiKey — тот же уровень доверия, что и /logout: не требуем повторный
// пароль (OAuth-аккаунты его вообще не имеют). Анонимный ключ (userId
// null) удалять нечего — это не аккаунт, а просто квота.
async function handleDeleteAccount(req, res) {
  if (!checkOriginHttp(req, res)) return;

  const ipHash = hmacIp(getClientIp(req));
  try {
    await checkRateLimit({ id: `account-delete:${ipHash}`, isApiKey: false });
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    sendJson(res, 429, { error: err.message });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid request body' });
    return;
  }

  const session = await lookupApiKey(body.apiKey);
  if (!session || !session.userId) {
    sendJson(res, 400, { error: 'no account associated with this key' });
    return;
  }

  await deleteUser(session.userId);
  await revokeApiKeysForUser(session.userId);
  sendJson(res, 200, {});
}

function handleOAuthProviders(req, res) {
  const providers = Object.entries(OAUTH_PROVIDERS)
    .filter(([, mod]) => mod.configured)
    .map(([name]) => name);
  sendJson(res, 200, { providers });
}

// /oauth/:provider/start і /callback НЕ перевіряють Origin навмисно —
// це full-page навігації (браузер переходить на github.com/accounts.google.com
// і назад), а не fetch/XHR з поточної сторінки, тому Origin-заголовок на
// таких GET-навігаціях браузер здебільшого й не шле. CSRF тут закриває
// `state` (oauth/state.js), не Origin-перевірка.
async function handleOAuthStart(req, res, providerName) {
  const provider = OAUTH_PROVIDERS[providerName];
  if (!provider || !provider.configured) {
    sendJson(res, 404, { error: 'oauth provider not configured' });
    return;
  }

  const state = await createOAuthState(providerName);
  const redirectUri = `${config.publicApiUrl}/oauth/${providerName}/callback`;
  redirect(res, provider.getAuthorizeUrl(state, redirectUri));
}

async function handleOAuthCallback(req, res, providerName, searchParams) {
  const provider = OAUTH_PROVIDERS[providerName];
  if (!provider || !provider.configured) {
    sendJson(res, 404, { error: 'oauth provider not configured' });
    return;
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (searchParams.get('error') || !code || !(await consumeOAuthState(state, providerName))) {
    redirect(res, `${config.frontendUrl}/login?error=oauth_failed`);
    return;
  }

  const ipHash = hmacIp(getClientIp(req));

  try {
    const accessToken = await provider.exchangeCode(code, `${config.publicApiUrl}/oauth/${providerName}/callback`);
    const { providerId, email, username } = await provider.fetchProfile(accessToken);
    const { userId, username: resolvedUsername } = await findOrCreateOAuthUser(providerName, providerId, email, username);

    await revokeApiKeysForUser(userId);
    const { apiKey } = await generateApiKey(ipHash, undefined, userId);

    const dest = new URL('/auth/complete', config.frontendUrl);
    dest.searchParams.set('apiKey', apiKey);
    dest.searchParams.set('username', resolvedUsername);
    redirect(res, dest.toString());
  } catch (err) {
    logger.error(`oauth ${providerName} callback failed:`, err);
    redirect(res, `${config.frontendUrl}/login?error=oauth_failed`);
  }
}

export function createServer({ pool }) {
  const server = createHttpServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');

    // CORS — потрібен для fetch()-викликів з фронтенда (register/login/
    // logout/oauth/providers, api-key). Це не те саме, що Origin-перевірка
    // в checkOriginHttp()/checkOrigin() (та вирішує, чи СЕРВЕР обробляє
    // запит) — без цих заголовків браузер сам виконує запит, отримує 200,
    // але блокує JS від читання відповіді: саме такий мовчазний збій ловив
    // catch у lib/auth.js на фронтенді (getOAuthProviders діставав []
    // навіть коли curl тим самим ендпоінтом бачив коректні дані). /oauth/
    // :provider/start|callback CORS не потребують — це full-page навігації
    // (<a href>/302), браузер до них CORS не застосовує, заголовок тут
    // просто безпечно ігнорується.
    const origin = req.headers.origin ?? '';
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    // Preflight: браузер сам шле OPTIONS перед POST з Content-Type:
    // application/json (не "simple request") — без явної відповіді тут
    // сервер віддавав 404, і реальний POST /register чи /login браузер
    // після цього взагалі не відправляв.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    const handle = (fn) =>
      fn(req, res).catch((err) => {
        logger.error(`${req.method} ${pathname} failed:`, err);
        sendJson(res, 500, { error: 'internal error' });
      });

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && pathname === '/api-key') {
      handle(handleApiKeyRequest);
      return;
    }

    if (req.method === 'POST' && pathname === '/register') {
      handle(handleRegister);
      return;
    }

    if (req.method === 'POST' && pathname === '/login') {
      handle(handleLogin);
      return;
    }

    if (req.method === 'POST' && pathname === '/logout') {
      handle(handleLogout);
      return;
    }

    if (req.method === 'POST' && pathname === '/account/delete') {
      handle(handleDeleteAccount);
      return;
    }

    if (req.method === 'GET' && pathname === '/oauth/providers') {
      handleOAuthProviders(req, res);
      return;
    }

    const startMatch = req.method === 'GET' && pathname.match(/^\/oauth\/([\w-]+)\/start$/);
    if (startMatch) {
      handle((rq, rs) => handleOAuthStart(rq, rs, startMatch[1]));
      return;
    }

    const callbackMatch = req.method === 'GET' && pathname.match(/^\/oauth\/([\w-]+)\/callback$/);
    if (callbackMatch) {
      handle((rq, rs) => handleOAuthCallback(rq, rs, callbackMatch[1], searchParams));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.wsMaxPayloadBytes });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/terminal') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, req, { pool }).catch((err) => {
        logger.error('ws connection handler failed:', err);
        ws.close();
      });
    });
  });

  return server;
}
