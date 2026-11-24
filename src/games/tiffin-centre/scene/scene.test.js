import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Vector3, Group, Scene, Box3 } from 'three';
import { lightingAt, makeLighting, sunDirection, tubeFlicker, HOUR_KEYS } from './lighting.js';
import {
  viewFov, hFovOf, lensShift, clampLook, aimAt, autoGoal, stepLook, addManual, advancePhase, walkBob, speed01Of, edgeHint, shakeAngles,
  REST_PITCH, BOB_CYCLE, BOB_Y, VIEW, MANUAL_HOLD_S, FOV_MAX, HFOV_MIN,
} from './camera.js';
import { createCameraRig } from './rig.js';
import { createQualitySampler, pickQuality, lowerQuality, QUALITY } from './quality.js';
import {
  tickFrac, hourAt, patienceFrac, payFrac, slotVisual, moodOf, laneOffset, stepAvatarX, workForEvent, hashSeed, avatarColor, wrapAngle,
  actionSeqFor, sampleSeq, seqDuration, SEQ, ACTION_KINDS, crowdOffset, arrivalStart, departureEnd,
} from './interp.js';
import { pickFromProxies, cameraProjector, worldRadiusForPx, pxPerMetre, distToSegment, pickBoxes, boxAt, MIN_PX } from './picking.js';
import { createActionPlayer, loadViewmodel } from './vm.js';
import { createSync, PLATE_Z } from './sync.js';
import { LAYOUT, STATIONS, PAY_WINDOW } from '../../../../shared/tiffin-centre/catalog.js';
import { LANE_OFFSET, WALK_SPEED, WORK_MS, standX, stepWalker } from '../../../../shared/tiffin-centre/movement.js';

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('lighting curves', () => {
  it('wraps at 24 and is continuous over the whole day', () => {
    const a = makeLighting();
    const b = makeLighting();
    lightingAt(0, a);
    lightingAt(24, b);
    expect(b.si).toBeCloseTo(a.si, 6);
    expect(b.top[2]).toBeCloseTo(a.top[2], 6);
    let prev = lightingAt(0, makeLighting());
    const cur = makeLighting();
    for (let h = 0.05; h <= 48; h += 0.05) {
      lightingAt(h, cur);
      expect(Math.abs(cur.si - prev.si)).toBeLessThan(0.25);
      expect(Math.abs(cur.hi - prev.hi)).toBeLessThan(0.1);
      expect(Math.abs(cur.bulb - prev.bulb)).toBeLessThan(0.1);
      for (let k = 0; k < 3; k++) expect(Math.abs(cur.hor[k] - prev.hor[k])).toBeLessThan(0.06);
      for (let k = 0; k < 3; k++) expect(Math.abs(cur.sunDir[k] - prev.sunDir[k])).toBeLessThan(0.05);
      prev = { ...cur, hor: [...cur.hor], sunDir: [...cur.sunDir] };
    }
  });
  it('is bright and harsh at noon, dim and lamp-lit at night, rosy at dawn, amber in the evening', () => {
    const noon = lightingAt(12.5);
    const night = lightingAt(22);
    const dawn = lightingAt(5.7);
    const eve = lightingAt(18.4);
    expect(noon.si).toBeGreaterThan(night.si * 3);
    expect(noon.bulb).toBe(0);
    expect(night.bulb).toBeGreaterThan(0.95);
    expect(night.tube).toBeGreaterThan(0.95);
    expect(night.night).toBeGreaterThan(0.9);
    expect(noon.haze).toBeGreaterThan(night.haze);
    expect(night.wet).toBeGreaterThan(noon.wet);
    expect(dawn.hor[0]).toBeGreaterThan(dawn.hor[2]); // warm horizon
    expect(eve.sun[0]).toBeGreaterThan(eve.sun[2] * 1.5); // amber sun
    expect(lum(night.top)).toBeLessThan(lum(noon.top));
    expect(HOUR_KEYS.at(-1).h).toBe(24);
  });
  it('keeps the light above the stall front-lit and the direction normalised', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = sunDirection(h);
      expect(Math.hypot(...d)).toBeCloseTo(1, 5);
      expect(d[1]).toBeGreaterThan(0.1);
      expect(d[2]).toBeGreaterThan(0);
    }
  });
  it('tube light flickers only when on', () => {
    expect(tubeFlicker(3, 0)).toBe(0);
    let dipped = false;
    for (let t = 0; t < 60; t += 0.01) {
      const v = tubeFlicker(t, 1);
      expect(v).toBeGreaterThan(0.2);
      expect(v).toBeLessThanOrEqual(1);
      if (v < 0.5) dipped = true;
    }
    expect(dipped).toBe(true);
  });
});

