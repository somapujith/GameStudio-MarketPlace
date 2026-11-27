// Every mission plan, built once against the real generated city: waypoints on roads, sane time limits, deterministic daily job.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCity, nearestRoad } from '../world/layout.js';
import { planMetro } from '../world/metro-routes.js';
import { CITY_SEED } from '../game/config.js';
import { makeRng } from '../game/rng.js';
import { createRouter } from '../world/routing.js';
import { DAILY_POOL, DEFS, DEF_BY_ID, dailyJob, pickTrainRace, replayOf, tutorialPlan } from './quest-defs.js';
import { createRun, feedRun, payout, tickRun } from './quest-engine.js';
import { STEP_TYPES } from './quest-steps.js';
import { createTrainTracker, dateKey, shouldRebuildOffers } from './quest-math.js';
import { rampHeight, prepareRamps } from './quest-ramps.js';

let city;
let router;
let route;
let env;
let metro;

const GARAGE = () => city.poiById.garage.front;
const mkEnv = (seed, extra = {}) => ({ ...env, rng: makeRng(seed), ...extra });
const onRoad = (p, slack = 0.6) => {
  const r = nearestRoad(city, p.x, p.z);
  return r.dist <= r.edge.w / 2 + slack;
};
/** Every timed waypoint a plan asks the player to reach. */
function waypoints(plan) {
  const out = [];
  for (const s of plan.steps) {
    if (s.type === 'reach') out.push(s);
    if (s.type === 'collect') out.push(...s.points);
    if (s.type === 'race') out.push(...s.cps);
    if (s.type === 'trainRace') out.push({ x: s.x, z: s.z });
    if (s.type === 'jumps') out.push(...s.marks);
    if (s.type === 'escort') out.push(...s.path.points);
    if (s.type === 'event' && s.at) out.push(s.at);
  }
  return out;
}

beforeAll(() => {
  city = generateCity(CITY_SEED);
  for (const p of city.pois) {
    const r = nearestRoad(city, p.x, p.z);
    p.front = { x: r.x, z: r.z, edge: r.edge.id, t: r.t };
  }
  router = createRouter(city);
  route = (a, b) => router.route(a, b);
  const g = GARAGE();
  env = { city, route, rng: makeRng(1), player: { x: g.x, z: g.z }, metro: null };
  const plan = planMetro(city);
  const stations = plan.lines.flatMap((l) => l.stations);
  // a fake train just before a station, rolling towards it
  const st = stations.find((s) => s.line === 'red' && s.front);
  const a = plan.lines.find((l) => l.id === 'red').stations;
  const i = a.indexOf(st);
  const next = a[Math.min(a.length - 1, i + 2)];
  const dx = next.x - st.x;
  const dz = next.z - st.z;
  const d = Math.hypot(dx, dz) || 1;
  metro = { stations, trains: [{ x: st.x, z: st.z, speed: 14, line: 'red', vx: (dx / d) * 14, vz: (dz / d) * 14 }], first: st, next, d };
}, 20000);

describe('every mission', () => {
  for (const def of DEFS) {
    if (def.id === 'metro') continue;
    describe(def.id, () => {
      it('builds a plan with reachable, on-road waypoints', () => {
        for (let seed = 1; seed <= 4; seed++) {
          const plan = def.plan(mkEnv(seed * 31));
          expect(plan, `${def.id} seed ${seed}`).toBeTruthy();
          expect(plan.defId).toBe(def.id);
          expect(plan.steps.length).toBeGreaterThan(0);
          expect(plan.reward.cash).toBeGreaterThan(0);
          for (const s of plan.steps) {
            expect(typeof s.label).toBe('string');
            expect(s.label.length).toBeGreaterThan(3);
          }
          for (const p of waypoints(plan)) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.z), 'finite').toBe(true);
            expect(onRoad(p), `${def.id} waypoint ${Math.round(p.x)},${Math.round(p.z)} is not on a road`).toBe(true);
          }
        }
      });
      it('is deterministic for a seed', () => {
        const a = def.plan(mkEnv(99));
        const b = def.plan(mkEnv(99));
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      });
      it('has a time limit a real auto can meet', () => {
        const plan = def.plan(mkEnv(7));
        const limits = [];
        if (plan.timeLimit) limits.push({ t: plan.timeLimit, from: null });
        plan.steps.forEach((s) => s.timeLimit && limits.push({ t: s.timeLimit, step: s }));
        for (const l of limits) {
          // path length the limit covers, as straight line between consecutive waypoints (a lower bound: roads are longer)
          let need = 0;
          const wps = waypoints(plan).filter((w) => w.x != null);
          let prev = env.player;
          if (l.step) prev = plan.steps[plan.steps.indexOf(l.step) - 1] || prev;
          const target = l.step || wps[wps.length - 1];
          need = Math.hypot((target.x ?? prev.x) - prev.x, (target.z ?? prev.z) - prev.z);
          if (l.step) expect(need / l.t, `${def.id} step limit ${l.t}s for >= ${Math.round(need)} m`).toBeLessThan(18);
          expect(l.t).toBeGreaterThanOrEqual(30);
        }
      });
    });
  }
});

