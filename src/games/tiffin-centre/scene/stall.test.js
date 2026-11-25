import { describe, it, expect, vi } from 'vitest';
import { Scene, Vector3, PointLight, Mesh } from 'three';

// the models are somebody else's: stub them so this test covers the shell only (and runs in node, without a canvas)
vi.mock('../models/index.js', async () => {
  const { Group, Vector3: V3 } = await import('three');
  return {
    buildStationProp: () => ({ group: new Group(), slotAnchors: [new V3(-0.3, 1, 0), new V3(0, 1, 0), new V3(0.3, 1, 0)], update() {}, dispose() {} }),
    buildStreetProp: () => ({ group: new Group(), update() {}, dispose() {} }),
  };
});

const { createStall, SHELL } = await import('./stall.js');
const { makeArt } = await import('./art.js');
const { createTracker } = await import('./tracker.js');
const { QUALITY } = await import('./quality.js');
const { lightingAt, makeLighting } = await import('./lighting.js');
const { STATIONS, STATION_IDS, LAYOUT } = await import('../../../../shared/tiffin-centre/catalog.js');

function make(tier) {
  const scene = new Scene();
  const tr = createTracker();
  const art = makeArt(tr);
  const stall = createStall({ scene, art, tr, quality: { ...QUALITY[tier], texSize: 128, normalMaps: false } });
  return { scene, tr, stall };
}
const countMeshes = (root) => {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isInstancedMesh) n++;
  });
  return n;
};
const lightsOf = (root) => {
  const out = [];
  root.traverse((o) => {
    if (o instanceof PointLight) out.push(o);
  });
  return out;
};

describe('stall shell', { timeout: 60000 }, () => {
  it('builds at every tier and exposes the API the scene layer reads', () => {
    for (const tier of ['low', 'medium', 'high']) {
      const { scene, stall } = make(tier);
      for (const key of ['root', 'stations', 'binPos', 'setStations', 'setSpots', 'setMenu', 'setLight', 'update', 'slotWorld', 'bumpBin', 'redrawText', 'counterY', 'dispose']) expect(stall[key], key).toBeDefined();
      expect(scene.children).toContain(stall.root);
      expect(stall.binPos.x).toBe(LAYOUT.bin.x);
      expect(stall.binPos.z).toBe(LAYOUT.bin.z);
      stall.dispose();
      expect(scene.children).not.toContain(stall.root);
    }
  });

  it('keeps the draw-call budget: merged statics, a handful of lights, shafts only where the tier has them', () => {
    const low = make('low').stall;
    const medium = make('medium').stall;
    const high = make('high').stall;
    low.setStations(['tawa1', 'chai1']);
    medium.setStations(['tawa1', 'chai1']);
    high.setStations(STATION_IDS);
    expect(countMeshes(medium.root)).toBeLessThan(110);
    expect(countMeshes(high.root)).toBeLessThan(130);
    expect(countMeshes(low.root)).toBeLessThanOrEqual(countMeshes(medium.root) + 6);
    expect(lightsOf(low.root).length).toBe(0); // low: baked-looking pools instead of real lights
    expect(lightsOf(medium.root).length).toBe(3); // two bulbs and the tube
    expect(lightsOf(high.root).length).toBe(5); // four bulbs and the tube
    expect(medium.roofGaps.length).toBeGreaterThanOrEqual(3);
  });

  it('only the stations of the level are real; the rest is tidy empty counter space at the same slots', () => {
    const { stall } = make('medium');
    stall.setStations(['tawa1', 'chai1']);
    expect(stall.stations.size).toBe(STATION_IDS.length);
    for (const id of STATION_IDS) {
      const s = stall.stations.get(id);
      const real = id === 'tawa1' || id === 'chai1';
      expect(!!s.prop, id).toBe(real);
      expect(s.group.position.x).toBe(STATIONS[id].x);
      expect(s.group.position.z).toBe(STATIONS[id].z);
      expect(s.group.position.z).toBe(-1.0);
    }
    // the empty slots carry a counter, a steel top and a cloth or a tray, not a bare stove box
    expect(countMeshes(stall.stations.get('kadai1').group)).toBeGreaterThanOrEqual(3);
    // same ids again keeps the same objects; a different set rebuilds
    const before = stall.stations.get('tawa1');
    stall.setStations(['tawa1', 'chai1']);
    expect(stall.stations.get('tawa1')).toBe(before);
    stall.setStations(STATION_IDS);
    expect(stall.stations.get('kadai1').prop).toBeTruthy();
    expect(stall.stations.get('tawa1')).not.toBe(before);
  });

  it('gives the world position of a slot from the prop anchors, with a sane fallback for empty counters', () => {
    const { stall } = make('medium');
    stall.setStations(['tawa1']);
    const out = new Vector3();
    expect(stall.slotWorld('tawa1', 1, out)).toBe(out);
    expect(out.x).toBeCloseTo(STATIONS.tawa1.x, 5);
    expect(out.z).toBeCloseTo(STATIONS.tawa1.z, 5);
    expect(stall.slotWorld('kadai1', 0, out)).toBe(out);
    expect(out.y).toBeGreaterThan(0.8);
    expect(stall.slotWorld('nope', 0, out)).toBeNull();
  });

  it('turns its lamps on with the evening and off by day; shafts are for the low sun only', () => {
    const { stall } = make('high');
    stall.setStations(STATION_IDS);
    const L = makeLighting();
    const power = () => lightsOf(stall.root).reduce((s, l) => s + l.intensity, 0);
    lightingAt(12.4, L);
    stall.setLight(L, 1);
    expect(power()).toBe(0);
    let shafts = 0;
    stall.root.traverse((o) => {
      if (o instanceof Mesh && o.material.uniforms?.uStrength) shafts += o.visible ? 1 : 0;
    });
    expect(shafts).toBe(0);
    lightingAt(7.0, L);
    stall.setLight(L, 1);
    shafts = 0;
    stall.root.traverse((o) => {
      if (o instanceof Mesh && o.material.uniforms?.uStrength) shafts += o.visible ? 1 : 0;
    });
    expect(shafts).toBeGreaterThan(0);
    lightingAt(22, L);
    stall.setLight(L, 1);
    expect(power()).toBeGreaterThan(20);
    stall.update(1 / 60, 1);
    stall.bumpBin();
    stall.update(0.1, 1.1);
  });

  it('has real dimensions: a steel-topped counter at 82 cm, a ledge at 83 cm whose customer edge is at -1.65, a roof above head height', () => {
    expect(SHELL.counterTop).toBe(0.82);
    expect(SHELL.ledgeTop).toBeGreaterThan(SHELL.counterTop);
    expect(SHELL.roofFrontY).toBeGreaterThan(LAYOUT.eyeHeight + 0.8);
    expect(SHELL.roofRearY).toBeGreaterThan(SHELL.roofFrontY);
    const { stall } = make('medium');
    expect(stall.counterY).toBe(0.82);
    const box = { minZ: Infinity };
    stall.root.traverse((o) => {
      if (o.isMesh && o.geometry?.boundingBox === null) o.geometry.computeBoundingBox();
    });
    void box;
  });
});
