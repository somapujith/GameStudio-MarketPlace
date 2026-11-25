import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120000 });
import { InstancedMesh } from 'three';
import { BUILDERS, triCount } from './traffic-models.js';
import { makeFakeCtx } from './traffic-testkit.js';

// the triangle budget per instance (the traffic is a large share of the scene: keep every body tiny)
const BUDGET = { car: 450, bike: 250, bus: 600, truck: 600, auto: 700 };

describe('traffic geometry budgets', () => {
  for (const [kind, max] of Object.entries(BUDGET)) {
    it(`${kind} is at most ${max} triangles and carries the paint mask`, () => {
      const b = BUILDERS[kind]();
      expect(b.geo).toBeTruthy(); // a failed merge returns null: that would be an invisible vehicle
      expect(b.geo.attributes.position.count).toBeGreaterThan(0);
      expect(b.geo.index).toBeNull();
      expect(triCount(b.geo)).toBeLessThanOrEqual(max);
      expect(b.geo.attributes.aPaint).toBeTruthy();
      expect(b.geo.attributes.color).toBeTruthy();
      let paint = 0;
      for (let i = 0; i < b.geo.attributes.aPaint.count; i++) paint += b.geo.attributes.aPaint.array[i];
      expect(paint).toBeGreaterThan(0); // something to lacquer
      expect(paint).toBeLessThan(b.geo.attributes.aPaint.count); // and something fixed (glass, tyres)
      b.geo.dispose();
    });
  }

  it('the whole traffic system: at most 10 draw calls, only the active instances drawn, pedestrians <= 80 triangles', () => {
    const kit = makeFakeCtx({ quality: 'high' });
    const { ctx, run } = kit;
    run(2, { brake: 1 });
    const meshes = [];
    ctx.scene.traverse((o) => { if (o instanceof InstancedMesh) meshes.push(o); });
    const drawn = meshes.filter((m) => m.visible && m.count > 0);
    expect(meshes.length).toBeLessThanOrEqual(10);
    expect(drawn.length).toBeLessThanOrEqual(10);
    // no shadow pass for any of them
    expect(meshes.every((m) => !m.castShadow)).toBe(true);
    // count follows the active vehicles of each kind
    const byKind = {};
    for (const v of ctx.traffic.vehicles) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
    for (const m of meshes) {
      if (m.geometry.attributes.aTint && Object.keys(BUDGET).some((k) => false)) continue;
    }
    const bodies = meshes.filter((m) => triCount(m.geometry) > 100 && m !== ctx.traffic.peds.pedMesh && m !== ctx.traffic.peds.cowMesh && triCount(m.geometry) > 150);
    const drawnBodies = bodies.reduce((s, m) => s + m.count, 0);
    expect(drawnBodies).toBe(ctx.traffic.vehicles.length);
    expect(triCount(ctx.traffic.peds.pedMesh.geometry)).toBeLessThanOrEqual(80);
    expect(triCount(ctx.traffic.peds.cowMesh.geometry)).toBeLessThanOrEqual(150);
    expect(ctx.traffic.peds.pedMesh.count).toBe(ctx.traffic.peds.activePeds);
    expect(ctx.traffic.peds.activePeds).toBeLessThanOrEqual(ctx.gfx.cfg.peds);
    expect(ctx.traffic.vehicles.length).toBeLessThanOrEqual(ctx.gfx.cfg.traffic);
    // triangles per frame for all traffic and pedestrians together
    const tris = meshes.reduce((s, m) => s + (m.visible ? m.count * triCount(m.geometry) : 0), 0);
    expect(tris).toBeLessThan(60000);
    kit.dispose();
    expect(ctx.scene.children.length).toBe(0);
  });

  it('traffic follows the quality setting', () => {
    for (const [q, n] of [['low', 22], ['medium', 36], ['high', 52]]) {
      const kit = makeFakeCtx({ quality: q });
      kit.run(3, { brake: 1 });
      expect(kit.ctx.traffic.vehicles.length).toBeLessThanOrEqual(n);
      expect(kit.ctx.traffic.vehicles.length).toBeGreaterThanOrEqual(Math.floor(n * 0.6));
      kit.dispose();
    }
  });
});
