// First-run tour memory. One key per tour: `tour:v1:<id>` (bump the id, e.g. `game@2`, or the version to show a tour again).
// Every storage access is guarded (private mode, quota, SSR); when it fails the answer is kept in memory for this visit so
// a tour that was skipped is not offered again at the next screen.

export const TOUR_VERSION = 'v1';
const PREFIX = 'tour';

/** localStorage key of a tour. Pure; exported for tests. */
export const tourKey = (tourId, version = TOUR_VERSION) => `${PREFIX}:${version}:${tourId}`;

const mem = new Map(); // key -> '1' (seen) | null (reset this visit)

const store = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** True when this player has finished or skipped the tour. Never throws. */
export function hasSeen(tourId) {
  if (!tourId) return false;
  const key = tourKey(tourId);
  if (mem.has(key)) return mem.get(key) === '1';
  try {
    return store()?.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remember that the tour was seen (finished, skipped or "don't show again"). Never throws. */
export function markSeen(tourId) {
  if (!tourId) return;
  const key = tourKey(tourId);
  try {
    const ls = store();
    if (!ls) throw new Error('no storage');
    ls.setItem(key, '1');
    mem.delete(key);
  } catch {
    mem.set(key, '1');
  }
}

/** Forget one tour so it is offered again. Never throws. */
export function resetTour(tourId) {
  if (!tourId) return;
  const key = tourKey(tourId);
  mem.set(key, null);
  try {
    store()?.removeItem(key);
    mem.delete(key);
  } catch {
    /* kept as "reset" in memory */
  }
}

/** Forget every tour (Settings > replay). Never throws. */
export function resetAllTours() {
  const prefix = `${PREFIX}:`;
  try {
    const ls = store();
    if (ls) {
      const keys = [];
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach((k) => { try { ls.removeItem(k); } catch { /* ignore */ } });
    }
  } catch {
    /* ignore */
  }
  mem.clear();
}
