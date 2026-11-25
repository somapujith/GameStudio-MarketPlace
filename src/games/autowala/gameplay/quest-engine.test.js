import { describe, expect, it } from 'vitest';
import {
  abandonRun, clockLeft, createRun, defaultSave, feedRun, isUnlocked, normalizeSave, payout, rankOf, recordComplete, runView, tickRun,
} from './quest-engine.js';
import { convoyPace, rivalPace, targetsOf } from './quest-steps.js';
import { dailyPick, dateKey, fmtClock, makePath, pathAt, projectOnPath, rankFor, waypointsAlong } from './quest-math.js';
import { DROP, LIP, prepareRamps, rampHeight, rampsHeight, rampMesh } from './quest-ramps.js';

const S = (o = {}) => ({ x: 0, z: 0, speed: 0, airborne: false, jolt: 0, distance: 0, time: 0, ...o });
const plan = (steps, over = {}) => ({
  id: 't', defId: 't', title: 'T', te: '', reward: { cash: 100, rep: 10 }, timeLimit: null, rules: {}, props: {}, mult: 1, steps, ...over,
});
const reach = (x, z, extra = {}) => ({ type: 'reach', x, z, r: 10, label: 'go', ...extra });
const run10 = (run, seconds, sample, env) => {
  const evs = [];
  for (let t = 0; t < seconds; t += 0.1) evs.push(...tickRun(run, 0.1, sample, env));
  return evs;
};

describe('quest-math', () => {
  const path = makePath([{ x: 0, z: 0 }, { x: 0, z: 100 }, { x: 50, z: 100 }]);
  it('measures and walks a path', () => {
    expect(path.length).toBeCloseTo(150);
    expect(pathAt(path, 50).z).toBeCloseTo(50);
    const p = pathAt(path, 125);
    expect(p.x).toBeCloseTo(25);
    expect(p.z).toBeCloseTo(100);
    expect(pathAt(path, 1e9).x).toBeCloseTo(50); // clamped to the end
  });
  it('projects a point on the path', () => {
    const r = projectOnPath(path, 3, 40);
    expect(r.s).toBeCloseTo(40);
    expect(r.d).toBeCloseTo(3);
  });
  it('places waypoints along the path', () => {
    const w = waypointsAlong(path, 3, { from: 0.5, to: 1 });
    expect(w.map((p) => Math.round(p.s))).toEqual([75, 113, 150]);
  });
  it('picks the same daily job for the same date', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    expect(dailyPick('2026-11-25', ids)).toBe(dailyPick('2026-11-25', ids));
    const seen = new Set();
    for (let d = 1; d <= 28; d++) seen.add(dailyPick(`2026-11-${String(d).padStart(2, '0')}`, ids));
    expect(seen.size).toBeGreaterThan(2);
    expect(dateKey(new Date(2026, 10, 5))).toBe('2026-11-05');
  });
  it('has a reputation ladder and a clock format', () => {
    expect(rankFor(0).title).toBe('Naya Driver');
    expect(rankFor(130).index).toBe(1);
    expect(rankFor(99999).next).toBe(null);
    expect(fmtClock(75)).toBe('1:15');
    expect(fmtClock(-3)).toBe('0:00');
  });
});

describe('reach and the run lifecycle', () => {
  it('finishes a reach step and pays', () => {
    const run = createRun(plan([reach(100, 0)]));
    expect(run.status).toBe('active');
    expect(tickRun(run, 0.1, S({ x: 50 }))).toHaveLength(0);
    const ev = tickRun(run, 0.1, S({ x: 95 }));
    expect(ev.map((e) => e.type)).toEqual(['step', 'complete']);
    expect(run.status).toBe('done');
    expect(run.payout.cash).toBeGreaterThanOrEqual(100);
  });
  it('needs a real stop for a pickup (speed under 2.2 m/s for the dwell time)', () => {
    const run = createRun(plan([reach(0, 0, { stop: true, dwell: 1 })]));
    expect(run10(run, 3, S({ speed: 8 }))).toHaveLength(0);
    expect(run10(run, 0.5, S({ speed: 0.5 }))).toHaveLength(0);
    const ev = run10(run, 1, S({ speed: 0.5 }));
    expect(ev.some((e) => e.type === 'complete')).toBe(true);
  });
  it('resets the dwell when the auto leaves the zone', () => {
    const run = createRun(plan([reach(0, 0, { stop: true, dwell: 1 })]));
    run10(run, 0.8, S({ speed: 0 }));
    run10(run, 0.2, S({ x: 50 }));
    expect(run10(run, 0.5, S({ speed: 0 }))).toHaveLength(0);
  });
  it('walks several steps in order and reports each', () => {
    const run = createRun(plan([reach(0, 0), reach(100, 0)]));
    expect(tickRun(run, 0.1, S()).map((e) => e.type)).toEqual(['step']);
    expect(run.stepIndex).toBe(1);
    expect(tickRun(run, 0.1, S({ x: 100 })).map((e) => e.type)).toEqual(['step', 'complete']);
  });
  it('does nothing once finished and can be abandoned', () => {
    const run = createRun(plan([reach(1e6, 0)]));
    abandonRun(run);
    expect(run.status).toBe('failed');
    expect(run.failReason).toBe('abandoned');
    expect(tickRun(run, 0.1, S())).toHaveLength(0);
    expect(feedRun(run, { type: 'crash' })).toHaveLength(0);
  });
  it('has a plain-data view for the HUD', () => {
    const run = createRun(plan([reach(100, 0, { label: 'A' }), reach(0, 0, { label: 'B' })], { timeLimit: 60 }));
    const v = runView(run, S());
    expect(v.steps.map((s) => s.label)).toEqual(['A', 'B']);
    expect(v.steps[0].current).toBe(true);
    expect(v.timeLeft).toBe(60);
    expect(JSON.parse(JSON.stringify(v)).title).toBe('T');
  });
});

