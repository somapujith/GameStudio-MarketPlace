import { describe, it, expect } from 'vitest';
import {
  moveSel, stepSlider, sliderFromPointer, cycleQuality, qualityLabel, normalizeAudio, masterGain, padEdges, backPath, ROOT_ITEMS,
} from './menuNav.js';

describe('moveSel', () => {
  it('wraps both ways and survives bad input', () => {
    expect(moveSel(0, 5, 1)).toBe(1);
    expect(moveSel(4, 5, 1)).toBe(0);
    expect(moveSel(0, 5, -1)).toBe(4);
    expect(moveSel(2, 0, 1)).toBe(0);
    expect(moveSel(undefined, 3, 1)).toBe(1);
  });
});

describe('sliders', () => {
  it('steps, clamps and avoids float drift', () => {
    expect(stepSlider(0.5, 1)).toBe(0.6);
    expect(stepSlider(0.95, 1)).toBe(1);
    expect(stepSlider(0.05, -1)).toBe(0);
    let v = 0;
    for (let i = 0; i < 10; i++) v = stepSlider(v, 1);
    expect(v).toBe(1);
    expect(stepSlider(NaN, 1)).toBe(0.1);
  });
  it('maps a pointer onto the track in notches', () => {
    const rect = { left: 100, width: 200 };
    expect(sliderFromPointer(100, rect)).toBe(0);
    expect(sliderFromPointer(300, rect)).toBe(1);
    expect(sliderFromPointer(200, rect)).toBe(0.5);
    expect(sliderFromPointer(-50, rect)).toBe(0);
    expect(sliderFromPointer(999, rect)).toBe(1);
    expect(sliderFromPointer(NaN, rect)).toBe(0);
    expect(sliderFromPointer(150, null)).toBe(0);
  });
});

describe('quality', () => {
  it('cycles Auto -> Low -> Medium -> High and back', () => {
    expect(cycleQuality(null, 1)).toBe('low');
    expect(cycleQuality('low', 1)).toBe('medium');
    expect(cycleQuality('high', 1)).toBeNull();
    expect(cycleQuality(null, -1)).toBe('high');
    expect(cycleQuality('weird', 1)).toBe('low');
    expect(cycleQuality(undefined, 1)).toBe('low');
    expect(qualityLabel(null)).toBe('Auto');
    expect(qualityLabel('medium')).toBe('Medium');
  });
});

describe('audio settings', () => {
  it('normalises junk to 0..1 levels with full volume defaults', () => {
    expect(normalizeAudio(undefined)).toEqual({ master: 1, fx: 1, voice: 1, music: 1 });
    expect(normalizeAudio({ master: 0.456, fx: 7, voice: -2, music: 'x' })).toEqual({ master: 0.46, fx: 1, voice: 0, music: 1 });
    expect(normalizeAudio({ master: null }).master).toBe(1);
    expect(normalizeAudio('nope').fx).toBe(1);
  });
  it('master gain follows the mute switch', () => {
    expect(masterGain(1, false)).toBeCloseTo(0.8, 10);
    expect(masterGain(0.5, false)).toBeCloseTo(0.4, 10);
    expect(masterGain(1, true)).toBe(0);
    expect(masterGain(5, false)).toBeCloseTo(0.8, 10);
    expect(masterGain(NaN, false)).toBe(0);
  });
});

describe('padEdges', () => {
  const pad = (pressed = [], axes = [0, 0]) => ({ axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });
  it('fires once per press (edge) and again after release', () => {
    let r = padEdges(null, pad([13]));
    expect(r.down).toBe(true);
    r = padEdges(r.held, pad([13]));
    expect(r.down).toBe(false);
    r = padEdges(r.held, pad([]));
    r = padEdges(r.held, pad([13]));
    expect(r.down).toBe(true);
  });
  it('reads the d-pad, the left stick and the face buttons', () => {
    expect(padEdges(null, pad([12])).up).toBe(true);
    expect(padEdges(null, pad([], [0, -0.9])).up).toBe(true);
    expect(padEdges(null, pad([], [0.9, 0])).right).toBe(true);
    expect(padEdges(null, pad([], [0.3, 0.3])).down).toBe(false);
    expect(padEdges(null, pad([0])).select).toBe(true);
    expect(padEdges(null, pad([1])).back).toBe(true);
    expect(padEdges(null, pad([9])).start).toBe(true);
    expect(padEdges(null, null).up).toBe(false);
  });
});

describe('menu structure', () => {
  it('backPath steps up one level', () => {
    expect(backPath(['options', 'audio'])).toEqual(['options']);
    expect(backPath(['options'])).toEqual([]);
    expect(backPath([])).toEqual([]);
    expect(backPath(null)).toEqual([]);
  });
  it('the root list has the Vice City-style entries', () => {
    expect(ROOT_ITEMS.map((i) => i.id)).toEqual(['resume', 'brief', 'map', 'stats', 'options', 'clockout', 'quit']);
    for (const i of ROOT_ITEMS) expect(i.te).toMatch(/\S/);
  });
});
