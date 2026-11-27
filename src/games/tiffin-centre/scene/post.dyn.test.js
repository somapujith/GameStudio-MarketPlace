// Dynamic resolution without re-allocation in the post pipeline (post.js): the render targets are allocated once, a scale step only moves viewports and uniforms,
// every fetch from a dynamic target goes through dynUv(), texel sizes follow the USED size. A fake renderer records what the pipeline asks of it (no WebGL).
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { QUALITY } from './quality.js';
import { POST_FRAGMENTS, createPost } from './post.js';
import { applyPointScale } from './renderer.js';
import { Points, PointsMaterial, BufferGeometry, Group } from 'three';

function fakeRenderer() {
  const log = [];
  let current = null;
  let compiled = 0;
  const r = {
    autoClear: true,
    log,
    getRenderTarget: () => current,
    setRenderTarget: (t) => {
      current = t;
    },
    render: (obj) => {
      const m = obj?.material || null;
      log.push({
        pass: m?.name || (obj?.isScene ? 'scene' : '?'),
        target: current,
        viewport: current ? [current.viewport.x, current.viewport.y, current.viewport.z, current.viewport.w] : null,
        scissorTest: current ? current.scissorTest : false,
        clear: r.autoClear,
      });
    },
    compile: () => {
      compiled++;
    },
    get compiled() {
      return compiled;
    },
  };
  return r;
}

const cfgOf = (tier, over = {}) => ({ ...QUALITY[tier], ...over });
const makeCamera = () => {
  const c = new PerspectiveCamera(74, 16 / 9, 0.08, 700);
  c.updateMatrixWorld();
  return c;
};