describe('time limits', () => {
  it('fails when the mission clock runs out and shows the time left', () => {
    const run = createRun(plan([reach(1e6, 0)], { timeLimit: 5 }));
    run10(run, 2, S());
    expect(clockLeft(run)).toBeCloseTo(3, 0);
    const ev = run10(run, 4, S());
    expect(ev.find((e) => e.type === 'fail').reason).toBe('time');
  });
  it('uses the step clock only for that step', () => {
    const run = createRun(plan([reach(0, 0), reach(1e6, 0, { timeLimit: 3 })]));
    tickRun(run, 0.1, S());
    expect(run.stepTimeLeft).toBe(3);
    const ev = run10(run, 4, S({ x: -500 }));
    expect(ev.some((e) => e.type === 'fail' && e.reason === 'time')).toBe(true);
  });
  it('pays a time bonus for finishing with time to spare', () => {
    const fast = createRun(plan([reach(0, 0)], { timeLimit: 100 }));
    tickRun(fast, 0.1, S());
    const slow = createRun(plan([reach(1e6, 0)], { timeLimit: 100 }));
    run10(slow, 90, S());
    slow.status = 'done';
    expect(payout(slow.plan, fast).cash).toBeGreaterThan(payout(slow.plan, slow).cash - 1);
    expect(fast.payout.parts.some((p) => p.label === 'Time bonus')).toBe(true);
  });
});

describe('crashes and guardrails', () => {
  it('ignores guardrail contacts completely', () => {
    const run = createRun(plan([reach(1e6, 0)], { rules: { noCrash: true } }));
    expect(feedRun(run, { type: 'crash', strength: 1.2, guard: true, tag: 'building' })).toHaveLength(0);
    expect(run.status).toBe('active');
    expect(run.stats.incidents).toBe(0);
  });
  it('fails a no-crash mission on a real crash or a vehicle hit', () => {
    const a = createRun(plan([reach(1e6, 0)], { rules: { noCrash: true } }));
    expect(feedRun(a, { type: 'crash', strength: 0.5 }).some((e) => e.type === 'fail')).toBe(true);
    expect(a.failReason).toBe('crash');
    const b = createRun(plan([reach(1e6, 0)], { rules: { noCrash: true } }));
    feedRun(b, { type: 'traffic:hit', kind: 'car', severity: 0.4 });
    expect(b.status).toBe('failed');
  });
  it('does not fail a no-crash mission for bumping a pedestrian', () => {
    const run = createRun(plan([reach(1e6, 0)], { rules: { noCrash: true } }));
    feedRun(run, { type: 'traffic:hit', kind: 'ped', severity: 0.2 });
    expect(run.status).toBe('active');
    expect(run.stats.hits).toBe(1);
  });
  it('fails on a cow when cows are forbidden', () => {
    const run = createRun(plan([reach(1e6, 0)], { rules: { noHit: ['cow', 'ped'] } }));
    const ev = feedRun(run, { type: 'traffic:hit', kind: 'cow', severity: 0.3 });
    expect(ev[0].reason).toBe('hit:cow');
  });
  it('counts one bump reported twice (crash + traffic:hit) once', () => {
    const run = createRun(plan([reach(1e6, 0)]));
    feedRun(run, { type: 'crash', strength: 0.6 });
    feedRun(run, { type: 'traffic:hit', kind: 'car', severity: 0.6 });
    expect(run.stats.incidents).toBe(1);
    run10(run, 1, S());
    feedRun(run, { type: 'crash', strength: 0.6 });
    expect(run.stats.incidents).toBe(2);
  });
  it('pays less reputation after a bump and gives a clean-drive bonus without one', () => {
    const clean = createRun(plan([reach(0, 0)]));
    tickRun(clean, 0.1, S());
    expect(clean.payout.parts.some((p) => p.label === 'Clean drive')).toBe(true);
    const dirty = createRun(plan([reach(0, 0, { x: 100 }), reach(0, 0)]));
    feedRun(dirty, { type: 'crash', strength: 0.6 });
    tickRun(dirty, 0.1, S({ x: 100 }));
    tickRun(dirty, 0.1, S());
    expect(dirty.payout.parts.some((p) => p.label === 'Clean drive')).toBe(false);
    expect(dirty.payout.rep).toBeLessThan(clean.payout.rep);
  });
});

