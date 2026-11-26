import { describe, expect, it } from 'vitest';
import { createGame } from '@shared/tiffin-centre/index.js';
import {
  MAX_SAVE_BYTES, PREFS_KEY, ROOM_CACHE_MAX_AGE_MS, SAVE_VERSION, SHIFT_KEY, clearShift, createAutosave, createRoomCache, describeSavedShift,
  hasSavedShift, loadPrefs, loadShift, savePrefs, saveShift, validateJournal, validateSnapshot,
} from './autosave.js';
import { checksum, seal, unseal } from './safeStorage.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
}
const boom = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};
function quotaStorage() {
  const s = fakeStorage();
  s.setItem = () => {
    const e = new Error('full');
    e.name = 'QuotaExceededError';
    throw e;
  };
  return s;
}

const practiceState = (seed = 3, level = 2) => createGame({ players: [{ id: 'me', name: 'Asha' }], settings: { level, pace: 'normal' }, seed });
const snapOf = (over = {}) => {
  const state = practiceState();
  return { v: 1, savedAt: 1700000000000, mode: 'practice', level: state.level, pace: state.pace, seed: 3, state, driver: null, ...over };
};
const tutorialSnap = (over = {}) => {
  const state = createGame({ players: [{ id: 'me', name: 'A' }], settings: { level: 0, pace: 'normal' }, seed: 1 });
  return { v: 1, savedAt: 5, mode: 'tutorial', level: 0, pace: 'normal', seed: 1, state, driver: { journal: [3, ['a', { type: 'move', to: 'tawa1' }], 2, ['k'], ['l', 0.5, 0], ['l']], restarts: 0, index: 2 }, ...over };
};

