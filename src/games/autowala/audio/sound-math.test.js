import { describe, expect, it } from 'vitest';
import {
  GEAR_KMH, RPM_IDLE, RPM_MAX, STATIONS, STATION_SCALES, ambienceMix, crashParams, engineMix, engineRpm, gearAt, genStep, landParams,
  liftOff, midiHz, newSlot, pulseHz, radioDuck, scaleSemis, skidAmount, stepSeconds, surfaceMix, swingDelay, trackTitle,
} from './sound-math.js';

describe('engine', () => {
  it('idles at idle revs and rises with speed inside a gear', () => {
    expect(engineRpm(0, 0)).toBe(RPM_IDLE);
    expect(engineRpm(10, 0)).toBeGreaterThan(engineRpm(4, 0));
    expect(engineRpm(22, 0)).toBeGreaterThan(engineRpm(15, 0));
  });
  it('drops the revs when it shifts up', () => {
    const before = engineRpm(GEAR_KMH[1] - 0.2, 0.6);
    const after = engineRpm(GEAR_KMH[1] + 0.2, 0.6);
    expect(after).toBeLessThan(before - 400);
    expect(gearAt(5)).toBe(0);
    expect(gearAt(20)).toBe(1);
    expect(gearAt(200)).toBe(3);
  });
  it('is bounded and responds to throttle, boost and air', () => {
    for (const k of [0, 3, 13, 27, 44, 90, 160]) {
      for (const t of [0, 0.5, 1]) {
        const r = engineRpm(k, t, true, false);
        expect(r).toBeGreaterThanOrEqual(RPM_IDLE);
        expect(r).toBeLessThanOrEqual(RPM_MAX + 450);
      }
    }
    expect(engineRpm(8, 1)).toBeGreaterThan(engineRpm(8, 0));
    expect(engineRpm(30, 0, true)).toBeGreaterThan(engineRpm(30, 0, false));
    expect(engineRpm(0, 1, false, true)).toBeGreaterThan(engineRpm(0, 1, false, false));
    expect(engineRpm(NaN, undefined)).toBe(RPM_IDLE);
  });
  it('pulse rate is a putter at idle and a buzz at speed', () => {
    expect(pulseHz(RPM_IDLE)).toBeGreaterThan(6);
    expect(pulseHz(RPM_IDLE)).toBeLessThan(10);
    expect(pulseHz(RPM_MAX)).toBeLessThan(45);
  });
  it('is silent in a menu and with an empty tank, and whines only while boosting', () => {
    const o = {};
    expect(engineMix({ kmh: 20, throttle: 1, hold: true }, o).gain).toBe(0);
    expect(engineMix({ kmh: 20, throttle: 1, fuel: 0 }, o).gain).toBe(0);
    expect(engineMix({ kmh: 20, throttle: 1, fuel: 4 }, o).gain).toBeGreaterThan(0.1);
    expect(engineMix({ kmh: 60, throttle: 1, boosting: true, fuel: 4 }, o).whineGain).toBeGreaterThan(0);
    expect(engineMix({ kmh: 60, throttle: 1, boosting: false, fuel: 4 }, o).whineGain).toBe(0);
    const idle = engineMix({ kmh: 0, throttle: 0, fuel: 4 }, {});
    const full = engineMix({ kmh: 50, throttle: 1, fuel: 4 }, {});
    expect(full.gain).toBeGreaterThan(idle.gain);
    expect(full.lp).toBeGreaterThan(idle.lp);
  });
  it('crackles when the pedal is lifted at speed only', () => {
    expect(liftOff(1, 0, 30)).toBe(true);
    expect(liftOff(1, 0, 5)).toBe(false);
    expect(liftOff(0.2, 0, 30)).toBe(false);
    expect(liftOff(1, 0.8, 30)).toBe(false);
  });
});

