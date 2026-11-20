// Optional cross-origin mode: the SPA may be hosted on a different origin than the Worker
// (for example Vercel + workers.dev). Nothing here is active unless ALLOWED_ORIGINS is set,
// so the default same-origin deployment behaves exactly as before.
//
// ALLOWED_ORIGINS is a non-secret var: comma-separated exact origins, e.g.
//   "https://gamestudio-lac.vercel.app,https://play.example.com"
// No wildcards (`*` is ignored). Cross-origin clients authenticate with `Authorization: Bearer`
// (never cookies), so there is deliberately no Access-Control-Allow-Credentials.

export const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
export const CORS_HEADERS = 'Authorization, Content-Type';
export const CORS_MAX_AGE = '600';

/** Normalise one configured entry to an origin string, or null when it is not a usable origin. */
function normalizeOrigin(entry) {
  const s = String(entry).trim();
  if (!s || s.includes('*')) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

let cachedRaw = null;
let cachedSet = new Set();

/** The allowlist as a Set of origins. Parsed once per distinct value of the var. */
export function allowedOrigins(env) {
  const raw = env && typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '';
  if (raw === cachedRaw) return cachedSet;
  const set = new Set();
  for (const part of raw.split(',')) {
    const o = normalizeOrigin(part);
    if (o) set.add(o);
  }
  cachedRaw = raw;
  cachedSet = set;
  return set;
}

/** Is cross-origin mode configured at all? */
export const corsEnabled = (env) => allowedOrigins(env).size > 0;

/** The request's Origin header when it is exactly an allowlisted origin, else null. */
export function allowedOrigin(env, originHeader) {
  if (!originHeader || typeof originHeader !== 'string') return null;
  return allowedOrigins(env).has(originHeader) ? originHeader : null;
}

/**
 * Strict origin comparison (no loopback leniency): is this Origin different from the origin the
 * Worker itself is served on? Used to decide whether a sign-in may hand out a bearer token.
 */
export function isForeignOrigin(originHeader, requestUrl) {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin !== new URL(requestUrl).origin;
  } catch {
    return true;
  }
}

/** Headers for an allowlisted cross-origin response. */
export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

/**
 * Hono middleware for /api/*. Allowlisted origins get CORS headers (never `*`); a preflight
 * is answered with 204 before authentication and rate limiting. Other origins get nothing.
 */
export async function corsMiddleware(c, next) {
  const env = c.env;
  if (!corsEnabled(env)) return next();
  const origin = allowedOrigin(env, c.req.header('origin'));

  if (c.req.method === 'OPTIONS' && origin) {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        'Access-Control-Allow-Methods': CORS_METHODS,
        'Access-Control-Allow-Headers': CORS_HEADERS,
        'Access-Control-Max-Age': CORS_MAX_AGE,
      },
    });
  }

  await next();
  // Responses differ by Origin once the allowlist is on, so caches must key on it.
  c.header('Vary', 'Origin', { append: true });
  if (origin) c.header('Access-Control-Allow-Origin', origin);
}
