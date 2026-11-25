import { describe, expect, it } from 'vitest';
import { fineFor, initialRage, nextSeverity, RAGE, reduceRage, wantChasers } from './rage-logic.js';

const hit = (s, severity, recruited = 2) => reduceRage(s, { type: 'hit', severity, recruited });
const tick = (s, o = {}) => reduceRage(s, { type: 'tick', dt: 0.1, chasers: 2, contact: 1, boxGap: 50, pairs: 0, speed: 15, wallet: 1000, ...o });

/** run ticks for `secs` seconds; returns the final state and every effect seen */
function run(state, secs, o = {}) {
  let s = state;
  const fx = [];
  for (let t = 0; t < secs; t += 0.1) {
    const r = tick(s, o);
    s = r.state;
    fx.push(...r.effects);
  }
  return { s, fx };
}

describe('road rage state machine', () => {
  it('a hit starts a chase with heat scaled by severity', () => {
    const soft = hit(initialRage(), 0.1, 1);
    const hard = hit(initialRage(), 0.9, 3);
    expect(soft.effects).toEqual([{ type: 'start', chasers: 1 }]);
    expect(hard.effects).toEqual([{ type: 'start', chasers: 3 }]);
    expect(hard.state.active).toBe(true);
    expect(hard.state.heat).toBeGreaterThan(soft.state.heat);
    expect(hard.state.heat).toBeLessThanOrEqual(1);
  });

  it('with nobody to recruit there is heat but no chase', () => {
    const r = hit(initialRage(), 0.5, 0);
    expect(r.state.active).toBe(false);
    expect(r.state.heat).toBeGreaterThan(0);
    expect(r.effects).toEqual([]);
  });

  it('repeated hits escalate heat, severity and the number of chasers', () => {
    const a = hit(initialRage(), 0.3, 2);
    const b = hit(a.state, 0.3, 3);
    const c = hit(b.state, 0.3, 4);
    expect(b.state.heat).toBeGreaterThan(a.state.heat);
    expect(c.state.heat).toBeGreaterThan(b.state.heat);
    expect(b.state.sev).toBeGreaterThan(a.state.sev);
    expect(wantChasers(a.state, 0.3)).toBeGreaterThan(wantChasers(initialRage(), 0.3));
    expect(wantChasers(c.state, 1)).toBeLessThanOrEqual(RAGE.maxChasers);
    expect(nextSeverity(c.state, 0.3)).toBeGreaterThan(0.3);
    // a second hit while active does not "start" again
    expect(b.effects).toEqual([]);
  });

  it('escape: nobody within reach for 10 s ends the rage, no fine', () => {
    let s = hit(initialRage(), 0.6, 3).state;
    let r = run(s, 5, { contact: 0, boxGap: 200, speed: 20 });
    expect(r.s.active).toBe(true);
    expect(r.s.escape).toBeGreaterThan(0.4);
    expect(r.s.escape).toBeLessThan(0.6);
    r = run(r.s, 6, { contact: 0, boxGap: 200, speed: 20 });
    expect(r.fx).toEqual([{ type: 'escaped' }]);
    expect(r.s.active).toBe(false);
    expect(r.fx.some((e) => e.type === 'caught')).toBe(false);
  });

  it('a chaser staying close resets the escape timer', () => {
    let s = hit(initialRage(), 0.6, 3).state;
    s = run(s, 8, { contact: 0, boxGap: 200, speed: 20 }).s;
    expect(s.escape).toBeGreaterThan(0.7);
    s = run(s, 0.2, { contact: 1, boxGap: 30, speed: 20 }).s;
    expect(s.escape).toBe(0);
  });

  it('caught: boxed in by one chaser and nearly stopped for ~3 s, fine capped by the wallet', () => {
    const sev = 0.8;
    let s = hit(initialRage(), sev, 3).state;
    const r = run(s, 4, { contact: 1, boxGap: 3, speed: 0.5, wallet: 1000 });
    const caught = r.fx.filter((e) => e.type === 'caught');
    expect(caught).toHaveLength(1);
    expect(caught[0].fine).toBe(Math.round(150 + 300 * s.sev));
    expect(r.s.active).toBe(false);

    const poor = run(hit(initialRage(), sev, 3).state, 4, { contact: 1, boxGap: 3, speed: 0.5, wallet: 40 });
    expect(poor.fx.find((e) => e.type === 'caught').fine).toBe(40);
    const broke = run(hit(initialRage(), sev, 3).state, 4, { contact: 1, boxGap: 3, speed: 0.5, wallet: 0 });
    expect(broke.fx.find((e) => e.type === 'caught').fine).toBe(0);
    expect(fineFor(1, 10000)).toBe(450);
  });

  it('moving away from a close chaser is not being caught', () => {
    const s = hit(initialRage(), 0.8, 3).state;
    const r = run(s, 8, { contact: 1, boxGap: 3, speed: 10 });
    expect(r.fx.some((e) => e.type === 'caught')).toBe(false);
    expect(r.s.active).toBe(true);
  });

  it('caught: two chasers within 9 m for ~4 s', () => {
    const s = hit(initialRage(), 0.5, 3).state;
    const r = run(s, 3.5, { contact: 2, boxGap: 8, pairs: 2, speed: 6 });
    expect(r.fx).toEqual([]);
    expect(r.s.caughtIn).toBeGreaterThan(0.8);
    const r2 = run(r.s, 1, { contact: 2, boxGap: 8, pairs: 2, speed: 6 });
    expect(r2.fx.map((e) => e.type)).toEqual(['caught']);
  });

  it('caughtIn rises smoothly and drains when the box opens', () => {
    let s = hit(initialRage(), 0.5, 2).state;
    s = run(s, 1.5, { boxGap: 3, speed: 0.2 }).s;
    expect(s.caughtIn).toBeCloseTo(0.5, 1);
    s = run(s, 1, { boxGap: 40, speed: 12 }).s;
    expect(s.caughtIn).toBeLessThan(0.2);
  });

  it('grace period after being caught: a new hit does not start another chase', () => {
    let s = hit(initialRage(), 0.8, 3).state;
    s = run(s, 4, { contact: 1, boxGap: 3, speed: 0.5 }).s;
    expect(s.grace).toBeGreaterThan(5);
    expect(wantChasers(s, 0.9)).toBe(0);
    const r = hit(s, 0.9, 3);
    expect(r.state.active).toBe(false);
    expect(r.effects).toEqual([]);
    const after = run(s, RAGE.grace + 0.5, {}).s;
    expect(after.grace).toBe(0);
    expect(wantChasers(after, 0.5)).toBeGreaterThan(0);
    expect(hit(after, 0.5, 2).effects).toEqual([{ type: 'start', chasers: 2 }]);
  });

  it('heat decays while calm', () => {
    let s = hit(initialRage(), 0.8, 0).state;
    const h0 = s.heat;
    s = run(s, 10, {}).s;
    expect(s.heat).toBeLessThan(h0);
    s = run(s, 60, {}).s;
    expect(s.heat).toBe(0);
    expect(s.hits).toBe(0);
  });

  it('a menu or pause freezes every timer', () => {
    const s = hit(initialRage(), 0.6, 3).state;
    const a = run(s, 20, { menu: 'pause', contact: 0, boxGap: 3, speed: 0 });
    expect(a.s).toBe(s);
    expect(a.fx).toEqual([]);
    const b = run(s, 20, { paused: true, contact: 0 });
    expect(b.s).toBe(s);
  });

  it('a tiny or huge dt cannot skip or break the machine', () => {
    const s = hit(initialRage(), 0.6, 3).state;
    const r = reduceRage(s, { type: 'tick', dt: 100, chasers: 2, contact: 0, boxGap: 99, pairs: 0, speed: 20, wallet: 10 });
    expect(r.state.escapeT).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(reduceRage(s, { type: 'tick', dt: -1 }).state).toBe(s);
  });
});
