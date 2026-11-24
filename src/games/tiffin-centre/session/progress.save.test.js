import { describe, expect, it } from 'vitest';
import { PROGRESS_LOCAL_KEY, TUTORIAL_LOCAL_KEY } from '@shared/tiffin-centre/catalog.js';
import { createGame } from '@shared/tiffin-centre/index.js';
import { PREFS_KEY, SHIFT_KEY, saveShift } from './autosave.js';
import {
  DATA_KEYS, EXPORT_KIND, HUD_PREFS_KEY, TUTORIAL_PENDING_KEY, VOICES_KEY, exportAll, getPrefs, getProgress, importAll, isTutorialDoneLocal,
  isTutorialPending, markTutorialDone, reportTutorialDone, resetAll, saveShiftResult, setPrefs, syncPendingTutorial,
} from './progress.js';
import { checksum } from './safeStorage.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}
const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };

describe('versioned progress envelope', () => {
  it('writes v1 with a checksum and keeps the old top-level fields readable', () => {
    const st = fakeStorage();
    saveShiftResult(1, 2, 300, st);
    const raw = JSON.parse(st.getItem(PROGRESS_LOCAL_KEY));
    expect(raw).toMatchObject({ v: 1, kind: 'progress', unlocked: 2, best: { 1: { stars: 2, earned: 300 } } });
    expect(raw.sum).toBe(checksum(JSON.stringify(raw.best)));
    expect(getProgress(st).best[1]).toEqual({ stars: 2, earned: 300 });
  });

  it('migrates the original bare format (v0) and rewrites it as v1 on the next save', () => {
    const st = fakeStorage({ [PROGRESS_LOCAL_KEY]: JSON.stringify({ best: { 1: { stars: 3, earned: 700 } }, unlocked: 2 }) });
    expect(getProgress(st)).toEqual({ best: { 1: { stars: 3, earned: 700 } }, unlocked: 2 });
    saveShiftResult(2, 1, 50, st);
    const raw = JSON.parse(st.getItem(PROGRESS_LOCAL_KEY));
    expect(raw.v).toBe(1);
    expect(raw.best[1]).toEqual({ stars: 3, earned: 700 });
    expect(raw.best[2]).toEqual({ stars: 1, earned: 50 });
  });

  it('a tampered, truncated, future-version or foreign envelope reads as nothing saved', () => {
    const st = fakeStorage();
    saveShiftResult(1, 3, 900, st);
    const good = st.getItem(PROGRESS_LOCAL_KEY);
    for (const bad of [good.replace('"stars":3', '"stars":2'), good.slice(0, 30), good.replace('"v":1', '"v":7'), good.replace('"progress"', '"other"'), good.replace('"v":1', '"v":0')]) {
      expect(getProgress(fakeStorage({ [PROGRESS_LOCAL_KEY]: bad })), bad.slice(0, 30)).toEqual({ best: {}, unlocked: 1 });
    }
  });

  it('a failed write leaves the earlier progress intact and still reports the new result', () => {
    const st = fakeStorage();
    saveShiftResult(1, 1, 100, st);
    st.setItem = () => { throw new Error('quota'); };
    const p = saveShiftResult(1, 3, 500, st);
    expect(p.best[1].stars).toBe(3);
    expect(getProgress(st).best[1]).toEqual({ stars: 1, earned: 100 });
  });
});

describe('prefs', () => {
  it('getPrefs / setPrefs keep the last level and pace', () => {
    const st = fakeStorage();
    expect(getPrefs(st)).toEqual({ lastLevel: 1, lastPace: 'normal' });
    setPrefs({ lastLevel: 3, lastPace: 'relaxed' }, st);
    expect(getPrefs(st)).toEqual({ lastLevel: 3, lastPace: 'relaxed' });
    expect(st.getItem(PREFS_KEY)).toContain('"kind":"prefs"');
  });
});

