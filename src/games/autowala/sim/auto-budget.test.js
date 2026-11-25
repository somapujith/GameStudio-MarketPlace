// Performance budget of the auto model: triangles and draw calls of the player's rig (default look and a fully loaded one) and of the
// plain traffic auto. A node canvas stub stands in for the DOM.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT } from '../gameplay/catalog.js';

function ctx2d() {
  let font = '12px x';
  const grad = { addColorStop() {} };
  const target = {
    measureText: (s) => ({ width: String(s).length * (parseFloat(font) || 12) * 0.55 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get: (t, k) => (k === 'font' ? font : k in t ? t[k] : () => {}),
    set: (t, k, v) => {
      if (k === 'font') font = v;
      return true;
    },
  });
}

let build;
let custom;
beforeAll(async () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d() }) };
  custom = await import('./customize.js');
  build = await import('./autoModel.js');
});
afterAll(() => {
  delete globalThis.document;
});

/** Triangles and draw calls of the visible meshes (a draw call per mesh x material group; instanced meshes count once). */
export function measure(root) {
  let tris = 0;
  let calls = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o.parent;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    const g = o.geometry;
    const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    tris += per * (o.isInstancedMesh ? o.count : 1);
    calls += Array.isArray(o.material) ? o.material.length : 1;
  });
  return { tris: Math.round(tris), calls };
}

const FULL = {
  ...DEFAULT_LOADOUT,
  paint: { body: 'neon-pink', roof: 'white', finish: 'pearl' },
  roofStyle: 'dome-lights',
  decals: { ...DEFAULT_LOADOUT.decals, stripe: 'flame', dash: 'ganesh', mudflap: 'horn-ok' },
  rear: { cover: 'led-rainbow', bumper: 'spiked', flaps: 'peacock', ladder: true, antenna: true, sideGuards: true },
  lights: { head: 'cyan', under: 'rainbow', tail: 'cyan' },
  interior: { seats: 'leopard', garland: true },
};

describe('auto model budget', () => {
  it('every merged geometry slot exists, is non-empty and carries the same attributes', () => {
    for (const hi of [false, true]) {
      const slots = build.autoGeometries(hi);
      const names = Object.keys(slots);
      expect(names.length).toBeGreaterThan(8);
      for (const [name, g] of Object.entries(slots)) {
        expect(g, `${hi ? 'player' : 'traffic'} slot ${name}`).toBeTruthy();
        expect(g.attributes.position.count, name).toBeGreaterThan(0);
        expect(g.attributes.normal, name).toBeTruthy();
        expect(g.attributes.uv, name).toBeTruthy();
        expect(g.index, name).toBeNull();
      }
      for (const must of ['paint', 'dark', 'chrome', 'roof', 'upper', 'curtains', 'seat', 'tyre', 'posts', 'tailLens', 'brake', 'hlLamp']) expect(slots[must], must).toBeTruthy();
    }
    // the rig never loses a part to a failed merge: every visible body mesh has triangles
    const p = build.buildAuto({ player: true });
    p.traverse((o) => {
      if (o.isMesh) expect(o.geometry.attributes.position.count, o.name).toBeGreaterThan(0);
    });
  });

  it('reports and bounds the triangles and draw calls', () => {
    const traffic = measure(build.buildAuto({ color: '#2288ff' }));
    const player = measure(build.buildAuto({ player: true }));
    const pa = build.buildAuto({ player: true });
    custom.applyLoadout(pa, FULL);
    const loaded = measure(pa);
    console.log('traffic', traffic, 'player default', player, 'player loaded', loaded);
    expect(traffic.tris).toBeLessThanOrEqual(1500);
    expect(player.tris).toBeLessThanOrEqual(9000);
    expect(loaded.tris).toBeLessThanOrEqual(9000);
    expect(traffic.calls).toBeLessThanOrEqual(20);
    expect(player.calls).toBeLessThanOrEqual(48);
  });
});