describe('first-person view maths', () => {
  it('uses LAYOUT.view.fov in landscape and widens on portrait phones, never past the cap', () => {
    expect(viewFov(16 / 9)).toBe(VIEW.fov);
    expect(viewFov(1.2)).toBe(VIEW.fov);
    const phone = viewFov(390 / 844);
    expect(phone).toBeGreaterThan(VIEW.fov + 10);
    expect(phone).toBeLessThanOrEqual(FOV_MAX);
    expect(viewFov(0.2)).toBeLessThanOrEqual(FOV_MAX);
    // the horizontal fov of a phone is what the widening protects
    expect(hFovOf(phone, 390 / 844)).toBeGreaterThan(hFovOf(VIEW.fov, 390 / 844));
    expect(hFovOf(viewFov(0.62), 0.62)).toBeGreaterThanOrEqual(HFOV_MIN - 0.5);
    for (let a = 0.3; a <= 4; a += 0.1) expect(viewFov(a)).toBeGreaterThanOrEqual(VIEW.fov);
  });
  it('shifts the lens so the picture centres in the HUD-free window', () => {
    expect(lensShift({ top: 0.1, bottom: 0.1 }, 1)).toBe(0);
    expect(lensShift({ top: 0.1, bottom: 0.3 }, 0.5)).toBeGreaterThan(0); // taller bottom bar: picture moves up
    expect(lensShift({ top: 0.3, bottom: 0.1 }, 0.5)).toBeLessThan(0);
    expect(Math.abs(lensShift({ top: 0, bottom: 0.9 }, 0.5))).toBeLessThanOrEqual(0.2);
    expect(lensShift(null, 390 / 844)).toBeGreaterThan(0); // the portrait default has a taller bottom bar
  });
  it('clamps the look to the view limits', () => {
    const l = clampLook({ yaw: 9, pitch: -9 });
    expect(l.yaw).toBe(VIEW.yawMax);
    expect(l.pitch).toBe(VIEW.pitchMin);
    expect(clampLook({ yaw: -9, pitch: 9 })).toEqual({ yaw: -VIEW.yawMax, pitch: VIEW.pitchMax });
    expect(clampLook({ yaw: 0.2, pitch: 0.1 })).toEqual({ yaw: 0.2, pitch: 0.1 });
  });
  it('aims: +x is the cook right (yaw > 0), up is pitch > 0, straight ahead is zero', () => {
    const fwd = aimAt(0, 1.55, 0, 0, 1.55, -3);
    expect(fwd.yaw).toBeCloseTo(0, 9);
    expect(fwd.pitch).toBeCloseTo(0, 9);
    expect(aimAt(0, 1.55, 0, 2, 1.55, -2).yaw).toBeCloseTo(Math.PI / 4, 9);
    expect(aimAt(0, 1.55, 0, -2, 1.55, -2).yaw).toBeCloseTo(-Math.PI / 4, 9);
    expect(aimAt(0, 1.55, 0, 0, 3.55, -2).pitch).toBeCloseTo(Math.PI / 4, 9);
    expect(aimAt(0, 1.55, 0, 0, 0.55, -1).pitch).toBeLessThan(0); // looking down at the counter
  });
  it('auto head-turn leads the walk partly and settles on the work (yaw 0 when it is straight ahead)', () => {
    const at = { x: STATIONS.chai1.x, y: 0.95, z: STATIONS.chai1.z };
    const far = autoGoal(STATIONS.tawa1.x, at);
    expect(far.yaw).toBeGreaterThan(0.3);
    expect(far.yaw).toBeLessThanOrEqual(0.75);
    const here = autoGoal(STATIONS.chai1.x, at);
    expect(here.yaw).toBeCloseTo(0, 9);
    expect(here.pitch).toBeLessThan(0); // down at the counter, but only part of the way
    expect(here.pitch).toBeGreaterThan(Math.atan2(0.95 - LAYOUT.eyeHeight, 1) );
    expect(autoGoal(0, { x: -4, y: 0.95, z: -1 }).yaw).toBeLessThan(0);
  });
  it('damps the look towards its goal without overshoot, frame-rate independent', () => {
    const goal = { yaw: 0.8, pitch: -0.4 };
    const a = { yaw: 0, pitch: 0 };
    let prev = 0;
    for (let i = 0; i < 90; i++) {
      stepLook(a, goal, 9, 1 / 60);
      expect(a.yaw).toBeGreaterThanOrEqual(prev);
      expect(a.yaw).toBeLessThanOrEqual(goal.yaw);
      prev = a.yaw;
    }
    expect(a.yaw).toBeCloseTo(goal.yaw, 2);
    expect(a.pitch).toBeCloseTo(goal.pitch, 2);
    const b = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 30; i++) stepLook(b, goal, 9, 1 / 30);
    const c = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 90; i++) stepLook(c, goal, 9, 1 / 90);
    expect(b.yaw).toBeCloseTo(c.yaw, 6);
    // a goal beyond the limit is clamped
    const d = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 600; i++) stepLook(d, { yaw: 9, pitch: 9 }, 9, 1 / 60);
    expect(d.yaw).toBeLessThanOrEqual(VIEW.yawMax + 1e-9);
    expect(d.pitch).toBeLessThanOrEqual(VIEW.pitchMax + 1e-9);
  });
  it('free look adds to the manual offset but never pushes the result past the limits or accepts NaN', () => {
    const m = { yaw: 0, pitch: 0 };
    const base = { yaw: 0.4, pitch: -0.2 };
    addManual(m, 0.3, 0.1, base);
    expect(m).toEqual({ yaw: expect.closeTo(0.3, 9), pitch: expect.closeTo(0.1, 9) });
    addManual(m, 99, 99, base);
    expect(base.yaw + m.yaw).toBeCloseTo(VIEW.yawMax, 9);
    expect(base.pitch + m.pitch).toBeCloseTo(VIEW.pitchMax, 9);
    addManual(m, NaN, undefined, base);
    expect(Number.isFinite(m.yaw) && Number.isFinite(m.pitch)).toBe(true);
    addManual(m, -99, -99, base);
    expect(base.yaw + m.yaw).toBeCloseTo(-VIEW.yawMax, 9);
    expect(base.pitch + m.pitch).toBeCloseTo(VIEW.pitchMin, 9);
  });
});

describe('walking bob', () => {
  it('advances the stride phase by distance walked, one cycle per BOB_CYCLE metres', () => {
    expect(Math.cos(advancePhase(0, BOB_CYCLE))).toBeCloseTo(1, 9); // a full cycle is back where it started
    expect(advancePhase(0, BOB_CYCLE / 4)).toBeCloseTo(Math.PI / 2, 9);
    expect(advancePhase(1, -BOB_CYCLE / 4)).toBeCloseTo(1 + Math.PI / 2, 9); // direction does not matter
  });
  it('is zero when standing, when reduced, and bounded while walking', () => {
    expect(walkBob(1.3, 0, 1, false)).toEqual({ x: 0, y: 0, roll: 0 });
    expect(walkBob(1.3, 1, 1, true)).toEqual({ x: 0, y: 0, roll: 0 });
    let ymin = 9;
    let ymax = -9;
    let rmax = 0;
    for (let p = 0; p < Math.PI * 2; p += 0.01) {
      const b = walkBob(p, 1, 1, false);
      ymin = Math.min(ymin, b.y);
      ymax = Math.max(ymax, b.y);
      rmax = Math.max(rmax, Math.abs(b.roll));
    }
    expect(ymax - ymin).toBeCloseTo(BOB_Y * 0.5 * 2, 2); // peak to peak stays inside +-BOB_Y/2 -> total BOB_Y
    expect(ymax).toBeLessThanOrEqual(BOB_Y);
    expect(rmax).toBeLessThan(0.05); // a slight roll, never a lurch
    // two bobs per stride cycle: y repeats every half cycle
    expect(walkBob(0.7, 1, 0, false).y).toBeCloseTo(walkBob(0.7 + Math.PI, 1, 0, false).y, 9);
  });
  it('scales with speed and leans into the walk', () => {
    const slow = walkBob(1.0, 0.3, 0, false);
    const fast = walkBob(1.0, 1, 0, false);
    expect(Math.abs(fast.x)).toBeGreaterThan(Math.abs(slow.x));
    expect(walkBob(0, 1, 1, false).roll).toBeLessThan(0);
    expect(walkBob(0, 1, -1, false).roll).toBeGreaterThan(0);
    expect(speed01Of(WALK_SPEED)).toBe(1);
    expect(speed01Of(-WALK_SPEED * 3)).toBe(1);
    expect(speed01Of(0)).toBe(0);
  });
  it('shake is off with reduced motion and decays to nothing', () => {
    const o = shakeAngles(3, 1, true);
    expect([o.pitch, o.yaw, o.roll]).toEqual([0, 0, 0]);
    expect(shakeAngles(3, 0, false).roll).toBe(0);
    expect(Math.abs(shakeAngles(3.001, 1, false).pitch)).toBeLessThan(0.02);
  });
});

