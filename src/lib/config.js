// Build-time network configuration for the OPTIONAL cross-origin mode.
//
// Default (VITE_API_ORIGIN unset): the SPA is served by the same origin as the API (the Worker, or the Vite dev
// proxy), so every URL stays relative ('/api/...', ws(s)://<page host>/ws/...) and sessions use the httpOnly cookie.
//
// Cross-origin (VITE_API_ORIGIN=https://your-worker.workers.dev): the SPA is hosted elsewhere (e.g. Vercel), every
// request goes to that origin, auth is a bearer token (see token.js) and WebSockets use a short-lived ticket.
//
// Every network call in the app goes through `apiUrl()` / `wsUrl()`; nothing else builds a URL.

/** Normalise a configured API origin: '' (same-origin mode) or 'https://host[:port]' without a path. */
export function normalizeApiOrigin(raw, warn = console.warn) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
  } catch {
    /* fall through */
  }
  warn(`VITE_API_ORIGIN "${s}" is not an http(s) origin: ignored, using same-origin requests.`);
  return '';
}

const pageOriginOf = (loc) => {
  if (!loc) return '';
  if (loc.origin && loc.origin !== 'null') return loc.origin;
  return loc.protocol && loc.host ? `${loc.protocol}//${loc.host}` : '';
};

/** Build the helpers for one API origin ('' = same-origin). Exported for tests; the app uses the instance below. */
export function makeConfig(rawOrigin, warn) {
  const API_ORIGIN = normalizeApiOrigin(rawOrigin, warn);

  /**
   * True when requests really leave the page's origin (bearer token + ticket mode). A build that has an API origin
   * but is served from that very origin (e.g. the Worker serving its own bundle) is still same-origin: cookies work.
   */
  const isCrossOrigin = (loc = globalThis.location) => API_ORIGIN !== '' && pageOriginOf(loc) !== API_ORIGIN;

  /** '/api/x' -> '/api/x' (same-origin) or 'https://worker.example/api/x' (cross-origin). */
  const apiUrl = (path, loc = globalThis.location) => {
    const p = String(path);
    if (!isCrossOrigin(loc)) return p;
    return API_ORIGIN + (p.startsWith('/') ? p : `/${p}`);
  };

  /** ws(s) URL of a Worker path: the API origin (https->wss, http->ws) or, same-origin, the page's own host. */
  const wsUrl = (path, loc = globalThis.location) => {
    const p = String(path).startsWith('/') ? String(path) : `/${path}`;
    if (isCrossOrigin(loc)) return API_ORIGIN.replace(/^http/, 'ws') + p;
    if (!loc || !loc.host) return `ws://localhost:8787${p}`;
    return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${p}`;
  };

  return { API_ORIGIN, isCrossOrigin, apiUrl, wsUrl };
}

const read = () => {
  try {
    return import.meta.env.VITE_API_ORIGIN;
  } catch {
    return undefined;
  }
};

const config = makeConfig(read());

export const API_ORIGIN = config.API_ORIGIN;
export const isCrossOrigin = config.isCrossOrigin;
export const apiUrl = config.apiUrl;
export const wsUrl = config.wsUrl;
