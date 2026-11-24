// Tiffin Centre: the auto-save slots. Pure over an injected storage ({ getItem, setItem, removeItem }); nothing here throws.
//
//   slot 'shift'  the resumable solo run (practice or tutorial)      key  jalebi.save.v1.tiffin-centre.shift
//   slot 'prefs'  small device preferences (last level / pace)       key  jalebi.progress.v1.tiffin-centre.prefs
//   room cache    the last good online state, in sessionStorage       key  jalebi.save.v1.tiffin-centre.room.<code>
//
// A shift snapshot:
//   { v: 1, savedAt, mode: 'practice' | 'tutorial', level, pace, seed,
//     state,                      the engine state, plain JSON (the rng lives inside it, so it resumes EXACTLY)
//     driver: null | { journal, restarts, index } }   tutorial only, see below
//
// WHY A JOURNAL FOR THE TUTORIAL: the tutorial driver (shared/tiffin-centre/tutorial.js) keeps private memory (visits, tags, who paid ...)
// that cannot be read out or put back. But the whole tutorial is deterministic: the engine state comes from `createGame(seed)` plus
// the ticks and the player's actions, and the driver only ever sees the state, the events and the head direction. So the session
// records an ordered, run-length encoded JOURNAL of what happened and a resume REPLAYS it through the very same code paths. The
// replay must land on exactly the saved state and driver step, or the save is discarded (an engine that changed since the save).
//   journal ops:  n (integer >= 1)    n ticks
//                 ['a', action]       an accepted player action (without playerId)
//                 ['k']               "Got it" pressed
//                 ['l', yaw, pitch]   head direction noted (['l'] = cleared)
import { GAME_ID, MAX_LEVEL, PACE, levelDef } from '@shared/tiffin-centre/catalog.js';
import { byteLength, defaultSessionStorage, defaultStorage, isObj, readKey, removeRaw, seal, unseal, writeRaw } from './safeStorage.js';

export const SAVE_VERSION = 1;
export const SHIFT_KEY = `jalebi.save.v1.${GAME_ID}.shift`;
export const PREFS_KEY = `jalebi.progress.v1.${GAME_ID}.prefs`;
export const ROOM_CACHE_PREFIX = `jalebi.save.v1.${GAME_ID}.room.`;
export const MAX_SAVE_BYTES = 200 * 1024;
export const MAX_JOURNAL_OPS = 6000;
export const MAX_JOURNAL_TICKS = 40000;
export const MAX_TUTORIAL_RESTARTS = 3;
export const ROOM_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isInt = (n) => Number.isInteger(n);
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

function validAction(a) {
  if (!isObj(a) || typeof a.type !== 'string' || a.type.length === 0 || a.type.length > 40) return false;
  if (a.type === 'tick' || a.type === 'spawn' || a.type === 'tutorial-flags') return false;
  try {
    return JSON.stringify(a).length <= 400;
  } catch {
    return false;
  }
}

/** `{ ok, reason }`: is this a well formed tutorial journal? */
export function validateJournal(journal) {
  if (!Array.isArray(journal) || journal.length > MAX_JOURNAL_OPS) return { ok: false, reason: 'journal-size' };
  let ticks = 0;
  for (const op of journal) {
    if (typeof op === 'number') {
      if (!isInt(op) || op < 1 || op > MAX_JOURNAL_TICKS) return { ok: false, reason: 'journal-op' };
      ticks += op;
    } else if (Array.isArray(op) && op[0] === 'a') {
      if (op.length !== 2 || !validAction(op[1])) return { ok: false, reason: 'journal-op' };
    } else if (Array.isArray(op) && op[0] === 'k') {
      if (op.length !== 1) return { ok: false, reason: 'journal-op' };
    } else if (Array.isArray(op) && op[0] === 'l') {
      if (!(op.length === 1 || (op.length === 3 && isFiniteNum(op[1]) && isFiniteNum(op[2])))) return { ok: false, reason: 'journal-op' };
    } else return { ok: false, reason: 'journal-op' };
  }
  if (ticks > MAX_JOURNAL_TICKS) return { ok: false, reason: 'journal-ticks' };
  return { ok: true };
}

