// The player's rules under a fake <audio>: settings, autoplay, restart vs stack, the concurrency cap, one warning on failure.
import { describe, expect, it, vi } from 'vitest';
import { createVoicePlayer, voiceAudible, voiceVolumeOf } from './voicePlayer.js';
import { voiceItem } from './voiceModel.js';

const SHERU = voiceItem('voice-sheru-bhai');
const MEOW = voiceItem('voice-ladle-meow');
const CAT = { ...MEOW, id: 'voice-extra-a', src: '/audio/voice/extra-a.mp3' };
const DOG = { ...MEOW, id: 'voice-extra-b', src: '/audio/voice/extra-b.mp3' };

function fakeEnv(over = {}) {
  const els = [];
  const timers = [];
  const settings = { sfx: true, volume: 0.8, voiceLines: true, voiceVolume: 1, ...(over.settings || {}) };
  const env = {
    createAudio: (url) => {
      const handlers = {};
      const el = {
        url, volume: 1, muted: false, currentTime: 5, plays: 0, pauses: 0,
        play: vi.fn(() => { el.plays += 1; return over.reject ? Promise.reject(over.reject) : Promise.resolve(); }),
        pause: vi.fn(() => { el.pauses += 1; }),
        addEventListener: (t, f) => { handlers[t] = f; },
        fire: (t) => handlers[t] && handlers[t](),
      };
      els.push(el);
      return el;
    },
    getSettings: () => settings,
    canStart: () => (over.canStart === undefined ? true : over.canStart),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    warn: over.warn || vi.fn(),
  };
  return { env, els, settings, timers };
}

describe('settings', () => {
  it('master volume x voice slider, and the three ways to be silent', () => {
    expect(voiceVolumeOf({ volume: 0.8, voiceVolume: 0.5 })).toBeCloseTo(0.4);
    expect(voiceVolumeOf({})).toBeCloseTo(0.8);
    expect(voiceAudible({ voiceLines: false })).toBe(false);
    expect(voiceAudible({ sfx: false })).toBe(false);
    expect(voiceAudible({ volume: 0 })).toBe(false);
    expect(voiceAudible({})).toBe(true);
    expect(voiceAudible({ voiceLines: false }, true)).toBe(true); // an explicit preview ignores the toggle
  });
});

describe('createVoicePlayer', () => {
  it('plays a clip at the master x voice volume, from the start', () => {
    const { env, els } = fakeEnv({ settings: { volume: 0.5, voiceVolume: 0.5 } });
    const p = createVoicePlayer(env);
    expect(p.play(SHERU, { from: 'rav' })).toBe('played');
    expect(els).toHaveLength(1);
    expect(els[0].url).toBe('/audio/voice/sheru-bhai.mp3');
    expect(els[0].volume).toBeCloseTo(0.25);
    expect(els[0].currentTime).toBe(0);
    expect(p.isPlaying(SHERU.id)).toBe(true);
  });
  it('is silent (no element created, no fetch) when muted, switched off or before a gesture', () => {
    for (const [settings, canStart, want] of [[{ voiceLines: false }, true, 'muted'], [{ sfx: false }, true, 'muted'], [{ volume: 0 }, true, 'muted'], [{}, false, 'locked']]) {
      const { env, els } = fakeEnv({ settings, canStart });
      expect(createVoicePlayer(env).play(SHERU)).toBe(want);
      expect(els).toHaveLength(0);
    }
  });
  it('rejects anything that is not a same-origin voice clip', () => {
    const { env, els } = fakeEnv();
    const p = createVoicePlayer(env);
    expect(p.play({ id: 'x', src: 'https://evil.example/a.mp3' })).toBe('invalid');
    expect(p.play(null)).toBe('invalid');
    expect(els).toHaveLength(0);
  });
  it('restarts the same line instead of stacking it', () => {
    const { env, els } = fakeEnv();
    const p = createVoicePlayer(env);
    expect(p.play(SHERU)).toBe('played');
    els[0].currentTime = 4;
    expect(p.play(SHERU)).toBe('restarted');
    expect(els).toHaveLength(1);
    expect(els[0].currentTime).toBe(0);
    expect(els[0].plays).toBe(2);
    expect(p.activeCount()).toBe(1);
  });
  it('lets different lines overlap up to the cap and drops the rest', () => {
    const { env } = fakeEnv();
    const p = createVoicePlayer(env);
    expect(p.play(SHERU)).toBe('played');
    expect(p.play(MEOW)).toBe('played');
    expect(p.play(CAT)).toBe('played');
    expect(p.activeCount()).toBe(3);
    expect(p.play(DOG)).toBe('dropped');
    expect(p.activeCount()).toBe(3);
    p.stop(MEOW.id);
    expect(p.play(DOG)).toBe('played');
  });
  it('frees the slot when the clip ends or its safety timer fires', () => {
    const { env, els, timers } = fakeEnv();
    const p = createVoicePlayer(env);
    p.play(SHERU);
    els[0].fire('ended');
    expect(p.isPlaying(SHERU.id)).toBe(false);
    p.play(SHERU);
    expect(timers.at(-1).ms).toBeGreaterThan(8300);
    timers.at(-1).fn();
    expect(p.isPlaying(SHERU.id)).toBe(false);
  });
  it('a load failure is silent and warns once', () => {
    const warn = vi.fn();
    const { env, els } = fakeEnv({ warn });
    const p = createVoicePlayer(env);
    p.play(SHERU);
    els[0].fire('error');
    p.play(MEOW);
    els[1].fire('error');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(p.activeCount()).toBe(0);
  });
  it('an autoplay refusal (NotAllowedError) does not warn and frees the slot', async () => {
    const warn = vi.fn();
    const { env } = fakeEnv({ warn, reject: Object.assign(new Error('no'), { name: 'NotAllowedError' }) });
    const p = createVoicePlayer(env);
    p.play(SHERU);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    expect(p.isPlaying(SHERU.id)).toBe(false);
  });
  it('another play() failure warns exactly once', async () => {
    const warn = vi.fn();
    const { env } = fakeEnv({ warn, reject: Object.assign(new Error('404'), { name: 'NotSupportedError' }) });
    const p = createVoicePlayer(env);
    p.play(SHERU);
    p.play(MEOW);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('stopAll silences everything', () => {
    const { env } = fakeEnv();
    const p = createVoicePlayer(env);
    p.play(SHERU);
    p.play(MEOW);
    p.stopAll();
    expect(p.activeCount()).toBe(0);
  });
  it('prime warms an element with a muted play that is paused again', async () => {
    const f = fakeEnv();
    const r = createVoicePlayer(f.env);
    r.prime([SHERU, MEOW]);
    expect(f.els).toHaveLength(2);
    expect(f.els[0].muted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.els[0].pauses).toBeGreaterThan(0);
    expect(f.els[0].muted).toBe(false);
  });
  it('the preview (force) plays even with "Voice lines" off', () => {
    const { env } = fakeEnv({ settings: { voiceLines: false } });
    const p = createVoicePlayer(env);
    expect(p.play(SHERU)).toBe('muted');
    expect(p.play(SHERU, { force: true })).toBe('played');
  });
});
