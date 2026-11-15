// Recently opened games (ids only), kept on this device for the command palette. Never throws.
const KEY = 'hub.recent.games.v1';
const MAX = 5;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Most recent first. */
export const getRecentIds = read;

/** Remembers `id` as the latest opened game. */
export function pushRecent(id) {
  const clean = String(id ?? '');
  if (!clean) return;
  try {
    const next = [clean, ...read().filter((x) => x !== clean)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: recents are a convenience */
  }
}

/** Game manifests for the stored ids that still exist in the catalogue. */
export function recentGames(getGame) {
  return getRecentIds()
    .map((id) => getGame(id))
    .filter(Boolean);
}
