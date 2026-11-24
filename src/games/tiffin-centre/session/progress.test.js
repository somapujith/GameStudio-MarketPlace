import { describe, expect, it, vi } from 'vitest';
import { PROGRESS_LOCAL_KEY, TUTORIAL_LOCAL_KEY } from '@shared/tiffin-centre/catalog.js';
import {
  TUTORIAL_COMPLETE_PATH, TUTORIAL_PENDING_KEY, clearTutorialPending, getProgress, isTutorialDoneLocal, isTutorialPending,
  markTutorialDone, normalizeProgress, reportTutorialDone, saveShiftResult, syncPendingTutorial, unlockedLevel,
} from './progress.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe('progress', () => {
  it('starts empty with level 1 open', () => {
    const p = getProgress(fakeStorage());
    expect(p).toEqual({ best: {}, unlocked: 1 });
    expect(unlockedLevel(p)).toBe(1);
  });

  it('keeps the best stars and earnings per level and unlocks the next level after one star', () => {
    const st = fakeStorage();
    let p = saveShiftResult(1, 0, 90, st);
    expect(p.unlocked).toBe(1);
    expect(p.improved).toBe(false);
    p = saveShiftResult(1, 2, 400, st);
    expect(p.best[1]).toEqual({ stars: 2, earned: 400 });
    expect(p.unlocked).toBe(2);
    expect(p.unlockedNow).toBe(2);
    expect(p.improved).toBe(true);
    p = saveShiftResult(1, 1, 500, st);
    expect(p.best[1]).toEqual({ stars: 2, earned: 500 }); // stars never go down, earnings are the best seen
    expect(p.improved).toBe(false);
    expect(p.unlockedNow).toBe(null);
    expect(getProgress(st).unlocked).toBe(2);
  });

  it('unlocks in order: a star on level 3 without level 2 does not skip ahead', () => {
    const st = fakeStorage();
    saveShiftResult(3, 3, 900, st);
    expect(getProgress(st).unlocked).toBe(1);
    saveShiftResult(1, 1, 100, st);
    saveShiftResult(2, 1, 100, st);
    expect(getProgress(st).unlocked).toBe(4);
  });

  it('caps at the last level and ignores the tutorial and nonsense levels', () => {
    const st = fakeStorage();
    for (let n = 1; n <= 12; n++) saveShiftResult(n, 1, 1, st);
    expect(getProgress(st).unlocked).toBe(12);
    const before = st.dump();
    saveShiftResult(0, 3, 100, st);
    saveShiftResult(13, 3, 100, st);
    saveShiftResult('x', 3, 100, st);
    expect(st.dump()).toEqual(before);
  });

  it('clamps stars and earnings', () => {
    const st = fakeStorage();
    const p = saveShiftResult(1, 9, -5, st);
    expect(p.best[1]).toEqual({ stars: 3, earned: 0 });
  });

  it('survives corrupt storage', () => {
    for (const bad of ['{not json', 'null', '[]', '"x"', '{"best":5}', '{"best":{"1":"x","99":{"stars":3},"2":{"stars":"2","earned":"7"}}}']) {
      const p = getProgress(fakeStorage({ [PROGRESS_LOCAL_KEY]: bad }));
      expect(p.unlocked).toBeGreaterThanOrEqual(1);
      expect(p.unlocked).toBeLessThanOrEqual(12);
      expect(Object.keys(p.best).every((k) => k >= 1 && k <= 12)).toBe(true);
    }
    expect(getProgress(fakeStorage({ [PROGRESS_LOCAL_KEY]: '{"best":{"2":{"stars":"2","earned":"7"}}}' })).best[2]).toEqual({ stars: 2, earned: 7 });
    expect(normalizeProgress(undefined)).toEqual({ best: {}, unlocked: 1 });
  });

  it('does not throw when the storage does', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
    expect(getProgress(boom)).toEqual({ best: {}, unlocked: 1 });
    expect(() => saveShiftResult(1, 1, 1, boom)).not.toThrow();
    expect(isTutorialDoneLocal(boom)).toBe(false);
    expect(() => markTutorialDone(boom)).not.toThrow();
    expect(() => clearTutorialPending(boom)).not.toThrow();
  });
});

describe('tutorial flag', () => {
  it('markTutorialDone sets the local flag and the pending flag', () => {
    const st = fakeStorage();
    expect(isTutorialDoneLocal(st)).toBe(false);
    markTutorialDone(st);
    expect(st.getItem(TUTORIAL_LOCAL_KEY)).toBe('1');
    expect(isTutorialDoneLocal(st)).toBe(true);
    expect(isTutorialPending(st)).toBe(true);
  });

  it('reportTutorialDone posts to the tutorial route and clears the pending flag', async () => {
    const st = fakeStorage();
    markTutorialDone(st);
    const post = vi.fn().mockResolvedValue({ ok: true });
    expect(await reportTutorialDone({ storage: st, post })).toBe(true);
    expect(post).toHaveBeenCalledWith(TUTORIAL_COMPLETE_PATH);
    expect(TUTORIAL_COMPLETE_PATH).toBe('/api/games/tiffin-centre/tutorial/complete');
    expect(isTutorialPending(st)).toBe(false);
    expect(isTutorialDoneLocal(st)).toBe(true);
  });

  it('a failed post is ignored and retried on the next start', async () => {
    const st = fakeStorage();
    markTutorialDone(st);
    const post = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ ok: true });
    expect(await reportTutorialDone({ storage: st, post })).toBe(false);
    expect(isTutorialPending(st)).toBe(true);
    expect(await syncPendingTutorial({ storage: st, post })).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    expect(isTutorialPending(st)).toBe(false);
    expect(await syncPendingTutorial({ storage: st, post })).toBe(false); // nothing pending any more
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('syncPendingTutorial does nothing without a local flag', async () => {
    const post = vi.fn();
    expect(await syncPendingTutorial({ storage: fakeStorage({ [TUTORIAL_PENDING_KEY]: '1' }), post })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
