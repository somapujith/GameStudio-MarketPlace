// The operations layer in the scene: pure view maths, turning round to the back counter, the weather look, rain, the events in the world, and the sync
// layer's reaction to prep / tend / gas / inspector events (with stubs: no WebGL).
import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Vector3, Group, Scene } from 'three';
import { GAS, HEAT, LAYOUT, STATIONS } from '../../../../shared/tiffin-centre/catalog.js';
import { standX, workTarget } from '../../../../shared/tiffin-centre/movement.js';
import {
  approach, clamp, eventFlags, eventOf, gasView, flamePower, swapPose, panView, stockOf, offKey, customerMarks, inspectorPos, deliveryBikePos, hasEvent,
  STOCK_FULL, SHELF_BATTERS, SHELF_JARS,
} from './ops-view.js';
import {
  autoGoal, aimAt, turnYaw, turnAmount, addManual, edgeHint, TURN_MAX, TURN_START, STRAIGHT_BEHIND, VIEW, VIEW_TURN, REST_PITCH, clampLook, stepLook,
} from './camera.js';
import { createCameraRig } from './rig.js';
import { cameraProjector, pickFromProxies } from './picking.js';
import { lightingAt, makeLighting, applyWeather, applyPower } from './lighting.js';
import { slotVisual, flawOf, workForEvent, actionSeqFor, SEQ, seqDuration, ACTION_KINDS } from './interp.js';
import { WORK_MS } from '../../../../shared/tiffin-centre/movement.js';
import { ROOF, roofY, underRoof, dropY, fallTime, streakCount, createWeather } from './weather.js';
import { FADE, GENERATOR_DELAY, makeLevels, stepLevels, hangingLine, createEventsFx } from './events-fx.js';
import { createSync, nightOf } from './sync.js';
import { QUALITY } from './quality.js';
import { makeArt } from './art.js';
import { createTracker } from './tracker.js';

const settle = (rig, secs = 3) => {
  for (let i = 0; i < secs * 60; i++) rig.update(1 / 60, i / 60);
};
const mkRig = () => {
  const cam = new PerspectiveCamera(74, 1.6, 0.05, 160);
  const rig = createCameraRig(cam);
  rig.setAspect(1.6, 800, 500);
  return { cam, rig };
};
const D2R = Math.PI / 180;