describe('tyres and impacts', () => {
  const base = { drifting: false, side: 0, speed: 15, braking: false, airborne: false, onPave: false };
  it('squeals in a drift and on a hard slide, not when driving straight or flying', () => {
    expect(skidAmount(base)).toBe(0);
    expect(skidAmount({ ...base, drifting: true, side: 5 })).toBeGreaterThan(0.7);
    expect(skidAmount({ ...base, side: 6 })).toBeGreaterThan(0.5);
    expect(skidAmount({ ...base, drifting: true, side: 5, airborne: true })).toBe(0);
    expect(skidAmount({ ...base, drifting: true, side: 5, onPave: true })).toBeLessThan(skidAmount({ ...base, drifting: true, side: 5 }));
    expect(skidAmount({ ...base, braking: true, speed: 22 })).toBeGreaterThan(0);
  });
  it('rumbles on the pavement and hums on the road', () => {
    const o = {};
    expect(surfaceMix(40, true, false, o).pave).toBeGreaterThan(0.5);
    expect(o.road).toBe(0);
    expect(surfaceMix(40, false, false, o).pave).toBe(0);
    expect(o.road).toBeGreaterThan(0.1);
    expect(surfaceMix(40, true, true, o).pave).toBe(0);
    expect(surfaceMix(0, true, false, o).pave).toBe(0);
  });
  it('a guardrail is a soft thud, a real crash is bigger, harder and metallic', () => {
    const soft = crashParams(0.7, true, {});
    const hard = crashParams(0.7, false, {});
    expect(soft.metal).toBe(0);
    expect(hard.metal).toBeGreaterThan(0);
    expect(hard.gain).toBeGreaterThan(soft.gain * 1.5);
    expect(hard.dur).toBeGreaterThan(soft.dur);
    expect(crashParams(1.4, false, {}).gain).toBeGreaterThan(crashParams(0.2, false, {}).gain);
    expect(crashParams(NaN, true, {}).gain).toBeGreaterThan(0);
  });
  it('a landing thump grows with the impact', () => {
    expect(landParams(14, {}).gain).toBeGreaterThan(landParams(4, {}).gain);
    expect(landParams(14, {}).hz).toBeLessThan(landParams(4, {}).hz);
  });
});

describe('ambience', () => {
  const mix = (o) => ambienceMix({ hour: 12, traffic: 0, pillars: 0, rain: 0, ...o }, {});
  it('birds sing in the morning only, crickets at night only', () => {
    expect(mix({ hour: 7 }).birds).toBeGreaterThan(0.9);
    expect(mix({ hour: 7 }).crickets).toBe(0);
    expect(mix({ hour: 13 }).birds).toBe(0);
    expect(mix({ hour: 13 }).crickets).toBe(0);
    expect(mix({ hour: 23 }).crickets).toBeGreaterThan(0.9);
    expect(mix({ hour: 23 }).birds).toBe(0);
    expect(mix({ hour: 2 }).crickets).toBeGreaterThan(0.9);
    expect(mix({ hour: 3.5 }).birds).toBe(0);
  });
  it('the road hum follows the traffic around you', () => {
    expect(mix({ traffic: 12 }).road).toBeGreaterThan(mix({ traffic: 1 }).road * 2);
    expect(mix({ traffic: 99 }).road).toBeLessThanOrEqual(1);
  });
  it('metro rumble needs pillars, rain needs rain, and rain mutes the birds', () => {
    expect(mix({ pillars: 0 }).metro).toBe(0);
    expect(mix({ pillars: 3 }).metro).toBeGreaterThan(0.4);
    expect(mix({ rain: 0 }).rain).toBe(0);
    expect(mix({ rain: 1 }).rain).toBe(1);
    expect(mix({ hour: 7, rain: 1 }).birds).toBe(0);
  });
  it('survives garbage and wraps the hour', () => {
    const m = ambienceMix({ hour: NaN, traffic: undefined, pillars: 'x', rain: null }, {});
    for (const k of Object.keys(m)) expect(Number.isFinite(m[k])).toBe(true);
    expect(mix({ hour: 31 }).birds).toBe(mix({ hour: 7 }).birds);
  });
  it('the radio ducks under a voice and in menus', () => {
    expect(radioDuck(10, 0, null)).toBe(1);
    expect(radioDuck(10, 12, null)).toBeLessThan(0.4);
    expect(radioDuck(10, 0, 'pause')).toBeLessThan(0.3);
    expect(radioDuck(10, 0, 'workshop')).toBeLessThan(1);
    expect(radioDuck(10, 12, 'pause')).toBeLessThanOrEqual(0.2);
  });
});

