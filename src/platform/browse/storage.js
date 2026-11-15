// Per-visitor conveniences kept in localStorage: the grid/list choice and recent searches.
// Every access is wrapped: private windows and blocked storage must never break the page.
const VIEW_KEY = 'hub.browse.view.v1';
const RECENT_KEY = 'hub.search.recent.v1';
export const MAX_RECENT = 6;

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference just does not persist */
  }
}

export const getStoredView = () => (read(VIEW_KEY) === 'list' ? 'list' : 'grid');
export const setStoredView = (view) => write(VIEW_KEY, view === 'list' ? 'list' : 'grid');

/** Add `q` to a recent-search list: newest first, case-insensitive de-dupe, capped. Pure. */
export function pushRecent(list, q, max = MAX_RECENT) {
  const t = String(q ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (t.length < 2) return list;
  const key = t.toLowerCase();
  return [t, ...list.filter((x) => x.toLowerCase() !== key)].slice(0, max);
}

export function getRecents() {
  try {
    const v = JSON.parse(read(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
export const saveRecents = (list) => write(RECENT_KEY, list.length ? JSON.stringify(list.slice(0, MAX_RECENT)) : null);
