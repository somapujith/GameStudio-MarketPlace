// Tiffin Centre: what this device remembers. Pure helpers over a storage-like object ({ getItem, setItem, removeItem }),
// injected so the tests need no browser. Every read is tolerant: corrupt JSON, wrong types and a missing or blocked
// localStorage all fall back to "nothing saved yet" and never throw.
import { MAX_LEVEL, PROGRESS_LOCAL_KEY, TUTORIAL_LOCAL_KEY } from '@shared/tiffin-centre/catalog.js';

/** Set after the tutorial is finished but before the server has confirmed it ("tell the server again next time"). */
export const TUTORIAL_PENDING_KEY = `${TUTORIAL_LOCAL_KEY}.pending`;
export const TUTORIAL_COMPLETE_PATH = '/api/games/tiffin-centre/tutorial/complete';

const memory = new Map();
/** localStorage when it works, else a per-page memory store (private mode, blocked storage, node tests). */
export const memoryStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => void memory.set(k, String(v)),
  removeItem: (k) => void memory.delete(k),
};

export function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* blocked */
  }
  return memoryStorage;
}

function read(storage, key) {
  try {
    const v = storage.getItem(key);
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}
function write(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

/** Highest level a player may start: 1 always; level n+1 opens after at least one star on n. */
export function unlockedLevel(progress) {
  const best = progress && isObj(progress.best) ? progress.best : {};
  let n = 1;
  while (n < MAX_LEVEL && best[n] && best[n].stars >= 1) n += 1;
  return n;
}

/** `{ best: { [level 1..12]: { stars 0..3, earned >= 0 } }, unlocked }` from whatever is stored; always well formed. */
export function normalizeProgress(raw) {
  const best = {};
  const src = isObj(raw) && isObj(raw.best) ? raw.best : {};
  for (const key of Object.keys(src)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL || !isObj(src[key])) continue;
    best[level] = { stars: int(src[key].stars, 0, 3), earned: int(src[key].earned, 0, 1e9) };
  }
  const p = { best, unlocked: 1 };
  p.unlocked = unlockedLevel(p);
  return p;
}

export function getProgress(storage = defaultStorage()) {
  const raw = read(storage, PROGRESS_LOCAL_KEY);
  let parsed = null;
  if (typeof raw === 'string' && raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  return normalizeProgress(parsed);
}

/**
 * Record a finished practice shift. Keeps the best stars and the best earnings per level (level 0 / bad levels are ignored).
 * Returns the saved progress plus two extras that are NOT stored: `improved` (stars went up or a first clear) and
 * `unlockedNow` (the level this result just opened, or null).
 */
export function saveShiftResult(level, stars, earned, storage = defaultStorage()) {
  const lv = Math.trunc(Number(level));
  const before = getProgress(storage);
  if (!Number.isInteger(lv) || lv < 1 || lv > MAX_LEVEL) return { ...before, improved: false, unlockedNow: null };
  const s = int(stars, 0, 3);
  const e = int(earned, 0, 1e9);
  const prev = before.best[lv] || { stars: 0, earned: 0 };
  const best = { ...before.best, [lv]: { stars: Math.max(prev.stars, s), earned: Math.max(prev.earned, e) } };
  const next = normalizeProgress({ best });
  write(storage, PROGRESS_LOCAL_KEY, JSON.stringify({ best: next.best, unlocked: next.unlocked }));
  return { ...next, improved: s > prev.stars, unlockedNow: next.unlocked > before.unlocked ? next.unlocked : null };
}

export const isTutorialDoneLocal = (storage = defaultStorage()) => read(storage, TUTORIAL_LOCAL_KEY) === '1';

/** The tutorial is finished on this device. Also raises the "server not told yet" flag until `clearTutorialPending`. */
export function markTutorialDone(storage = defaultStorage()) {
  write(storage, TUTORIAL_LOCAL_KEY, '1');
  write(storage, TUTORIAL_PENDING_KEY, '1');
}
export const isTutorialPending = (storage = defaultStorage()) => read(storage, TUTORIAL_PENDING_KEY) === '1';
export function clearTutorialPending(storage = defaultStorage()) {
  try {
    storage.removeItem(TUTORIAL_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

async function defaultPost(path) {
  const { api } = await import('@/lib/api.js'); // the hub's client: same-origin cookie or the cross-origin bearer token
  return api.post(path, {});
}

/**
 * Tell the server the tutorial is done (POST /api/games/tiffin-centre/tutorial/complete). Failures are ignored: the pending
 * flag stays up and the next session start tries again. Resolves to true when the server confirmed.
 */
export async function reportTutorialDone({ storage = defaultStorage(), post = defaultPost } = {}) {
  try {
    await post(TUTORIAL_COMPLETE_PATH);
    clearTutorialPending(storage);
    return true;
  } catch {
    return false;
  }
}

/** On a session start: when the tutorial is done locally but the server was never told, try once more. */
export async function syncPendingTutorial(opts = {}) {
  const storage = opts.storage || defaultStorage();
  if (!isTutorialDoneLocal(storage) || !isTutorialPending(storage)) return false;
  return reportTutorialDone({ ...opts, storage });
}
