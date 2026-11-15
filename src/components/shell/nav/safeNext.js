// Post-login / post-action redirect targets come from the URL (`/login?next=...`), so they are untrusted:
// only a same-origin absolute path is allowed ("/x/y?z"), never "//evil.com", "/\evil.com" or "https://...".
// Wave 0 (shared): WP-C and WP-D import it, nobody else forks it.

/** `safeNext('/games/x?y=1') -> '/games/x?y=1'`; anything else -> `fallback`. */
export function safeNext(raw, fallback = '/') {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback;
  // no control characters, and never bounce back to the login screen itself
  if (/[\u0000-\u001f\u007f]/.test(v) || /^\/login(\/|\?|#|$)/.test(v)) return fallback;
  return v;
}

export default safeNext;
