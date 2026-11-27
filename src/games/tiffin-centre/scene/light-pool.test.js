import { describe, it, expect } from 'vitest';
import { Group, Layers, PointLight, Scene, Vector3 } from 'three';
import { FADE, POOL_LAYER, POOL_MAX_RANGE, assignSlots, createLightPool, sourceScore, stepWeight } from './light-pool.js';

describe('sourceScore', () => {
  it('is zero for a dark source and falls with the distance to the eye', () => {
    expect(sourceScore(0, 1)).toBe(0);
    expect(sourceScore(0.01, 1)).toBe(0);
    expect(sourceScore(6, 0.5)).toBeGreaterThan(sourceScore(6, 3));
    expect(sourceScore(6, 3)).toBeGreaterThan(sourceScore(6, 8));
    expect(sourceScore(12, 3)).toBeGreaterThan(sourceScore(6, 3));
  });
});

describe('assignSlots', () => {
  it('serves the k best live sources, best first, and leaves slots empty when fewer are alive', () => {
    expect(assignSlots([0, 5, 0, 9, 2], 2)).toEqual([3, 1]);
    expect(assignSlots([0, 5, 0, 0, 0], 3)).toEqual([1, -1, -1]);
    expect(assignSlots([0, 0], 2)).toEqual([-1, -1]);
    expect(assignSlots([], 2)).toEqual([-1, -1]);
  });
  it('keeps a slot on its source while that source is still among the best (no swap without cause)', () => {
    // source 0 is now only third best of three but k = 3: it keeps slot 0 even though slot order would be [1, 2, 0] by score
    const prev = [0, 1, 2];
    expect(assignSlots([1, 5, 9], 3, prev)).toEqual([0, 1, 2]);
    // source 2 dies: its slot is freed and a better source takes it
    expect(assignSlots([1, 5, 0, 4], 3, prev)).toEqual([0, 1, 3]);
    // k = 2: source 0 (score 1) falls out of the best two: its slot goes to the next best source
    expect(assignSlots([1, 5, 9], 2, [0, 1])).toEqual([2, 1]);
  });
  it('fills a reusable array in place (the per-frame path allocates nothing) and gives the same answer as a fresh one', () => {
    const out = [9, 9, 9];
    const r = assignSlots([0, 5, 0, 9, 2], 3, [-1, -1, -1], out);
    expect(r).toBe(out);
    expect(out).toEqual([3, 1, 4]);
    expect(assignSlots([0, 5, 0, 9, 2], 3)).toEqual(out);
    // ties go to the lower index
    expect(assignSlots([4, 4, 4], 2)).toEqual([0, 1]);
  });
  it('never serves one source in two slots', () => {
    for (let t = 0; t < 50; t++) {
      const scores = Array.from({ length: 8 }, (_, i) => ((i * 7 + t * 3) % 5) + (i % 2 ? 0 : 1));
      const prev = [(t * 5) % 8, (t * 3) % 8, (t * 2) % 8];
      const out = assignSlots(scores, 3, prev).filter((x) => x >= 0);
      expect(new Set(out).size).toBe(out.length);
    }
  });
});

describe('stepWeight', () => {
  it('fades in and out over FADE seconds and stays inside 0..1', () => {
    expect(stepWeight(0, true, FADE / 2)).toBeCloseTo(0.5, 6);
    expect(stepWeight(0.5, true, FADE)).toBe(1);
    expect(stepWeight(0.25, false, FADE / 2)).toBe(0);
    expect(stepWeight(1, true, 1)).toBe(1);
  });
});

const makeStall = () => {
  const scene = new Scene();
  const mk = (x, range, intensity, parent = scene) => {
    const l = new PointLight(0xffaa55, intensity, range, 2);
    l.position.set(x, 1.5, -1);
    parent.add(l);
    return l;
  };
  const station = new Group();
  scene.add(station);
  const bulbA = mk(-2.4, 7.5, 12);
  const bulbB = mk(2.4, 7.5, 12);
  const tube = mk(2.45, 8, 14);
  const lamp = mk(0, 30, 330);
  const flames = [mk(-1, 1.9, 0, station), mk(0, 1.8, 0, station), mk(1, 1.2, 0, station), mk(2, 1.0, 0, station)];
  const candle = mk(0.5, 4.5, 0);
  const prep = mk(3, 5.5, 0);
  return { scene, bulbA, bulbB, tube, lamp, flames, candle, prep, station };
};
const camLayers = new Layers(); // layer 0, like the stall's camera

