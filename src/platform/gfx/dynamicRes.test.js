import { describe, expect, it, vi } from 'vitest';
import { LinearFilter, ShaderMaterial, WebGLRenderTarget } from 'three';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { DYNRES_GLSL, createBlit, createDynPass, createDynamicRes, dynResUniforms, dynUv, rewriteSamples } from './dynamicRes.js';

const rt = (w = 1000, h = 500) => new WebGLRenderTarget(w, h, { minFilter: LinearFilter, magFilter: LinearFilter });

describe('createDynamicRes', () => {
  it('apply() sets viewport and scissor to the scaled sub-rect and enables the scissor test; scale 1 turns it off', () => {
    const dyn = createDynamicRes({ scale: 0.8 });
    const t = rt(1000, 500);
    const u = dyn.apply(t);
    expect(u).toEqual({ w: 800, h: 400 });
    expect([t.viewport.x, t.viewport.y, t.viewport.z, t.viewport.w]).toEqual([0, 0, 800, 400]);
    expect([t.scissor.z, t.scissor.w]).toEqual([800, 400]);
    expect(t.scissorTest).toBe(true);
    dyn.setScale(1);
    dyn.apply(t);
    expect(t.scissorTest).toBe(false);
    expect([t.viewport.z, t.viewport.w]).toEqual([1000, 500]);
  });
  it('setScale reports changes, clamps to [min, 1], and never reallocates the target', () => {
    const dyn = createDynamicRes({ scale: 1 });
    const t = rt();
    const image = t.texture.image;
    const w0 = t.width;
    expect(dyn.setScale(0.9)).toBe(true);
    expect(dyn.setScale(0.9)).toBe(false);
    expect(dyn.setScale(7)).toBe(true);
    expect(dyn.scale).toBe(1);
    expect(dyn.setScale(0)).toBe(true);
    expect(dyn.scale).toBe(0.25);
    for (const s of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      dyn.setScale(s);
      dyn.apply(t);
    }
    expect(t.width).toBe(w0);
    expect(t.texture.image).toBe(image);
  });
  it('different targets (half-res bloom, full-res colour) scale independently from their own allocation', () => {
    const dyn = createDynamicRes({ scale: 0.7 });
    const full = rt(1920, 1080);
    const half = rt(960, 540);
    expect(dyn.apply(full)).toEqual({ w: 1344, h: 756 });
    expect(dyn.apply(half)).toEqual({ w: 672, h: 378 });
    expect(dyn.sizeOf(full)).toEqual({ w: 1344, h: 756 });
    expect(dyn.sizeOf(half)).toEqual({ w: 672, h: 378 });
    // an un-applied target reports the size it WOULD have
    expect(dyn.sizeOf(rt(100, 100))).toEqual({ w: 70, h: 70 });
  });
  it('the used size keeps the aspect ratio to within one pixel at every ladder rung', () => {
    const t = rt(1920, 1080);
    for (const s of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const dyn = createDynamicRes({ scale: s });
      const u = dyn.apply(t);
      expect(Math.abs(u.w / u.h - 1920 / 1080)).toBeLessThan(1 / u.h + 1e-9);
    }
  });
  it('keeps the shared uniforms current: uDynScale = used / allocated, uDynHalf = half a used texel', () => {
    const dyn = createDynamicRes({ scale: 0.5 });
    const t = rt(1000, 500);
    dyn.apply(t);
    expect(dyn.uniforms.uDynScale.value.toArray()).toEqual([0.5, 0.5]);
    expect(dyn.uniforms.uDynHalf.value.x).toBeCloseTo(0.5 / 500);
    dyn.setScale(0.8);
    expect(dyn.uniforms.uDynScale.value.toArray()).toEqual([0.8, 0.8]);
    expect(dyn.uniforms.uDynHalf.value.y).toBeCloseTo(0.5 / 400);
  });
  it('reset() restores the full viewport; bind() prepares the uniforms for sampling a target', () => {
    const dyn = createDynamicRes({ scale: 0.6 });
    const t = rt(800, 800);
    dyn.apply(t);
    dyn.reset(t);
    expect(t.scissorTest).toBe(false);
    expect([t.viewport.z, t.viewport.w]).toEqual([800, 800]);
    const other = rt(400, 400);
    dyn.bind(other);
    expect(dyn.uniforms.uDynScale.value.x).toBeCloseTo(0.6);
    expect(dyn.uvScaleOf(other).x).toBeCloseTo(0.6);
  });
  it('a one-pixel target never collapses to zero', () => {
    const dyn = createDynamicRes({ scale: 0.25 });
    expect(dyn.apply(rt(2, 2))).toEqual({ w: 1, h: 1 });
  });
  it('dynResUniforms gives fresh uniform objects', () => {
    const a = dynResUniforms();
    const b = dynResUniforms();
    expect(a.uDynScale).not.toBe(b.uDynScale);
    expect(a.uDynScale.value.toArray()).toEqual([1, 1]);
  });
});

