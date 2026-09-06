export const API_KEY_STORAGE_KEY = 'linuxcli_api_key';
const STORAGE_KEY = API_KEY_STORAGE_KEY;

export function getStoredApiKey() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredApiKey(key) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, key);
}

export function removeStoredApiKey() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export async function generateApiKey(httpUrl) {
  const res = await fetch(`${httpUrl}/api-key`, { method: 'POST' });
  if (!res.ok) throw new Error(`api-key request failed: ${res.status}`);
  const data = await res.json();
  setStoredApiKey(data.apiKey);
  return data.apiKey;
}
