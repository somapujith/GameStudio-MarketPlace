// Bearer token storage for the cross-origin mode (see config.js). The Worker hands the session token to an
// allowlisted cross-origin SPA in the sign-in response; it lives in localStorage under `hyd_token` and is sent as
// `Authorization: Bearer`. Same-origin mode never touches this: there the session is an httpOnly cookie.
//
// Storage can be missing or throw (private windows, blocked site data), so every access is guarded and an
// in-memory copy keeps the current tab working.

export const TOKEN_KEY = 'hyd_token';

let memory = null;
let memoryOnly = false; // the last write to storage failed: memory is the source of truth

const storage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

export function getToken() {
  try {
    const ls = storage();
    if (ls) {
      const v = ls.getItem(TOKEN_KEY);
      if (v || !memoryOnly) return v || null; // storage is the source of truth: another tab may have signed out
    }
  } catch {
    /* fall back to memory */
  }
  return memory;
}

export function setToken(token) {
  if (typeof token !== 'string' || !token) return clearToken();
  memory = token;
  memoryOnly = false;
  try {
    const ls = storage();
    if (!ls) memoryOnly = true;
    else ls.setItem(TOKEN_KEY, token);
  } catch {
    memoryOnly = true;
  }
  return undefined;
}

export function clearToken() {
  memory = null;
  memoryOnly = false;
  try {
    const ls = storage();
    if (ls) ls.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
}