describe('dynUv (the JS twin of the GLSL function)', () => {
  const alloc = [1000, 500];
  const used = [800, 400];
  it('maps the virtual [0,1] range into the used part of the texture', () => {
    expect(dynUv([0.5, 0.5], used, alloc)).toEqual([0.4, 0.4]);
    // the centre of the first / last used texel is the clamp, never the edge or beyond
    const lo = dynUv([0, 0], used, alloc);
    const hi = dynUv([1, 1], used, alloc);
    expect(lo[0]).toBeCloseTo((0.5 / 800) * 0.8, 9);
    expect(hi[0]).toBeLessThan(0.8);
    expect(hi[0]).toBeCloseTo((1 - 0.5 / 800) * 0.8, 9);
    expect(hi[1]).toBeLessThan(0.8);
  });
  it('never samples outside the used area, even for uv offsets past the edge (blur taps)', () => {
    for (const uv of [-0.2, -0.001, 0, 0.5, 1, 1.001, 1.5]) {
      const [x, y] = dynUv([uv, uv], used, alloc);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(0.8);
      expect(y).toBeLessThan(0.8);
    }
  });
  it('scale 1 is the identity (up to the half-texel clamp)', () => {
    const [x] = dynUv([0.3, 0.3], [1000, 500], [1000, 500]);
    expect(x).toBeCloseTo(0.3, 9);
  });
});