describe('exportAll / importAll / resetAll', () => {
  const shiftSnap = (seed = 3) => {
    const state = createGame({ players: [{ id: 'me', name: 'A' }], settings: { level: 2, pace: 'normal' }, seed });
    return { v: 1, savedAt: 9, mode: 'practice', level: 2, pace: 'normal', seed, state, driver: null };
  };
  const full = () => {
    const st = fakeStorage();
    saveShiftResult(1, 3, 800, st);
    saveShiftResult(2, 1, 100, st);
    markTutorialDone(st);
    setPrefs({ lastLevel: 2 }, st);
    saveShift(shiftSnap(), st);
    st.setItem(HUD_PREFS_KEY, JSON.stringify({ lang: 'te', subs: 'both', voices: true }));
    st.setItem(VOICES_KEY, '1');
    return st;
  };

  it('moves everything to another device', () => {
    const a = full();
    const text = exportAll(a);
    expect(JSON.parse(text)).toMatchObject({ kind: EXPORT_KIND, v: 1 });
    const b = fakeStorage();
    const res = importAll(text, b);
    expect(res.ok).toBe(true);
    expect(res.skipped).toEqual([]);
    expect([...res.imported].sort()).toEqual([...DATA_KEYS].sort());
    expect(getProgress(b)).toEqual(getProgress(a));
    expect(isTutorialDoneLocal(b)).toBe(true);
    expect(isTutorialPending(b)).toBe(true); // this account may not know yet: tell the server again
    expect(getPrefs(b).lastLevel).toBe(2);
    expect(b.getItem(SHIFT_KEY)).toBe(a.getItem(SHIFT_KEY));
    expect(b.getItem(VOICES_KEY)).toBe('1');
  });

  it('merges progress (best wins) and keeps an existing shift unless told to replace it', () => {
    const a = full();
    const text = exportAll(a);
    const b = fakeStorage();
    saveShiftResult(1, 1, 999, b);
    saveShiftResult(3, 2, 10, b);
    saveShift(shiftSnap(4), b);
    const mine = b.getItem(SHIFT_KEY);
    const res = importAll(text, b);
    expect(res.skipped).toContain(SHIFT_KEY);
    expect(b.getItem(SHIFT_KEY)).toBe(mine);
    const p = getProgress(b);
    expect(p.best[1]).toEqual({ stars: 3, earned: 999 });
    expect(p.best[2]).toEqual({ stars: 1, earned: 100 });
    expect(p.best[3]).toEqual({ stars: 2, earned: 10 });
    importAll(text, b, { replaceShift: true });
    expect(b.getItem(SHIFT_KEY)).toBe(a.getItem(SHIFT_KEY));
  });

  it('refuses junk, damaged, foreign and future files, and never plants unknown keys', () => {
    const text = exportAll(full());
    const env = JSON.parse(text);
    const plant = { ...env, entries: { ...env.entries, 'jalebi.auth.token': 'x', [SHIFT_KEY]: '{"v":1}' } };
    plant.sum = checksum(JSON.stringify(plant.entries));
    const b = fakeStorage();
    const r = importAll(JSON.stringify(plant), b);
    expect(r.skipped).toEqual(expect.arrayContaining(['jalebi.auth.token', SHIFT_KEY]));
    expect(b.getItem('jalebi.auth.token')).toBe(null);
    expect(b.getItem(SHIFT_KEY)).toBe(null);
    for (const bad of [null, '', '{', '[]', '{"kind":"other"}', JSON.stringify({ ...env, v: 9 }), JSON.stringify({ ...env, sum: 'deadbeef' }), 'x'.repeat(700 * 1024)]) {
      const s2 = fakeStorage();
      const out = importAll(bad, s2);
      expect(out.ok, String(bad).slice(0, 20)).toBe(false);
      expect(typeof out.error).toBe('string');
      expect(s2.getItem(PROGRESS_LOCAL_KEY)).toBe(null);
    }
  });

  it('exportAll skips damaged entries instead of exporting them', () => {
    const a = full();
    a.setItem(PROGRESS_LOCAL_KEY, '{garbage');
    a.setItem(SHIFT_KEY, 'nope');
    const env = JSON.parse(exportAll(a));
    expect(Object.keys(env.entries)).not.toContain(PROGRESS_LOCAL_KEY);
    expect(Object.keys(env.entries)).not.toContain(SHIFT_KEY);
  });

  it('resetAll wipes the device (optionally keeping prefs)', () => {
    const a = full();
    const removed = resetAll(a, { keepPrefs: true });
    expect(removed).toEqual(expect.arrayContaining([PROGRESS_LOCAL_KEY, TUTORIAL_LOCAL_KEY, SHIFT_KEY, TUTORIAL_PENDING_KEY]));
    expect(getPrefs(a).lastLevel).toBe(2);
    expect(a.getItem(VOICES_KEY)).toBe('1');
    resetAll(a);
    for (const k of [...DATA_KEYS, TUTORIAL_PENDING_KEY]) expect(a.getItem(k), k).toBe(null);
    expect(getProgress(a)).toEqual({ best: {}, unlocked: 1 });
  });

  it('none of them throws on blocked storage', () => {
    expect(() => exportAll(boom)).not.toThrow();
    expect(importAll(exportAll(full()), boom).imported).toEqual([]);
    expect(() => resetAll(boom)).not.toThrow();
    expect(JSON.parse(exportAll(boom)).entries).toEqual({});
  });
});

describe('the tutorial report never rejects', () => {
  it('reportTutorialDone and syncPendingTutorial resolve false for every failure shape', async () => {
    const st = fakeStorage();
    markTutorialDone(st);
    for (const post of [() => { throw new Error('sync'); }, () => Promise.reject(new Error('net')), () => Promise.reject(undefined), () => Promise.reject(null)]) {
      await expect(reportTutorialDone({ storage: st, post })).resolves.toBe(false);
      await expect(syncPendingTutorial({ storage: st, post })).resolves.toBe(false);
      expect(isTutorialPending(st)).toBe(true);
    }
    await expect(syncPendingTutorial({ storage: boom, post: async () => ({}) })).resolves.toBe(false);
    await expect(reportTutorialDone({ storage: boom, post: async () => ({}) })).resolves.toBe(true); // the server was told; only the flag could not be cleared
  });
});