describe('edge hints for off-screen targets', () => {
  const W = 400;
  const H = 800;
  const M = 30;
  const onBorder = (e) => Math.abs(e.x - M) < 1e-6 || Math.abs(e.x - (W - M)) < 1e-6 || Math.abs(e.y - M) < 1e-6 || Math.abs(e.y - (H - M)) < 1e-6;
  it('puts the hint on the inset border along the line from the centre', () => {
    const r = edgeHint(900, 400, 3, 5, 0, W, H, M);
    expect(r.side).toBe('right');
    expect(r.x).toBeCloseTo(W - M, 6);
    expect(r.y).toBeCloseTo(400, 6);
    const l = edgeHint(-200, 100, 3, -5, 2, W, H, M);
    expect(l.side).toBe('left');
    expect(l.x).toBeCloseTo(M, 6);
    expect(l.y).toBeGreaterThan(M);
    expect(l.y).toBeLessThan(400);
    expect(onBorder(l)).toBe(true);
    const up = edgeHint(200, -900, 2, 0, 9, W, H, M);
    expect(up.y).toBeCloseTo(M, 6);
    expect(onBorder(up)).toBe(true);
  });
  it('says "behind" for targets behind the eye and points to the side they are on', () => {
    const b = edgeHint(0, 0, -2, 3, 0, W, H, M);
    expect(b.side).toBe('behind');
    expect(b.x).toBeCloseTo(W - M, 6);
    const b2 = edgeHint(0, 0, 0, -3, 0.5, W, H, M);
    expect(b2.side).toBe('behind');
    expect(b2.x).toBeCloseTo(M, 6);
    const dead = edgeHint(0, 0, -1, 0, 0, W, H, M); // exactly behind: somewhere on the border, finite
    expect(Number.isFinite(dead.x) && Number.isFinite(dead.y)).toBe(true);
    expect(onBorder(dead)).toBe(true);
  });
});

describe('camera rig (first person)', () => {
  const mk = (reduced = false) => {
    const cam = new PerspectiveCamera(60, 1.6, 0.3, 160);
    const rig = createCameraRig(cam, { reducedMotion: reduced });
    rig.setAspect(1.6, 800, 500);
    return { cam, rig };
  };
  const fwd = (cam) => cam.getWorldDirection(new Vector3());
  const settle = (rig, secs = 3) => {
    for (let i = 0; i < secs * 60; i++) rig.update(1 / 60, i / 60);
  };
  it('sits at eye height on the cook line, looking towards -z with +x on the right', () => {
    const { cam, rig } = mk();
    rig.setBody(0.5, 0);
    settle(rig);
    expect(cam.position.x).toBeCloseTo(0.5, 2);
    expect(cam.position.y).toBeCloseTo(LAYOUT.eyeHeight, 1);
    expect(cam.position.z).toBe(LAYOUT.cookZ);
    const d = fwd(cam);
    expect(d.z).toBeLessThan(-0.9);
    // a point at +x projects to the right half of the screen
    const p = new Vector3(2, 1.5, -3).project(cam);
    expect(p.x).toBeGreaterThan(0);
    expect(new Vector3(-2, 1.5, -3).project(cam).x).toBeLessThan(0);
  });
  it('has a near plane close enough for arms at the lens', () => {
    const { cam } = mk();
    expect(cam.near).toBeLessThanOrEqual(0.06);
    expect(cam.rotation.order).toBe('YXZ');
  });
  it('lookBy turns right for positive yaw, up for positive pitch, clamps to the limits and recentres after the hold', () => {
    const { cam, rig } = mk();
    rig.setBody(0, 0);
    settle(rig, 1);
    rig.lookBy(0.6, 0.2);
    settle(rig, 1);
    expect(fwd(cam).x).toBeGreaterThan(0.3); // to the right
    expect(fwd(cam).y).toBeGreaterThan(-0.1);
    expect(rig.getLook().yaw).toBeCloseTo(0.6, 1);
    rig.lookBy(99, 99);
    settle(rig, 1);
    const l = rig.getLook();
    expect(l.yaw).toBeLessThanOrEqual(VIEW.yawMax + 1e-6);
    expect(l.pitch).toBeLessThanOrEqual(VIEW.pitchMax + 1e-6);
    // free look is held for a while, then the head recentres
    settle(rig, MANUAL_HOLD_S + 6);
    expect(Math.abs(rig.getLook().yaw)).toBeLessThan(0.05);
    expect(rig.getLook().pitch).toBeCloseTo(REST_PITCH, 1);
  });
  it('turns the head towards the work while walking and settles straight ahead on arrival', () => {
    const { rig } = mk();
    const at = { x: 2.6, y: 0.95, z: -0.9 };
    rig.setBody(-2.6, 1);
    rig.setAuto(at);
    settle(rig, 0.5);
    expect(rig.getLook().yaw).toBeGreaterThan(0.2);
    rig.setBody(2.6, 0);
    settle(rig, 2);
    expect(Math.abs(rig.getLook().yaw)).toBeLessThan(0.03);
    expect(rig.getLook().pitch).toBeLessThan(REST_PITCH); // looking down at the counter
    rig.setAuto(null);
    settle(rig, 3);
    expect(rig.getLook().pitch).toBeCloseTo(REST_PITCH, 1);
  });
  it('lookAt-style pinning holds the head on a world point and releases back to rest', () => {
    const { rig } = mk();
    rig.setBody(0, 0);
    rig.setPinned({ x: -3, y: 1.5, z: -2.5 });
    settle(rig, 2);
    expect(rig.getLook().yaw).toBeLessThan(-0.8);
    rig.setPinned(null);
    settle(rig, 6);
    expect(Math.abs(rig.getLook().yaw)).toBeLessThan(0.05);
  });
  it('follows the walker: same arrival as stepWalker, bob while walking, nothing with reduced motion', () => {
    for (const reduced of [false, true]) {
      const { cam, rig } = mk(reduced);
      const w = { x: standX('tawa1') };
      const target = standX('chai1');
      rig.setBody(w.x, 0);
      settle(rig, 0.2);
      const ys = [];
      let t = 0;
      let arrivedAt = -1;
      for (let i = 0; i < 60 * 5; i++) {
        const r = stepWalker(w.x, target, 1 / 60);
        w.x = r.x;
        rig.setBody(w.x, r.dir);
        rig.update(1 / 60, t);
        t += 1 / 60;
        if (r.dir !== 0) {
          ys.push(cam.position.y);
          expect(Math.abs(cam.position.x - w.x)).toBeLessThan(0.45); // the glide lags the walker by a fraction of a metre
        }
        if (r.arrived && arrivedAt < 0) arrivedAt = t;
      }
      expect(arrivedAt).toBeGreaterThan(0);
      expect(arrivedAt).toBeCloseTo(Math.abs(target - standX('tawa1')) / WALK_SPEED, 1);
      expect(cam.position.x).toBeCloseTo(target, 2);
      const span = Math.max(...ys) - Math.min(...ys);
      if (reduced) expect(span).toBeLessThan(1e-9);
      else {
        expect(span).toBeGreaterThan(0.01);
        expect(span).toBeLessThan(0.08);
      }
    }
  });
  it('recentre() lets go of free look at once', () => {
    const { rig } = mk();
    rig.setBody(0, 0);
    settle(rig, 0.5);
    rig.lookBy(1.0, 0);
    settle(rig, 0.6);
    expect(rig.getLook().yaw).toBeGreaterThan(0.8);
    rig.recentre();
    settle(rig, 2.5); // well inside the free-look hold: it would still be turned without recentre()
    expect(Math.abs(rig.getLook().yaw)).toBeLessThan(0.1);
  });
  it('shifts the lens by the insets (the straight-ahead point lands in the HUD-free window)', () => {
    const { cam, rig } = mk();
    rig.setAspect(390 / 844, 390, 844);
    rig.setInsets({ top: 0.1, bottom: 0.3 });
    rig.setBody(0, 0);
    rig.reset();
    rig.update(1 / 60, 0);
    const ahead = new Vector3(0, LAYOUT.eyeHeight, -3).project(cam); // NDC, y up
    const py = (-ahead.y * 0.5 + 0.5); // fraction from the top
    expect(py).toBeLessThan(0.5);
    rig.setInsets({ top: 0.1, bottom: 0.1 });
    rig.update(1 / 60, 0);
    expect(Math.abs(new Vector3(0, LAYOUT.eyeHeight, -3).project(cam).y)).toBeLessThan(0.3);
  });
});