describe('meters (a hot parcel)', () => {
  const meter = { id: 'heat', label: 'Heat', start: 1, decay: 0.1, crash: 0.4, hit: 0.2, land: 0.1, failAtZero: true, fromStep: 1 };
  it('only cools after the pickup (fromStep) and fails at zero', () => {
    const run = createRun(plan([reach(0, 0), reach(1e6, 0)], { rules: { meter } }));
    expect(run.meter).toBe(1);
    run10(run, 5, S({ x: 50 }));
    expect(run.meter).toBe(1);
    tickRun(run, 0.1, S());
    expect(run.stepIndex).toBe(1);
    run10(run, 5, S({ x: 50 }));
    expect(run.meter).toBeCloseTo(0.5, 1);
    const ev = run10(run, 6, S({ x: 50 }));
    expect(ev.some((e) => e.type === 'fail' && e.reason === 'meter')).toBe(true);
  });
  it('loses heat on bumps and pays more for a hotter parcel', () => {
    const hot = createRun(plan([reach(0, 0)], { rules: { meter: { ...meter, fromStep: 0 } } }));
    const cold = createRun(plan([reach(0, 0)], { rules: { meter: { ...meter, fromStep: 0 } } }));
    feedRun(cold, { type: 'crash', strength: 1 });
    expect(cold.meter).toBeCloseTo(0.6, 1);
    tickRun(hot, 0.1, S());
    cold.sinceIncident = 99;
    tickRun(cold, 0.1, S());
    expect(hot.payout.cash).toBeGreaterThan(cold.payout.cash);
  });
  it('ignores a soft guardrail contact for the meter', () => {
    const run = createRun(plan([reach(1e6, 0)], { rules: { meter: { ...meter, fromStep: 0 } } }));
    feedRun(run, { type: 'crash', strength: 1.2, guard: true });
    expect(run.meter).toBe(1);
  });
});

describe('collect (kites)', () => {
  it('collects points in any order', () => {
    const run = createRun(plan([{ type: 'collect', r: 10, points: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }], label: 'kites' }]));
    tickRun(run, 0.1, S({ x: 200 }));
    tickRun(run, 0.1, S({ x: 0 }));
    expect(run.states[0].count).toBe(2);
    expect(run.status).toBe('active');
    const ev = tickRun(run, 0.1, S({ x: 100 }));
    expect(ev.some((e) => e.type === 'complete')).toBe(true);
  });
  it('lists the remaining kites as marker targets', () => {
    const run = createRun(plan([{ type: 'collect', r: 10, marker: 'kite', points: [{ x: 0, z: 0 }, { x: 100, z: 0 }], label: 'k' }]));
    tickRun(run, 0.1, S({ x: 0 }));
    const out = [];
    targetsOf(run.plan.steps[0], run.states[0], out);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ x: 100, kind: 'kite' });
  });
});

describe('stunt jumps', () => {
  it('counts only landings with enough air time', () => {
    const run = createRun(plan([{ type: 'jumps', count: 2, minAir: 0.35, label: 'j' }]));
    feedRun(run, { type: 'land', air: 0.2, impact: 3 });
    expect(run.states[0].count).toBe(0);
    feedRun(run, { type: 'land', air: 0.5, impact: 5 });
    const ev = feedRun(run, { type: 'land', air: 0.6, impact: 5 });
    expect(ev.some((e) => e.type === 'complete')).toBe(true);
    expect(run.payout.parts.some((p) => p.label === 'Air time')).toBe(true);
    expect(run.states[0].best).toBeCloseTo(0.6);
  });
});

