import { describe, it, expect } from 'vitest';
import { ShaderChunk } from 'three';
import { guardPointLights, lightSkipActive, makeProgramComparator, skipDarkLights } from './gfx-tweaks.js';

describe('guardPointLights', () => {
  it('guards the point-light RE_Direct call of the real three chunk, and only that one', () => {
    const src = ShaderChunk.lights_fragment_begin;
    const out = guardPointLights(src);
    expect(out).not.toBe(src);
    const open = out.indexOf('getPointLightInfo( pointLight');
    const end = out.indexOf('#pragma unroll_loop_end', open);
    const loop = out.slice(open, end);
    expect(loop).toContain('if ( directLight.visible ) { RE_Direct(');
    // a light that is switched off is skipped before its attenuation is computed
    const gate = out.indexOf('if ( dot( pointLight.color, vec3( 1.0 ) ) > 0.0 ) {');
    expect(gate).toBeGreaterThan(out.indexOf('pointLight = pointLights[ i ];'));
    expect(gate).toBeLessThan(open);
    // the whole chunk stays brace-balanced
    expect(out.split('{').length).toBe(out.split('}').length);
    // the spot and directional loops are untouched
    expect(out.slice(end)).not.toContain('if ( directLight.visible ) { RE_Direct(');
    expect(out.split('if ( directLight.visible ) { RE_Direct(').length - 1).toBe(1);
  });

  it('is idempotent and leaves an unknown chunk alone', () => {
    const once = guardPointLights(ShaderChunk.lights_fragment_begin);
    expect(guardPointLights(once)).toBe(once);
    expect(guardPointLights('void main() {}')).toBe('void main() {}');
  });

  it('installs and releases the patch with reference counting', () => {
    const before = ShaderChunk.lights_fragment_begin;
    const a = skipDarkLights();
    const b = skipDarkLights();
    expect(lightSkipActive()).toBe(true);
    expect(ShaderChunk.lights_fragment_begin).toContain('if ( directLight.visible ) { RE_Direct(');
    a();
    a(); // a double release does not steal the second user's hold
    expect(lightSkipActive()).toBe(true);
    b();
    expect(lightSkipActive()).toBe(false);
    expect(ShaderChunk.lights_fragment_begin).toBe(before);
  });
});

describe('program-first opaque sort', () => {
  const item = (o) => ({ groupOrder: 0, renderOrder: 0, materialVariant: 0, z: 0, id: 0, material: { id: 1 }, ...o });
  const prog = new Map();
  const cmp = makeProgramComparator((m) => prog.get(m) ?? -1);

  it('keeps group and render order first, then groups by program, then material, then front to back', () => {
    const mA = { id: 1 };
    const mB = { id: 2 };
    const mC = { id: 3 };
    prog.set(mA, 7);
    prog.set(mB, 3);
    prog.set(mC, 7);
    const sky = item({ material: mA, renderOrder: -1000, id: 1 });
    const a1 = item({ material: mA, z: 0.9, id: 2 });
    const a2 = item({ material: mA, z: 0.2, id: 3 });
    const b1 = item({ material: mB, z: 0.5, id: 4 });
    const c1 = item({ material: mC, z: 0.1, id: 5 });
    const late = item({ material: mB, renderOrder: 9, id: 6 });
    const sorted = [late, c1, a1, b1, sky, a2].sort(cmp);
    expect(sorted.map((x) => x.id)).toEqual([1, 4, 3, 2, 5, 6]);
    // program 3 (mB) first, then program 7 split by material (mA before mC), each front to back
  });

  it('falls back to material order for materials that have no program yet', () => {
    const m1 = { id: 10 };
    const m2 = { id: 11 };
    const out = [item({ material: m2, id: 2 }), item({ material: m1, id: 1 })].sort(cmp);
    expect(out.map((x) => x.id)).toEqual([1, 2]);
  });
});
