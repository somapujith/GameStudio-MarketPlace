import { describe, it, expect, beforeEach, vi } from 'vitest';

function stubLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
  return m;
}

let S;
let mem;
beforeEach(async () => {
  vi.resetModules();
  mem = stubLocalStorage();
  S = await import('./storage.js');
});

describe('sound settings: master volume, effects fader, ambient bed', () => {
  it('defaults: effects at unity, ambient off', () => {
    expect(S.loadSettings()).toMatchObject({ sfx: true, volume: 0.8, sfxVolume: 1, ambient: false });
  });

  it('clamps the fader and keeps the others when patching', () => {
    expect(S.saveSettings({ sfxVolume: 7 }).sfxVolume).toBe(1);
    expect(S.saveSettings({ sfxVolume: -3 }).sfxVolume).toBe(0);
    expect(S.saveSettings({ sfxVolume: 'loud' }).sfxVolume).toBe(1); // junk falls back to the default
    expect(S.saveSettings({ sfxVolume: 0.4, ambient: true })).toMatchObject({ sfxVolume: 0.4, ambient: true, volume: 0.8, sfx: true });
    expect(S.saveSettings({ ambient: 0 }).ambient).toBe(false);
  });

  it('an older save without the new keys loads with the defaults', async () => {
    vi.resetModules();
    mem.set('hyd.settings.v1', JSON.stringify({ sfx: false, volume: 0.3 }));
    const O = await import('./storage.js');
    expect(O.loadSettings()).toMatchObject({ sfx: false, volume: 0.3, sfxVolume: 1, ambient: false });
  });

  it('notifies subscribers (the sound system follows the settings live)', () => {
    const cb = vi.fn();
    S.subscribeSettings(cb);
    S.saveSettings({ ambient: true });
    expect(cb).toHaveBeenCalled();
  });
});