describe('post pipeline: every fetch from a dynamic target is wrapped in dynUv', () => {
  it('ships dynUv once in every fragment, and no un-wrapped fetch from a render target', () => {
    for (const [name, src] of Object.entries(POST_FRAGMENTS)) {
      expect(src.match(/vec2 dynUv\(/g)?.length, name).toBe(1);
      // a fetch is `texture2D(s, uv)` / `textureLod(s, uv, lod)`: its uv argument must start with dynUv( for every sampler the passes read from a dynamic target
      const fetches = [...src.matchAll(/\b(texture2D|textureLod)\(\s*(tColor|tDepth|tAO|tBloom|tDiffuse)\s*,\s*([^,)]*)/g)];
      expect(fetches.length, name).toBeGreaterThan(0);
      for (const f of fetches) expect(f[3].trim().startsWith('dynUv('), `${name}: ${f[0]}`).toBe(true);
    }
  });

  it('keeps the texel-size arithmetic of the passes in the shaders (the offsets are in used-size texels, not allocated ones)', () => {
    expect(POST_FRAGMENTS.pre).toContain('uInv');
    expect(POST_FRAGMENTS.down).toContain('uInv');
    expect(POST_FRAGMENTS.fxaa).toContain('resolution');
  });
});

describe('post pipeline: a scale step re-allocates nothing', () => {
  const W = 800;
  const H = 400;
  const PR = 1.25; // allocated 1000 x 500

  it('allocates once, skips an identical build, rebuilds only for a different size or pipeline', () => {
    const r = fakeRenderer();
    const post = createPost(r, new Scene(), makeCamera());
    const med = cfgOf('medium');
    expect(post.build(med, W, H, PR)).toBe(true);
    const first = post.targets;
    expect(first.scene.width).toBe(1000);
    expect(first.scene.height).toBe(500);
    expect(first.pyramid.length).toBe(5);
    expect(first.pyramid[0].width).toBe(500);
    expect(post.build(med, W, H, PR)).toBe(false); // a resize event with an unchanged box, the second resize of the load
    expect(post.targets.scene).toBe(first.scene);
    expect(post.build(med, W + 40, H, PR)).toBe(true);
    expect(post.targets.scene).not.toBe(first.scene);
    expect(post.build(cfgOf('high'), W + 40, H, PR)).toBe(true);
    expect(post.targets.dof).toBeTruthy();
    post.dispose();
  });

  it('moves viewports and scissors to the used sub-rect, and the used size follows the scale', () => {
    const r = fakeRenderer();
    const post = createPost(r, new Scene(), makeCamera());
    post.build(cfgOf('medium'), W, H, PR);
    const t = post.targets;
    for (const s of [1, 0.85, 0.5]) {
      post.setScale(s);
      r.log.length = 0;
      post.render(0.016);
      const byPass = Object.fromEntries(r.log.map((e) => [`${e.pass}:${e.target ? e.target.width : 'canvas'}`, e]));
      const sceneDraw = r.log[0];
      expect(sceneDraw.target).toBe(t.scene);
      expect(sceneDraw.viewport).toEqual([0, 0, Math.round(1000 * s), Math.round(500 * s)]);
      expect(sceneDraw.scissorTest).toBe(s < 1);
      // the first bloom level is half the scene target: half the used size
      const pre = r.log.find((e) => e.pass === 'bloomPre');
      expect(pre.viewport[2]).toBe(Math.round(500 * s));
      expect(pre.viewport[3]).toBe(Math.round(250 * s));
      // the composite goes to the LDR target (used size), the FXAA pass to the canvas (null target: full size)
      const fin = r.log.find((e) => e.pass === 'final');
      expect(fin.target).toBe(t.ldr);
      expect(fin.viewport[2]).toBe(Math.round(1000 * s));
      expect(r.log[r.log.length - 1].pass).toBe('fxaa');
      expect(r.log[r.log.length - 1].target).toBe(null);
      expect(byPass).toBeTruthy();
      // identity: nothing was re-created by the step
      expect(post.targets.scene).toBe(t.scene);
      expect(post.targets.ldr).toBe(t.ldr);
      expect(post.targets.pyramid[3]).toBe(t.pyramid[3]);
    }
    post.dispose();
  });

  it('computes every texel-size uniform from the used size', () => {
    const r = fakeRenderer();
    const post = createPost(r, new Scene(), makeCamera());
    post.build(cfgOf('medium'), W, H, PR);
    post.setScale(0.5);
    post.render(0.016);
    const U = post.uniforms;
    // the last bloom down pass read level 3 (used 62 x 31 of 125 x 62), the pre pass read the scene (used 500 x 250)
    expect(U.pre.uInv.value.x).toBeCloseTo(1 / 500, 6);
    expect(U.pre.uInv.value.y).toBeCloseTo(1 / 250, 6);
    const lvl = post.targets.pyramid;
    const us = (t) => ({ w: Math.max(1, Math.round(t.width * 0.5)), h: Math.max(1, Math.round(t.height * 0.5)) });
    expect(U.down.uInv.value.x).toBeCloseTo(1 / us(lvl[lvl.length - 2]).w, 6);
    // the FXAA texel is the used LDR size
    post.dispose();
  });

  it('shares ONE set of dynUv uniforms between all the passes (the dyn state of the renderer)', () => {
    const r = fakeRenderer();
    const post = createPost(r, new Scene(), makeCamera());
    const mats = post.getMaterials();
    expect(mats.length).toBe(8);
    for (const m of mats) {
      expect(m.uniforms.uDynScale).toBe(post.dyn.uniforms.uDynScale);
      expect(m.uniforms.uDynHalf).toBe(post.dyn.uniforms.uDynHalf);
    }
    post.dispose();
  });

  it('pre-links every pass of the tier against the target it draws into, and none that the tier does not run', () => {
    const r = fakeRenderer();
    const post = createPost(r, new Scene(), makeCamera());
    post.build(cfgOf('medium'), W, H, PR);
    const targets = [];
    const n = post.prelink((scene) => {
      targets.push([scene.children[0].material.name, r.getRenderTarget()]);
    });
    const names = targets.map((x) => x[0]);
    expect(n).toBe(names.length);
    expect(names).toEqual(['bloomPre', 'bloomDown', 'bloomUp', 'final', 'fxaa']); // medium: no depth of field, no occlusion
    expect(targets.find((x) => x[0] === 'fxaa')[1]).toBe(null); // the canvas
    expect(targets.find((x) => x[0] === 'final')[1]).toBe(post.targets.ldr);
    expect(r.getRenderTarget()).toBe(null); // restored
    post.dispose();
    const r2 = fakeRenderer();
    const p2 = createPost(r2, new Scene(), makeCamera());
    p2.build(cfgOf('high', { msaa: 0, fxaa: true }), W, H, PR);
    const names2 = [];
    p2.prelink((scene) => names2.push(scene.children[0].material.name));
    expect(names2).toEqual(['dof', 'ao', 'aoBlur', 'bloomPre', 'bloomDown', 'bloomUp', 'final', 'fxaa']);
    p2.dispose();
  });
});

describe('point sprites keep their on-screen size at any render scale', () => {
  const make = (size) => {
    const m = new PointsMaterial({ size });
    const p = new Points(new BufferGeometry(), m);
    return { m, p };
  };
  it('multiplies every PointsMaterial size by the scale, remembers the original, and restores it at 1', () => {
    const root = new Group();
    const a = make(0.7);
    const b = make(0.035);
    root.add(a.p, b.p);
    expect(applyPointScale(root, 0.5)).toBe(2);
    expect(a.m.size).toBeCloseTo(0.35, 9);
    expect(b.m.size).toBeCloseTo(0.0175, 9);
    expect(applyPointScale(root, 0.5)).toBe(0); // idempotent: nothing to touch
    expect(applyPointScale(root, 0.8)).toBe(2);
    expect(a.m.size).toBeCloseTo(0.56, 9); // from the ORIGINAL size, not compounded
    applyPointScale(root, 1);
    expect(a.m.size).toBeCloseTo(0.7, 9);
    expect(b.m.size).toBeCloseTo(0.035, 9);
  });
  it('handles a material shared by several Points and a Points that is added later', () => {
    const root = new Group();
    const shared = new PointsMaterial({ size: 1.9 });
    root.add(new Points(new BufferGeometry(), shared), new Points(new BufferGeometry(), shared));
    expect(applyPointScale(root, 0.6)).toBe(1);
    expect(shared.size).toBeCloseTo(1.14, 9);
    const late = make(0.075);
    root.add(late.p);
    applyPointScale(root, 0.6);
    expect(late.m.size).toBeCloseTo(0.045, 9);
    expect(shared.size).toBeCloseTo(1.14, 9);
  });
  it('leaves shader points and meshes alone', () => {
    const root = new Group();
    const sm = { isPointsMaterial: undefined, size: 5, userData: {} };
    const pts = new Points(new BufferGeometry(), sm);
    root.add(pts);
    expect(applyPointScale(root, 0.5)).toBe(0);
    expect(sm.size).toBe(5);
  });
});