describe('safeStorage envelopes', () => {
  it('seal / unseal round trip, and every way a stored text can be wrong', () => {
    const text = seal('shift', 1, { a: [1, 2], b: 'x' });
    expect(unseal(text, 'shift', 1)).toMatchObject({ ok: true, data: { a: [1, 2], b: 'x' } });
    expect(unseal(null, 'shift', 1)).toEqual({ ok: false, reason: 'missing' });
    expect(unseal('', 'shift', 1).reason).toBe('missing');
    expect(unseal('{oops', 'shift', 1).reason).toBe('corrupt');
    expect(unseal(text.slice(0, -5), 'shift', 1).reason).toBe('corrupt'); // truncated write
    expect(unseal('[1,2]', 'shift', 1).reason).toBe('foreign');
    expect(unseal('{"best":{}}', 'shift', 1).reason).toBe('foreign');
    expect(unseal(text, 'prefs', 1).reason).toBe('foreign'); // another slot's envelope
    expect(unseal(text.replace('"x"', '"y"'), 'shift', 1).reason).toBe('checksum'); // hand edit
    expect(unseal(seal('shift', 2, {}), 'shift', 1).reason).toBe('new-version');
    expect(unseal(seal('shift', 1, {}), 'shift', 2).reason).toBe('old-version'); // no migration written yet
  });

  it('runs migrations in order and survives a migration that throws', () => {
    const text = seal('k', 1, { n: 1 });
    expect(unseal(text, 'k', 3, { 1: (d) => ({ ...d, a: 1 }), 2: (d) => ({ ...d, b: 2 }) })).toMatchObject({ ok: true, data: { n: 1, a: 1, b: 2 } });
    expect(unseal(text, 'k', 2, { 1: () => { throw new Error('x'); } }).reason).toBe('corrupt');
  });

  it('seal returns null for data that cannot be serialised', () => {
    const c = {};
    c.self = c;
    expect(seal('k', 1, c)).toBe(null);
    expect(seal('k', 1, undefined)).toBe(null);
    expect(checksum('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('shift slot', () => {
  it('saves and loads a practice snapshot exactly, with and without the engine version check', () => {
    const st = fakeStorage();
    const snap = snapOf();
    expect(saveShift(snap, st)).toMatchObject({ ok: true });
    expect(st.getItem(SHIFT_KEY)).toContain('"kind":"shift"');
    expect(loadShift(st)).toEqual(snap);
    expect(loadShift(st, { stateVersion: snap.state.v })).toEqual(snap);
    expect(hasSavedShift(st)).toBe(true);
    clearShift(st);
    expect(hasSavedShift(st)).toBe(false);
    expect(loadShift(st)).toBe(null);
  });

  it('a save from another engine version is refused and removed', () => {
    const st = fakeStorage();
    saveShift(snapOf(), st);
    expect(loadShift(st, { stateVersion: 99 })).toBe(null);
    expect(st.getItem(SHIFT_KEY)).toBe(null);
  });

  it('createAutosave binds the storage', () => {
    const a = createAutosave(fakeStorage());
    expect(a.hasSavedShift()).toBe(false);
    expect(a.saveShift(snapOf()).ok).toBe(true);
    expect(a.hasSavedShift()).toBe(true);
    expect(a.loadShift().seed).toBe(3);
    a.clearShift();
    expect(a.loadShift()).toBe(null);
    expect(a.savePrefs({ lastLevel: 4 }).lastLevel).toBe(4);
    expect(a.loadPrefs().lastLevel).toBe(4);
  });

  it('refuses to save an invalid snapshot', () => {
    const st = fakeStorage();
    expect(saveShift(null, st)).toEqual({ ok: false, reason: 'invalid' });
    expect(saveShift(snapOf({ mode: 'online' }), st).reason).toBe('invalid');
    expect(st.getItem(SHIFT_KEY)).toBe(null);
  });

  it('discards corrupt, foreign, tampered and wrongly-versioned saves without throwing', () => {
    const good = seal('shift', SAVE_VERSION, snapOf());
    const cases = [
      '{not json',
      'null',
      '[]',
      '"x"',
      '{"best":{"1":{"stars":3}}}',
      good.slice(0, 200),
      good.replace('"seed":3', '"seed":4'), // checksum mismatch
      seal('shift', SAVE_VERSION, { ...snapOf(), mode: 'zzz' }),
      seal('shift', SAVE_VERSION, { ...snapOf(), v: 2 }),
      seal('shift', 2, snapOf()), // newer envelope
      seal('prefs', 1, snapOf()), // another slot
      seal('shift', SAVE_VERSION, { ...snapOf(), state: { v: 1 } }),
      seal('shift', SAVE_VERSION, { ...snapOf(), state: { ...snapOf().state, status: 'done' } }),
      seal('shift', SAVE_VERSION, { ...snapOf(), level: 99 }),
      seal('shift', SAVE_VERSION, { ...snapOf(), pace: 'warp' }),
      seal('shift', SAVE_VERSION, { ...snapOf(), seed: { x: 1 } }),
      seal('shift', SAVE_VERSION, { ...snapOf(), driver: { journal: [], restarts: 0, index: 0 } }), // a practice run has no driver
    ];
    for (const raw of cases) {
      const st = fakeStorage({ [SHIFT_KEY]: raw });
      expect(loadShift(st), raw.slice(0, 40)).toBe(null);
      expect(st.getItem(SHIFT_KEY), 'removed').toBe(null);
      expect(hasSavedShift(fakeStorage({ [SHIFT_KEY]: raw }))).toBe(false);
    }
  });

  it('an absurdly large stored value is dropped unread', () => {
    const st = fakeStorage({ [SHIFT_KEY]: 'x'.repeat(MAX_SAVE_BYTES * 2 + 5) });
    expect(loadShift(st)).toBe(null);
    expect(st.getItem(SHIFT_KEY)).toBe(null);
  });

  it('size guard: a snapshot over 200 KB is not written and the old save stays', () => {
    const st = fakeStorage();
    saveShift(snapOf(), st);
    const before = st.getItem(SHIFT_KEY);
    const fat = snapOf();
    fat.state = { ...fat.state, junk: 'z'.repeat(MAX_SAVE_BYTES) };
    expect(saveShift(fat, st)).toEqual({ ok: false, reason: 'too-big' });
    expect(st.getItem(SHIFT_KEY)).toBe(before);
  });

  it('quota errors are swallowed and reported', () => {
    expect(saveShift(snapOf(), quotaStorage())).toEqual({ ok: false, reason: 'quota' });
  });

  it('blocked / missing storage: no function throws', () => {
    expect(saveShift(snapOf(), boom)).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadShift(boom)).toBe(null);
    expect(hasSavedShift(boom)).toBe(false);
    expect(clearShift(boom)).toBe(false);
    expect(saveShift(snapOf(), null).ok).toBe(false);
    expect(loadShift(undefined === 1 ? 0 : { getItem: 5 })).toBe(null);
    expect(loadPrefs(boom)).toEqual({ lastLevel: 1, lastPace: 'normal' });
    expect(() => savePrefs({ lastLevel: 3 }, boom)).not.toThrow();
  });

  it('a read failure never removes a save (only bad CONTENT does)', () => {
    const st = fakeStorage();
    saveShift(snapOf(), st);
    const flaky = { ...st, getItem: () => { throw new Error('read'); } };
    let removed = false;
    flaky.removeItem = () => { removed = true; };
    expect(loadShift(flaky)).toBe(null);
    expect(removed).toBe(false);
    expect(loadShift(st)).not.toBe(null);
  });

  it('a snapshot that cannot be JSON-ed is refused without throwing', () => {
    const snap = snapOf();
    snap.state = { ...snap.state, big: 10n };
    expect(saveShift(snap, fakeStorage()).ok).toBe(false);
  });
});

describe('tutorial journal validation', () => {
  it('accepts the four op kinds', () => {
    expect(validateJournal([1, ['a', { type: 'move', to: 'tawa1' }], ['k'], ['l', 1, 0], ['l'], 40])).toEqual({ ok: true });
    expect(validateSnapshot(tutorialSnap()).ok).toBe(true);
  });

  it('rejects junk, oversize and forbidden actions', () => {
    for (const bad of [
      'x', [0], [-1], [1.5], [['a']], [['a', { type: 'tick' }]], [['a', { type: 'spawn' }]], [['a', { type: 'tutorial-flags' }]], [['a', 5]],
      [['a', { type: 'x'.repeat(41) }]], [['a', { type: 'cook', pad: 'x'.repeat(500) }]], [['k', 1]], [['l', 1]], [['l', 'a', 'b']], [['l', NaN, 0]],
      [['q']], [null], [{}], new Array(6001).fill(1), [40001], [30000, 30000],
    ]) {
      expect(validateJournal(bad).ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });

  it('a tutorial snapshot needs level 0, a driver, sane restarts and index', () => {
    expect(validateSnapshot(tutorialSnap({ driver: null })).ok).toBe(false);
    expect(validateSnapshot(tutorialSnap({ level: 2 })).ok).toBe(false);
    expect(validateSnapshot(tutorialSnap({ driver: { journal: [], restarts: 9, index: 0 } })).ok).toBe(false);
    expect(validateSnapshot(tutorialSnap({ driver: { journal: [], restarts: 0, index: -1 } })).ok).toBe(false);
    const st = fakeStorage();
    expect(saveShift(tutorialSnap(), st).ok).toBe(true);
    expect(loadShift(st).driver.journal).toHaveLength(6);
  });
});

describe('describeSavedShift', () => {
  it('gives the Resume card its numbers', () => {
    const snap = snapOf({ savedAt: 123 });
    snap.state = { ...snap.state, tick: 40, money: 275 };
    expect(describeSavedShift(snap)).toEqual({
      title: 'Idly Sambar', level: 2, pace: 'normal', mode: 'practice', tick: 40, shiftTicks: snap.state.shiftTicks, money: 275, savedAt: 123,
    });
    expect(describeSavedShift(tutorialSnap()).title).toBe('Training Morning');
  });

  it('a tutorial save reports its STEP (the training clock is frozen, so game time says nothing about how far it got); older saves without the step count do not', () => {
    const withSteps = describeSavedShift(tutorialSnap({ driver: { journal: [3], restarts: 0, index: 37, steps: 128 } }));
    expect(withSteps).toMatchObject({ mode: 'tutorial', step: 38, steps: 128 });
    const old = describeSavedShift(tutorialSnap());
    expect(old.step).toBeUndefined();
    expect(old.steps).toBeUndefined();
    expect(validateSnapshot(tutorialSnap({ driver: { journal: [3], restarts: 0, index: 2, steps: 0 } })).ok).toBe(false);
    expect(validateSnapshot(tutorialSnap({ driver: { journal: [3], restarts: 0, index: 2, steps: 'many' } })).ok).toBe(false);
    expect(validateSnapshot(tutorialSnap({ driver: { journal: [3], restarts: 0, index: 2, steps: 128 } })).ok).toBe(true);
  });

  it('is null for anything that is not a snapshot', () => {
    expect(describeSavedShift(null)).toBe(null);
    expect(describeSavedShift({})).toBe(null);
    expect(describeSavedShift(snapOf({ mode: 'x' }))).toBe(null);
  });
});

describe('prefs slot', () => {
  it('starts with defaults, merges patches, clamps and drops unknown keys', () => {
    const st = fakeStorage();
    expect(loadPrefs(st)).toEqual({ lastLevel: 1, lastPace: 'normal' });
    expect(savePrefs({ lastLevel: 5, evil: 1 }, st)).toEqual({ lastLevel: 5, lastPace: 'normal' });
    expect(savePrefs({ lastPace: 'rush' }, st)).toEqual({ lastLevel: 5, lastPace: 'rush' });
    expect(savePrefs({ lastLevel: 99, lastPace: 'warp' }, st)).toEqual({ lastLevel: 1, lastPace: 'normal' });
    expect(loadPrefs(st)).toEqual({ lastLevel: 1, lastPace: 'normal' });
  });

  it('a corrupt prefs slot reads as defaults', () => {
    expect(loadPrefs(fakeStorage({ [PREFS_KEY]: '{bad' }))).toEqual({ lastLevel: 1, lastPace: 'normal' });
    expect(loadPrefs(fakeStorage({ [PREFS_KEY]: seal('prefs', 1, { lastLevel: 4, lastPace: 'rush' }) }))).toEqual({ lastLevel: 4, lastPace: 'rush' });
  });
});

describe('room cache', () => {
  const st0 = () => practiceState(5, 1);

  it('round trips the last good state for one room code only', () => {
    const storage = fakeStorage();
    let t = 1000;
    const cache = createRoomCache('ABCD', { storage, now: () => t });
    expect(cache.load()).toBe(null);
    expect(cache.save(st0(), 'u1').ok).toBe(true);
    t += 5000;
    const hit = cache.load();
    expect(hit.meId).toBe('u1');
    expect(hit.state.seed).toBe(5);
    expect(createRoomCache('WXYZ', { storage, now: () => t }).load()).toBe(null);
    cache.clear();
    expect(cache.load()).toBe(null);
  });

  it('expires, and a wrong-code or corrupt entry is removed', () => {
    const storage = fakeStorage();
    let t = 0;
    const cache = createRoomCache('ROOM1', { storage, now: () => t });
    cache.save(st0(), 'u');
    t = ROOM_CACHE_MAX_AGE_MS + 1;
    expect(cache.load()).toBe(null);
    expect(storage.getItem(cache.key)).toBe(null);
    storage.setItem(cache.key, '{nope');
    expect(cache.load()).toBe(null);
    expect(storage.getItem(cache.key)).toBe(null);
    t = 10;
    cache.save(st0(), 'u');
    storage.setItem(createRoomCache('ROOM2', { storage }).key, storage.getItem(cache.key)); // an entry of room 1 under room 2's key
    expect(createRoomCache('ROOM2', { storage, now: () => t }).load()).toBe(null);
  });

  it('never saves a finished or invalid state and never throws', () => {
    const storage = fakeStorage();
    const cache = createRoomCache('R', { storage });
    expect(cache.save({ ...st0(), status: 'done' }, 'u').ok).toBe(false);
    expect(cache.save(null, 'u').ok).toBe(false);
    expect(createRoomCache('', { storage }).save(st0(), 'u').ok).toBe(false);
    const dead = createRoomCache('R', { storage: boom });
    expect(dead.save(st0(), 'u').ok).toBe(false);
    expect(dead.load()).toBe(null);
    expect(() => dead.clear()).not.toThrow();
    expect(createRoomCache('R', { storage: quotaStorage() }).save(st0(), 'u')).toEqual({ ok: false, reason: 'quota' });
  });
});
