// Pure rules for the announcement banner under the top bar. No React, no network.
// Shape (docs/ADMIN.md): Announcement = { id, message, tone: 'info'|'event'|'warning', linkUrl: string|null,
//   linkLabel: string|null, startsAt: ISO, endsAt: ISO|null, active: boolean, createdAt: ISO }

/** Re-fetch this often while the tab is visible (the endpoint is cached for 60 s anyway). */
export const ANNOUNCEMENT_REFRESH_MS = 5 * 60_000;
/** localStorage key holding the ids a player closed. */
export const DISMISS_KEY = 'jalebi:announcements:dismissed';
/** Remember at most this many closed ids (old ones fall off; they have long ended by then). */
export const DISMISS_MAX = 30;

const TONES = new Set(['info', 'event', 'warning']);

/** Routes where the banner never shows: full-screen play (outside the shell anyway) and the viewport-fit leaderboard. */
const HIDDEN_PREFIXES = ['/play', '/lobby', '/leaderboard'];

/** Is the banner allowed on this path? */
export function bannerRouteAllowed(pathname) {
  const p = typeof pathname === 'string' ? pathname : '';
  if (!p.startsWith('/')) return false;
  return !HIDDEN_PREFIXES.some((b) => p === b || p.startsWith(`${b}/`));
}

/**
 * Where a link goes: `{ kind: 'internal', to }` for a same-site path ("/shop", not "//evil"), `{ kind: 'external',
 * href }` for an https:// URL, or null (anything else is ignored, whatever the server sent).
 */
export function linkTarget(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\')) return { kind: 'internal', to: u };
  if (/^https:\/\/[^\s/?#]+/i.test(u)) {
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'https:' ? { kind: 'external', href: parsed.href } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** A clean Announcement, or null (no id or no message). Unknown tones read as 'info'. */
export function normalizeAnnouncement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id == null ? '' : String(raw.id);
  const message = typeof raw.message === 'string' ? raw.message.trim().slice(0, 200) : '';
  if (!id || !message) return null;
  const link = linkTarget(raw.linkUrl);
  const label = typeof raw.linkLabel === 'string' ? raw.linkLabel.trim().slice(0, 40) : '';
  return {
    id,
    message,
    tone: TONES.has(raw.tone) ? raw.tone : 'info',
    link: link ? { ...link, label: label || 'Learn more' } : null,
    startsAt: typeof raw.startsAt === 'string' ? raw.startsAt : null,
    endsAt: typeof raw.endsAt === 'string' ? raw.endsAt : null,
    active: raw.active !== false,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
  };
}

/**
 * Inside its live window right now? Active, started (a missing start counts as started), and not ended (a missing end
 * never ends). The server already filters; this keeps a banner from outliving its window in a long-open tab.
 */
export function isLive(a, now = Date.now()) {
  if (!a || a.active === false) return false;
  const start = Date.parse(a.startsAt);
  if (Number.isFinite(start) && start > now) return false;
  const end = Date.parse(a.endsAt);
  if (Number.isFinite(end) && end <= now) return false;
  return true;
}

const stamp = (a) => {
  const s = Date.parse(a.startsAt);
  if (Number.isFinite(s)) return s;
  const c = Date.parse(a.createdAt);
  return Number.isFinite(c) ? c : 0;
};

/** The one to show: the newest live announcement the player has not closed, or null. */
export function pickAnnouncement(list, { now = Date.now(), dismissed = [] } = {}) {
  const closed = new Set(Array.isArray(dismissed) ? dismissed.map(String) : []);
  const live = (Array.isArray(list) ? list : [])
    .map(normalizeAnnouncement)
    .filter((a) => a && isLive(a, now) && !closed.has(a.id));
  live.sort((a, b) => stamp(b) - stamp(a));
  return live[0] || null;
}

/** When the shown banner should next be re-checked against its window (its end), in ms from now, or null. */
export function msUntilEnd(a, now = Date.now()) {
  const end = Date.parse(a?.endsAt);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - now);
}

function safeLocal() {
  try {
    return typeof window !== 'undefined' ? window.localStorage || null : null;
  } catch {
    return null;
  }
}

/** The closed ids (storage is injectable for tests; private mode / blocked storage reads as "none"). */
export function readDismissed(store = safeLocal()) {
  try {
    const raw = store ? store.getItem(DISMISS_KEY) : null;
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(-DISMISS_MAX) : [];
  } catch {
    return [];
  }
}

/** The list after closing `id` (newest last, capped, no duplicates). Pure. */
export function withDismissed(list, id, max = DISMISS_MAX) {
  const key = String(id ?? '');
  const cur = (Array.isArray(list) ? list : []).filter((x) => x !== key);
  return key ? [...cur, key].slice(-max) : cur;
}

/** Remember that `id` was closed. Returns the new list (also when storage is unavailable: the tab still remembers). */
export function dismissAnnouncement(id, store = safeLocal()) {
  const next = withDismissed(readDismissed(store), id);
  try {
    store?.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode: the caller keeps the in-memory list */
  }
  return next;
}