/** A cheap structural check of an engine state: enough to refuse junk, never enough to need to know the engine's fields. */
export function validateStateShape(state, { stateVersion } = {}) {
  if (!isObj(state)) return false;
  if (!isInt(state.v) || state.v < 1) return false;
  if (stateVersion !== undefined && state.v !== stateVersion) return false;
  if (!isInt(state.tick) || state.tick < 0 || state.tick > 1e6) return false;
  if (!isInt(state.shiftTicks) || state.shiftTicks < 1 || state.shiftTicks > 1e6) return false;
  if (state.status !== 'playing') return false;
  if (!isObj(state.players) || !Array.isArray(state.order)) return false;
  const n = Object.keys(state.players).length;
  if (n < 1 || n > 8) return false;
  return true;
}

/**
 * `{ ok:true }` or `{ ok:false, reason }`. `stateVersion` (the engine's STATE_VERSION) is checked when given: a save from an older
 * engine is refused rather than fed to a newer one.
 */
export function validateSnapshot(snap, { stateVersion } = {}) {
  if (!isObj(snap)) return { ok: false, reason: 'shape' };
  if (snap.v !== SAVE_VERSION) return { ok: false, reason: snap.v > SAVE_VERSION ? 'new-version' : 'old-version' };
  if (snap.mode !== 'practice' && snap.mode !== 'tutorial') return { ok: false, reason: 'mode' };
  if (!isFiniteNum(snap.savedAt) || snap.savedAt < 0) return { ok: false, reason: 'savedAt' };
  const tutorial = snap.mode === 'tutorial';
  if (tutorial ? snap.level !== 0 : !(isInt(snap.level) && snap.level >= 1 && snap.level <= MAX_LEVEL)) return { ok: false, reason: 'level' };
  if (typeof snap.pace !== 'string' || !hasOwn(PACE, snap.pace)) return { ok: false, reason: 'pace' };
  if (!((typeof snap.seed === 'string' && snap.seed.length <= 64) || isFiniteNum(snap.seed))) return { ok: false, reason: 'seed' };
  if (!validateStateShape(snap.state, { stateVersion })) return { ok: false, reason: 'state' };
  if (snap.state.level !== snap.level) return { ok: false, reason: 'state' };
  if (tutorial) {
    const d = snap.driver;
    if (!isObj(d)) return { ok: false, reason: 'driver' };
    if (!isInt(d.restarts) || d.restarts < 0 || d.restarts > MAX_TUTORIAL_RESTARTS) return { ok: false, reason: 'driver' };
    if (!isInt(d.index) || d.index < 0 || d.index > 500) return { ok: false, reason: 'driver' };
    const j = validateJournal(d.journal);
    if (!j.ok) return { ok: false, reason: j.reason };
  } else if (snap.driver !== null && snap.driver !== undefined) return { ok: false, reason: 'driver' };
  return { ok: true };
}

/**
 * Save the resumable run. Returns `{ ok:true, bytes }` or `{ ok:false, reason }` with reason in
 * 'invalid' | 'too-big' | 'quota' | 'unavailable' | 'unserializable'. An older good save is left alone when the write fails.
 */
export function saveShift(snapshot, storage = defaultStorage(), opts = {}) {
  const v = validateSnapshot(snapshot, opts);
  if (!v.ok) return { ok: false, reason: 'invalid' };
  const text = seal('shift', SAVE_VERSION, snapshot, { savedAt: snapshot.savedAt });
  if (text === null) return { ok: false, reason: 'unserializable' };
  const w = writeRaw(storage, SHIFT_KEY, text, MAX_SAVE_BYTES);
  return w.ok ? { ok: true, bytes: byteLength(text) } : { ok: false, reason: w.reason };
}

/** The saved run or null. A corrupt, foreign, old-version or failing-validation save is REMOVED so it cannot trip anyone twice. */
export function loadShift(storage = defaultStorage(), opts = {}) {
  const r = readKey(storage, SHIFT_KEY);
  if (!r.ok || r.value === null) return null; // storage failure or nothing there: leave the key alone
  if (r.value.length > MAX_SAVE_BYTES * 2) {
    removeRaw(storage, SHIFT_KEY);
    return null;
  }
  const u = unseal(r.value, 'shift', SAVE_VERSION, {});
  if (!u.ok || !validateSnapshot(u.data, opts).ok) {
    removeRaw(storage, SHIFT_KEY);
    return null;
  }
  return u.data;
}

export function clearShift(storage = defaultStorage()) {
  return removeRaw(storage, SHIFT_KEY);
}

export function hasSavedShift(storage = defaultStorage(), opts = {}) {
  return loadShift(storage, opts) !== null;
}