describe('ramps', () => {
  const r = prepareRamps([{ x: 0, z: 0, dx: 0, dz: 1, len: 16, w: 6, rise: 2.4 }])[0];
  it('climbs along the direction of travel, is flat on top and then falls steeply', () => {
    const climb = 16 - LIP - DROP;
    expect(rampHeight(r, 0, -8)).toBeCloseTo(0, 1);
    expect(rampHeight(r, 0, -8 + climb / 2)).toBeCloseTo(1.2, 1);
    expect(rampHeight(r, 0, -8 + climb + 0.5)).toBeCloseTo(2.4, 1);
    expect(rampHeight(r, 0, -8 + climb + LIP + DROP / 2)).toBeCloseTo(1.2, 1);
    expect(rampHeight(r, 0, 8.2)).toBe(0); // past the foot
    expect(rampHeight(r, 4, 0)).toBe(0); // beside the deck
  });
  it('has a cheap reject and a mesh', () => {
    expect(rampsHeight([r], 500, 500)).toBe(0);
    expect(rampsHeight([r], 0, 5)).toBeGreaterThan(1);
    expect(rampMesh(r).length % 9).toBe(0);
  });
  it('rotates with its direction', () => {
    const e = prepareRamps([{ x: 10, z: 20, dx: 1, dz: 0, len: 16, w: 6, rise: 2.4 }])[0];
    expect(rampHeight(e, 10 + 8 - DROP - 0.5, 20)).toBeCloseTo(2.4, 1);
    expect(rampHeight(e, 10, 25)).toBe(0);
  });
});

describe('escort (baraat)', () => {
  const path = makePath([{ x: 0, z: 0 }, { x: 0, z: 100 }]);
  const step = { type: 'escort', path, speed: 5, len: 10, pauses: [0.5], pauseTime: 2, label: 'e' };
  const at = (z, x = 0) => S({ x, z });
  it('moves the convoy, pauses for the dhol and finishes when it arrives with the player close', () => {
    const run = createRun(plan([step]));
    const st = run.states[0];
    let z = 0;
    let sawPause = false;
    for (let t = 0; t < 60 && run.status === 'active'; t += 0.1) {
      z = Math.max(0, st.u - 14); // the player follows 14 m behind the tail
      tickRun(run, 0.1, at(z));
      if (st.hold > 0) sawPause = true;
    }
    expect(sawPause).toBe(true);
    expect(run.status).toBe('done');
    expect(st.u).toBe(100);
  });
  it('fails when the player overtakes the procession for too long', () => {
    const run = createRun(plan([step]));
    const ev = run10(run, 12, at(60));
    expect(ev.find((e) => e.type === 'fail')?.reason).toBe('overtake');
  });
  it('fails when the player lets it go out of sight', () => {
    const run = createRun(plan([step]));
    run.states[0].u = 20;
    const ev = run10(run, 30, at(0, 300));
    expect(ev.find((e) => e.type === 'fail')?.reason).toBe('lost');
  });
  it('slows the convoy when the player trails far behind', () => {
    expect(convoyPace(4, 10)).toBe(4);
    expect(convoyPace(4, 35)).toBeLessThan(4);
    expect(convoyPace(4, 80)).toBeLessThan(convoyPace(4, 35));
  });
  it('does not call a slow follower an overtaker', () => {
    const run = createRun(plan([step]));
    run.states[0].u = 30;
    run10(run, 3, at(25));
    expect(run.status).toBe('active');
    expect(run.states[0].ahead).toBe(0);
  });
});

describe('race', () => {
  const path = makePath([{ x: 0, z: 0 }, { x: 0, z: 400 }]);
  const cps = [{ x: 0, z: 100, r: 15 }, { x: 0, z: 200, r: 15 }, { x: 0, z: 400, r: 18 }];
  const step = { type: 'race', path, cps, rivalSpeed: 12, countdown: 1, label: 'r' };
  it('waits for the countdown, then the player wins by passing every gate first', () => {
    const run = createRun(plan([step]));
    const st = run.states[0];
    expect(run10(run, 0.5, S({ z: 200 }))).toHaveLength(0);
    expect(st.cp).toBe(0); // no gate counts before GO
    run10(run, 0.7, S());
    expect(st.go).toBe(true);
    let z = 0;
    let evs = [];
    for (let t = 0; t < 40 && run.status === 'active'; t += 0.1) {
      z += 25 * 0.1;
      evs = tickRun(run, 0.1, S({ z }));
    }
    expect(run.status).toBe('done');
    expect(evs.some((e) => e.type === 'complete')).toBe(true);
    expect(st.cp).toBe(3);
  });
  it('is lost when the rival reaches the end first', () => {
    const run = createRun(plan([step]));
    const ev = run10(run, 120, S({ z: 0 }));
    expect(ev.find((e) => e.type === 'fail')?.reason).toBe('rival');
  });
  it('rubber-bands the rival: slower when far ahead, faster when far behind', () => {
    expect(rivalPace(12, 0)).toBe(12);
    expect(rivalPace(12, 200)).toBeLessThan(10);
    expect(rivalPace(12, -200)).toBeGreaterThan(13);
    expect(rivalPace(12, 60)).toBeLessThan(12);
  });
});