describe('rewriteSamples', () => {
  it('wraps the uv of the listed samplers and prepends the dynUv helpers', () => {
    const src = 'void main(){ vec3 a = texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb; vec3 b = texture2D(tOther, vUv).rgb; }';
    const r = rewriteSamples(src, ['tColor']);
    expect(r.rewritten).toBe(1);
    expect(r.source).toContain('texture2D(tColor, dynUv(vUv + vec2(-o.x, -o.y))).rgb');
    expect(r.source).toContain('texture2D(tOther, vUv)'); // untouched
    expect(r.source.startsWith(DYNRES_GLSL.trim().split('\n')[0]) || r.source.includes('vec2 dynUv(vec2 uv)')).toBe(true);
  });
  it('handles nested calls, newlines, `texture(` and a bias argument', () => {
    const src = `
      float z = texture2D( tDepth,
        vUv + texture2D(tNoise, vUv).xy * 0.01 ).x;
      vec4 c = texture(tColor, clamp(vUv, 0.0, 1.0), -0.5);
    `;
    const r = rewriteSamples(src, ['tDepth', 'tColor']);
    expect(r.rewritten).toBe(2);
    expect(r.source).toContain('dynUv(vUv + texture2D(tNoise, vUv).xy * 0.01)');
    expect(r.source).toContain('texture(tColor, dynUv(clamp(vUv, 0.0, 1.0)), -0.5)');
  });
  it('rewrites a dynamic fetch nested inside a non-dynamic one', () => {
    const r = rewriteSamples('vec4 x = texture2D(tLut, texture2D(tColor, vUv).rg);', ['tColor']);
    expect(r.source).toContain('texture2D(tLut, texture2D(tColor, dynUv(vUv)).rg)');
  });
  it('no match: returns the source unchanged without the helpers', () => {
    const src = 'void main(){ gl_FragColor = texture2D(tA, vUv); }';
    expect(rewriteSamples(src, ['tZ'])).toEqual({ source: src, rewritten: 0 });
  });
  it('does not touch texture2DProj / textureLod style calls or sampler declarations', () => {
    const src = 'uniform sampler2D tColor; vec4 a = texture2DProj(tColor, p); vec4 b = textureLod(tColor, vUv, 0.0);';
    const r = rewriteSamples(src, ['tColor']);
    expect(r.rewritten).toBe(0);
    expect(r.source).toBe(src);
  });
  it('is balanced and complete on the real FXAA shader from three (its one fetch point is Sample(tex2D, uv))', () => {
    const src = FXAAShader.fragmentShader;
    expect((src.match(/texture\(\s*tex2D/g) || []).length).toBe(1);
    const r = rewriteSamples(src, ['tex2D']);
    expect(r.rewritten).toBe(1);
    expect(r.source).toContain('return texture( tex2D, dynUv(uv));');
    expect((r.source.match(/\(/g) || []).length).toBe((r.source.match(/\)/g) || []).length);
    // and it still compiles as a ShaderMaterial definition (three only builds the program at render time, but the object must construct)
    expect(() => new ShaderMaterial({ fragmentShader: r.source, uniforms: { ...FXAAShader.uniforms, ...dynResUniforms() } })).not.toThrow();
  });
  it('is idempotent in the sense that a second pass does not double-wrap', () => {
    const once = rewriteSamples('a = texture2D(tColor, vUv);', ['tColor']).source;
    const twice = rewriteSamples(once, ['tColor']);
    expect(twice.source.match(/dynUv\(dynUv/g)).toBeNull();
  });
});

describe('createDynPass / createBlit with a stub renderer', () => {
  const stubRenderer = () => ({
    autoClear: true,
    setRenderTarget: vi.fn(),
    setScissorTest: vi.fn(),
    setViewport: vi.fn(),
    render: vi.fn(),
    getPixelRatio: () => 1.25,
    getDrawingBufferSize: (v) => v.set(1920, 1080),
  });
  it('renders into a target at the used sub-rect, with the dyn uniforms shared into the material', () => {
    const dyn = createDynamicRes({ scale: 0.75 });
    const r = stubRenderer();
    const pass = createDynPass({ dyn, uniforms: { tSrc: { value: null } }, fragment: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, dynUv(vUv)); }' });
    const t = rt(1000, 1000);
    pass.render(r, t, dyn);
    expect(r.setRenderTarget).toHaveBeenCalledWith(t);
    expect([t.viewport.z, t.viewport.w]).toEqual([750, 750]);
    expect(pass.uniforms.uDynScale).toBe(dyn.uniforms.uDynScale);
    expect(pass.material.fragmentShader).toContain('vec2 dynUv(vec2 uv)');
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(r.autoClear).toBe(true);
    pass.dispose();
  });
  it('rendering to the canvas (target null) uses the full drawing buffer and no scissor', () => {
    const dyn = createDynamicRes({ scale: 0.5 });
    const r = stubRenderer();
    const pass = createDynPass({ dyn, fragment: 'varying vec2 vUv; void main(){ gl_FragColor = vec4(vUv, 0.0, 1.0); }' });
    pass.render(r, null, dyn);
    expect(r.setRenderTarget).toHaveBeenCalledWith(null);
    expect(r.setScissorTest).toHaveBeenCalledWith(false);
    const [x, y, w, h] = r.setViewport.mock.calls[0];
    expect([x, y]).toEqual([0, 0]);
    expect(w * 1.25).toBeCloseTo(1920);
    expect(h * 1.25).toBeCloseTo(1080);
  });
  it('createBlit binds the source target and draws to the canvas', () => {
    const dyn = createDynamicRes({ scale: 0.6 });
    const r = stubRenderer();
    const blit = createBlit(dyn);
    const t = rt(1000, 500);
    dyn.apply(t);
    blit.render(r, t);
    expect(blit.pass.uniforms.tSrc.value).toBe(t.texture);
    expect(dyn.uniforms.uDynScale.value.x).toBeCloseTo(0.6);
    expect(r.setRenderTarget).toHaveBeenLastCalledWith(null);
    blit.dispose();
  });
});