describe('the board is almost always full', () => {
  it('builds every non-metro mission for 25 different board rolls', () => {
    const misses = [];
    for (let seed = 100; seed < 125; seed++) {
      for (const def of DEFS) {
        if (def.id === 'metro') continue;
        const plan = def.plan(mkEnv(seed * 7919 + 3));
        if (!plan) misses.push(def.id + ':' + seed);
        else for (const p of waypoints(plan)) if (!onRoad(p, 1)) misses.push('off-road ' + def.id + ':' + seed);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('mission specifics', () => {
  it('biryani: pickup at a Paradise/Bawarchi front, a heat meter that only starts cooling after the pickup', () => {
    const plan = DEF_BY_ID.biryani.plan(mkEnv(3));
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].label).toMatch(/Paradise|Bawarchi/);
    expect(plan.rules.meter.fromStep).toBe(1);
    expect(plan.timeLimit).toBeGreaterThan(60);
  });
  it('chai: three deliveries after the pickup', () => {
    const plan = DEF_BY_ID.chai.plan(mkEnv(3));
    expect(plan.steps).toHaveLength(4);
  });
  it('baraat: join, then a convoy path of 300-460 m on roads', () => {
    const plan = DEF_BY_ID.baraat.plan(mkEnv(5));
    const esc = plan.steps[1];
    expect(esc.type).toBe('escort');
    expect(esc.path.length).toBeGreaterThanOrEqual(300);
    expect(esc.path.length).toBeLessThanOrEqual(460);
    expect(plan.props.convoy).toBe(true);
  });
  it('airport: a long pickup-to-airport leg with its own clock', () => {
    const plan = DEF_BY_ID.airport.plan(mkEnv(5));
    expect(plan).toBeTruthy();
    expect(plan.steps[1].label).toMatch(/airport/i);
    expect(plan.steps[1].timeLimit).toBeGreaterThan(60);
    expect(plan.steps[0].seat).toBe(true);
  });
  it('tourist: pickup + 3 photo stops at landmarks', () => {
    const plan = DEF_BY_ID.tourist.plan(mkEnv(5));
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps.slice(1).every((s) => s.stop && s.dwell >= 3)).toBe(true);
    expect(plan.rules.meter.id).toBe('mood');
  });
  it('race: five gates on the road along the rival path, finish last', () => {
    const plan = DEF_BY_ID.race.plan(mkEnv(5));
    const race = plan.steps[1];
    expect(race.cps).toHaveLength(5);
    expect(race.path.length).toBeGreaterThanOrEqual(650);
    const last = race.cps[4];
    const end = race.path.points[race.path.points.length - 1];
    expect(Math.hypot(last.x - end.x, last.z - end.z)).toBeLessThan(1);
    expect(plan.props.rival.color).toBeTruthy();
  });
  it('stunts: three ramps on long straight edges, each with a run-up on the same road', () => {
    const plan = DEF_BY_ID.stunts.plan(mkEnv(5));
    const ramps = plan.props.ramps;
    expect(ramps).toHaveLength(3);
    prepareRamps(ramps);
    for (const r of ramps) {
      expect(onRoad({ x: r.x, z: r.z })).toBe(true);
      expect(onRoad({ x: r.runX, z: r.runZ })).toBe(true);
      expect(rampHeight(r, r.x + r.dx * 3, r.z + r.dz * 3)).toBeGreaterThan(2);
      expect(rampHeight(r, r.runX, r.runZ)).toBe(0);
    }
    expect(plan.steps[0].marks).toHaveLength(3);
    expect(plan.timeLimit).toBeGreaterThanOrEqual(150);
  });
  it('cows: seven cows ON the road, none standing on a stop, cows forbidden', () => {
    const plan = DEF_BY_ID.cows.plan(mkEnv(5));
    expect(plan.props.cows).toHaveLength(7);
    expect(plan.rules.noHit).toContain('cow');
    for (const c of plan.props.cows) expect(onRoad(c)).toBe(true);
    for (const s of plan.steps[0].points) for (const c of plan.props.cows) expect(Math.hypot(s.x - c.x, s.z - c.z)).toBeGreaterThan(8);
  });
  it('kites: 6-7 kites on junctions, spaced out', () => {
    const plan = DEF_BY_ID.kites.plan(mkEnv(5));
    const pts = plan.steps[0].points;
    expect(pts.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(55);
  });
  it('hospital: patient pickup, then a timed run to Care Hospital', () => {
    const plan = DEF_BY_ID.hospital.plan(mkEnv(5));
    expect(plan.steps[1].timeLimit).toBeGreaterThan(20);
    const h = city.poiById.hospital.front;
    expect(Math.hypot(plan.steps[1].x - h.x, plan.steps[1].z - h.z)).toBeLessThan(1);
  });
  it('metro: only offered when a train is heading for a station the player can beat, and never without a metro', () => {
    expect(DEF_BY_ID.metro.plan(mkEnv(5))).toBe(null);
    const trains = metro.trains;
    const found = pickTrainRace({ ...env, metro: { stations: metro.stations, trains } }, { minD: 100, maxD: 5000, ratioLo: 0, ratioHi: 50 });
    expect(found).toBeTruthy();
    expect(found.station.line).toBe('red');
    // a train that is moving away from a station is not "approaching" it
    const away = [{ ...trains[0], vx: -trains[0].vx, vz: -trains[0].vz }];
    const chosen = pickTrainRace({ ...env, metro: { stations: metro.stations.filter((s) => s.id === metro.next.id), trains: away } }, { minD: 100, maxD: 5000, ratioLo: 0, ratioHi: 50 });
    expect(chosen).toBe(null);
    const plan = DEF_BY_ID.metro.plan({ ...mkEnv(5), metro: { stations: metro.stations, trains } });
    // the default window may or may not fit this made-up train: when it does, the step is a trainRace on the station's road front
    if (plan) {
      expect(plan.steps[0].type).toBe('trainRace');
      expect(onRoad({ x: plan.steps[0].x, z: plan.steps[0].z })).toBe(true);
    }
  });
});

describe('plans run in the engine', () => {
  it('a plan that reaches its waypoints in order completes', () => {
    for (const id of ['biryani', 'chai', 'tourist', 'hospital', 'airport']) {
      const plan = DEF_BY_ID[id].plan(mkEnv(11));
      const run = createRun(plan);
      for (let guard = 0; guard < 20 && run.status === 'active'; guard++) {
        const s = plan.steps[run.stepIndex];
        for (let t = 0; t < 6 && run.status === 'active' && run.stepIndex === plan.steps.indexOf(s); t += 0.1) tickRun(run, 0.1, { x: s.x, z: s.z, speed: 0, jolt: 0, distance: 0 });
      }
      expect(run.status, id).toBe('done');
      expect(run.payout.cash).toBeGreaterThanOrEqual(plan.reward.cash);
    }
  });
  it('kites complete when every kite is visited', () => {
    const plan = DEF_BY_ID.kites.plan(mkEnv(3));
    const run = createRun(plan);
    for (const p of plan.steps[0].points) tickRun(run, 0.1, { x: p.x, z: p.z, speed: 5, jolt: 0, distance: 0 });
    expect(run.status).toBe('done');
  });
  it('the cow mission fails on a cow hit and ignores a guardrail graze', () => {
    const run = createRun(DEF_BY_ID.cows.plan(mkEnv(3)));
    feedRun(run, { type: 'crash', strength: 1, guard: true, tag: 'building' });
    expect(run.status).toBe('active');
    feedRun(run, { type: 'traffic:hit', kind: 'cow', severity: 0.5 });
    expect(run.status).toBe('failed');
  });
  it('the baraat escort completes when followed at walking pace', () => {
    const plan = DEF_BY_ID.baraat.plan(mkEnv(3));
    const run = createRun(plan);
    const j = plan.steps[0];
    tickRun(run, 0.1, { x: j.x, z: j.z, speed: 3, jolt: 0, distance: 0 });
    expect(run.stepIndex).toBe(1);
    const st = run.states[1];
    const path = plan.steps[1].path;
    for (let t = 0; t < 400 && run.status === 'active'; t += 0.1) {
      const s = Math.max(0, st.u - 12);
      const k = path.points.length;
      // follow the path 12 m behind the tail
      let i = 1;
      while (i < k - 1 && path.cum[i] < s) i++;
      const f = (s - path.cum[i - 1]) / (path.cum[i] - path.cum[i - 1] || 1);
      const x = path.points[i - 1].x + (path.points[i].x - path.points[i - 1].x) * f;
      const z = path.points[i - 1].z + (path.points[i].z - path.points[i - 1].z) * f;
      tickRun(run, 0.1, { x, z, speed: 3, jolt: 0, distance: 0 });
    }
    expect(run.status).toBe('done');
  });
});

describe('the tutorial', () => {
  it('has the six steps: drive, horn, pick up, drop off, pause, workshop', () => {
    const plan = tutorialPlan(mkEnv(7));
    expect(plan.steps.map((s) => s.type)).toEqual(['drive', 'event', 'reach', 'reach', 'event', 'event']);
    expect(plan.steps[1].event).toBe('honk');
    expect(plan.steps[2].stop && plan.steps[3].stop).toBe(true);
    expect(plan.steps[4]).toMatchObject({ event: 'menu', match: { name: 'pause' } });
    expect(plan.steps[5].event).toBe('workshop:enter');
    expect(plan.tutorial).toBe(true);
    for (const p of waypoints(plan)) expect(onRoad(p, 1)).toBe(true);
  });
  it('can be played through by the events it asks for', () => {
    const plan = tutorialPlan(mkEnv(7));
    const run = createRun(plan);
    tickRun(run, 0.1, { x: 0, z: 0, speed: 5, jolt: 0, distance: 10 });
    tickRun(run, 0.1, { x: 0, z: 0, speed: 5, jolt: 0, distance: 60 });
    expect(run.stepIndex).toBe(1);
    feedRun(run, { type: 'honk' });
    for (const i of [2, 3]) {
      const s = plan.steps[i];
      for (let t = 0; t < 2; t += 0.1) tickRun(run, 0.1, { x: s.x, z: s.z, speed: 0, jolt: 0, distance: 60 });
    }
    expect(run.stepIndex).toBe(4);
    feedRun(run, { type: 'menu', name: 'pause' });
    feedRun(run, { type: 'workshop:enter' });
    expect(run.status).toBe('done');
  });
});

describe('replaying the tutorial', () => {
  it('pays nothing the second time (it used to pay Rs 150 and 25 reputation every replay)', () => {
    const first = tutorialPlan(mkEnv(7));
    expect(payout(first, createRun(first)).cash).toBe(150);
    const again = replayOf(first);
    expect(again.replay).toBe(true);
    expect(again.tutorial).toBe(true);
    expect(again.steps).toEqual(first.steps);
    expect(payout(again, createRun(again))).toMatchObject({ cash: 0, rep: 0 });
    expect(first.reward.cash).toBe(150); // the original plan is untouched
  });
});

describe('every step a plan uses is one the engine can finish', () => {
  it('uses only known step types, in all missions and the tutorial', () => {
    const plans = [tutorialPlan(mkEnv(7))];
    for (const def of DEFS) for (let seed = 1; seed <= 6; seed++) {
      let p = null;
      try { p = def.plan(mkEnv(seed * 31, { metro })); } catch { /* planners may decline */ }
      if (p) plans.push(p);
    }
    expect(plans.length).toBeGreaterThan(DEFS.length);
    for (const plan of plans) for (const s of plan.steps) expect(STEP_TYPES, `${plan.defId}: ${s.type}`).toContain(s.type);
  });

  it('a position that is not a number is not "inside" a reach ring', () => {
    const plan = { id: 't', defId: 't', title: 't', reward: { cash: 10, rep: 1 }, steps: [{ type: 'reach', x: 10, z: 10, r: 14, label: 'go' }] };
    const run = createRun(plan);
    tickRun(run, 0.1, { x: NaN, z: NaN, speed: 0, jolt: 0, distance: 0 });
    expect(run.status).toBe('active');
    tickRun(run, 0.1, { x: 10, z: 10, speed: 3, jolt: 0, distance: 0 });
    expect(run.status).toBe('done');
  });
});

describe('the job board is not re-rolled under the player', () => {
  const base = { force: false, dirty: false, age: 0, stale: 25, empty: false, boardOpen: false };
  it('re-rolls when stale or dirty away from the board', () => {
    expect(shouldRebuildOffers({ ...base, age: 30 })).toBe(true);
    expect(shouldRebuildOffers({ ...base, dirty: true })).toBe(true);
    expect(shouldRebuildOffers(base)).toBe(false);
  });
  it('keeps the offers the player is reading, however long they take', () => {
    expect(shouldRebuildOffers({ ...base, age: 600, dirty: true, boardOpen: true })).toBe(false);
  });
  it('but always builds when asked to (opening the board) or when there is nothing yet', () => {
    expect(shouldRebuildOffers({ ...base, force: true, boardOpen: true })).toBe(true);
    expect(shouldRebuildOffers({ ...base, empty: true, boardOpen: true })).toBe(true);
  });
});

describe('createTrainTracker (the velocity Metro Rush plans with)', () => {
  const trains = () => [{ x: 0, z: 0 }, { x: 100, z: 0 }];
  it('measures speed over world time', () => {
    const ts = trains();
    const tr = createTrainTracker(ts);
    let sim = 0;
    tr.update(sim);
    for (let i = 0; i < 90; i++) { // 1.5 s at 60 fps, train 0 moving +x at 14 m/s, train 1 standing
      sim += 1 / 60;
      ts[0].x += 14 / 60;
      tr.update(sim);
    }
    expect(Math.hypot(tr.tracks[0].vx, tr.tracks[0].vz)).toBeCloseTo(14, 0);
    expect(tr.tracks[1].vx).toBe(0);
  });
  it('a menu (world clock frozen) leaves the measured velocity alone instead of reading the trains as stopped', () => {
    const ts = trains();
    const tr = createTrainTracker(ts);
    let sim = 0;
    tr.update(sim);
    for (let i = 0; i < 60; i++) { sim += 1 / 60; ts[0].x += 14 / 60; tr.update(sim); }
    const before = tr.tracks[0].vx;
    expect(before).toBeGreaterThan(10);
    for (let i = 0; i < 600; i++) tr.update(sim); // ten seconds in the job board: sim time does not advance
    expect(tr.tracks[0].vx).toBe(before);
    for (let i = 0; i < 60; i++) { sim += 1 / 60; ts[0].x += 14 / 60; tr.update(sim); }
    expect(tr.tracks[0].vx).toBeGreaterThan(10);
  });
  it('ignores junk times and a clock that goes backwards', () => {
    const tr = createTrainTracker(trains());
    expect(() => { tr.update(NaN); tr.update(undefined); tr.update(5); tr.update(2); tr.update(Infinity); }).not.toThrow();
  });
});

describe('the daily job', () => {
  it('is the same for the same date, from a fixed pool, paying 1.5x', () => {
    const a = dailyJob(env, '2026-11-25');
    const b = dailyJob(env, '2026-11-25');
    expect(a.defId).toBe(b.defId);
    expect(DAILY_POOL).toContain(a.defId);
    if (a.plan) {
      expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
      expect(a.plan.mult).toBe(1.5);
      expect(a.plan.id).toBe('daily');
      expect(a.plan.daily).toBe(true);
    }
  });
  it('changes over a month', () => {
    const ids = new Set();
    for (let d = 1; d <= 28; d++) ids.add(dailyJob(env, `2026-11-${String(d).padStart(2, '0')}`)?.defId);
    expect(ids.size).toBeGreaterThan(2);
    expect(typeof dateKey()).toBe('string');
  });
});
