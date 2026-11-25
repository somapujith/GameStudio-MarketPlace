import { afterAll, describe, expect, it } from 'vitest';
import { Box3, Object3D, Vector3 } from 'three';
import { TOOL_IDS, buildTool } from './tools.js';
import { setQuality } from './pbr.js';
import { disposeModelCache } from './util.js';

afterAll(() => {
  disposeModelCache();
  setQuality('high');
});

const tris = (o) => {
  let n = 0;
  o.traverse((c) => {
    if (c.isMesh) n += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
  });
  return Math.round(n);
};
const size = (o) => {
  o.updateWorldMatrix(true, true);
  return new Box3().setFromObject(o).getSize(new Vector3());
};

describe('tools', () => {
  for (const id of TOOL_IDS) {
    for (const tier of ['low', 'high']) {
      it(`${id} @ ${tier}: structure, size, finite, dispose`, () => {
        setQuality(tier);
        const t = buildTool(id, { fill: 'sambar', value: 100 });
        expect(t.grip).toBeInstanceOf(Object3D);
        expect(t.tip).toBeInstanceOf(Object3D);
        expect(t.group.children.length).toBeGreaterThan(2);
        const s = size(t.group);
        expect(Math.max(s.x, s.y, s.z)).toBeGreaterThan(0.05);
        expect(Math.max(s.x, s.y, s.z)).toBeLessThan(0.75);
        expect(tris(t.group)).toBeLessThan(4000);
        const owned = [];
        t.group.traverse((o) => {
          if (o.geometry && !o.geometry.userData.shared) {
            const g = o.geometry;
            const orig = g.dispose.bind(g);
            g.__disposed = false;
            g.dispose = () => {
              g.__disposed = true;
              orig();
            };
            owned.push(g);
          }
          const p = o.geometry && o.geometry.attributes.position;
          if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) throw new Error('NaN');
        });
        for (const k of ['pour', 'open', 'fill', 'bogus']) for (const v of [0, 0.5, 1, NaN]) t.set(k, v);
        t.dispose();
        t.dispose();
        expect(owned.every((g) => g.__disposed)).toBe(true);
        expect(t.group.parent).toBe(null);
      });
    }
  }
  it('has realistic proportions (metres)', () => {
    setQuality('high');
    const ladle = size(buildTool('ladle').group);
    expect(ladle.z).toBeGreaterThan(0.28);
    expect(ladle.z).toBeLessThan(0.45);
    const spat = size(buildTool('spatula').group);
    expect(spat.z).toBeGreaterThan(0.3);
    expect(spat.z).toBeLessThan(0.5);
    const glass = size(buildTool('steel-glass').group);
    expect(glass.y).toBeGreaterThan(0.08);
    expect(glass.y).toBeLessThan(0.14);
    const note = size(buildTool('note').group);
    expect(note.x).toBeGreaterThan(0.1);
    expect(note.x).toBeLessThan(0.15);
  });
  it('the money box lid opens', () => {
    const b = buildTool('money-box');
    b.set('open', 1);
    b.group.updateWorldMatrix(true, true);
    const open = new Box3().setFromObject(b.group).max.y;
    b.set('open', 0);
    b.group.updateWorldMatrix(true, true);
    const shut = new Box3().setFromObject(b.group).max.y;
    expect(open).toBeGreaterThan(shut);
  });
  it('the oil bottle shows a stream while pouring', () => {
    const b = buildTool('oil-bottle');
    b.set('pour', 1);
    const stream = b.group.children.find((c) => c.isMesh && c.visible && c.scale.y > 0.05);
    expect(stream).toBeTruthy();
    b.set('pour', 0);
  });
  it('unknown ids fall back to a plate', () => {
    expect(buildTool('???').group.children.length).toBeGreaterThan(0);
  });
});
