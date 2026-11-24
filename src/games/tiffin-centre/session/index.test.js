import { describe, expect, it } from 'vitest';

describe('session index', () => {
  it('loads and exports the whole public surface', async () => {
    const m = await import('./index.js');
    for (const name of [
      'createLocalSession', 'useRoomSession', 'useSession', 'getProgress', 'saveShiftResult', 'unlockedLevel', 'isTutorialDoneLocal', 'markTutorialDone',
      'createRoomSessionCore', 'loadSavedShift', 'hasSavedShift', 'clearSavedShift', 'describeSavedShift', 'saveShift', 'loadShift', 'clearShift',
      'exportAll', 'importAll', 'resetAll', 'getPrefs', 'setPrefs', 'createRoomCache',
    ]) {
      expect(typeof m[name], name).toBe('function');
    }
  });

  it('the menu helpers work against an injected storage and the real engine version', async () => {
    const m = await import('./index.js');
    const { createGame } = await import('@shared/tiffin-centre/index.js');
    const mem = new Map();
    const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
    expect(m.hasSavedShift(st)).toBe(false);
    expect(m.loadSavedShift(st)).toBe(null);
    const state = { ...createGame({ players: [{ id: 'me', name: 'A' }], settings: { level: 4, pace: 'rush' }, seed: 1 }), tick: 33, money: 120 };
    expect(m.saveShift({ v: 1, savedAt: 77, mode: 'practice', level: 4, pace: 'rush', seed: 1, state, driver: null }, st).ok).toBe(true);
    expect(m.hasSavedShift(st)).toBe(true);
    expect(m.describeSavedShift(m.loadSavedShift(st))).toEqual({
      title: 'Breakfast Rush', level: 4, pace: 'rush', mode: 'practice', tick: 33, shiftTicks: state.shiftTicks, money: 120, savedAt: 77,
    });
    m.clearSavedShift(st);
    expect(m.hasSavedShift(st)).toBe(false);
  });
});