/** What the Resume card shows: `{ title, level, pace, mode, tick, shiftTicks, money, savedAt }`, or null for no / bad snapshot. */
export function describeSavedShift(snapshot) {
  if (!validateSnapshot(snapshot).ok) return null;
  const s = snapshot.state;
  let title = 'Your shift';
  try {
    const def = levelDef(snapshot.level);
    if (def && typeof def.name === 'string') title = def.name;
  } catch {
    /* keep the generic title */
  }
  return {
    title,
    level: snapshot.level,
    pace: snapshot.pace,
    mode: snapshot.mode,
    tick: s.tick,
    shiftTicks: s.shiftTicks,
    money: isFiniteNum(s.money) ? s.money : 0,
    savedAt: snapshot.savedAt,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// prefs slot

export const DEFAULT_DEVICE_PREFS = Object.freeze({ lastLevel: 1, lastPace: 'normal' });

export function normalizeDevicePrefs(raw) {
  const r = isObj(raw) ? raw : {};
  const lv = Math.trunc(Number(r.lastLevel));
  return {
    lastLevel: Number.isFinite(lv) && lv >= 1 && lv <= MAX_LEVEL ? lv : DEFAULT_DEVICE_PREFS.lastLevel,
    lastPace: typeof r.lastPace === 'string' && hasOwn(PACE, r.lastPace) ? r.lastPace : DEFAULT_DEVICE_PREFS.lastPace,
  };
}

export function loadPrefs(storage = defaultStorage()) {
  const r = readKey(storage, PREFS_KEY);
  const u = unseal(r.value, 'prefs', 1, {});
  return normalizeDevicePrefs(u.ok ? u.data : null);
}

/** Merge `patch` into the stored prefs (unknown keys are dropped). Returns the prefs now stored (or that would be). */
export function savePrefs(patch, storage = defaultStorage()) {
  const next = normalizeDevicePrefs({ ...loadPrefs(storage), ...(isObj(patch) ? patch : {}) });
  const text = seal('prefs', 1, next);
  if (text !== null) writeRaw(storage, PREFS_KEY, text, 8 * 1024);
  return next;
}

export const clearPrefs = (storage = defaultStorage()) => removeRaw(storage, PREFS_KEY);

// ---------------------------------------------------------------------------------------------------------------------
// the online room's "last good state" (sessionStorage: it must survive a refresh, and nothing longer)

/**
 * A cache for ONE room code: `{ load(), save(state, meId), clear() }`. `load()` returns `{ state, meId, savedAt }` or null (nothing,
 * too old, corrupt, over or not this room). `save` is throttled by the caller; all of it swallows storage errors.
 */
export function createRoomCache(code, { storage = defaultSessionStorage(), now = () => Date.now(), maxAgeMs = ROOM_CACHE_MAX_AGE_MS, stateVersion } = {}) {
  const key = ROOM_CACHE_PREFIX + String(code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  return {
    key,
    load() {
      if (!code) return null;
      const r = readKey(storage, key);
      if (!r.ok || r.value === null) return null;
      const u = unseal(r.value, 'room', 1, {});
      const d = u.ok ? u.data : null;
      const fine =
        d && isObj(d) && isFiniteNum(d.savedAt) && now() - d.savedAt >= 0 && now() - d.savedAt <= maxAgeMs &&
        typeof d.meId === 'string' && d.code === String(code) && validateStateShape(d.state, { stateVersion });
      if (!fine) {
        removeRaw(storage, key);
        return null;
      }
      return { state: d.state, meId: d.meId, savedAt: d.savedAt };
    },
    save(state, meId = '') {
      if (!code || !validateStateShape(state, { stateVersion })) return { ok: false, reason: 'invalid' };
      const text = seal('room', 1, { code: String(code), meId: String(meId || ''), savedAt: now(), state });
      if (text === null) return { ok: false, reason: 'unserializable' };
      return writeRaw(storage, key, text, MAX_SAVE_BYTES);
    },
    clear() {
      return removeRaw(storage, key);
    },
  };
}

/** The same functions bound to one storage, for callers that prefer an object. */
export function createAutosave(storage = defaultStorage(), opts = {}) {
  return {
    saveShift: (snapshot) => saveShift(snapshot, storage, opts),
    loadShift: () => loadShift(storage, opts),
    clearShift: () => clearShift(storage),
    hasSavedShift: () => hasSavedShift(storage, opts),
    loadPrefs: () => loadPrefs(storage),
    savePrefs: (patch) => savePrefs(patch, storage),
  };
}
