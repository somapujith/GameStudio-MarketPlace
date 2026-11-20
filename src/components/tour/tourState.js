// First-run tour memory. One key per tour: `tour:v1:<id>` (bump the id, e.g. `game@2`, or the version to show a tour again).
// Every storage access is guarded (private mode, quota, SSR); when it fails the answer is kept in memory for this visit so
// a tour that was skipped is not offered again at the next screen.

export const TOUR_VERSION = 'v1';
const PREFIX = 'tour';

/** localStorage key of a tour. Pure; exported for tests. */
export const tourKey = (tourId, version = TOUR_VERSION) => `${PREFIX}:${version}:${tourId}`;

const FIRST_SEEN_KEY = `${PREFIX}:${TOUR_VERSION}:firstSeen`;
const AUTO_DONE_KEY = `${PREFIX}:${TOUR_VERSION}:autoDone`;
let autoDoneMem = false;

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

/** Forget every tour (Settings > replay). Never throws. The first-seen stamp stays: it dates this browser, it is not a tour. */
export function resetAllTours() {
  const prefix = `${PREFIX}:`;
  autoDoneMem = false;
  try {
    const ls = store();
    if (ls) {
      const keys = [];
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i);
        if (k && k.startsWith(prefix) && k !== FIRST_SEEN_KEY) keys.push(k);
      }
      keys.forEach((k) => { try { ls.removeItem(k); } catch { /* ignore */ } });
    }
  } catch {
    /* ignore */
  }
  mem.clear();
}

// ---------------------------------------------------------------- who may be shown a tour by itself
//
// The rule: tips are for NEW players and for the first game they play, never again. A tour that starts by itself ("auto")
// needs `canAutoStart(user)`; a tour the player asks for (the "?" buttons, Menu > Take the tour, Settings > Replay) never asks.
// New = has played 0 games AND the account (or, when its age is not sent, this browser) is at most a week old.
// Missing data means "not new": we would rather skip a tip than nag a returning player.

export const NEW_PLAYER_DAYS = 7;
const DAY_MS = 86400000;

/** Games played in total from a /api/me user (`stats.games`, else the sum of `gameStats[*].games`); null when unknown. Pure. */
export function gamesPlayedOf(user) {
  if (!user || typeof user !== 'object') return null;
  const raw = user.stats?.games;
  if (raw !== null && raw !== undefined && Number.isFinite(Number(raw))) return Math.max(0, Number(raw));
  const per = user.gameStats;
  if (per && typeof per === 'object') {
    let sum = 0;
    for (const v of Object.values(per)) sum += Number(v?.games) || 0;
    return sum;
  }
  return null;
}

/** When the account was created (ms), if the user object says (`createdAt` / `created_at`, ms or ISO); null otherwise. Pure. */
export function createdAtOf(user) {
  const raw = user?.createdAt ?? user?.created_at;
  if (raw === null || raw === undefined || raw === '') return null;
  const t = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** When this browser first ran the app (ms), stamped on first call. A browser that already holds tour keys predates the stamp: old. Null without storage. */
function firstSeenAt(ls, now) {
  if (!ls) return null;
  try {
    const n = Number(ls.getItem(FIRST_SEEN_KEY));
    if (Number.isFinite(n) && n > 0) return n;
    let known = false;
    const prefix = `${PREFIX}:`;
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && k.startsWith(prefix) && k !== FIRST_SEEN_KEY) { known = true; break; }
    }
    const at = known ? now - 365 * DAY_MS : now;
    ls.setItem(FIRST_SEEN_KEY, String(at));
    return at;
  } catch {
    return null;
  }
}

/**
 * Is this a new player? `user`: the /api/me user; `null` = signed out (judged by this browser's age); `undefined` = not
 * known yet (false). Never throws. `opts.now` / `opts.storage` are for tests.
 */
export function isNewPlayer(user, { now = Date.now(), storage } = {}) {
  try {
    if (user === undefined) return false;
    let created = null;
    if (user !== null) {
      if (typeof user !== 'object') return false;
      const games = gamesPlayedOf(user);
      if (games === null || games > 0) return false; // unknown or already played: not new
      created = createdAtOf(user);
    }
    if (created === null) created = firstSeenAt(storage === undefined ? store() : storage, now);
    if (created === null) return false;
    return now - created <= NEW_PLAYER_DAYS * DAY_MS;
  } catch {
    return false;
  }
}

/** True once the player's first game started: no tour starts by itself any more (replays still work). Never throws. */
export function autoToursDone(storage) {
  if (autoDoneMem) return true;
  try {
    return (storage === undefined ? store() : storage)?.getItem(AUTO_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The first game started: remember that nothing starts by itself any more. Never throws. */
export function markAutoToursDone(storage) {
  autoDoneMem = true;
  try {
    (storage === undefined ? store() : storage)?.setItem(AUTO_DONE_KEY, '1');
  } catch {
    /* kept in memory */
  }
}

/** May a tour start BY ITSELF right now for this user? Explicit starts (the "?" buttons, Menu, Replay) never ask. */
export function canAutoStart(user, opts = {}) {
  return !autoToursDone(opts.storage) && isNewPlayer(user, opts);
}

// One auto tour per page load (home / game page / lobby / profile share the slot) and one in-game invite per session.
const claimed = new Set();

/** Take the slot of `kind` ('page' | 'invite'); false when it is already taken this page load. */
export function claimAuto(kind = 'page') {
  if (claimed.has(kind)) return false;
  claimed.add(kind);
  return true;
}

/** Tests only. */
export function _resetAutoSession() {
  claimed.clear();
  autoDoneMem = false;
}
