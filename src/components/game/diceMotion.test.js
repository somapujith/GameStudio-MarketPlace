import { describe, expect, it } from 'vitest';
import {
  BOUNCE_AT,
  FACE_NORMALS,
  ORIENT,
  PRIME_LIFT,
  TUMBLE_BEATS,
  burstParticles,
  faceNormals,
  faceShades,
  frontFace,
  newSeed,
  primeFrames,
  restTransform,
  settleFrames,
  skidEnd,
  tumbleFrames,
  tumblePlan,
} from './diceMotion.js';

/** A deterministic random source (mulberry32). */
const rng = (seed) => () => {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  seed = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('landing orientation', () => {
  it('opposite faces sum to 7 and every normal is a unit axis', () => {
    for (const [f, n] of Object.entries(FACE_NORMALS)) {
      const opp = 7 - Number(f);
      expect(n.map((v, i) => v + FACE_NORMALS[opp][i])).toEqual([0, 0, 0]);
      expect(Math.hypot(...n)).toBe(1);
    }
  });

  it('shows exactly the rolled value to the viewer, for every value and any twist', () => {
    const rand = rng(7);
    for (let v = 1; v <= 6; v++) {
      for (let i = 0; i < 25; i++) {
        const seed = newSeed(rand);
        expect(frontFace(v, seed)).toBe(v);
        expect(faceNormals(v, seed)[v][2]).toBeGreaterThan(0.8); // clearly facing us
        expect(restTransform(v, seed)).toContain(ORIENT[v]);
      }
    }
  });

  it('keeps the seed twist small and falls back to a face for 0 / unknown values', () => {
    const rand = rng(3);
    for (let i = 0; i < 50; i++) {
      const s = newSeed(rand);
      expect(Math.abs(s.tz)).toBeLessThanOrEqual(11);
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(5);
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(6);
    }
    expect(restTransform(0, { tz: 0, dx: 0, dy: 0 })).toContain(ORIENT[5]);
    expect(restTransform(9, { tz: 0, dx: 0, dy: 0 })).toContain(ORIENT[5]);
  });

  it('shows three faces, lights the top most and the right face least', () => {
    const seed = { tz: 0, dx: 0, dy: 0 };
    for (let v = 1; v <= 6; v++) {
      const shade = faceShades(v, seed);
      const n = faceNormals(v, seed);
      const visible = [1, 2, 3, 4, 5, 6].filter((f) => n[f][2] > 0);
      expect(visible).toHaveLength(3);
      for (const f of [1, 2, 3, 4, 5, 6]) {
        expect(shade[f]).toBeGreaterThanOrEqual(0);
        expect(shade[f]).toBeLessThanOrEqual(0.34);
        if (n[f][2] <= 0) expect(shade[f]).toBe(0.34);
      }
      const top = visible.find((f) => n[f][1] < -0.5);
      const right = visible.find((f) => n[f][0] > 0.3);
      expect(shade[top]).toBeLessThan(shade[right]);
    }
  });
});

describe('tumble keyframes', () => {
  it('has strictly increasing offsets from 0 to 1 and ends on the floor', () => {
    for (let i = 1; i < TUMBLE_BEATS.length; i++) expect(TUMBLE_BEATS[i].at).toBeGreaterThan(TUMBLE_BEATS[i - 1].at);
    expect(TUMBLE_BEATS[0].at).toBe(0);
    expect(TUMBLE_BEATS.at(-1).at).toBe(1);
    expect(TUMBLE_BEATS.at(-1).y).toBe(0);
    expect(TUMBLE_BEATS.at(-1).spin).toBe(1);
  });

  it('lifts first (anticipation), throws high, then bounces twice on the floor', () => {
    const early = TUMBLE_BEATS.filter((b) => b.at <= 0.12);
    expect(Math.min(...early.map((b) => b.y))).toBeLessThan(-0.1);
    expect(Math.max(...early.map((b) => Math.abs(b.wob)))).toBeGreaterThan(0);
    const peak = Math.min(...TUMBLE_BEATS.map((b) => b.y));
    expect(peak).toBeLessThan(-0.4);
    expect(peak).toBeGreaterThan(-0.8); // stays inside the panel
    expect(BOUNCE_AT).toEqual([0.44, 0.72, 0.92]);
    const apexes = [0.27, 0.58, 0.82].map((at) => -TUMBLE_BEATS.find((b) => b.at === at).y);
    expect(apexes[0]).toBeGreaterThan(apexes[1]);
    expect(apexes[1]).toBeGreaterThan(apexes[2]);
  });

  it('slows the spin down as it bounces (decaying angular speed)', () => {
    const speeds = [];
    for (let i = 3; i < TUMBLE_BEATS.length; i++) {
      const a = TUMBLE_BEATS[i - 1];
      const b = TUMBLE_BEATS[i];
      speeds.push((b.spin - a.spin) / (b.at - a.at));
    }
    expect(speeds.at(-1)).toBeLessThan(speeds[0] / 2);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-9);
  });

  it('builds air / shadow / cube frames with gravity easing and a shadow that tightens with height', () => {
    const plan = tumblePlan(rng(11));
    const f = tumbleFrames(plan, { from: 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)' });
    expect(f.air).toHaveLength(TUMBLE_BEATS.length);
    expect(f.shadow).toHaveLength(TUMBLE_BEATS.length);
    expect(f.cube).toHaveLength(TUMBLE_BEATS.length);
    expect(f.air.map((k) => k.offset)).toEqual(TUMBLE_BEATS.map((b) => b.at));
    // rising segments decelerate, falling ones accelerate
    expect(f.air[3].easing).not.toBe(f.air[4].easing);
    const scale = (k) => Number(/scale\(([\d.]+)\)/.exec(k.transform)[1]);
    expect(scale(f.shadow[0])).toBe(1);
    expect(scale(f.shadow[3])).toBeLessThan(0.7); // top of the throw: small and faint
    expect(Number(f.shadow[3].opacity)).toBeLessThan(Number(f.shadow[0].opacity));
    expect(scale(f.shadow[4])).toBe(1); // bounce 1 on the floor: full size
    // every cube frame keeps the same function list (interpolates per angle, not as a matrix)
    for (const k of f.cube) expect(k.transform).toMatch(/^matrix3d\(.*\) rotateX\(.*\) rotateY\(.*\) rotateZ\(.*\)$/);
    expect(f.cube.at(-1).transform).toContain(`rotateX(${plan.spin.x.toFixed(3)}deg)`);
  });

  it('continues from the primed height instead of jumping', () => {
    const f = tumbleFrames(tumblePlan(rng(1)), { startY: PRIME_LIFT });
    expect(f.air[0].transform).toContain(`${(PRIME_LIFT * 100).toFixed(2)}%`);
  });

  it('randomises spin axes and throw direction per roll within sensible bounds', () => {
    const plans = Array.from({ length: 40 }, (_, i) => tumblePlan(rng(i + 1)));
    expect(new Set(plans.map((p) => p.dir))).toEqual(new Set([-1, 1]));
    for (const p of plans) {
      expect(Math.abs(p.spin.x)).toBeGreaterThanOrEqual(720);
      expect(Math.abs(p.spin.y)).toBeGreaterThanOrEqual(540);
      expect(Math.abs(p.spin.z)).toBeGreaterThanOrEqual(120);
      expect(Math.abs(p.spin.x)).toBeLessThanOrEqual(1080);
    }
    expect(new Set(plans.map((p) => p.spin.x.toFixed(0))).size).toBeGreaterThan(30);
  });
});

describe('settle keyframes', () => {
  it('slides the skid back to the middle and finishes on the floor', () => {
    const plan = { dir: -1, wob: 1, spin: { x: 720, y: 540, z: 120 } };
    expect(skidEnd(plan)).toBeCloseTo(-0.05);
    const s = settleFrames({ from: 'matrix3d(1)', to: 'rotateX(-17deg)', skidX: skidEnd(plan), wobSign: 1 });
    expect(s.air[0].transform).toBe('translate(-5.00%, 0.00%)');
    expect(s.air.at(-1).transform).toBe('translate(0.00%, 0.00%)');
    expect(s.air.map((k) => k.offset)).toEqual([0, 0.26, 0.48, 0.68, 0.86, 1]);
  });

  it('ends exactly on the target pose with a wobble that dies out, and hops small', () => {
    const to = 'rotateX(-17.0deg) rotateY(-21.0deg) rotateZ(2.0deg) rotateY(180deg)';
    const s = settleFrames({ from: 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)', to, wobSign: -1 });
    expect(s.cube[0].transform).toContain('matrix3d');
    expect(s.cube.at(-1).transform).toBe(to);
    const wobbles = s.cube.filter((k) => k.transform.startsWith('rotateZ')).map((k) => Number(/rotateZ\(([-\d.]+)deg\)/.exec(k.transform)[1]));
    expect(wobbles).toHaveLength(2);
    expect(Math.sign(wobbles[0])).toBe(-Math.sign(wobbles[1]));
    expect(Math.abs(wobbles[1])).toBeLessThan(Math.abs(wobbles[0]));
    const heights = s.air.map((k) => Number(/, (-?[\d.]+)%/.exec(k.transform)[1]));
    expect(Math.min(...heights)).toBeGreaterThan(-20);
    expect(s.shadow.at(-1).transform).toContain('scale(1.000)');
  });
});

describe('prime (anticipation) frames', () => {
  it('lifts the die a little and wobbles about z in both directions', () => {
    const f = primeFrames(1);
    expect(f.air.at(-1).transform).toContain(`${(PRIME_LIFT * 100).toFixed(2)}%`);
    const w = f.wobble('rotateX(-17deg)');
    expect(w[0].transform).toContain('rotateZ(5deg)');
    expect(w[1].transform).toContain('rotateZ(-5deg)');
    expect(primeFrames(-1).wobble('x')[0].transform).toContain('rotateZ(-5deg)');
  });
});

describe('six burst', () => {
  it('spreads sparks around the die, deterministically for a given random source', () => {
    const a = burstParticles(6, rng(5));
    expect(a).toHaveLength(6);
    expect(burstParticles(6, rng(5))).toEqual(a);
    const angles = a.map((p) => Math.atan2(p.dy + 0.1, p.dx));
    expect(new Set(angles.map((x) => Math.round(x * 2))).size).toBeGreaterThan(3);
    for (const p of a) {
      expect(Math.hypot(p.dx, p.dy)).toBeGreaterThan(0.6);
      expect(p.size).toBeGreaterThan(0.09);
      expect(p.delay).toBeLessThanOrEqual(70);
      expect([0, 1, 2]).toContain(p.tone);
    }
  });
});