describe('event, drive and train steps', () => {
  it('waits for a matching bus event', () => {
    const run = createRun(plan([{ type: 'event', event: 'menu', match: { name: 'pause' }, label: 'p' }]));
    expect(feedRun(run, { type: 'menu', name: 'start' })).toHaveLength(0);
    expect(feedRun(run, { type: 'honk' })).toHaveLength(0);
    expect(feedRun(run, { type: 'menu', name: 'pause' }).some((e) => e.type === 'complete')).toBe(true);
  });
  it('counts metres driven', () => {
    const run = createRun(plan([{ type: 'drive', metres: 40, label: 'd' }]));
    tickRun(run, 0.1, S({ distance: 1000 }));
    tickRun(run, 0.1, S({ distance: 1030 }));
    expect(run.status).toBe('active');
    expect(tickRun(run, 0.1, S({ distance: 1045 })).some((e) => e.type === 'complete')).toBe(true);
  });
  it('beats the train to the station, or loses when it pulls in first', () => {
    const step = { type: 'trainRace', trainIdx: 0, station: { x: 500, z: 0 }, x: 500, z: 10, r: 16, arriveR: 24, label: 't' };
    const win = createRun(plan([step]));
    expect(tickRun(win, 0.1, S({ x: 500, z: 10 }), { trains: [{ x: 300, z: 0, speed: 16 }] }).some((e) => e.type === 'complete')).toBe(true);
    const lose = createRun(plan([step]));
    const ev = tickRun(lose, 0.1, S({ x: 0, z: 0 }), { trains: [{ x: 510, z: 0, speed: 3 }] });
    expect(ev.find((e) => e.type === 'fail')?.reason).toBe('train');
  });
});

describe('daily jobs pay extra', () => {
  it('multiplies the payout and the reputation', () => {
    const a = createRun(plan([reach(0, 0)]));
    const b = createRun(plan([reach(0, 0)], { mult: 1.5 }));
    tickRun(a, 0.1, S());
    tickRun(b, 0.1, S());
    expect(b.payout.cash).toBeGreaterThan(a.payout.cash * 1.4);
    expect(b.payout.rep).toBeGreaterThan(a.payout.rep);
  });
});

describe('saved progress', () => {
  it('survives garbage', () => {
    for (const bad of [null, 5, 'x', [], { rep: 'lots', done: 7, best: { x: 'y' }, tutorial: 'maybe', daily: 3 }]) {
      const s = normalizeSave(bad);
      expect(s.rep).toBe(0);
      expect(s.tutorial).toBe(null);
      expect(s.done).toEqual({});
    }
  });
  it('round-trips through JSON (the profile stores it)', () => {
    const s = defaultSave();
    recordComplete(s, { defId: 'biryani' }, { cash: 300, rep: 40 }, 91.234);
    recordComplete(s, { defId: 'biryani' }, { cash: 300, rep: 40 }, 120);
    s.tutorial = 'done';
    s.daily = { key: '2026-11-25', id: 'chai', done: true };
    const back = normalizeSave(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);
    expect(back.done.biryani).toBe(2);
    expect(back.best.biryani).toBeCloseTo(91.2);
    expect(back.rep).toBe(80);
  });
  it('unlocks missions by reputation', () => {
    const s = defaultSave();
    expect(isUnlocked({ minRep: 0 }, s)).toBe(true);
    expect(isUnlocked({ minRep: 100 }, s)).toBe(false);
    s.rep = 150;
    expect(isUnlocked({ minRep: 100 }, s)).toBe(true);
    expect(rankOf(s).title).toBe('Local Pro');
  });
  it('rejects hostile ids', () => {
    const s = normalizeSave({ done: { '<script>': 3, ok_id: 2, ['x'.repeat(80)]: 1 } });
    expect(Object.keys(s.done)).toEqual(['ok_id']);
  });
});
