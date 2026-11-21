// Pure rules for a suspended (banned) account. No React. Contract: docs/ADMIN.md, "Bans".
//
// While suspended, every hub page is replaced by the full-page notice, except the pages anyone may read without an
// account: Help (how to appeal / contact), Privacy, Terms (what the rules are) and About. Those keep the normal shell
// with a slim "your account is suspended" strip on top, so the notice's own links work instead of looping back to it.

/** Hub pages that stay readable while suspended. */
export const PUBLIC_PATHS = Object.freeze(['/help', '/privacy', '/terms', '/about']);

/** True for a page that stays reachable behind the suspended screen. */
export function isPublicPath(pathname) {
  const p = typeof pathname === 'string' ? pathname.replace(/\/+$/, '') || '/' : '';
  return PUBLIC_PATHS.some((b) => p === b || p.startsWith(`${b}/`));
}

/** `{ reason }` from anything that says "suspended" (an ApiError body, a socket message), trimmed and capped. */
export function suspension(source) {
  const raw = source && typeof source === 'object' ? (source.reason ?? source.data?.reason) : source;
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return { reason };
}

/** Is this user-socket close (status info from socket.js) the server refusing a suspended account? */
export function isSuspendedClose(info) {
  return !!info && info.reason === 'fatal_close' && Number(info.code) === 4003;
}
