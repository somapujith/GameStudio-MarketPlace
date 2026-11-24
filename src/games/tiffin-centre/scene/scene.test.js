import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { lightingAt, makeLighting, sunDirection, tubeFlicker, HOUR_KEYS } from './lighting.js';
import { frameCamera, projectWith, FIT_POINTS, swayOffset } from './camera.js';
import { createQualitySampler, pickQuality, lowerQuality, QUALITY } from './quality.js';
import {
  tickFrac, hourAt, patienceFrac, payFrac, slotVisual, moodOf, laneOffset, stepAvatarX, workForEvent, hashSeed, avatarColor, wrapAngle,
} from './interp.js';
import { pickFromProxies, cameraProjector, worldRadiusForPx, pxPerMetre, distToSegment, MIN_PX } from './picking.js';
import { LAYOUT, STATIONS, PAY_WINDOW } from '../../../../shared/tiffin-centre/catalog.js';
import { LANE_OFFSET, WALK_SPEED, standX, stepWalker } from '../../../../shared/tiffin-centre/movement.js';

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

describe('camera framing', () => {
  const check = (aspect) => {
    const f = frameCamera({ aspect });
    for (const p of FIT_POINTS) {
      const n = projectWith(f, aspect, p);
      expect(Math.abs(n.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.y)).toBeLessThanOrEqual(1);
      expect(n.depth).toBeGreaterThan(0);
    }
    return f;
  };
  it('fits every spot, station and the roof for phone portrait, square and landscape', () => {
    for (const a of [390 / 844, 0.6, 0.9, 1, 4 / 3, 16 / 9, 21 / 9]) check(a);
  });
  it('backs off for narrow screens and looks down steeper', () => {
    const wide = check(16 / 9);
    const tall = check(390 / 844);
    expect(tall.distance).toBeGreaterThan(wide.distance);
    expect(tall.elevation).toBeGreaterThan(wide.elevation);
    expect(tall.fov).toBeGreaterThan(wide.fov);
    expect(wide.pos[1]).toBeGreaterThan(wide.target[1]);
  });
  it('keeps the gameplay inside the HUD-safe window', () => {
    const f = frameCamera({ aspect: 390 / 844, insets: { top: 0.1, bottom: 0.3 } });
    for (const p of FIT_POINTS) {
      const n = projectWith(f, 390 / 844, p);
      expect(n.y).toBeLessThanOrEqual(1 - 0.2 + 1e-6);
      expect(n.y).toBeGreaterThanOrEqual(-1 + 0.6 - 1e-6);
    }
  });
  it('sway is off with reduced motion', () => {
    const o = swayOffset(3, 1, true);
    expect([o.x, o.y, o.tx]).toEqual([0, 0, 0]);
    expect(Math.abs(swayOffset(3, 0, false).x)).toBeLessThan(0.1);
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
  it('avatars walk with the shared kinematics and report arrival once', () => {
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
    // walking past each other eases apart then back
    const mid = laneOffset(0, [0.35, 0]);
    expect(Math.abs(mid)).toBeGreaterThan(0);
    expect(Math.abs(mid)).toBeLessThan(LANE_OFFSET);
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
});

describe('picking', () => {
  const W = 390;
  const H = 844;
  const camera = new PerspectiveCamera(46, W / H, 0.3, 200);
  const f = frameCamera({ aspect: W / H });
  camera.fov = f.fov;
  camera.aspect = W / H;
  camera.position.set(...f.pos);
  camera.lookAt(...f.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const projector = cameraProjector(camera, () => ({ w: W, h: H }));
  const at = (x, y, z) => ({ x, y, z });
  const px = (p) => projector.project(p, { x: 0, y: 0, depth: 0 });

  const proxies = [
    { kind: 'station', target: { kind: 'station', station: 'tawa1' }, a: at(STATIONS.tawa1.x, 0.9, STATIONS.tawa1.z), radius: 0.7 },
    { kind: 'slot', target: { kind: 'slot', station: 'tawa1', slot: 0 }, a: at(STATIONS.tawa1.x - 0.4, 1.1, STATIONS.tawa1.z), radius: 0.2 },
    { kind: 'slot', target: { kind: 'slot', station: 'tawa1', slot: 1 }, a: at(STATIONS.tawa1.x, 1.1, STATIONS.tawa1.z), radius: 0.2 },
    { kind: 'customer', target: { kind: 'customer', id: 'c1' }, a: at(LAYOUT.spotX(2), 0.3, LAYOUT.spotZ), b: at(LAYOUT.spotX(2), 1.6, LAYOUT.spotZ), radius: 0.35 },
    { kind: 'bin', target: { kind: 'bin' }, a: at(LAYOUT.bin.x, 0.5, LAYOUT.bin.z), radius: 0.5 },
  ];

  it('hits the thing under the pointer and nothing in empty space', () => {
    const slot1 = px(proxies[2].a);
    expect(pickFromProxies(proxies, slot1.x, slot1.y, projector)).toEqual({ kind: 'slot', station: 'tawa1', slot: 1 });
    const slot0 = px(proxies[1].a);
    expect(pickFromProxies(proxies, slot0.x, slot0.y, projector)).toEqual({ kind: 'slot', station: 'tawa1', slot: 0 });
    const head = px(proxies[3].b);
    expect(pickFromProxies(proxies, head.x, head.y - 3, projector)).toEqual({ kind: 'customer', id: 'c1' });
    const mid = px(at(LAYOUT.spotX(2), 1, LAYOUT.spotZ));
    expect(pickFromProxies(proxies, mid.x, mid.y, projector)).toEqual({ kind: 'customer', id: 'c1' });
    const bin = px(proxies[4].a);
    expect(pickFromProxies(proxies, bin.x, bin.y, projector)).toEqual({ kind: 'bin' });
    expect(pickFromProxies(proxies, 2, 2, projector)).toBeNull();
  });
  it('falls back to the station when the pointer is on it but off the slots', () => {
    const c = px(at(STATIONS.tawa1.x + 0.2, 0.6, STATIONS.tawa1.z));
    const hit = pickFromProxies(proxies, c.x, c.y + 4, projector);
    expect(['station', 'slot']).toContain(hit.kind);
  });
  it('never makes a target smaller than a fingertip', () => {
    const tiny = [{ kind: 'slot', target: { kind: 'slot', station: 's', slot: 0 }, a: at(0, 1, -1), radius: 0.001 }];
    const c = px(tiny[0].a);
    expect(pickFromProxies(tiny, c.x + MIN_PX / 2 - 1, c.y, projector)).not.toBeNull();
    expect(pickFromProxies(tiny, c.x + MIN_PX / 2 + 3, c.y, projector)).toBeNull();
  });
  it('geometry helpers', () => {
    expect(distToSegment(0, 5, -5, 0, 5, 0)).toBe(5);
    expect(distToSegment(10, 0, 0, 0, 5, 0)).toBe(5);
    const r = worldRadiusForPx(44, 10, 42, 800);
    expect(r * pxPerMetre(10, 42, 800)).toBeCloseTo(22, 5);
    expect(px(at(0, 1, -1)).depth).toBeGreaterThan(0);
    // a point behind the camera is never picked
    const behind = [{ kind: 'bin', target: { kind: 'bin' }, a: at(0, 5, 500), radius: 5 }];
    expect(pickFromProxies(behind, W / 2, H / 2, projector)).toBeNull();
  });
});
