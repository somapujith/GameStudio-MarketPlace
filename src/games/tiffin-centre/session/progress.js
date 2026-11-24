// Tiffin Centre: what this device remembers. Pure helpers over a storage-like object ({ getItem, setItem, removeItem }),
// injected so the tests need no browser. Every read is tolerant: corrupt JSON, wrong types and a missing or blocked
// localStorage all fall back to "nothing saved yet" and never throw.
//
// Stored on this device (all under jalebi.*, nothing shared with other games):
//   jalebi.progress.v1.tiffin-centre          practice stars and unlocks (versioned envelope, v0 = the old bare `{ best }` is migrated)
//   jalebi.progress.v1.tiffin-centre.prefs    device prefs (last level / pace)         -> autosave.js
//   jalebi.save.v1.tiffin-centre.shift        the resumable shift                       -> autosave.js
//   jalebi.tutorial.v1.tiffin-centre          tutorial done on this device ('1') and `.pending` (server not told yet)
//   jalebi.tiffin.prefs.v1 / jalebi.tiffin.voices.v1   owned by ui/hud/prefs.js and audio/speech.js: only exported / reset here
import { MAX_LEVEL, PROGRESS_LOCAL_KEY, TUTORIAL_LOCAL_KEY } from '@shared/tiffin-centre/catalog.js';
import { PREFS_KEY, SHIFT_KEY, clearPrefs, clearShift, loadPrefs, savePrefs, validateSnapshot } from './autosave.js';
import { checksum, defaultStorage, isObj, memoryStorage, readKey, removeRaw, unseal, writeRaw } from './safeStorage.js';

export { defaultStorage, memoryStorage };
export { loadPrefs as getPrefs, savePrefs as setPrefs };

/** Set after the tutorial is finished but before the server has confirmed it ("tell the server again next time"). */
export const TUTORIAL_PENDING_KEY = `${TUTORIAL_LOCAL_KEY}.pending`;
export const TUTORIAL_COMPLETE_PATH = '/api/games/tiffin-centre/tutorial/complete';

export const PROGRESS_VERSION = 1;
/** Keys other modules own (the HUD's language/subtitle/voice prefs): mirrored here only for export / import / reset. */
export const HUD_PREFS_KEY = 'jalebi.tiffin.prefs.v1';
export const VOICES_KEY = 'jalebi.tiffin.voices.v1';

const read = (storage, key) => readKey(storage, key).value;
const write = (storage, key, value) => writeRaw(storage, key, value).ok;

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

/** Migration stubs: PROGRESS_MIGRATIONS[n](obj) turns a stored version n into version n + 1. v0 (no `v`) is the bare old format. */
const PROGRESS_MIGRATIONS = {
  0: (obj) => normalizeProgress(obj),
};

/** The stored text -> a normalized progress, or null when the text is not a usable progress record. */
function decodeProgress(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(parsed)) return null;
  if (parsed.v === undefined) return PROGRESS_MIGRATIONS[0](parsed); // the original bare `{ best, unlocked }`
  if (!Number.isInteger(parsed.v) || parsed.v < 1 || parsed.v > PROGRESS_VERSION || parsed.kind !== 'progress') return null;
  let body;
  try {
    body = JSON.stringify(parsed.best);
  } catch {
    return null;
  }
  if (body === undefined || parsed.sum !== checksum(body)) return null;
  return normalizeProgress(parsed);
}

function encodeProgress(p) {
  const best = normalizeProgress(p).best;
  return JSON.stringify({ v: PROGRESS_VERSION, kind: 'progress', best, unlocked: unlockedLevel({ best }), sum: checksum(JSON.stringify(best)) });
}

export function getProgress(storage = defaultStorage()) {
  return decodeProgress(read(storage, PROGRESS_LOCAL_KEY)) || normalizeProgress(null);
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
  write(storage, PROGRESS_LOCAL_KEY, encodeProgress(next));
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
  removeRaw(storage, TUTORIAL_PENDING_KEY);
}

async function defaultPost(path) {
  const { api } = await import('@/lib/api.js'); // the hub's client: same-origin cookie or the cross-origin bearer token
  return api.post(path, {});
}