describe('ops view maths', () => {
  it('approach moves a level towards its target without overshoot, frame-rate independent, and snaps when it is there', () => {
    let a = 0;
    for (let i = 0; i < 1800; i++) {
      const b = approach(a, 1, 1 / 60, 2, 3);
      expect(b).toBeGreaterThanOrEqual(a);
      expect(b).toBeLessThanOrEqual(1);
      a = b;
    }
    expect(a).toBe(1);
    const x = (dt, n) => {
      let v = 0;
      for (let i = 0; i < n; i++) v = approach(v, 1, dt, 2, 2);
      return v;
    };
    expect(x(1 / 30, 30)).toBeCloseTo(x(1 / 120, 120), 3);
    // different time constants up and down
    expect(approach(0, 1, 0.5, 0.2, 5)).toBeGreaterThan(0.9); // fast up
    expect(1 - approach(1, 0, 0.5, 0.2, 5)).toBeLessThan(0.15); // slow down
  });

  it('reads events from the state, tolerating a state without them', () => {
    expect(hasEvent({ events: [{ id: 'rain', until: 9 }] }, 'rain')).toBe(true);
    expect(hasEvent({ events: [{ id: 'rain', until: 9 }] }, 'power')).toBe(false);
    expect(hasEvent({}, 'rain')).toBe(false);
    expect(hasEvent(null, 'rain')).toBe(false);
    expect(eventOf({ events: [{ id: 'inspector', until: 70 }] }, 'inspector').until).toBe(70);
    const f = eventFlags({ events: [{ id: 'power', until: 3 }, { id: 'cricket', until: 4 }] });
    expect(f).toEqual({ rain: false, power: true, cricket: true, festival: false, inspector: false, delivery: false });
  });

  it('the cylinder: full, low, empty, being changed (progress across ticks), and none on levels without gas', () => {
    const base = { cfg: { gas: true }, gas: { u: GAS.cap, sw: 0 } };
    const full = gasView(base, 0);
    expect(full).toMatchObject({ has: true, frac: 1, low: false, empty: false, swapping: false, burners: true });
    const low = gasView({ ...base, gas: { u: GAS.cap * 0.15, sw: 0 } }, 0);
    expect(low.low).toBe(true);
    expect(low.burners).toBe(true);
    expect(flamePower(low)).toBeLessThan(1);
    expect(flamePower(low)).toBeGreaterThan(0.5);
    const out = gasView({ ...base, gas: { u: 0, sw: 0 } }, 0);
    expect(out).toMatchObject({ empty: true, burners: false, low: false });
    expect(flamePower(out)).toBe(0);
    // a change: sw counts down from GAS.swapTicks; the burners are off all through it
    const first = gasView({ ...base, gas: { u: 0, sw: GAS.swapTicks } }, 0);
    const mid = gasView({ ...base, gas: { u: 0, sw: GAS.swapTicks / 2 } }, 0.5);
    const last = gasView({ ...base, gas: { u: 0, sw: 1 } }, 0.99);
    expect(first.swapping && mid.swapping && last.swapping).toBe(true);
    expect(first.burners || mid.burners || last.burners).toBe(false);
    expect(first.swapT).toBeCloseTo(0, 5);
    expect(mid.swapT).toBeGreaterThan(0.5);
    expect(last.swapT).toBeLessThanOrEqual(1);
    expect(last.swapT).toBeGreaterThan(mid.swapT);
    // no gas on the level (or in the tutorial): burners always on, a full-looking cylinder
    for (const s of [{ cfg: {} }, { cfg: { gas: false }, gas: null }, { cfg: { gas: true, tutorial: true }, gas: { u: 0, sw: 0 } }, null, undefined]) {
      expect(gasView(s, 0)).toMatchObject({ has: false, burners: true, frac: 1, swapping: false });
    }
  });

  it('the change carries the old cylinder away first, then the spare is brought in; never both at once', () => {
    const p = { out: 0, inn: 0 };
    swapPose(0, p);
    expect(p).toEqual({ out: 0, inn: 0 });
    swapPose(0.2, p);
    expect(p.out).toBeGreaterThan(0.1);
    expect(p.inn).toBe(0);
    swapPose(0.5, p);
    expect(p.out).toBe(1);
    expect(p.inn).toBe(0); // the stand stands empty
    swapPose(0.8, p);
    expect(p.inn).toBeGreaterThan(0.3);
    swapPose(1, p);
    expect(p).toEqual({ out: 1, inn: 1 });
    // monotonic
    let po = 0;
    let pi = 0;
    for (let i = 0; i <= 100; i++) {
      swapPose(i / 100, p);
      expect(p.out).toBeGreaterThanOrEqual(po);
      expect(p.inn).toBeGreaterThanOrEqual(pi);
      po = p.out;
      pi = p.inn;
    }
  });

  it('pan view: glow, hot / cold beyond the band, crust from the gunk (full at the torn threshold), the steamer water', () => {
    const ideal = panView({ heat: HEAT.ideal, gunk: 0 });
    expect(ideal.hot).toBe(0);
    expect(ideal.cold).toBe(0);
    expect(ideal.gunk).toBe(0);
    expect(ideal.glow).toBeCloseTo(HEAT.ideal / 100, 5);
    const hot = panView({ heat: 95, gunk: HEAT.torn });
    expect(hot.hot).toBeGreaterThan(0.5);
    expect(hot.gunk).toBe(1);
    expect(hot.torn).toBe(true);
    expect(hot.stuck).toBe(true);
    expect(panView({ heat: 10, gunk: 0 }).cold).toBeGreaterThan(0.5);
    expect(panView({ heat: HEAT.hot, gunk: HEAT.stick }).stuck).toBe(true);
    expect(panView({ heat: 50, gunk: HEAT.stick - 1 }).stuck).toBe(false);
    const dry = panView({ water: 0, gunk: 0 });
    expect(dry).toMatchObject({ water: 0, dry: true, low: true });
    expect(panView({ water: HEAT.waterStart }).water).toBe(1);
    // a pan without the layer's fields is a healthy pan
    expect(panView({})).toMatchObject({ hot: 0, cold: 0, gunk: 0, dry: false });
    expect(panView(null).gunk).toBe(0);
  });

  it('stock on the shelves: a level, a sliver while anything is left, sourness from freshness, null when not stocked', () => {
    const s = { stock: { batter_dosa: 10, sambar: 0, podi_ghee: 0.5, batter_idly: 40 }, fresh: { batter_dosa: 100, batter_idly: 20 } };
    expect(stockOf(s, 'batter_dosa')).toMatchObject({ fill: 10 / STOCK_FULL, sour: 0, isSour: false });
    expect(stockOf(s, 'sambar').fill).toBe(0);
    expect(stockOf(s, 'podi_ghee').fill).toBeGreaterThanOrEqual(0.06);
    expect(stockOf(s, 'batter_idly').fill).toBe(1); // overflow clamps
    expect(stockOf(s, 'batter_idly').sour).toBeGreaterThan(0.6);
    expect(stockOf(s, 'batter_idly').isSour).toBe(true);
    expect(stockOf(s, 'nothing')).toBeNull();
    expect(stockOf({}, 'batter_dosa')).toBeNull();
    expect(SHELF_BATTERS.length).toBe(3);
    expect(SHELF_JARS.length).toBe(4);
  });

  it('the board: a stable key of the dishes taken off', () => {
    expect(offKey({ off: [] })).toBe('');
    expect(offKey({})).toBe('');
    expect(offKey({ off: ['dosa', 'idly'] })).toBe('dosa,idly');
  });

  it('customer marks: a parcel (not for the delivery boy, who has his bag), a regular, the delivery boy', () => {
    expect(customerMarks({ parcel: 1 })).toEqual({ parcel: true, regular: false, delivery: false });
    expect(customerMarks({ parcel: 1, delivery: 1 })).toEqual({ parcel: false, regular: false, delivery: true });
    expect(customerMarks({ regular: true, rid: 0 }).regular).toBe(true);
    expect(customerMarks(null)).toEqual({ parcel: false, regular: false, delivery: false });
  });

  it('the inspector stands beyond the last spot of the level, the rider parks beyond the first, both on the footpath side of the customers', () => {
    for (const spots of [4, 5, 6]) {
      const p = inspectorPos(spots);
      expect(p.x).toBeGreaterThan(LAYOUT.spotX(spots - 1));
      expect(p.z).toBeLessThan(LAYOUT.counterZ);
      expect(p.z).toBeGreaterThan(LAYOUT.spotZ - 0.5);
    }
    const b = deliveryBikePos();
    expect(b.x).toBeLessThan(LAYOUT.spotX(0));
    expect(b.z).toBeLessThan(LAYOUT.spotZ);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

describe('turning round to the back counter', () => {
  const prepPoint = { x: STATIONS.prep1.x, y: 0.95, z: STATIONS.prep1.z + 0.1 };

  it('free look still stops at LAYOUT.view.yawMax, but the turn limit is 170 degrees', () => {
    expect(VIEW.yawMax).toBe(1.45);
    expect(TURN_MAX).toBeCloseTo(170 * D2R, 9);
    expect(VIEW_TURN.yawMax).toBe(TURN_MAX);
    expect(clampLook({ yaw: 9, pitch: 0 }).yaw).toBe(VIEW.yawMax);
  });

  it('the auto head-turn takes a target behind the whole way round, over the shoulder it was turning to, and still only leads gently to the front', () => {
    const behind = autoGoal(STATIONS.prep1.x, prepPoint, { yaw: 0, pitch: 0 }, 0);
    expect(behind.yaw).toBeGreaterThan(2.8);
    expect(behind.yaw).toBeLessThanOrEqual(TURN_MAX + 1e-9);
    expect(behind.pitch).toBeLessThan(0); // looking down at the counter
    // the sign is held by the head's own side when the target is straight behind
    const left = autoGoal(STATIONS.prep1.x, prepPoint, { yaw: 0, pitch: 0 }, -1.2);
    expect(left.yaw).toBeLessThan(-2.8);
    // a target on the counter row in front (even far along the line) keeps the old gentle lead (<= 0.75)
    const far = autoGoal(STATIONS.tawa1.x, { x: STATIONS.chai1.x, y: 0.95, z: STATIONS.chai1.z }, { yaw: 0, pitch: 0 });
    expect(far.yaw).toBeLessThanOrEqual(0.75 + 1e-9);
    // a half-turn (the gas stand, behind and to the left) is most of the way round
    const gas = autoGoal(standX('gas'), { x: LAYOUT.gas.x, y: 0.55, z: LAYOUT.gas.z }, { yaw: 0, pitch: 0 });
    expect(gas.yaw).toBeLessThan(-1.7);
    expect(gas.yaw).toBeGreaterThan(-TURN_MAX);
    // continuous in the target's bearing: no jump as it moves round behind
    let prev = null;
    for (let deg = 60; deg <= 179; deg += 1) {
      const a = deg * D2R;
      const g = autoGoal(0, { x: Math.sin(a) * 3, y: 0.95, z: -Math.cos(a) * 3 }, { yaw: 0, pitch: 0 }, 1);
      if (prev !== null) expect(Math.abs(g.yaw - prev)).toBeLessThan(0.12);
      prev = g.yaw;
    }
  });

  it('turnYaw clamps to the limit and keeps the side of the reference when the target is straight behind', () => {
    expect(turnYaw(Math.PI, 0.3)).toBeCloseTo(TURN_MAX, 9);
    expect(turnYaw(Math.PI, -0.3)).toBeCloseTo(-TURN_MAX, 9);
    expect(turnYaw(-Math.PI, 0.3)).toBeCloseTo(TURN_MAX, 9);
    expect(turnYaw(2.0, -1)).toBeCloseTo(2.0, 9); // not straight behind: its own side
    expect(turnYaw(-0.4, 5)).toBeCloseTo(-0.4, 9);
    expect(STRAIGHT_BEHIND).toBeLessThan(TURN_MAX);
    expect(TURN_START).toBeGreaterThan(1.45);
  });

  it('the head swings to the prep counter (about 170 degrees), faces it, and comes back by itself', () => {
    const { cam, rig } = mkRig();
    rig.setBody(STATIONS.prep1.x, 0);
    settle(rig, 0.5);
    rig.setAuto(prepPoint);
    settle(rig, 3);
    const look = rig.getLook();
    expect(look.yaw).toBeGreaterThan(2.8);
    expect(look.yaw).toBeLessThanOrEqual(TURN_MAX + 1e-6);
    const d = cam.getWorldDirection(new Vector3());
    expect(d.z).toBeGreaterThan(0.9); // facing +z, the back counter
    expect(rig.turn).toBeGreaterThan(0.9); // the shoulders came round
    // the prep counter is dead ahead on the screen
    const p = new Vector3(STATIONS.prep1.x, 1.0, STATIONS.prep1.z).project(cam);
    expect(Math.abs(p.x)).toBeLessThan(0.15);
    expect(p.z).toBeLessThan(1);
    // let go: it turns back to the front
    rig.setAuto(null);
    settle(rig, 5);
    expect(Math.abs(rig.getLook().yaw)).toBeLessThan(0.05);
    expect(rig.turn).toBeLessThan(0.05);
    expect(rig.getLook().pitch).toBeCloseTo(REST_PITCH, 1);
  });

  it('the turn is smooth: it never jumps and never overshoots the limit', () => {
    const { rig } = mkRig();
    rig.setBody(STATIONS.prep1.x, 0);
    settle(rig, 0.5);
    rig.setAuto(prepPoint);
    let prev = rig.getLook().yaw;
    let maxStep = 0;
    for (let i = 0; i < 240; i++) {
      rig.update(1 / 60, i / 60);
      const y = rig.getLook().yaw;
      maxStep = Math.max(maxStep, Math.abs(y - prev));
      expect(y).toBeLessThanOrEqual(TURN_MAX + 1e-6);
      prev = y;
    }
    expect(maxStep).toBeLessThan(0.1); // under TURN_SPEED per frame at 60 fps
  });

  it('a lookAt pin on the prep counter holds the head round and releases to rest; the gas stand pins to the left shoulder', () => {
    const { rig } = mkRig();
    rig.setBody(0, 0);
    rig.setPinned({ x: STATIONS.prep1.x, y: 1.0, z: STATIONS.prep1.z - 0.3 });
    settle(rig, 3);
    expect(Math.abs(rig.getLook().yaw)).toBeGreaterThan(2.0);
    rig.setPinned(null);
    settle(rig, 6);
    expect(Math.abs(rig.getLook().yaw)).toBeLessThan(0.05);
    rig.setBody(standX('gas'), 0);
    rig.reset();
    rig.setPinned({ x: LAYOUT.gas.x, y: 0.55, z: LAYOUT.gas.z });
    settle(rig, 3);
    expect(rig.getLook().yaw).toBeLessThan(-1.8);
  });

  it('free-look nudges while turned round are measured from there (they never snap the head forwards), and clamp at the turn limit', () => {
    const m = { yaw: 0, pitch: 0 };
    const base = { yaw: 2.9, pitch: -0.3 };
    addManual(m, 0, 0, base);
    expect(base.yaw + m.yaw).toBeCloseTo(2.9, 9); // no nudge, no snap to the field of view
    addManual(m, 0.4, 0, base);
    expect(base.yaw + m.yaw).toBeCloseTo(2.9, 9); // can't turn further than the head is
    addManual(m, -0.3, 0, base);
    expect(base.yaw + m.yaw).toBeCloseTo(2.6, 9);
    // from the front the limit is still the field of view
    const m2 = { yaw: 0, pitch: 0 };
    addManual(m2, 9, 0, { yaw: 0, pitch: 0 });
    expect(m2.yaw).toBeCloseTo(VIEW.yawMax, 9);
    // stepLook can reach the turn limit when given the wide view
    const l = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 400; i++) stepLook(l, { yaw: 9, pitch: 0 }, 9, 1 / 60, VIEW_TURN);
    expect(l.yaw).toBeCloseTo(TURN_MAX, 3);
  });

  it('targets behind get an edge hint ("behind") on the side they are on, and become pickable once the head is round', () => {
    const W = 800;
    const H = 500;
    const { cam, rig } = mkRig();
    rig.setBody(0, 0);
    rig.reset();
    rig.update(1 / 60, 0);
    cam.updateMatrixWorld();
    const projector = cameraProjector(cam, () => ({ w: W, h: H }));
    const out = { x: 0, y: 0, depth: 0, vx: 0, vy: 0 };
    projector.project(new Vector3(STATIONS.prep1.x, 1.0, STATIONS.prep1.z - 0.3), out);
    expect(out.depth).toBeLessThanOrEqual(0);
    const edge = edgeHint(out.x, out.y, out.depth, out.vx, out.vy, W, H, 30, { side: null, x: 0, y: 0 });
    expect(edge.side).toBe('behind');
    // turned round, the same point is on the screen and a tap on it picks the station
    rig.setBody(STATIONS.prep1.x, 0);
    rig.setAuto(prepPoint);
    settle(rig, 3);
    cam.updateMatrixWorld();
    const proxies = [{ kind: 'station', target: { kind: 'station', station: 'prep1' }, a: { x: STATIONS.prep1.x, y: 0.95, z: STATIONS.prep1.z - 0.3 }, radius: 0.62 }];
    projector.project(proxies[0].a, out);
    expect(out.depth).toBeGreaterThan(0);
    expect(pickFromProxies(proxies, out.x, out.y, projector)).toEqual({ kind: 'station', station: 'prep1' });
    expect(pickFromProxies(proxies, 5, 5, projector)).toBeNull();
  });

  it('the back counter and the gas stand are legal work targets of the engine actions the scene watches', () => {
    expect(workTarget({ type: 'prep', station: 'prep1' })).toBe('prep1');
    expect(workTarget({ type: 'swapGas' })).toBe('gas');
    expect(standX('prep1')).toBe(STATIONS.prep1.x);
    expect(standX('gas')).toBeCloseTo(LAYOUT.gas.x + 0.4, 9);
  });
});

describe('the look of rain and a power cut', () => {
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it('rain darkens and greys the day, drops the sun and its shadow and shafts, wets the road, brings the lamps on, and fades smoothly', () => {
    const dry = lightingAt(12.4);
    const rain = lightingAt(12.4, makeLighting(), { rain: 1, power: 0 });
    expect(rain.rain).toBe(1);
    expect(lum(rain.top)).toBeLessThan(lum(dry.top) * 0.85);
    expect(rain.si).toBeLessThan(dry.si * 0.4);
    expect(rain.shadow).toBeLessThan(dry.shadow * 0.3);
    expect(rain.shaft).toBe(0);
    expect(rain.wet).toBeGreaterThan(0.95);
    expect(rain.fd).toBeGreaterThan(dry.fd);
    expect(rain.bulb).toBeGreaterThan(0.5);
    expect(rain.sodium).toBeGreaterThan(0.3);
    expect(rain.cover).toBe(1);
    expect(rain.sat).toBeLessThan(dry.sat);
    // grey: the sky's channels are closer together than a clear blue sky
    const spread = (c) => Math.max(...c) - Math.min(...c);
    expect(spread(rain.top)).toBeLessThan(spread(dry.top));
    // smooth in the level: no jump between 0 and 1
    let prev = lightingAt(12.4, makeLighting(), { rain: 0, power: 0 }).si;
    for (let i = 1; i <= 20; i++) {
      const si = lightingAt(12.4, makeLighting(), { rain: i / 20, power: 0 }).si;
      expect(si).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - si).toBeLessThan(0.4 * dry.si);
      prev = si;
    }
    // no weather input = the plain hour, untouched
    expect(lightingAt(12.4, makeLighting(), null).si).toBe(dry.si);
    expect(lightingAt(12.4, makeLighting(), { rain: 0, power: 0 }).wet).toBe(dry.wet);
  });

  it('rain at night stays a night (never lighter than the dry night) and keeps every channel finite', () => {
    for (const h of [0, 3, 5.5, 7, 12, 17.3, 19.3, 22]) {
      const dry = lightingAt(h);
      const rain = lightingAt(h, makeLighting(), { rain: 1, power: 0.5 });
      for (const c of ['top', 'mid', 'hor', 'sun', 'hs', 'hg', 'fog', 'cloud', 'gl', 'gg']) for (const v of rain[c]) expect(Number.isFinite(v)).toBe(true);
      for (const n of ['si', 'hi', 'fd', 'bulb', 'tube', 'neon', 'sodium', 'exposure', 'env', 'wet', 'shadow', 'shaft', 'grid', 'rain']) expect(Number.isFinite(rain[n])).toBe(true);
      expect(rain.si).toBeLessThanOrEqual(dry.si + 1e-9);
    }
  });

  it('a power cut takes the mains lights out (bulbs, tube, neon, sodium lamps) and flags the grid for the shop signs', () => {
    const on = lightingAt(21);
    const cut = lightingAt(21, makeLighting(), { rain: 0, power: 1 });
    expect(on.bulb).toBeGreaterThan(0.9);
    expect(cut.bulb).toBe(0);
    expect(cut.tube).toBe(0);
    expect(cut.neon).toBe(0);
    expect(cut.sodium).toBe(0);
    expect(cut.grid).toBe(0);
    expect(on.grid).toBe(1);
    expect(cut.night).toBe(on.night); // the sky is still the night's
    const half = lightingAt(21, makeLighting(), { rain: 0, power: 0.5 });
    expect(half.bulb).toBeCloseTo(on.bulb * 0.5, 6);
    expect(half.grid).toBeCloseTo(0.5, 9);
  });

  it('the snapshot resets between frames: a reused object does not keep last frame\'s rain or cut', () => {
    const L = makeLighting();
    lightingAt(12, L, { rain: 1, power: 1 });
    expect(L.rain).toBe(1);
    lightingAt(12, L, null);
    expect(L.rain).toBe(0);
    expect(L.grid).toBe(1);
    expect(L.wet).toBeCloseTo(lightingAt(12).wet, 9);
    // direct use
    applyWeather(L, 0);
    applyPower(L, 0);
    expect(L.grid).toBe(1);
  });
});

describe('interp: operations events', () => {
  it('slot visuals carry the back-counter item and the dish flaw', () => {
    const job = { st: 'cooking', item: 'batter_dosa', t0: 4, readyAt: 16, by: 'p1' };
    expect(slotVisual(job, 10)).toMatchObject({ st: 'cooking', item: 'batter_dosa', progress: 0.5, flaw: '' });
    expect(slotVisual({ ...job, st: 'ready' }, 40)).toMatchObject({ st: 'ready', item: 'batter_dosa', progress: 1, burnFrac: 0 }); // jobs never burn
    expect(slotVisual({ st: 'ready', dish: 'dosa', readyAt: 5, burnAt: 12, fl: 2 }, 6).flaw).toBe('torn');
    expect(slotVisual({ st: 'ready', dish: 'dosa', readyAt: 5, burnAt: 12, fl: 1 }, 6).flaw).toBe('stuck');
    expect(slotVisual({ st: 'cooking', dish: 'idly', t0: 1, readyAt: 8, fl: 4 }, 3).flaw).toBe('sour');
    expect(slotVisual({ st: 'empty' }, 3)).toMatchObject({ st: 'empty', item: null, flaw: '' });
    expect(flawOf(3)).toBe('torn');
    expect(flawOf(0)).toBe('');
    expect(flawOf(undefined)).toBe('');
    // writes into the object it is given (no allocation per frame)
    const tmp = {};
    expect(slotVisual(job, 10, tmp)).toBe(tmp);
  });

  it('prep, tend and the cylinder change drive the hands with the existing twelve actions, for about as long as the work pause', () => {
    const kinds = (seq) => seq.map((s) => s[0]);
    expect(kinds(actionSeqFor({ type: 'prep-start', station: 'prep1', slot: 0 }))).toEqual(['tawa-fill', 'tawa-spread']);
    expect(kinds(actionSeqFor({ type: 'prep-collect', station: 'prep1', slot: 0 }))).toEqual(['tawa-take', 'collect']);
    expect(kinds(actionSeqFor({ type: 'tend', station: 'tawa1', kind: 'wipe' }))).toEqual(['tawa-oil', 'tawa-spread']);
    expect(kinds(actionSeqFor({ type: 'tend', station: 'kadai1', kind: 'skim' }))).toEqual(['kadai']);
    expect(kinds(actionSeqFor({ type: 'tend', station: 'steamer1', kind: 'water' }))).toEqual(['steamer']);
    expect(kinds(actionSeqFor({ type: 'gas-swap', phase: 'start' }))).toEqual(['discard', 'collect']);
    expect(actionSeqFor({ type: 'gas-swap', phase: 'done' })).toBeNull();
    expect(actionSeqFor({ type: 'prep-done', station: 'prep1' })).toBeNull();
    expect(actionSeqFor({ type: 'prep-start', station: 'tawa1' })).toBeNull(); // only the back counter
    expect(actionSeqFor({ type: 'tend', station: 'chai1' })).toBeNull();
    for (const s of [SEQ.prep, SEQ.prepTake, SEQ.tendWipe, SEQ.swapGas]) {
      expect(seqDuration(s)).toBeGreaterThan(WORK_MS / 1000 - 0.2);
      expect(seqDuration(s)).toBeLessThan(WORK_MS / 1000 + 0.15);
      for (const a of s) expect(ACTION_KINDS).toContain(a[0]);
    }
  });

  it('maps the new events to the nearest existing avatar work pose', () => {
    expect(workForEvent({ type: 'prep-start', station: 'prep1', by: 'p1' })).toMatchObject({ kind: 'tawa', verb: 'prep', station: 'prep1' });
    expect(workForEvent({ type: 'prep-collect', station: 'prep1', by: 'p1' })).toMatchObject({ kind: 'tawa', verb: 'take' });
    expect(workForEvent({ type: 'tend', station: 'tawa1', by: 'p1' })).toMatchObject({ kind: 'tawa', verb: 'tend' });
    expect(workForEvent({ type: 'tend', station: 'steamer1', by: 'p1' }).kind).toBe('steamer');
    expect(workForEvent({ type: 'tend', station: 'kadai1', by: 'p1' }).kind).toBe('kadai');
    expect(workForEvent({ type: 'gas-swap', phase: 'start', by: 'p1' })).toMatchObject({ verb: 'swap' });
    expect(workForEvent({ type: 'gas-swap', phase: 'done', by: 'p1' })).toBeNull();
    expect(workForEvent({ type: 'tend', station: 'nope', by: 'p1' })).toBeNull();
    expect(workForEvent({ type: 'prep-done', station: 'prep1' })).toBeNull();
  });
});

describe('rain (weather.js)', () => {
  it('the roof: its underside rises to the back, and rain cannot reach under it', () => {
    expect(roofY(ROOF.frontZ)).toBeCloseTo(ROOF.frontY, 5);
    expect(roofY(ROOF.rearZ)).toBeCloseTo(ROOF.rearY, 5);
    expect(roofY(0)).toBeGreaterThan(roofY(-1.5));
    expect(underRoof(0, 1.5, 0)).toBe(true);
    expect(underRoof(0, 5, 0)).toBe(false); // above the tin
    expect(underRoof(0, 1, -3)).toBe(false); // out in front of the awning
    expect(underRoof(6, 1, 0)).toBe(false); // beside the stall
    expect(underRoof(0, 1, ROOF.rearZ + 1)).toBe(false); // behind it
  });

  it('a drop falls under gravity and lands once; the fall time matches', () => {
    expect(dropY(0, 2.5, 0).y).toBe(2.5);
    expect(dropY(0.3, 2.5, 0).landed).toBe(false);
    const tf = fallTime(2.5, 0);
    expect(tf).toBeCloseTo(Math.sqrt((2 * 2.5) / 9.8), 9);
    expect(dropY(tf + 0.01, 2.5, 0)).toEqual({ y: 0, landed: true });
    expect(dropY(0.2, 2.5, 0).y).toBeLessThan(2.5);
    expect(fallTime(1, 2)).toBe(0);
  });

  it('streak counts follow the tier: none on low (the lens film instead), more on high', () => {
    expect(streakCount(QUALITY.low)).toBe(0);
    expect(streakCount(QUALITY.medium)).toBeGreaterThan(200);
    expect(streakCount(QUALITY.high)).toBeGreaterThan(streakCount(QUALITY.medium));
    expect(streakCount(null)).toBe(0);
  });

  const mkWeather = (tier, camera = null, roofGaps = [{ x: -1, w: 0.06 }, { x: 0.5, w: 0.08 }]) => {
    const scene = new Scene();
    const tr = createTracker();
    const art = makeArt(tr);
    const w = createWeather({ scene, camera, art, tr, quality: { ...QUALITY[tier], texSize: 128, normalMaps: false }, roofGaps });
    return { scene, w, tr };
  };

  it('draws nothing when dry, streaks and drops and rings in the rain, and fades out again', () => {
    const { scene, w } = mkWeather('medium');
    const draws = () => {
      let n = 0;
      w.root.traverse((o) => {
        if ((o.isPoints || o.isMesh) && o.visible) n++;
      });
      return n;
    };
    w.update(1 / 60, 0, 0);
    expect(draws()).toBe(0);
    expect(w.stats.streaks).toBeGreaterThan(200);
    for (let i = 0; i < 180; i++) w.update(1 / 60, i / 60, 1);
    expect(draws()).toBeGreaterThan(1);
    let streaks = null;
    w.root.traverse((o) => {
      if (o.isMesh && o.geometry.index && o.geometry.attributes.position.count > 1000) streaks = o;
    });
    expect(streaks.visible).toBe(true);
    expect(streaks.material.opacity).toBeGreaterThan(0.2);
    const pos = streaks.geometry.attributes.position.array;
    // every visible streak is slanted (the tip is up and to the right of the tail) and none is under the tin
    let n = 0;
    for (let i = 0; i < pos.length; i += 12) {
      if (pos[i + 1] < -10) continue;
      expect(pos[i + 10]).toBeGreaterThan(pos[i + 1]); // the tip is above the tail
      expect(pos[i + 9]).toBeGreaterThan(pos[i] - 0.1); // and leans with the wind
      expect(underRoof(pos[i], pos[i + 1], pos[i + 2])).toBe(false);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    for (let i = 0; i < 60; i++) w.update(1 / 60, 3 + i / 60, 0);
    expect(draws()).toBe(0);
    w.dispose();
    expect(scene.children).not.toContain(w.root);
  });

  it('is allocation-free in steady state (no growth of the scene graph while it rains)', () => {
    const { w } = mkWeather('high');
    const count = () => {
      let n = 0;
      w.root.traverse(() => n++);
      return n;
    };
    for (let i = 0; i < 30; i++) w.update(1 / 60, i / 60, 1);
    const before = count();
    for (let i = 0; i < 600; i++) w.update(1 / 60, 1 + i / 60, 0.8);
    expect(count()).toBe(before);
    w.dispose();
  });

  it('the low tier gets a faint streaked film on the lens instead of particles, which follows the level and is removed with the weather', () => {
    const cam = new PerspectiveCamera(74, 1.6, 0.05, 160);
    const { w } = mkWeather('low', cam);
    expect(w.stats.streaks).toBe(0);
    expect(w.stats.film).toBe(true);
    const film = cam.children.find((o) => o.isMesh);
    expect(film).toBeTruthy();
    w.update(1 / 60, 0, 0);
    expect(film.visible).toBe(false);
    w.update(1 / 60, 1, 1);
    expect(film.visible).toBe(true);
    expect(film.material.opacity).toBeGreaterThan(0.1);
    w.dispose();
    expect(cam.children.includes(film)).toBe(false);
  });

  it('drips come from the roof edge and through the gaps in the tin: leaks land on the counter at 0.84 m or on the floor', () => {
    const { w } = mkWeather('medium', null, [{ x: -3.7, w: 0.07 }, { x: 0.2, w: 0.09 }, { x: 3.9, w: 0.06 }]);
    expect(w.stats.drippers).toBeGreaterThan(24); // the edge + the leaks
    let pts = null;
    w.root.traverse((o) => {
      if (o.isPoints) pts = o;
    });
    for (let i = 0; i < 400; i++) w.update(1 / 60, i / 60, 1);
    const p = pts.geometry.attributes.position.array;
    let live = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < -10) continue;
      live++;
      expect(p[i + 1]).toBeLessThanOrEqual(roofY(p[i + 2]) + 0.01);
      expect(p[i + 1]).toBeGreaterThanOrEqual(-0.01);
    }
    expect(live).toBeGreaterThan(5);
    w.dispose();
  });
});

describe('the events in the world (events-fx.js)', () => {
  const mk = (tier = 'medium') => {
    const scene = new Scene();
    const tr = createTracker();
    const art = makeArt(tr);
    const fx = { emit: vi.fn(), burst: vi.fn() };
    const levels = makeLevels();
    const e = createEventsFx({ scene, art, tr, quality: { ...QUALITY[tier], texSize: 128, normalMaps: false }, fx, levels });
    return { scene, e, fx, levels };
  };

  it('levels fade towards their flags at the speeds of the event: a cut is sudden, the rain is slow', () => {
    const lv = makeLevels();
    const flags = { rain: true, power: true, cricket: true, festival: true };
    stepLevels(lv, flags, 0.5);
    expect(lv.power).toBeGreaterThan(0.9); // the mains go out at once
    expect(lv.rain).toBeLessThan(0.2);
    expect(lv.cricket).toBeLessThan(0.3);
    for (let i = 0; i < 60 * 45; i++) stepLevels(lv, flags, 1 / 60);
    expect(lv).toEqual({ rain: 1, power: 1, cricket: 1, festival: 1 });
    // the mains come back more slowly than they went (a flicker), the rain thins out slowly
    const back = { ...lv };
    stepLevels(back, {}, 0.5);
    expect(back.power).toBeGreaterThan(0.4);
    expect(back.rain).toBeGreaterThan(0.85);
    expect(FADE.power[0]).toBeLessThan(FADE.power[1]);
    expect(FADE.rain[0]).toBeLessThan(FADE.rain[1]);
    expect(GENERATOR_DELAY).toBeGreaterThan(1);
  });

  it('hangingLine droops by `sag` in the middle and meets both ends', () => {
    const pts = hangingLine([0, 2, 0], [4, 2, 0], 0.3, 8);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual([0, 2, 0]);
    expect(pts[8][0]).toBeCloseTo(4, 9);
    expect(pts[8][1]).toBeCloseTo(2, 9);
    expect(pts[4][1]).toBeCloseTo(1.7, 9);
    const out = [];
    hangingLine([0, 1, 0], [1, 1, 0], 0, 3, out);
    expect(out).toHaveLength(4);
  });

  it('builds for every tier, shows nothing until an event runs, and cleans up', () => {
    for (const tier of ['low', 'medium', 'high']) {
      const { scene, e } = mk(tier);
      const visible = () => {
        let n = 0;
        e.root.traverse((o) => {
          if (o.isMesh && o.visible && o.parent && (o.parent === e.root ? o.visible : o.parent.visible)) n++;
        });
        return n;
      };
      e.update(1 / 60, 0, { night: 0 });
      expect(e.root.children.filter((c) => c.visible && c.isGroup && c.name !== '').length).toBe(0);
      void visible;
      e.dispose();
      expect(scene.children).not.toContain(e.root);
    }
  });

  it('cricket gathers a crowd and lights the television; festival hangs garlands and lights; both vanish with their level', () => {
    const { e, levels } = mk('high');
    e.setFlags({ cricket: true, festival: true });
    levels.cricket = 1;
    levels.festival = 1;
    for (let i = 0; i < 120; i++) e.update(1 / 60, i / 60, { night: 1 });
    const groups = e.root.children.filter((c) => c.isGroup);
    // cricket group (tv, crowd, flags, bunting) and festival group (garland, lights, rangoli, cow)
    expect(groups.some((g) => g.visible && g.children.some((c) => c.isInstancedMesh))).toBe(true);
    let emissive = 0;
    e.root.traverse((o) => {
      if (o.isMesh && o.material?.emissiveIntensity > 0.5) emissive = Math.max(emissive, o.material.emissiveIntensity);
    });
    expect(emissive).toBeGreaterThan(0.5); // the screen glows
    levels.cricket = 0;
    levels.festival = 0;
    e.update(1 / 60, 3, { night: 1 });
    expect(e.root.children.filter((c) => c.isGroup && c.visible && c.children.some((x) => x.isInstancedMesh)).length).toBe(0);
    e.dispose();
  });

  it('a power cut cues the audio: the cut at once, the neighbour\'s generator after a couple of seconds, both off when the mains return', () => {
    const { e, fx, levels } = mk('medium');
    const cues = [];
    const off = e.onCue((c) => cues.push(c));
    e.setFlags({ power: true });
    levels.power = 1;
    e.update(0.05, 0, { night: 1 });
    expect(cues).toEqual([{ type: 'power', on: false }]);
    for (let t = 0; t < GENERATOR_DELAY - 0.3; t += 0.1) e.update(0.1, t, { night: 1 });
    expect(cues.length).toBe(1);
    for (let t = 0; t < 1; t += 0.1) e.update(0.1, 3 + t, { night: 1 });
    expect(cues).toContainEqual({ type: 'generator', on: true });
    expect(e.generatorOn).toBe(true);
    expect(fx.emit).toHaveBeenCalled(); // exhaust smoke
    e.setFlags({});
    e.update(0.1, 10, { night: 1 });
    expect(cues.map((c) => `${c.type}:${c.on}`)).toEqual(['power:false', 'generator:true', 'power:true', 'generator:false']);
    off();
    e.setFlags({ power: true });
    e.update(0.1, 11, { night: 1 });
    expect(cues.length).toBe(4); // unsubscribed
    e.dispose();
  });

  it('phone torches only show in a cut and follow the customers (at most four)', () => {
    const { e, levels } = mk('medium');
    const torches = () => e.root.children.filter((c) => c.isMesh && c.geometry?.type === 'ConeGeometry');
    e.setFlags({ power: true });
    levels.power = 1;
    e.setTorches([{ x: -1, z: -2.2 }, { x: 0, z: -2.2 }, { x: 1, z: -2.2 }, { x: 2, z: -2.2 }, { x: 3, z: -2.2 }], 9);
    e.update(0.05, 0, { night: 1 });
    expect(torches().filter((m) => m.visible).length).toBe(4);
    expect(torches().find((m) => m.visible).position.y).toBeGreaterThan(0.8);
    levels.power = 0;
    e.setFlags({});
    e.update(0.05, 1, { night: 1 });
    expect(torches().filter((m) => m.visible).length).toBe(0);
    e.dispose();
  });
});

describe('sync: the operations layer', () => {
  const stubStall = (ids = ['tawa1', 'chai1', 'prep1']) => {
    const stations = new Map();
    for (const id of ids) {
      const g = new Group();
      g.position.set(STATIONS[id].x, 0, STATIONS[id].z);
      const prop = {
        group: g, playAction: vi.fn(), playTend: vi.fn(), setSlot: vi.fn(), setBurner: vi.fn(), setHeat: vi.fn(), update() {}, dispose() {},
      };
      stations.set(id, { id, kind: STATIONS[id].kind, group: g, prop, anchors: [new Vector3(0, 0.95, 0.1), new Vector3(0.2, 0.95, 0.1)], front: id === 'prep1' ? -1 : 1 });
    }
    return {
      stations,
      binPos: new Vector3(LAYOUT.bin.x, 0, LAYOUT.bin.z),
      counterY: 0.97,
      setStations: vi.fn(),
      setSpots() {},
      setMenu: vi.fn(),
      setGas: vi.fn(),
      setPan: vi.fn(),
      setShelf: vi.fn(),
      bumpBin: vi.fn(),
      roofGaps: [{ x: -1, w: 0.06 }],
      slotWorld(id, i, out) {
        const s = stations.get(id);
        return s ? out.copy(s.anchors[Math.min(i, 1)]).add(s.group.position) : null;
      },
    };
  };
  const fxStub = () => ({ burst: vi.fn(), emit: vi.fn(), floatText: vi.fn() });
  const tr = { track: (o) => o };
  const art = { blob: () => null };
  const mk = () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(74, 1.6, 0.05, 160);
    scene.add(camera);
    const stall = stubStall();
    const fx = fxStub();
    const onShake = vi.fn();
    const sync = createSync({ scene, camera, stall, fx, art, tr, quality: {}, reducedMotion: false, onShake });
    return { scene, camera, stall, fx, sync, onShake };
  };
  const state = (over = {}) => ({
    tick: 5, cfg: { stations: ['tawa1', 'chai1', 'prep1'], spots: 6, menu: ['dosa'], hour: [18, 19], stock: true, heat: true, gas: true },
    shiftTicks: 100, order: ['p1'], players: { p1: { id: 'p1', name: 'Me', at: null, hands: [] } },
    stations: {
      tawa1: { slots: [{ st: 'empty' }], heat: 50, gunk: 0, tendAt: 0 }, chai1: { slots: [{ st: 'empty' }] },
      prep1: { slots: [{ st: 'empty', item: null }, { st: 'empty', item: null }] },
    },
    customers: [], stock: { batter_dosa: 12, sambar: 8 }, fresh: { batter_dosa: 90 }, gas: { u: 800, sw: 0 }, off: [], events: [], ...over,
  });
  const run = (sync, secs, now = 1000) => {
    for (let i = 0; i < secs * 60; i++) {
      sync.advance(1 / 60);
      sync.update(1 / 60, i / 60, now + i * 16, { yaw: 0, pitch: 0 });
    }
  };

  it('passes the stock, the board and the pans to the stall; the board follows state.off', () => {
    const { sync, stall } = mk();
    sync.setMe('p1');
    const s = state();
    sync.setState(s, 1000);
    expect(stall.setShelf).toHaveBeenCalledWith(s);
    expect(stall.setMenu).toHaveBeenLastCalledWith(['dosa'], []);
    expect(stall.setPan).toHaveBeenCalledWith('tawa1', expect.objectContaining({ gunk: 0, hot: 0 }));
    // a dirtier, hotter tawa is reported once per change, not per frame
    stall.setPan.mockClear();
    s.stations.tawa1.gunk = 60;
    s.stations.tawa1.heat = 90;
    sync.setState(s, 1000);
    run(sync, 0.5);
    expect(stall.setPan).toHaveBeenCalledTimes(1);
    expect(stall.setPan.mock.calls[0][1]).toMatchObject({ torn: false, stuck: true });
    expect(stall.setPan.mock.calls[0][1].hot).toBeGreaterThan(0.4);
    sync.setState(s, 1000);
    expect(stall.setPan).toHaveBeenCalledTimes(1);
    // off the board
    s.off = ['dosa'];
    sync.setState(s, 1000);
    expect(stall.setMenu).toHaveBeenLastCalledWith(['dosa'], ['dosa']);
    sync.dispose();
  });

  it('hands the cylinder to the stall every time it changes: low, out, being swapped (progress through the ticks)', () => {
    const { sync, stall } = mk();
    sync.setMe('p1');
    const s = state();
    sync.setState(s, 1000);
    run(sync, 0.2);
    expect(stall.setGas).toHaveBeenCalled();
    expect(stall.setGas.mock.calls.at(-1)[0]).toMatchObject({ frac: 0.8, low: false, burners: true, swapping: false });
    s.gas.u = 100;
    sync.setState(s, 1000);
    run(sync, 0.2);
    expect(stall.setGas.mock.calls.at(-1)[0]).toMatchObject({ low: true, burners: true });
    s.gas.u = 0;
    sync.setState(s, 1000);
    run(sync, 0.2);
    expect(stall.setGas.mock.calls.at(-1)[0]).toMatchObject({ empty: true, burners: false });
    s.gas.sw = GAS.swapTicks;
    sync.setState(s, 1000);
    run(sync, 0.2);
    expect(stall.setGas.mock.calls.at(-1)[0]).toMatchObject({ swapping: true, burners: false });
    const n = stall.setGas.mock.calls.length;
    run(sync, 0.4, 5000);
    expect(stall.setGas.mock.calls.length).toBeGreaterThan(n); // swapT moves with the clock between ticks
    // nothing changes: nothing is sent
    const s2 = state();
    const { sync: sync2, stall: stall2 } = mk();
    sync2.setMe('p1');
    sync2.setState(s2, 1000);
    run(sync2, 0.1);
    const m = stall2.setGas.mock.calls.length;
    run(sync2, 1);
    expect(stall2.setGas.mock.calls.length).toBe(m);
    sync.dispose();
    sync2.dispose();
  });

  it('a level without the layer (the tutorial, level 1-2) reads as all is well', () => {
    const { sync, stall } = mk();
    sync.setMe('p1');
    const s = state({ cfg: { stations: ['tawa1', 'chai1'], spots: 3, menu: ['dosa'], hour: [8, 9], tutorial: true }, gas: null, stock: {}, fresh: {}, off: undefined, events: undefined });
    delete s.stations.prep1;
    sync.setState(s, 1000);
    run(sync, 0.3);
    expect(stall.setGas.mock.calls.at(-1)[0]).toMatchObject({ has: false, burners: true, frac: 1 });
    expect(stall.setPan).not.toHaveBeenCalled(); // no heat on this level
    expect(sync.world).toEqual({ rain: 0, power: 0, cricket: 0, festival: 0 });
    expect(sync.worldFx.ev).toBeNull(); // nothing built for events that never come
    sync.dispose();
  });

  it('prep events: puffs at the slot, the hands fill and take, the prop is driven with the beats', () => {
    const { sync, stall, fx, camera } = mk();
    sync.setMe('p1');
    sync.setState(state(), 1000);
    camera.updateMatrixWorld();
    const vm = sync.viewmodel;
    vm.setAction = vi.fn();
    sync.handleEvents([{ type: 'prep-start', station: 'prep1', slot: 0, item: 'batter_dosa', n: 12, ticks: 12, by: 'p1' }]);
    run(sync, 1);
    expect(fx.burst).toHaveBeenCalledWith('puff', expect.any(Number), expect.any(Number), expect.any(Number), 0.6);
    expect(vm.setAction.mock.calls.filter((c) => c[0]).map((c) => c[0])).toContain('tawa-fill');
    expect(stall.stations.get('prep1').prop.playAction).toHaveBeenCalledWith(0, 'tawa-fill', expect.any(Number));
    fx.burst.mockClear();
    sync.handleEvents([{ type: 'prep-done', station: 'prep1', slot: 0, item: 'batter_dosa', n: 12 }]);
    expect(fx.burst).toHaveBeenCalledWith('ping', expect.any(Number), expect.any(Number), expect.any(Number));
    vm.setAction.mockClear();
    sync.handleEvents([{ type: 'prep-collect', station: 'prep1', slot: 0, item: 'batter_dosa', n: 12, by: 'p1' }]);
    run(sync, 1);
    expect(vm.setAction.mock.calls.some((c) => c[0] === 'tawa-take')).toBe(true);
    sync.dispose();
  });

  it('tend events run the pad / skimmer / jug beat on the prop (0 to 1) with a sizzle part-way, for anybody\'s tend', () => {
    const { sync, stall, fx } = mk();
    sync.setMe('p1');
    sync.setState(state(), 1000);
    sync.handleEvents([{ type: 'tend', station: 'tawa1', kind: 'wipe', by: 'p2' }]);
    run(sync, 1.2);
    const calls = stall.stations.get('tawa1').prop.playTend.mock.calls;
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((c) => c[0] === 'wipe')).toBe(true);
    expect(calls[0][1]).toBeLessThan(0.2);
    expect(calls.at(-1)[1]).toBe(1);
    for (let i = 1; i < calls.length; i++) expect(calls[i][1]).toBeGreaterThanOrEqual(calls[i - 1][1]);
    expect(fx.burst).toHaveBeenCalledWith('sizzle', expect.any(Number), expect.any(Number), expect.any(Number), 4);
    // after the beat nothing more is sent
    const n = calls.length;
    run(sync, 0.5);
    expect(stall.stations.get('tawa1').prop.playTend.mock.calls.length).toBe(n);
    sync.dispose();
  });

  it('gas events: floating cues and a shake when it runs out', () => {
    const { sync, fx, onShake } = mk();
    sync.setMe('p1');
    sync.setState(state(), 1000);
    sync.handleEvents([{ type: 'gas-low', units: 190 }, { type: 'gas-out' }, { type: 'gas-swap', phase: 'start', ticks: 6, cost: 90, by: 'p1' }, { type: 'gas-swap', phase: 'done', units: 1000 }]);
    const texts = fx.floatText.mock.calls.map((c) => c[0]);
    expect(texts).toContain('Gas low');
    expect(texts).toContain('NO GAS');
    expect(texts).toContain('New cylinder...');
    expect(onShake).toHaveBeenCalled();
    for (const c of fx.floatText.mock.calls) expect(Math.abs(c[2] - LAYOUT.gas.x)).toBeLessThan(0.01); // at the stand
    sync.dispose();
  });

  it('targets behind the cook: the back counter resolves to its front (towards the cook), the gas stand resolves, the head aims at both', () => {
    const { sync } = mk();
    sync.setMe('p1');
    const s = state();
    s.players.p1.at = 'prep1';
    sync.setState(s, 1000);
    const centre = new Vector3();
    const top = new Vector3();
    expect(sync.resolve({ kind: 'station', id: 'prep1' }, centre, top)).toBeGreaterThan(0);
    expect(centre.x).toBeCloseTo(STATIONS.prep1.x, 6);
    expect(centre.z).toBeCloseTo(STATIONS.prep1.z - 0.3, 6); // the front of the prop is on the cook's side
    expect(top.y).toBeGreaterThan(centre.y);
    expect(sync.resolve({ kind: 'station', station: 'prep1' }, centre, top)).toBeGreaterThan(0);
    expect(sync.resolve({ kind: 'slot', station: 'prep1', slot: 1 }, centre, top)).toBeGreaterThan(0);
    expect(sync.resolve({ kind: 'station', id: 'gas' }, centre, top)).toBeGreaterThan(0);
    expect(centre.x).toBeCloseTo(LAYOUT.gas.x, 6);
    const aim = { x: 0, y: 0, z: 0 };
    run(sync, 0.1);
    expect(sync.aimPointFor('prep1', aim)).toBe(true);
    expect(aim.z).toBeGreaterThan(1);
    expect(sync.aimPointFor('gas', aim)).toBe(true);
    expect(aim.x).toBeCloseTo(LAYOUT.gas.x, 6);
    // pick proxies include the back counter's two jobs and the gas stand
    const proxies = sync.buildProxies(9e9);
    expect(proxies.filter((p) => p.kind === 'slot' && p.target.station === 'prep1')).toHaveLength(2);
    expect(proxies.some((p) => p.kind === 'station' && p.target.station === 'gas')).toBe(true);
    expect(proxies.some((p) => p.kind === 'station' && p.target.station === 'prep1')).toBe(true);
    sync.dispose();
  });

  it('the world levels follow state.events smoothly and the modules for them are built on demand', () => {
    const { sync } = mk();
    sync.setMe('p1');
    const s = state();
    sync.setState(s, 1000);
    run(sync, 0.2);
    expect(sync.worldFx.ev).toBeNull();
    s.events = [{ id: 'rain', until: 99 }, { id: 'power', until: 99 }];
    sync.setState(s, 1000);
    expect(sync.worldFx.ev).toBeTruthy();
    expect(sync.worldFx.weather).toBeTruthy();
    run(sync, 1.0);
    expect(sync.world.power).toBeGreaterThan(0.95);
    expect(sync.world.rain).toBeGreaterThan(0.1);
    expect(sync.world.rain).toBeLessThan(0.6);
    run(sync, 12);
    expect(sync.world.rain).toBeGreaterThan(0.95);
    // the cues reach subscribers
    const cues = [];
    const off = sync.onCue((c) => cues.push(c));
    s.events = [];
    sync.setState(s, 1000);
    run(sync, 1);
    expect(cues.some((c) => c.type === 'power' && c.on === true)).toBe(true);
    off();
    sync.dispose();
  });

  it('the inspector walks up for his event, shows a verdict, and leaves when it ends; late joiners find him already there', () => {
    const { sync, fx } = mk();
    sync.setMe('p1');
    const s = state({ events: [{ id: 'inspector', until: 60 }] });
    sync.setState(s, 1000);
    expect(sync.inspector.phase).toBe('stand'); // joined mid-event
    const { sync: sync2 } = mk();
    sync2.setMe('p1');
    sync2.setState(state(), 1000);
    expect(sync2.inspector.phase).toBe('none');
    const s2 = state({ events: [{ id: 'inspector', until: 60 }] });
    sync2.setState(s2, 1000);
    expect(sync2.inspector.phase).toBe('in');
    run(sync2, 2.2);
    expect(sync2.inspector.phase).toBe('stand');
    const p = inspectorPos(6);
    expect(sync2.inspector.x).toBeCloseTo(p.x, 3);
    expect(sync2.inspector.z).toBeCloseTo(p.z, 3);
    sync2.handleEvents([{ type: 'inspector', pass: true, bonus: 90, fine: 0, why: [] }]);
    expect(sync2.inspector.phase).toBe('verdict');
    expect(sync2.inspector.verdict).toBe('pass');
    expect(sync2.inspector.model.mood).toBe('happy');
    expect(fx.floatText).not.toHaveBeenCalled();
    s2.events = [];
    sync2.setState(s2, 1000);
    expect(sync2.inspector.phase).toBe('out');
    run(sync2, 3);
    expect(sync2.inspector.phase).toBe('none');
    // a failed check
    const { sync: sync3, fx: fx3 } = mk();
    sync3.setMe('p1');
    sync3.setState(state({ events: [{ id: 'inspector', until: 60 }] }), 1000);
    sync3.handleEvents([{ type: 'inspector', pass: false, bonus: 0, fine: 65, why: ['untended'] }]);
    expect(sync3.inspector.verdict).toBe('fail');
    expect(sync3.inspector.model.mood).toBe('angry');
    expect(fx3.floatText.mock.calls.some((c) => /FINE/.test(c[0]))).toBe(true);
    sync.dispose();
    sync2.dispose();
    sync3.dispose();
  });

  it('customers: a parcel gets a bag, a regular a gold star; the delivery boy is his own model with a scooter parked beside the counter', () => {
    const { sync, scene } = mk();
    sync.setMe('p1');
    const mkC = (id, spot, over) => ({ id, kind: 'office', name: `C${id}`, spot, st: 'waiting', patience: 20, patienceMax: 30, got: [], qs: [], need: ['dosa'], arrivedAt: 0, ...over });
    const s = state({ customers: [mkC(1, 0, { parcel: 1 }), mkC(2, 1, { regular: true, rid: 0, loyal: 1 }), mkC(3, 2, { kind: 'autowala', name: 'Delivery boy', parcel: 1, delivery: 1 }), mkC(4, 3, {})] });
    sync.setState(s, 1000);
    run(sync, 0.3);
    const { customers } = sync.actors;
    expect(customers.get(1).bag).toBeTruthy();
    expect(customers.get(1).star).toBeNull();
    expect(customers.get(2).star).toBeTruthy();
    expect(customers.get(2).bag).toBeNull();
    expect(customers.get(3).model.kind).toBe('delivery');
    expect(customers.get(3).bag).toBeNull(); // he has his own bag
    expect(customers.get(4).bag).toBeNull();
    expect(customers.get(4).star).toBeNull();
    expect(customers.get(2).holder.children.some((c) => c.name === 'regular-star')).toBe(true);
    // the scooter appears for the rider and goes when he has left
    const names = () => {
      const out = [];
      scene.getObjectByName('actors').traverse((o) => {
        if (o.name === 'street-scooter' && o.visible) out.push(o);
      });
      return out;
    };
    expect(names().length).toBe(1);
    s.customers[2].st = 'left';
    s.customers[2].outcome = 'happy';
    sync.setState(s, 1000);
    expect(names().length).toBe(0);
    sync.dispose();
  });

  it('night is a smooth 0..1 of the clock hour', () => {
    expect(nightOf(12)).toBe(0);
    expect(nightOf(17)).toBe(0);
    expect(nightOf(19.6)).toBe(1);
    expect(nightOf(23)).toBe(1);
    expect(nightOf(2)).toBe(1);
    expect(nightOf(6.5)).toBe(0);
    expect(nightOf(18.75)).toBeGreaterThan(0.3);
    expect(nightOf(18.75)).toBeLessThan(0.7);
    expect(nightOf(30)).toBe(nightOf(6));
  });
});