describe('radio sequencer', () => {
  const slot = newSlot();
  const scan = (st, steps) => {
    const rows = [];
    for (let s = 0; s < steps; s++) rows.push({ ...genStep(st, s, slot), step: s });
    return rows;
  };
  it('has three stations with distinct tempi', () => {
    expect(STATIONS).toHaveLength(3);
    expect(new Set(STATIONS.map((s) => s.tempo)).size).toBe(3);
    expect(stepSeconds(0)).toBeGreaterThan(stepSeconds(2));
    expect(stepSeconds(1)).toBeGreaterThan(stepSeconds(0));
    expect(stepSeconds(99)).toBeGreaterThan(0);
  });
  it('is deterministic and pure', () => {
    for (let st = 0; st < 3; st++) expect(scan(st, 64)).toEqual(scan(st, 64));
  });
  it('every lead note stays inside the station scale and a sane register', () => {
    for (let st = 0; st < 3; st++) {
      const { root, scale } = STATION_SCALES[st];
      const ok = new Set(scale.map((s) => (s + root) % 12));
      let notes = 0;
      for (const r of scan(st, 16 * 12)) {
        if (!r.lead) continue;
        notes++;
        expect(ok.has(r.lead % 12), `st ${st} step ${r.step} midi ${r.lead}`).toBe(true);
        expect(r.lead).toBeGreaterThanOrEqual(55);
        expect(r.lead).toBeLessThanOrEqual(100);
        expect(midiHz(r.lead)).toBeLessThan(2700);
      }
      expect(notes).toBeGreaterThan(20);
    }
  });
  it('the disco station has four on the floor and the lo-fi one is sparse', () => {
    const disco = scan(2, 16).filter((r) => r.kick).map((r) => r.step);
    expect(disco).toEqual([0, 4, 8, 12]);
    expect(scan(1, 16).filter((r) => r.kick).length).toBeLessThan(4);
    expect(scan(0, 16).filter((r) => r.kick).length).toBeGreaterThanOrEqual(3);
  });
  it('bass notes are low and strengths are 0..1', () => {
    for (let st = 0; st < 3; st++) {
      for (const r of scan(st, 64)) {
        if (r.bass) {
          expect(r.bass).toBeGreaterThanOrEqual(28);
          expect(r.bass).toBeLessThan(60);
        }
        expect(r.kick).toBeGreaterThanOrEqual(0);
        expect(r.kick).toBeLessThanOrEqual(1);
      }
    }
  });
  it('the filmi phrase changes over 4 bars and repeats', () => {
    const a = scan(0, 16).map((r) => r.lead).join();
    const b = scan(0, 32).slice(16).map((r) => r.lead).join();
    const again = scan(0, 80).slice(64).map((r) => r.lead).join();
    expect(a).not.toBe(b);
    expect(again).toBe(a);
  });
  it('swing only moves the odd sixteenths of the lo-fi station', () => {
    expect(swingDelay(1, 1)).toBeGreaterThan(0);
    expect(swingDelay(1, 2)).toBe(0);
    expect(swingDelay(2, 1)).toBe(0);
  });
  it('now-playing titles rotate', () => {
    expect(trackTitle(0, 0)).not.toBe(trackTitle(0, 256));
    expect(trackTitle(1, 0)).toBe(trackTitle(1, 256 * 4));
    expect(trackTitle(9, 0)).toBe('');
  });
  it('scaleSemis handles octaves and negatives', () => {
    const s = [0, 2, 4, 5, 7, 9, 11];
    expect(scaleSemis(s, 0)).toBe(0);
    expect(scaleSemis(s, 7)).toBe(12);
    expect(scaleSemis(s, -1)).toBe(-1);
    expect(scaleSemis(s, 9)).toBe(16);
  });
});
