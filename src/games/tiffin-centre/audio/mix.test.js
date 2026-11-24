import { describe, expect, it } from 'vitest';
import {
  CONTINUOUS_LAYERS, LAYER_FLOOR, LAYER_TABLE, SPORADIC, SPORADIC_LAYERS, busyOfState, daypartWeights, hourOfState, layerLevels, nextDelayMs, wrapHour,
} from './mix.js';
import { LEVELS } from '@shared/tiffin-centre/catalog.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

describe('daypartWeights', () => {
  it('always sums to 1 with at most two dayparts active', () => {
    for (let h = 0; h <= 30; h += 0.25) {
      const w = daypartWeights(h);
      expect(sum(w)).toBeCloseTo(1, 9);
      expect(Object.values(w).filter((v) => v > 0).length, `hour ${h}`).toBeLessThanOrEqual(2);
    }
  });
  it('is dominated by the right daypart at its anchor and wraps past midnight', () => {
    expect(daypartWeights(5.5).dawn).toBe(1);
    expect(daypartWeights(9).morning).toBe(1);
    expect(daypartWeights(13.5).noon).toBe(1);
    expect(daypartWeights(17.75).evening).toBe(1);
    expect(daypartWeights(22.5).night).toBe(1);
    expect(daypartWeights(26)).toEqual(daypartWeights(2));
    expect(daypartWeights(29.5).dawn).toBeCloseTo(1, 9); // 5:30 am next day
    expect(wrapHour(-1)).toBe(23);
    expect(wrapHour(NaN)).toBe(0);
  });
  it('crossfades smoothly: tiny steps in the hour never jump the weights', () => {
    let prev = daypartWeights(0);
    for (let h = 0.01; h <= 24; h += 0.01) {
      const w = daypartWeights(h);
      for (const k of Object.keys(w)) expect(Math.abs(w[k] - prev[k]), `hour ${h} ${k}`).toBeLessThan(0.05);
      prev = w;
    }
  });
});

describe('layerLevels', () => {
  it('describes each daypart', () => {
    const dawn = layerLevels(5.5);
    expect(dawn.birds).toBe(1);
    expect(dawn.temple).toBeGreaterThan(0.5);
    const morning = layerLevels(9);
    expect(morning.traffic).toBeGreaterThan(0.5);
    expect(morning.cooker).toBeGreaterThan(0.5);
    const noon = layerLevels(13.5);
    expect(noon.cicadas).toBeGreaterThan(0.6);
    expect(noon.heat).toBeGreaterThan(0.6);
    const evening = layerLevels(17.75);
    expect(evening.crowd).toBeGreaterThan(0.6);
    expect(evening.autos).toBeGreaterThan(0.6);
    expect(evening.hawkers).toBeGreaterThan(0.5);
    expect(evening.tabla).toBeGreaterThan(0.6);
    expect(evening.dogs).toBeGreaterThan(0.2); // a dog at dusk
    const night = layerLevels(22.5);
    expect(night.crickets).toBeGreaterThan(0.6);
    expect(night.radio).toBeGreaterThan(0.3);
    expect(night.dogs).toBeGreaterThan(0.5);
    expect(night.tabla).toBeLessThan(0.3);
    expect(night.cicadas).toBe(0);
  });
  it('keeps every level in 0..1 and defines every layer for every daypart', () => {
    for (const [layer, row] of Object.entries(LAYER_TABLE)) expect(Object.keys(row).sort(), layer).toEqual(['dawn', 'evening', 'morning', 'night', 'noon']);
    for (let h = 0; h < 30; h += 0.5) for (const [k, v] of Object.entries(layerLevels(h, 1))) expect(v >= 0 && v <= 1, `${k}@${h}`).toBe(true);
    for (const id of [...CONTINUOUS_LAYERS, ...SPORADIC_LAYERS, 'tabla']) expect(LAYER_TABLE[id], id).toBeDefined();
    for (const id of SPORADIC_LAYERS) expect(SPORADIC[id], id).toBeDefined();
  });
  it('fades one layer in while another fades out (monotonic across a daypart boundary)', () => {
    let prevHeat = -1;
    let prevTraffic = 2;
    for (let h = 9; h <= 13.5; h += 0.25) {
      const l = layerLevels(h, 0.5);
      expect(l.heat).toBeGreaterThanOrEqual(prevHeat - 1e-9);
      expect(l.traffic).toBeLessThanOrEqual(prevTraffic + 1e-9);
      prevHeat = l.heat;
      prevTraffic = l.traffic;
    }
  });
  it('a busier counter sounds busier, but only the people layers change', () => {
    const empty = layerLevels(17.75, 0);
    const full = layerLevels(17.75, 1);
    expect(full.crowd).toBeGreaterThan(empty.crowd);
    expect(full.hawkers).toBeGreaterThan(empty.hawkers);
    expect(full.tabla).toBe(empty.tabla);
    expect(full.crickets).toBe(empty.crickets);
  });
});

describe('nextDelayMs', () => {
  it('is infinite when the layer is off and grows as the level drops', () => {
    expect(nextDelayMs(SPORADIC.birds, 0, 0.5)).toBe(Infinity);
    expect(nextDelayMs(SPORADIC.birds, LAYER_FLOOR / 2, 0.5)).toBe(Infinity);
    expect(nextDelayMs(SPORADIC.birds, 1, 0)).toBe(1400);
    expect(nextDelayMs(SPORADIC.birds, 1, 1)).toBe(4500);
    expect(nextDelayMs(SPORADIC.birds, 0.5, 0.5)).toBeGreaterThan(nextDelayMs(SPORADIC.birds, 1, 0.5));
    expect(nextDelayMs(undefined, 1)).toBe(Infinity);
  });
});

describe('state helpers', () => {
  it('hourOfState follows the level hours across the shift', () => {
    const base = { cfg: { hour: [6, 9] }, shiftTicks: 100 };
    expect(hourOfState({ ...base, tick: 0 })).toBe(6);
    expect(hourOfState({ ...base, tick: 50 })).toBe(7.5);
    expect(hourOfState({ ...base, tick: 999 })).toBe(9);
    expect(hourOfState({ cfg: { hour: LEVELS[10].hour }, shiftTicks: LEVELS[10].shiftTicks, tick: LEVELS[10].shiftTicks / 2 })).toBe(21);
    expect(hourOfState(null)).toBe(9);
    expect(hourOfState({})).toBe(9);
  });
  it('busyOfState counts customers still at the stall', () => {
    const s = { cfg: { spots: 4 }, customers: [{ st: 'waiting' }, { st: 'paying' }, { st: 'left' }] };
    expect(busyOfState(s)).toBe(0.5);
    expect(busyOfState({ cfg: { spots: 1 }, customers: [{ st: 'waiting' }, { st: 'waiting' }] })).toBe(1);
    expect(busyOfState(null)).toBe(0.5);
  });
});
