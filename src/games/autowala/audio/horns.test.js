import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HORNS } from '../gameplay/catalog.js';
import { HORN_DEFS, getHornDef, hornDuration, hornFrequencies, midiToHz, noteEnd, resolveHornId } from './horn-data.js';

const KINDS = ['tone', 'bell', 'pluck', 'thump', 'noise'];

describe('horn note tables', () => {
  it('every catalogue horn has a definition (and nothing extra)', () => {
    for (const h of HORNS) expect(HORN_DEFS[h.id], h.id).toBeTruthy();
    expect(Object.keys(HORN_DEFS).sort()).toEqual(HORNS.map((h) => h.id).sort());
  });
  it('unknown ids fall back to stock without throwing', () => {
    for (const bad of ['nope', '', null, undefined, 42, {}, '__proto__', 'constructor', 'toString']) {
      expect(getHornDef(bad)).toBe(HORN_DEFS.stock);
      expect(resolveHornId(bad)).toBe('stock');
    }
  });
  it('durations are 0.3 - 1.5 s', () => {
    for (const [id, def] of Object.entries(HORN_DEFS)) {
      const d = hornDuration(def);
      expect(d, id).toBeGreaterThanOrEqual(0.3);
      expect(d, id).toBeLessThanOrEqual(1.5);
    }
  });
  it('frequencies are audible and gains sane', () => {
    for (const [id, def] of Object.entries(HORN_DEFS)) {
      expect(def.gain, id).toBeGreaterThan(0);
      expect(def.gain, id).toBeLessThanOrEqual(1);
      for (const f of hornFrequencies(def)) {
        expect(f, id).toBeGreaterThanOrEqual(35);
        expect(f, id).toBeLessThanOrEqual(14000);
      }
      for (const l of def.layers) {
        expect(KINDS, id).toContain(l.kind);
        expect(l.notes.length, id).toBeGreaterThan(0);
        for (const n of l.notes) {
          expect(n.t, id).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(noteEnd(l, n)), id).toBe(true);
          if (n.g != null) {
            expect(n.g, id).toBeGreaterThan(0);
            expect(n.g, id).toBeLessThanOrEqual(1);
          }
          if (l.kind === 'tone') expect(n.d, id).toBeGreaterThan(0);
          if (['bell', 'pluck', 'thump'].includes(l.kind)) expect(n.decay, id).toBeGreaterThan(0);
        }
      }
    }
  });
  it('every horn is distinct', () => {
    const sig = Object.values(HORN_DEFS).map((d) => JSON.stringify(d.layers));
    expect(new Set(sig).size).toBe(sig.length);
  });
  it('midi maths', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880, 5);
  });
});

// ---- synthesis against a recording fake of the Web Audio API (no real audio device needed)
const log = { exp: [], starts: 0, stops: 0, nodes: 0, bad: [] };
const param = () => {
  const p = {
    value: 0,
    setValueAtTime(v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) log.bad.push(['set', v, t]); },
    linearRampToValueAtTime(v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) log.bad.push(['lin', v, t]); },
    exponentialRampToValueAtTime(v, t) { log.exp.push(v); if (!(v > 0) || !Number.isFinite(t)) log.bad.push(['exp', v, t]); },
    setTargetAtTime(v, t, c) { if (!Number.isFinite(v) || !Number.isFinite(t) || !(c > 0)) log.bad.push(['target', v, t, c]); },
    cancelScheduledValues() {},
  };
  return p;
};
const node = () => {
  log.nodes++;
  return {
    connect: () => {}, disconnect: () => {},
    start() { log.starts++; }, stop() { log.stops++; },
    frequency: param(), gain: param(), Q: param(), detune: param(), pan: param(),
  };
};
class FakeAC {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.state = 'running';
    this.destination = {};
  }
  createGain() { return node(); }
  createOscillator() { return node(); }
  createBiquadFilter() { return node(); }
  createDynamicsCompressor() { return node(); }
  createWaveShaper() { return node(); }
  createStereoPanner() { return node(); }
  createBufferSource() { return node(); }
  createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
}

describe('playHorn (fake Web Audio)', () => {
  let horns;
  beforeAll(async () => {
    globalThis.window = { AudioContext: FakeAC };
    horns = await import('./horns.js');
  });
  afterAll(() => {
    horns?.stopHorn();
    delete globalThis.window;
  });

  it('plays every catalogue horn id, schedules sound, never uses a bad value', () => {
    let t = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 500));
    for (const h of HORNS) {
      log.starts = 0;
      log.bad.length = 0;
      expect(horns.playHorn(h.id), h.id).toBe(true);
      expect(log.starts, h.id).toBeGreaterThan(0);
      expect(log.bad, h.id).toEqual([]);
    }
    expect(log.exp.every((v) => v > 0)).toBe(true);
    spy.mockRestore();
  });
  it('unknown ids play the stock horn, junk options are tolerated', () => {
    let t = 50000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 500));
    expect(horns.playHorn('nope')).toBe(true);
    expect(horns.playHorn(undefined, { volume: 'x', pitch: NaN, pan: 9 })).toBe(true);
    expect(horns.playHorn('stock', { volume: 0 })).toBe(false);
    spy.mockRestore();
  });
  it('swallows a double trigger inside the cooldown', () => {
    let t = 90000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t);
    expect(horns.playHorn('cycle')).toBe(true);
    t += 20;
    expect(horns.playHorn('cycle')).toBe(false);
    t += 80;
    expect(horns.playHorn('cycle')).toBe(true);
    spy.mockRestore();
  });
  it('caps polyphony and stopHorn cuts everything', () => {
    let t = 200000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 200));
    for (let i = 0; i < 10; i++) horns.playHorn('airhorn');
    expect(horns.activeHornCount()).toBeLessThanOrEqual(horns.MAX_POLYPHONY);
    horns.stopHorn();
    expect(horns.activeHornCount()).toBe(0);
    spy.mockRestore();
  });
});

describe('playHorn without audio', () => {
  it('returns false quietly', async () => {
    vi.resetModules();
    delete globalThis.window;
    const horns = await import('./horns.js');
    expect(horns.playHorn('stock')).toBe(false);
    expect(() => horns.stopHorn()).not.toThrow();
  });
});