/**
 * Tell the server the tutorial is done (POST /api/games/tiffin-centre/tutorial/complete). Failures are ignored: the pending
 * flag stays up and the next session start tries again. Resolves to true when the server confirmed. NEVER rejects (a `post`
 * that throws synchronously, rejects, or never returns an object all end as `false`).
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

/** On a session start: when the tutorial is done locally but the server was never told, try once more. Never rejects. */
export async function syncPendingTutorial(opts = {}) {
  try {
    const storage = (opts && opts.storage) || defaultStorage();
    if (!isTutorialDoneLocal(storage) || !isTutorialPending(storage)) return false;
    return await reportTutorialDone({ ...opts, storage });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// move / wipe everything this game keeps on the device

export const EXPORT_KIND = 'jalebi-tiffin-export';
export const EXPORT_VERSION = 1;
const MAX_EXPORT_BYTES = 600 * 1024;
/** Every key export / import / reset touch (the pending flag is deliberately not exported: it is about THIS device's server link). */
export const DATA_KEYS = Object.freeze([PROGRESS_LOCAL_KEY, TUTORIAL_LOCAL_KEY, PREFS_KEY, SHIFT_KEY, HUD_PREFS_KEY, VOICES_KEY]);

/** Whether `text` is an acceptable value for `key` (used by importAll, so a hand-made file cannot plant junk). */
function acceptable(key, text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (key === PROGRESS_LOCAL_KEY) return decodeProgress(text) !== null;
  if (key === TUTORIAL_LOCAL_KEY) return text === '1';
  if (key === PREFS_KEY) return unseal(text, 'prefs', 1, {}).ok;
  if (key === SHIFT_KEY) {
    const u = unseal(text, 'shift', 1, {});
    return u.ok && validateSnapshot(u.data).ok;
  }
  return text.length <= 4096; // the HUD prefs and voices flag are small strings owned by their own modules
}

/** Everything as one JSON text a player can save to a file: `{ kind, v, exportedAt, entries, sum }`. Never throws. */
export function exportAll(storage = defaultStorage(), now = () => Date.now()) {
  const entries = {};
  for (const key of DATA_KEYS) {
    const v = read(storage, key);
    if (typeof v === 'string' && v && acceptable(key, v)) entries[key] = v;
  }
  return JSON.stringify({ kind: EXPORT_KIND, v: EXPORT_VERSION, exportedAt: now(), entries, sum: checksum(JSON.stringify(entries)) });
}

/**
 * Bring an export back. Progress is MERGED (best stars / earnings win); the tutorial flag is OR-ed; prefs and the HUD keys are
 * replaced; the resumable shift is only taken when this device has none (or `replaceShift: true`). Returns
 * `{ ok, imported: [keys], skipped: [keys], error? }` and never throws.
 */
export function importAll(text, storage = defaultStorage(), { replaceShift = false } = {}) {
  const fail = (error) => ({ ok: false, imported: [], skipped: [], error });
  if (typeof text !== 'string' || text.length === 0) return fail('Nothing to import.');
  if (text.length > MAX_EXPORT_BYTES) return fail('That file is too big.');
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return fail('That is not a Tiffin Centre save file.');
  }
  if (!isObj(env) || env.kind !== EXPORT_KIND || !isObj(env.entries)) return fail('That is not a Tiffin Centre save file.');
  if (!Number.isInteger(env.v) || env.v > EXPORT_VERSION) return fail('That file is from a newer version of the game.');
  if (env.sum !== checksum(JSON.stringify(env.entries))) return fail('That save file is damaged.');
  const imported = [];
  const skipped = [];
  for (const key of Object.keys(env.entries)) {
    const value = env.entries[key];
    if (!DATA_KEYS.includes(key) || !acceptable(key, value)) {
      skipped.push(key);
      continue;
    }
    let ok = false;
    if (key === PROGRESS_LOCAL_KEY) {
      const mine = getProgress(storage);
      const theirs = decodeProgress(value);
      const best = { ...mine.best };
      for (const lv of Object.keys(theirs.best)) {
        const a = best[lv] || { stars: 0, earned: 0 };
        best[lv] = { stars: Math.max(a.stars, theirs.best[lv].stars), earned: Math.max(a.earned, theirs.best[lv].earned) };
      }
      ok = write(storage, key, encodeProgress({ best }));
    } else if (key === TUTORIAL_LOCAL_KEY) {
      ok = write(storage, key, '1');
      if (ok && !isTutorialPending(storage)) write(storage, TUTORIAL_PENDING_KEY, '1'); // the account may not know yet
    } else if (key === SHIFT_KEY) {
      if (!replaceShift && read(storage, SHIFT_KEY) !== null) {
        skipped.push(key);
        continue;
      }
      ok = write(storage, key, value);
    } else {
      ok = write(storage, key, value);
    }
    (ok ? imported : skipped).push(key);
  }
  return { ok: imported.length > 0 || skipped.length === 0, imported, skipped };
}

/** The settings menu's "erase everything": progress, tutorial flags, the saved shift, the device prefs. Returns what it removed. */
export function resetAll(storage = defaultStorage(), { keepPrefs = false } = {}) {
  const removed = [];
  for (const key of [...DATA_KEYS, TUTORIAL_PENDING_KEY]) {
    if (keepPrefs && (key === HUD_PREFS_KEY || key === VOICES_KEY || key === PREFS_KEY)) continue;
    const had = read(storage, key) !== null;
    if (removeRaw(storage, key) && had) removed.push(key);
  }
  if (!keepPrefs) clearPrefs(storage);
  clearShift(storage);
  return removed;
}
