import { setStoredApiKey, removeStoredApiKey, API_KEY_STORAGE_KEY } from './apiKey';

const ACCOUNT_NAME_KEY = 'linuxcli_account_name';
const AUTH_CHANGE_EVENT = 'linuxcli-auth-change';

// Другий прапор поряд з linuxcli_api_key (apiKey.js) — сам ключ
// непрозорий (випадковий токен), тому UI не може відрізнити "анонімний
// ключ" від "залогинений як X" без цього окремого маркера. Значення —
// username (псевдонім), не email — email ніде в UI не показується.
export function getAccountName() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCOUNT_NAME_KEY);
}

function setAccountName(username) {
  window.localStorage.setItem(ACCOUNT_NAME_KEY, username);
}

function clearAccountName() {
  window.localStorage.removeItem(ACCOUNT_NAME_KEY);
}

// AuthStatus живе в кореневому layout і НЕ перемонтовується при client-
// side навігації (router.push/replace) — без цієї події воно лишалось
// би зі стейтом, прочитаним при самому першому монтуванні, і показувало
// "не залогинений" аж до ручного перезавантаження сторінки навіть після
// успішного register/login/oauth. Той самий патерн, що й
// linuxcli-theme-change (ThemeToggle.jsx) для синхронізації між
// незалежно змонтованими компонентами без глобального стану/контексту.
function notifyAuthChange() {
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
}

async function postJson(httpUrl, path, body) {
  const res = await fetch(`${httpUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `request failed: ${res.status}`);
  }
  return data;
}

export async function registerAccount(httpUrl, email, password, username) {
  const { apiKey, username: resolvedUsername } = await postJson(httpUrl, '/register', {
    email,
    password,
    username,
  });
  setStoredApiKey(apiKey);
  setAccountName(resolvedUsername);
  notifyAuthChange();
  return apiKey;
}

export async function loginAccount(httpUrl, email, password) {
  const { apiKey, username } = await postJson(httpUrl, '/login', { email, password });
  setStoredApiKey(apiKey);
  setAccountName(username);
  notifyAuthChange();
  return apiKey;
}

// OAuth-логін закінчується full-page редіректом на /auth/complete
// (сервер видає apiKey+username, тут їх лише кладемо в той самий
// localStorage, що й register/login — docs/architecture/auth.md).
export function completeOAuthLogin(apiKey, username) {
  setStoredApiKey(apiKey);
  setAccountName(username);
  notifyAuthChange();
}

export async function logoutAccount(httpUrl, apiKey) {
  // Best-effort — навіть якщо мережевий запит не пройде, локальний стан
  // усе одно чиститься нижче (Terminal.jsx на наступному підключенні
  // просто піде як анонім).
  await postJson(httpUrl, '/logout', { apiKey }).catch(() => {});
  removeStoredApiKey();
  clearAccountName();
  notifyAuthChange();
}

// На відміну від logoutAccount — НЕ best-effort. Якщо запит на бекенд
// не пройшов, акаунт насправді ще живий, і локальний стан не повинен
// чиститись так, ніби видалення відбулось (AccountView.jsx показав би
// "видалено", хоча на сервері акаунт лишився).
export async function deleteAccount(httpUrl, apiKey) {
  await postJson(httpUrl, '/account/delete', { apiKey });
  removeStoredApiKey();
  clearAccountName();
  notifyAuthChange();
}

// linuxcli-auth-change (notifyAuthChange) — тільки в межах однієї вкладки,
// window.dispatchEvent не перетинає вкладки. Без окремого 'storage'-
// listener'а логаут/видалення акаунту в одній вкладці не оновило б
// AuthStatus/AccountView в іншій — там і далі був би "живий" username,
// а клік "Delete account" пішов би з уже недійсним/порожнім apiKey
// (localStorage вже почищено першою вкладкою) замість чіткого
// "ти вже не залогинений". 'storage' — нативна подія браузера, летить
// саме в ІНШІ вкладки на зміну localStorage, ніколи в ту, що змінила.
function isAuthStorageKey(key) {
  return key === API_KEY_STORAGE_KEY || key === ACCOUNT_NAME_KEY;
}

export function onAuthChange(callback) {
  const onStorage = (event) => {
    if (isAuthStorageKey(event.key)) callback();
  };
  window.addEventListener(AUTH_CHANGE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

// Легкий GET, не критичний шлях — мережева помилка чи бекенд без цього
// ендпоінта (ще не задеплоєно) не повинні ламати рендер /login,
// просто жодна OAuth-кнопка не покажеться.
export async function getOAuthProviders(httpUrl) {
  try {
    const res = await fetch(`${httpUrl}/oauth/providers`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    return [];
  }
}