describe('createLightPool', () => {
  it('takes the small lights off the camera layers, leaves the bulbs, the tube and the lamp, and adds K proxies', () => {
    const s = makeStall();
    const pool = createLightPool({ scene: s.scene, k: 3 });
    const added = pool.refresh();
    expect(added).toBe(6); // 4 flames + candle + prep light
    for (const l of [...s.flames, s.candle, s.prep]) expect(l.layers.test(camLayers)).toBe(false);
    for (const l of [s.bulbA, s.bulbB, s.tube, s.lamp]) expect(l.layers.test(camLayers)).toBe(true);
    const proxies = [];
    s.scene.traverse((o) => o.userData.tcPool && proxies.push(o));
    expect(proxies.length).toBe(3);
    // what a render would count in the shader: bulbs, tube, lamp, proxies = 7, not 11
    let visible = 0;
    s.scene.traverseVisible((o) => o.isPointLight && o.layers.test(camLayers) && visible++);
    expect(visible).toBe(7);
    expect(s.flames[0].layers.test({ mask: 1 << POOL_LAYER })).toBe(true);
    expect(POOL_MAX_RANGE).toBe(6);
  });

  it('a refresh with nothing new changes nothing; a light that arrives later (a rebuilt station) is pooled by the next refresh', () => {
    const s = makeStall();
    const pool = createLightPool({ scene: s.scene, k: 2 });
    pool.refresh();
    expect(pool.refresh()).toBe(0);
    const late = new PointLight(0xff8a3a, 3, 1.8, 2);
    s.station.add(late);
    expect(late.layers.test(camLayers)).toBe(true); // visible to the camera until the pool sees it
    expect(pool.refresh()).toBe(1);
    expect(late.layers.test(camLayers)).toBe(false);
    s.station.remove(late);
    pool.refresh();
    expect(pool.stats.pooled).toBe(6);
  });

  it('serves a flame through a proxy: same colour, range and place, intensity fading in, and nothing when every source is dark', () => {
    const s = makeStall();
    const pool = createLightPool({ scene: s.scene, k: 2 });
    pool.refresh();
    const eye = new Vector3(0, 1.55, 0);
    pool.update(0.016, eye);
    const proxy = () => s.scene.children.filter((o) => o.userData.tcPool);
    expect(proxy().every((p) => p.intensity === 0)).toBe(true);
    s.flames[1].intensity = 8;
    for (let i = 0; i < 4; i++) pool.update(0.016, eye);
    const lit = proxy().filter((p) => p.intensity > 0);
    expect(lit.length).toBe(1);
    expect(lit[0].intensity).toBeGreaterThan(0);
    expect(lit[0].intensity).toBeLessThan(8); // still fading in
    expect(lit[0].distance).toBe(1.8);
    expect(lit[0].position.x).toBeCloseTo(0, 6);
    for (let i = 0; i < 30; i++) pool.update(0.016, eye);
    expect(lit[0].intensity).toBeCloseTo(8, 6);
    expect(pool.stats.active).toBe(1);
    // the flame goes out
    s.flames[1].intensity = 0;
    for (let i = 0; i < 40; i++) pool.update(0.016, eye);
    expect(proxy().every((p) => p.intensity === 0)).toBe(true);
  });

  it('with more live sources than slots the strongest nearest ones win, and a swap fades out before the new source fades in', () => {
    const s = makeStall();
    const pool = createLightPool({ scene: s.scene, k: 2 });
    pool.refresh();
    const eye = new Vector3(0, 1.55, 0);
    const proxies = s.scene.children.filter((o) => o.userData.tcPool);
    s.flames[0].intensity = 6;
    s.flames[1].intensity = 6;
    for (let i = 0; i < 40; i++) pool.update(0.016, eye);
    expect(proxies.filter((p) => p.intensity > 0).length).toBe(2);
    // a third, much stronger source appears: one slot hands over
    s.candle.intensity = 40;
    let minDuring = Infinity;
    for (let i = 0; i < 6; i++) {
      pool.update(0.016, eye);
      const ps = proxies.map((p) => p.intensity);
      minDuring = Math.min(minDuring, ...ps.filter((v) => v >= 0));
    }
    for (let i = 0; i < 40; i++) pool.update(0.016, eye);
    const final = proxies.map((p) => p.intensity).sort((a, b) => b - a);
    expect(final[0]).toBeCloseTo(40, 4); // the candle owns a slot at full strength
    expect(final[1]).toBeCloseTo(6, 4);
    expect(minDuring).toBeGreaterThanOrEqual(0);
  });

  it('setK(0) puts every source back on the camera layers and removes the proxies', () => {
    const s = makeStall();
    const pool = createLightPool({ scene: s.scene, k: 3 });
    pool.refresh();
    pool.setK(0);
    for (const l of [...s.flames, s.candle, s.prep]) expect(l.layers.test(camLayers)).toBe(true);
    expect(s.scene.children.filter((o) => o.userData.tcPool).length).toBe(0);
    pool.setK(2);
    expect(s.scene.children.filter((o) => o.userData.tcPool).length).toBe(2);
    expect(s.flames[0].layers.test(camLayers)).toBe(false);
    pool.dispose();
    expect(s.flames[0].layers.test(camLayers)).toBe(true);
  });
});