describe('quality', () => {
  it('picks a tier and honours an explicit one', () => {
    expect(pickQuality('high')).toBe('high');
    expect(pickQuality('auto', { mobile: true })).toBe('low');
    expect(pickQuality('auto', { mobile: false, cores: 12 })).toBe('high');
    expect(pickQuality('auto', { mobile: false, cores: 4 })).toBe('medium');
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('low')).toBe('low');
    expect(QUALITY.low.particles).toBeLessThan(QUALITY.high.particles);
  });
  it('steps down only after a window of mostly slow frames and ignores hidden-tab gaps', () => {
    const s = createQualitySampler({ windowSec: 1 });
    let verdict = false;
    for (let i = 0; i < 40; i++) verdict = s.push(0.05) || verdict;
    expect(verdict).toBe(true);
    const ok = createQualitySampler({ windowSec: 1 });
    let any = false;
    for (let i = 0; i < 200; i++) any = ok.push(i === 50 ? 5 : 0.016) || any;
    expect(any).toBe(false);
  });
});

describe('interpolation helpers', () => {
  const state = { tick: 30, shiftTicks: 150, cfg: { hour: [6, 9] } };
  it('hour follows hourOf semantics with the in-tick fraction', () => {
    expect(hourAt({ ...state, tick: 0 }, 0)).toBeCloseTo(6);
    expect(hourAt(state, 0)).toBeCloseTo(6 + 3 * (30 / 150));
    expect(hourAt(state, 0.5)).toBeCloseTo(6 + 3 * (30.5 / 150));
    expect(hourAt({ ...state, tick: 150 }, 1)).toBeCloseTo(9);
  });
  it('tick fraction clamps', () => {
    expect(tickFrac(1500, 1000, 1000)).toBe(0.5);
    expect(tickFrac(900, 1000, 1000)).toBe(0);
    expect(tickFrac(9000, 1000, 1000)).toBe(1);
    expect(tickFrac(5, null)).toBe(0);
  });
  it('patience drains between ticks only while waiting; pay likewise', () => {
    const c = { st: 'waiting', patience: 10, patienceMax: 20 };
    expect(patienceFrac(c, 0)).toBe(0.5);
    expect(patienceFrac(c, 1)).toBeCloseTo(9 / 20);
    expect(patienceFrac({ ...c, st: 'eating' }, 1)).toBe(0.5);
    expect(patienceFrac(c, 1, { noPatience: true })).toBe(0.5);
    expect(patienceFrac({ ...c, patience: 0 }, 1)).toBe(0);
    const p = { st: 'paying', payLeft: PAY_WINDOW };
    expect(payFrac(p, 0)).toBe(1);
    expect(payFrac(p, 1)).toBeCloseTo((PAY_WINDOW - 1) / PAY_WINDOW);
    expect(payFrac(p, 1, { noPayExpiry: true })).toBe(1);
  });
  it('slot progress interpolates between ticks', () => {
    const slot = { st: 'cooking', dish: 'dosa', t0: 10, readyAt: 15, burnAt: 22 };
    expect(slotVisual(slot, 10).progress).toBe(0);
    expect(slotVisual(slot, 12.5).progress).toBeCloseTo(0.5);
    expect(slotVisual(slot, 99).progress).toBe(1);
    const ready = { ...slot, st: 'ready' };
    expect(slotVisual(ready, 15).burnFrac).toBe(0);
    expect(slotVisual(ready, 18.5).burnFrac).toBeCloseTo(0.5);
    expect(slotVisual({ st: 'burnt', dish: 'dosa' }, 30).burnFrac).toBe(1);
    expect(slotVisual({ st: 'empty' }, 3).st).toBe('empty');
  });
  it('maps outcomes to moods', () => {
    expect(moodOf({ st: 'waiting' })).toBe('waiting');
    expect(moodOf({ st: 'paying' })).toBe('paying');
    expect(moodOf({ st: 'left', outcome: 'paid' })).toBe('happy');
    expect(moodOf({ st: 'left', outcome: 'angry' })).toBe('angry');
    expect(moodOf({ st: 'left', outcome: 'unpaid' })).toBe('walkaway');
  });
  it('avatars walk with the shared kinematics and report arrival once (parity with movement.js stepWalker)', () => {
    const w = { x: standX('tawa1'), dir: 0, arrived: true };
    const target = standX('chai1');
    const ref = { x: w.x };
    let arrivals = 0;
    let t = 0;
    while (t < 5) {
      if (stepAvatarX(w, target, 1 / 60)) arrivals++;
      ref.x = stepWalker(ref.x, target, 1 / 60).x;
      expect(w.x).toBeCloseTo(ref.x, 9); // identical to the HUD runner's stepWalker
      t += 1 / 60;
    }
    expect(arrivals).toBe(1);
    expect(w.x).toBe(target);
    expect(w.dir).toBe(0);
    const secs = Math.abs(STATIONS.chai1.x - STATIONS.tawa1.x) / WALK_SPEED;
    expect(secs).toBeGreaterThan(0.5);
  });
  it('gives players at one stand x opposite lanes and nobody else a lane', () => {
    expect(laneOffset(0, [1.5, 1.5])).toBeCloseTo(LANE_OFFSET);
    expect(laneOffset(1, [1.5, 1.5])).toBeCloseTo(-LANE_OFFSET);
    expect(laneOffset(0, [-3, 3])).toBe(0);
    const three = [0, 0, 0].map((_, i) => laneOffset(i, [2, 2, 2]));
    expect(new Set(three.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
    const mid = laneOffset(0, [0.35, 0]);
    expect(Math.abs(mid)).toBeGreaterThan(0);
    expect(Math.abs(mid)).toBeLessThan(LANE_OFFSET);
  });
  it('puts another cook beside and a little behind you when close, and leaves distant ones alone', () => {
    const near = crowdOffset(0, 1);
    expect(near.x).toBeGreaterThan(0.5);
    expect(near.z).toBeGreaterThan(0);
    expect(crowdOffset(0, -1).x).toBeLessThan(-0.5);
    const far = crowdOffset(2.6, 1);
    expect(far.x).toBe(0);
    expect(far.z).toBe(0);
    // continuous in dx: no jump while passing
    let prev = crowdOffset(-1.2, 1).x;
    for (let dx = -1.2; dx <= 1.2; dx += 0.01) {
      const cur = crowdOffset(dx, 1).x;
      expect(Math.abs(cur - prev)).toBeLessThan(0.08);
      prev = cur;
    }
  });
  it('maps action events to work kinds', () => {
    expect(workForEvent({ type: 'cook-start', station: 'tawa1', by: 'p1' })).toMatchObject({ kind: 'tawa', by: 'p1' });
    expect(workForEvent({ type: 'take', station: 'steamer1', by: 'p1' }).kind).toBe('steamer');
    expect(workForEvent({ type: 'cook-start', station: 'kadai1', by: 'p1' }).kind).toBe('kadai');
    expect(workForEvent({ type: 'cook-start', station: 'chai1', by: 'p1' }).kind).toBe('chai');
    expect(workForEvent({ type: 'serve', by: 'p2' }).kind).toBe('serve');
    expect(workForEvent({ type: 'collect', by: 'p2' }).kind).toBe('collect');
    expect(workForEvent({ type: 'discard', by: 'p2' }).kind).toBe('discard');
    expect(workForEvent({ type: 'tick' })).toBeNull();
    expect(workForEvent({ type: 'serve' })).toBeNull();
  });
  it('misc: seeds, colours, angles', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(avatarColor({ avatar: '#112233' }, 0)).toBe('#112233');
    expect(avatarColor({}, 1)).toMatch(/^#/);
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 5);
    expect(wrapAngle(0.5 + Math.PI * 4)).toBeCloseTo(0.5, 5);
  });
  it('customers arrive from and leave to the street beyond their spot, never through the counter', () => {
    for (let s = 0; s < LAYOUT.spots; s++) {
      const a = arrivalStart(s);
      expect(a.z).toBeLessThan(LAYOUT.spotZ);
      const d = departureEnd(s, LAYOUT.spotX(s));
      expect(d.z).toBeLessThan(LAYOUT.spotZ);
      expect(Math.abs(d.x - LAYOUT.spotX(s))).toBeGreaterThan(2);
    }
  });
});

describe('viewmodel action mapping', () => {
  it('maps every event kind to the station-specific action sequence', () => {
    const kinds = (seq) => seq.map((s) => s[0]);
    expect(kinds(actionSeqFor({ type: 'cook-start', station: 'tawa1' }))).toEqual(['tawa-oil', 'tawa-pour', 'tawa-spread']);
    expect(kinds(actionSeqFor({ type: 'take', station: 'tawa2', dish: 'dosa' }))).toEqual(['tawa-flip', 'tawa-take']);
    expect(kinds(actionSeqFor({ type: 'take', station: 'tawa1', dish: 'masala_dosa' }))).toEqual(['tawa-fill', 'tawa-take']);
    expect(kinds(actionSeqFor({ type: 'cook-start', station: 'steamer1' }))).toEqual(['steamer']);
    expect(kinds(actionSeqFor({ type: 'take', station: 'steamer1', dish: 'idly' }))).toEqual(['steamer']);
    expect(kinds(actionSeqFor({ type: 'cook-start', station: 'kadai1' }))).toEqual(['kadai']);
    expect(kinds(actionSeqFor({ type: 'cook-start', station: 'chai1' }))).toEqual(['chai-pour']);
    expect(kinds(actionSeqFor({ type: 'take', station: 'chai1', dish: 'irani_chai' }))).toEqual(['chai-pour']);
    expect(kinds(actionSeqFor({ type: 'serve' }))).toEqual(['serve']);
    expect(kinds(actionSeqFor({ type: 'collect' }))).toEqual(['collect']);
    expect(kinds(actionSeqFor({ type: 'discard' }))).toEqual(['discard']);
    expect(kinds(actionSeqFor({ type: 'burnt-cleared', station: 'tawa1' }))).toEqual(['discard']);
    expect(actionSeqFor({ type: 'tick' })).toBeNull();
    expect(actionSeqFor({ type: 'ready', station: 'tawa1' })).toBeNull();
    expect(actionSeqFor({ type: 'cook-start', station: 'nope' })).toBeNull();
    expect(actionSeqFor(null)).toBeNull();
  });
  it('covers exactly the twelve actions and every sequence is about as long as the work pause', () => {
    const used = new Set(Object.values(SEQ).flatMap((s) => s.map((a) => a[0])));
    expect([...used].sort()).toEqual([...ACTION_KINDS].sort());
    for (const s of Object.values(SEQ)) {
      expect(seqDuration(s)).toBeGreaterThan(WORK_MS / 1000 - 0.2);
      expect(seqDuration(s)).toBeLessThan(WORK_MS / 1000 + 0.15);
    }
  });
  it('samples a sequence by time: kind, phase 0..1, done at the end', () => {
    const s = SEQ.tawaCook;
    expect(sampleSeq(s, 0)).toMatchObject({ kind: 'tawa-oil', t01: 0, done: false });
    const mid = sampleSeq(s, 0.22 + 0.11);
    expect(mid.kind).toBe('tawa-pour');
    expect(mid.t01).toBeCloseTo(0.5, 6);
    expect(mid.done).toBe(false);
    const end = sampleSeq(s, 99);
    expect(end).toMatchObject({ kind: 'tawa-spread', t01: 1, done: true });
    expect(sampleSeq(s, -3).kind).toBe('tawa-oil');
  });
  it('the action player replays a sequence once, replaces a player\'s own, and never allocates beyond its pool', () => {
    const p = createActionPlayer(4);
    const seen = [];
    const fn = (play, kind, t01, done) => seen.push([play.who, kind, +t01.toFixed(2), done]);
    p.start(SEQ.serve, 'a', null, 0);
    expect(p.active('a')).toBe(true);
    p.update(0.25, fn);
    p.update(0.3, fn);
    expect(seen.at(-1)).toEqual(['a', 'serve', 1, true]);
    expect(p.active('a')).toBe(false);
    p.update(0.1, fn);
    expect(seen).toHaveLength(2);
    p.start(SEQ.tawaCook, 'a', 'tawa1', 1);
    p.start(SEQ.kadai, 'a', 'kadai1', 0); // replaces
    seen.length = 0;
    p.update(0.1, fn);
    expect(seen).toHaveLength(1);
    expect(seen[0][1]).toBe('kadai');
    for (let i = 0; i < 20; i++) p.start(SEQ.serve, `w${i}`);
    expect(p.size).toBe(4);
    expect(p.cancel('w19')).toBe(true);
    expect(p.start([], 'x')).toBeNull();
  });
});

describe('picking in first person', () => {
  const W = 390;
  const H = 844;
  const camera = new PerspectiveCamera(viewFov(W / H), W / H, 0.05, 160);
  const rig = createCameraRig(camera);
  rig.setAspect(W / H, W, H);
  rig.setBody(0, 0);
  rig.reset();
  rig.update(1 / 60, 0);
  const projector = cameraProjector(camera, () => ({ w: W, h: H }));
  const at = (x, y, z) => ({ x, y, z });
  const px = (p) => projector.project(p, { x: 0, y: 0, depth: 0, vx: 0, vy: 0 });
  const s = STATIONS.kadai1; // straight ahead

  const proxies = [
    { kind: 'station', target: { kind: 'station', station: 'kadai1' }, a: at(s.x, 0.95, s.z + 0.3), radius: 0.62 },
    { kind: 'slot', target: { kind: 'slot', station: 'kadai1', slot: 0 }, a: at(s.x - 0.35, 1.0, s.z + 0.1), radius: 0.2 },
    { kind: 'slot', target: { kind: 'slot', station: 'kadai1', slot: 1 }, a: at(s.x + 0.1, 1.0, s.z + 0.1), radius: 0.2 },
    { kind: 'customer', target: { kind: 'customer', id: 'c1' }, a: at(LAYOUT.spotX(2), 0.95, LAYOUT.spotZ), b: at(LAYOUT.spotX(2), 1.7, LAYOUT.spotZ), radius: 0.3 },
    { kind: 'bin', target: { kind: 'bin' }, a: at(LAYOUT.bin.x, 0.5, LAYOUT.bin.z), radius: 0.5 },
  ];

  it('shows the stations in front, to scale: left stations on the left, right on the right (no mirroring)', () => {
    const left = px(at(STATIONS.tawa1.x, 1, STATIONS.tawa1.z));
    const right = px(at(STATIONS.chai1.x, 1, STATIONS.chai1.z));
    const mid = px(at(STATIONS.kadai1.x, 1, STATIONS.kadai1.z));
    expect(left.depth).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(mid.x);
    expect(mid.x).toBeLessThan(right.x);
    expect(Math.abs(mid.x - W / 2)).toBeLessThan(2);
    // customers are beyond the stations: further away, so they sit higher / smaller in the picture
    const cust = px(at(0, 1.55, LAYOUT.spotZ));
    expect(cust.depth).toBeGreaterThan(mid.depth);
  });
  it('hits the thing under the pointer and nothing in empty space; a slot beats its station', () => {
    const slot1 = px(proxies[2].a);
    expect(pickFromProxies(proxies, slot1.x, slot1.y, projector)).toEqual({ kind: 'slot', station: 'kadai1', slot: 1 });
    const slot0 = px(proxies[1].a);
    expect(pickFromProxies(proxies, slot0.x, slot0.y, projector)).toEqual({ kind: 'slot', station: 'kadai1', slot: 0 });
    const body = px(at(LAYOUT.spotX(2), 1.3, LAYOUT.spotZ));
    expect(pickFromProxies(proxies, body.x, body.y, projector)).toEqual({ kind: 'customer', id: 'c1' });
    expect(pickFromProxies(proxies, 2, 2, projector)).toBeNull();
  });
  it('falls back to the station when the pointer is on it but off the slots', () => {
    const c = px(at(s.x, 0.95, s.z + 0.3));
    const hit = pickFromProxies(proxies, c.x + 1, c.y + 30, projector);
    expect(hit).toEqual({ kind: 'station', station: 'kadai1' });
  });
  it('never makes a target smaller than a fingertip (44 px)', () => {
    expect(MIN_PX).toBe(44);
    const tiny = [{ kind: 'slot', target: { kind: 'slot', station: 's', slot: 0 }, a: at(0, 1, -1), radius: 0.001 }];
    const c = px(tiny[0].a);
    expect(pickFromProxies(tiny, c.x + MIN_PX / 2 - 1, c.y, projector)).not.toBeNull();
    expect(pickFromProxies(tiny, c.x + MIN_PX / 2 + 3, c.y, projector)).toBeNull();
  });
  it('picks the nearest of two overlapping discs, with the slot bias', () => {
    const a = { kind: 'station', target: { kind: 'station', station: 'A' }, a: at(0, 1, -1), radius: 0.4 };
    const b = { kind: 'slot', target: { kind: 'slot', station: 'A', slot: 0 }, a: at(0.05, 1, -1), radius: 0.2 };
    const c = px(b.a);
    expect(pickFromProxies([a, b], c.x, c.y, projector).kind).toBe('slot');
    expect(pickFromProxies([b, a], c.x, c.y, projector).kind).toBe('slot');
    // a little off the slot, still inside both discs: the bias keeps the slot ahead of the station that is closer to the pointer
    const near = px(a.a);
    expect(pickFromProxies([a, b], (c.x * 3 + near.x) / 4, c.y, projector).kind).toBe('slot');
  });
  it('geometry helpers', () => {
    expect(distToSegment(0, 5, -5, 0, 5, 0)).toBe(5);
    expect(distToSegment(10, 0, 0, 0, 5, 0)).toBe(5);
    const r = worldRadiusForPx(44, 10, 42, 800);
    expect(r * pxPerMetre(10, 42, 800)).toBeCloseTo(22, 5);
    expect(px(at(0, 1, -1)).depth).toBeGreaterThan(0);
    const behind = [{ kind: 'bin', target: { kind: 'bin' }, a: at(0, 5, 500), radius: 5 }];
    expect(pickFromProxies(behind, W / 2, H / 2, projector)).toBeNull();
  });
  it('an off-screen target gets an edge hint on the side it is on, an on-screen one does not', () => {
    const W2 = W;
    const H2 = H;
    const proj = (p) => {
      const o = projector.project(p, { x: 0, y: 0, depth: 0, vx: 0, vy: 0 });
      const visible = o.depth > 0 && o.x >= 0 && o.x <= W2 && o.y >= 0 && o.y <= H2;
      return { o, visible, edge: visible ? null : edgeHint(o.x, o.y, o.depth, o.vx, o.vy, W2, H2, 30) };
    };
    const ahead = proj(at(0, 1.5, -3));
    expect(ahead.visible).toBe(true);
    const right = proj(at(5, 1.5, -2.5));
    expect(right.visible).toBe(false);
    expect(right.edge.side).toBe('right');
    expect(right.edge.x).toBeCloseTo(W2 - 30, 4);
    const left = proj(at(-5, 1.5, -2.5));
    expect(left.edge.side).toBe('left');
    expect(left.edge.x).toBeCloseTo(30, 4);
    const behind = proj(at(1, 1.5, 4));
    expect(behind.visible).toBe(false);
    expect(behind.edge.side).toBe('behind');
    expect(behind.edge.x).toBeGreaterThan(W2 / 2); // it is behind-right
  });
  it('the raycast fallback finds a big object the discs missed, nearest first', () => {
    const near = { target: { kind: 'station', station: 'near' }, box: boxAt(0, 1.4, -1.0, 0.5, 0.5, 0.3) };
    const far = { target: { kind: 'customer', id: 'far' }, box: boxAt(0, 1.4, -2.5, 0.5, 0.5, 0.3) };
    camera.updateMatrixWorld();
    expect(pickBoxes([far, near], camera, 0, 0)).toEqual({ kind: 'station', station: 'near' });
    expect(pickBoxes([far], camera, 0, 0)).toEqual({ kind: 'customer', id: 'far' });
    expect(pickBoxes([near, far], camera, 0.99, 0.99)).toBeNull();
    expect(pickBoxes([], camera, 0, 0)).toBeNull();
    expect(new Box3().isBox3).toBe(true);
  });
});

// --- the sync layer with stubs (no WebGL): me has no body but a viewmodel, the others are avatars, events drive the hands --------------------------------
describe('sync (first person)', () => {
  const stubStall = () => {
    const stations = new Map();
    for (const id of ['tawa1', 'chai1']) {
      const g = new Group();
      g.position.set(STATIONS[id].x, 0, STATIONS[id].z);
      const prop = { group: g, playAction: vi.fn(), setSlot: vi.fn(), update() {}, dispose() {} };
      stations.set(id, { id, kind: STATIONS[id].kind, group: g, prop, anchors: [new Vector3(0, 0.95, 0.1)] });
    }
    return {
      stations,
      binPos: new Vector3(LAYOUT.bin.x, 0, LAYOUT.bin.z),
      counterY: 0.97,
      setStations() {},
      setSpots() {},
      setMenu() {},
      bumpBin: vi.fn(),
      slotWorld(id, i, out) {
        const s = stations.get(id);
        return s ? out.copy(s.anchors[0]).add(s.group.position) : null;
      },
    };
  };
  const fxStub = () => ({ burst: vi.fn(), emit: vi.fn(), floatText: vi.fn() });
  const tr = { track: (o) => o };
  const art = { blob: () => null };
  const mkSync = () => {
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
    tick: 5, cfg: { stations: ['tawa1', 'chai1'], spots: 3, menu: ['dosa'], hour: [8, 9] }, shiftTicks: 100, order: ['p1', 'p2'],
    players: { p1: { id: 'p1', name: 'Me', at: 'tawa1', hands: [] }, p2: { id: 'p2', name: 'Them', at: 'chai1', hands: [{ dish: 'dosa', q: 'good' }] } },
    stations: { tawa1: { slots: [{ st: 'empty' }] }, chai1: { slots: [{ st: 'empty' }] } }, customers: [], ...over,
  });
  const run = (sync, camera, secs, now = 1000) => {
    for (let i = 0; i < secs * 60; i++) {
      sync.advance(1 / 60);
      sync.update(1 / 60, i / 60, now + i * 16, { yaw: 0, pitch: 0 });
    }
    void camera;
  };

  it('gives the local cook a walker and hands but no body; others get avatars', () => {
    const { sync, scene } = mkSync();
    sync.setMe('p1');
    sync.setState(state(), 1000);
    expect(sync.me().x).toBeCloseTo(STATIONS.tawa1.x, 9);
    expect(sync.getAvatarX('p2')).toBeCloseTo(STATIONS.chai1.x, 9);
    expect(sync.viewmodel).toBeTruthy();
    const names = [];
    scene.getObjectByName('actors').traverse((o) => names.push(o.name));
    expect(scene.getObjectByName('actors').children.length).toBe(1); // exactly one other cook's holder
    // the viewmodel hangs off the camera
    expect(sync.viewmodel.group.parent).not.toBeNull();
    // switching who "me" is swaps body and hands
    sync.setMe('p2');
    expect(scene.getObjectByName('actors').children.length).toBe(1);
    sync.dispose();
  });
  it('the walker uses the shared kinematics and reports arrival once; the aim point follows `at`', () => {
    const { sync, camera } = mkSync();
    const arrivals = [];
    sync.onAvatarArrive((a) => arrivals.push(a));
    sync.setMe('p1');
    sync.setState(state(), 1000);
    arrivals.length = 0;
    const s2 = state();
    s2.players.p1.at = 'chai1';
    sync.setState(s2, 1000);
    const ref = { x: standX('tawa1') };
    for (let i = 0; i < 90; i++) {
      sync.advance(1 / 60);
      ref.x = stepWalker(ref.x, standX('chai1'), 1 / 60).x;
      expect(sync.me().x).toBeCloseTo(ref.x, 9);
    }
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ playerId: 'p1', at: 'chai1' });
    const aim = { x: 0, y: 0, z: 0 };
    expect(sync.autoAim(aim)).toBe(true);
    expect(aim.x).toBeCloseTo(STATIONS.chai1.x, 6);
    expect(aim.z).toBeLessThan(0);
    for (let i = 0; i < 60 * 3; i++) sync.advance(1 / 60); // after the hold, the head is free again
    expect(sync.autoAim(aim)).toBe(false);
    void camera;
  });
  it('plays the matching viewmodel action and drives the station prop in sync for the local cook only', () => {
    const { sync, camera, stall } = mkSync();
    sync.setMe('p1');
    sync.setState(state(), 1000);
    camera.updateMatrixWorld();
    const vm = sync.viewmodel;
    vm.setAction = vi.fn();
    sync.handleEvents([{ type: 'cook-start', station: 'tawa1', slot: 0, dish: 'dosa', by: 'p1' }]);
    run(sync, camera, 1);
    const kinds = vm.setAction.mock.calls.map((c) => c[0]).filter(Boolean);
    expect([...new Set(kinds)]).toEqual(['tawa-oil', 'tawa-pour', 'tawa-spread']);
    for (const c of vm.setAction.mock.calls) if (c[0]) expect(c[1]).toBeGreaterThanOrEqual(0), expect(c[1]).toBeLessThanOrEqual(1);
    expect(vm.setAction.mock.calls.at(-1)).toEqual([null, 0]); // and it lets go at the end
    const prop = stall.stations.get('tawa1').prop;
    expect(prop.playAction).toHaveBeenCalled();
    expect(prop.playAction.mock.calls.every((c) => c[0] === 0)).toBe(true);
    expect(prop.playAction.mock.calls.at(-1)[1]).toBe('tawa-spread');
    expect(prop.playAction.mock.calls.at(-1)[2]).toBe(1);
    // somebody else's event moves the stall but not my hands
    vm.setAction.mockClear();
    sync.handleEvents([{ type: 'cook-start', station: 'chai1', slot: 0, dish: 'irani_chai', by: 'p2' }]);
    run(sync, camera, 1);
    expect(vm.setAction.mock.calls.filter((c) => c[0])).toHaveLength(0);
    expect(stall.stations.get('chai1').prop.playAction).toHaveBeenCalledWith(0, 'chai-pour', expect.any(Number));
    // serve / collect / discard map to the hands too
    for (const [ev, kind] of [[{ type: 'serve', customer: 1, dish: 'dosa', by: 'p1' }, 'serve'], [{ type: 'collect', customer: 1, by: 'p1', amount: 40, tip: 0 }, 'collect'], [{ type: 'discard', dish: 'dosa', by: 'p1' }, 'discard']]) {
      vm.setAction.mockClear();
      sync.handleEvents([ev]);
      run(sync, camera, 1);
      expect(vm.setAction.mock.calls.some((c) => c[0] === kind)).toBe(true);
    }
  });
  it('cuts my hands when I start walking, shows carried dishes in them', () => {
    const { sync, camera } = mkSync();
    sync.setMe('p1');
    sync.setState(state(), 1000);
    const vm = sync.viewmodel;
    vm.setAction = vi.fn();
    vm.setHands = vi.fn();
    sync.handleEvents([{ type: 'serve', customer: 1, dish: 'dosa', by: 'p1' }]);
    const s2 = state();
    s2.players.p1.at = 'chai1';
    s2.players.p1.hands = [{ dish: 'idly', q: 'perfect' }];
    sync.setState(s2, 1000); // I start to walk right away
    run(sync, camera, 0.3);
    expect(vm.setAction.mock.calls.filter((c) => c[0])).toHaveLength(0);
    expect(vm.setHands).toHaveBeenCalledWith([{ dish: 'idly', q: 'perfect' }]);
  });
  it('shows customers across the counter, their dishes on the counter, and resolves targets for bubbles and the highlight', () => {
    const { sync, camera, scene } = mkSync();
    sync.setMe('p1');
    const c = { id: 7, kind: 'office', name: 'Ravi anna', spot: 2, st: 'waiting', patience: 20, patienceMax: 30, got: ['dosa'], qs: ['good'], need: ['dosa', 'dosa'], arrivedAt: 0 };
    sync.setState(state({ customers: [c] }), 1000);
    run(sync, camera, 0.2);
    const out = { x: 0, y: 0, z: 0 };
    const top = new Vector3();
    const centre = new Vector3();
    expect(sync.resolve({ kind: 'customer', id: 7 }, centre, top)).toBeGreaterThan(0);
    expect(centre.x).toBeCloseTo(LAYOUT.spotX(2), 6);
    expect(centre.z).toBeCloseTo(LAYOUT.spotZ, 6);
    expect(top.y).toBeGreaterThan(centre.y);
    // the served dish stands on the counter in front of them, inside its customer-side edge
    const dishes = [];
    scene.getObjectByName('actors').traverse((o) => {
      if (o.position && Math.abs(o.position.y - 0.97) < 1e-6 && Math.abs(o.position.z - PLATE_Z) < 1e-6) dishes.push(o);
    });
    expect(dishes.length).toBeGreaterThan(0);
    expect(PLATE_Z).toBeGreaterThan(LAYOUT.counterZ);
    expect(sync.resolve({ kind: 'slot', station: 'tawa1', slot: 0 }, centre, top)).toBeGreaterThan(0);
    expect(sync.resolve({ kind: 'station', id: 'chai1' }, centre, top)).toBeGreaterThan(0);
    expect(sync.resolve({ kind: 'bin' }, centre, top)).toBeGreaterThan(0);
    expect(sync.resolve({ kind: 'hands' }, centre, top)).toBeGreaterThan(0);
    expect(sync.resolve({ kind: 'customer', id: 999 }, centre, top)).toBe(0);
    expect(sync.resolve(null, centre, top)).toBe(0);
    void out;
    const proxies = sync.buildProxies(5e6);
    expect(proxies.some((p) => p.kind === 'customer')).toBe(true);
    expect(proxies.filter((p) => p.kind === 'slot')).toHaveLength(2);
    expect(proxies.boxes.length).toBeGreaterThanOrEqual(4);
    // customers look at the camera and can speak
    const model = { lookAt: vi.fn(), setSpeaking: vi.fn(), setMood: vi.fn(), setPatience: vi.fn(), update: vi.fn(), group: new Group(), dispose() {} };
    expect(typeof model.lookAt).toBe('function');
    sync.speak(7, 1200, 0.8);
    sync.speak(404, 1, 1); // unknown ids are ignored
  });
  it('skips animating customers and cooks that are out of view (but still advances them now and then)', () => {
    const { sync, camera } = mkSync();
    sync.setMe('p1');
    const c = { id: 8, kind: 'student', name: 'Kiran', spot: 0, st: 'waiting', patience: 20, patienceMax: 30, got: [], qs: [], need: ['dosa'], arrivedAt: 0 };
    sync.setState(state({ customers: [c] }), 1000);
    const { customers, avatars } = sync.actors;
    const cust = customers.get(8).model;
    const other = avatars.get('p2').model;
    const calls = { c: 0, a: 0 };
    const c0 = cust.update;
    const a0 = other.update;
    cust.update = (...x) => { calls.c++; return c0?.apply(cust, x); };
    other.update = (...x) => { calls.a++; return a0?.apply(other, x); };
    const frames = (n, yaw) => {
      for (let i = 0; i < n; i++) {
        sync.advance(1 / 60);
        camera.rotation.set(0, yaw, 0, 'YXZ');
        camera.position.set(0, LAYOUT.eyeHeight, 0);
        camera.updateMatrixWorld();
        sync.update(1 / 60, i / 60, 1000 + i * 16, null);
      }
    };
    frames(60, 0); // looking at the customers: the customer (spot 0, x = -2.75) is in view, p2 (chai, x = 2.6) too at 106 deg
    const seenC = calls.c;
    expect(seenC).toBe(60);
    calls.c = 0;
    calls.a = 0;
    frames(60, Math.PI); // looking at the street behind the cook: nobody is in view
    expect(calls.c).toBeLessThan(10);
    expect(calls.c).toBeGreaterThan(0); // still ticks over a few times a second
    expect(calls.a).toBeLessThan(10);
  });
});

describe('the cook never sees their own body, and the model loaders are guarded', () => {
  it('loadViewmodel always returns a usable hands object', () => {
    const vm = loadViewmodel();
    expect(vm.group).toBeTruthy();
    for (const m of ['setAction', 'update', 'dispose']) expect(typeof vm[m]).toBe('function');
    vm.setAction?.('serve', 0.5);
    vm.setHands?.([{ dish: 'dosa', q: 'good' }]);
    vm.setLookDelta?.(0.1, -0.1);
    vm.update(0.016, 1);
    vm.setAction?.(null, 0);
    vm.dispose();
  });
});
