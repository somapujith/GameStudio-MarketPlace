import { describe, it, expect } from 'vitest';
import {
  chooseTier, resolveTier, probeGl, probeEnv, probeCanvasGl, probeBattery, getGfxPref, setGfxPref, GFX_KEY, GFX_PREFS, isSoftwareRenderer, isWeakGpu, isDiscreteGpu, isFlagshipMobileGpu, describeCaps,
} from './capabilities.js';

// a fake WebGL2 context: constants are plain numbers, getParameter reads a table, extensions come from a set
function fakeGl({ gl2 = true, tex = 16384, samples = 8, exts = [], renderer = 'ANGLE (NVIDIA GeForce RTX 3060)', aniso = 16, vertexTex = 16 } = {}) {
  const C = { MAX_TEXTURE_SIZE: 1, MAX_SAMPLES: 2, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 3, MAX_VARYING_VECTORS: 4, MAX_FRAGMENT_UNIFORM_VECTORS: 5, RENDERER: 6, VENDOR: 7 };
  const table = { 1: tex, 2: samples, 3: vertexTex, 4: 30, 5: 1024, 6: 'WebKit WebGL', 7: 'WebKit', 100: renderer, 101: 'Google Inc.', 102: aniso };
  const have = new Set(exts);
  const gl = {
    ...C,
    getParameter: (p) => table[p],
    getExtension: (n) => {
      if (!have.has(n)) return null;
      if (n === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 100, UNMASKED_VENDOR_WEBGL: 101 };
      if (n === 'EXT_texture_filter_anisotropic') return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 102 };
      if (n === 'WEBGL_lose_context') return { loseContext() { gl.lost = true; } };
      return {};
    },
  };
  if (gl2) {
    gl.texStorage2D = () => {};
    gl.drawArraysInstanced = () => {};
  }
  return gl;
}
const FULL = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'WEBGL_debug_renderer_info', 'EXT_texture_filter_anisotropic', 'WEBGL_lose_context', 'KHR_parallel_shader_compile'];
const desktop = (o = {}) => ({ ...probeGl(fakeGl({ exts: FULL })), cores: 12, memoryGB: 8, dpr: 1, coarse: false, saveData: false, ...o });

describe('probeGl', () => {
  it('reads limits, extensions and the unmasked renderer from a WebGL2 context', () => {
    const c = probeGl(fakeGl({ exts: FULL }));
    expect(c).toMatchObject({ webgl: 2, maxTexture: 16384, maxSamples: 8, maxAniso: 16, floatRT: true, halfFloatRT: true, derivatives: true, instancing: true, parallelCompile: true });
    expect(c.renderer).toContain('RTX 3060');
    expect(c.software).toBe(false);
    expect(c.weakGpu).toBe(false);
  });
  it('reports WebGL1 with its own extension names and a null context as no WebGL', () => {
    const c = probeGl(fakeGl({ gl2: false, exts: ['WEBGL_color_buffer_float', 'OES_standard_derivatives', 'ANGLE_instanced_arrays'] }));
    expect(c).toMatchObject({ webgl: 1, floatRT: true, derivatives: true, instancing: true, maxSamples: 0 });
    expect(probeGl(null).webgl).toBe(0);
    expect(probeGl({}).webgl).toBe(0);
  });
  it('survives a context whose getParameter / getExtension throw', () => {
    const gl = fakeGl({ exts: FULL });
    gl.getParameter = () => {
      throw new Error('lost');
    };
    gl.getExtension = () => {
      throw new Error('lost');
    };
    const c = probeGl(gl);
    expect(c.webgl).toBe(2);
    expect(c.maxTexture).toBe(0);
    expect(c.floatRT).toBe(false);
  });
  it('flags software and weak renderers', () => {
    expect(probeGl(fakeGl({ exts: FULL, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' })).software).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Apple, Apple M2, OpenGL 4.1)')).toBe(false);
    for (const r of ['Mali-400 MP', 'Mali-T720', 'Adreno (TM) 306', 'Adreno (TM) 505', 'PowerVR SGX 544MP', 'Intel(R) HD Graphics 4000', 'ANGLE (Intel, Intel(R) HD Graphics 4400 Direct3D11 vs_5_0 ps_5_0)']) expect(isWeakGpu(r), r).toBe(true);
    for (const r of ['Adreno (TM) 650', 'Mali-G78', 'Apple GPU', 'ANGLE (NVIDIA GeForce RTX 3060)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)']) expect(isWeakGpu(r), r).toBe(false);
  });
});

describe('probeCanvasGl', () => {
  it('asks for webgl2, then webgl, releases the context, and never throws', () => {
    const gl = fakeGl({ exts: FULL });
    const doc = { createElement: () => ({ getContext: (k) => (k === 'webgl2' ? gl : null) }) };
    expect(probeCanvasGl(doc).webgl).toBe(2);
    expect(gl.lost).toBe(true);
    expect(probeCanvasGl({ createElement: () => ({ getContext: () => null }) }).webgl).toBe(0);
    expect(probeCanvasGl({ createElement: () => ({ getContext: () => { throw new Error('x'); } }) }).webgl).toBe(0);
    expect(probeCanvasGl({ createElement: () => { throw new Error('x'); } }).webgl).toBe(0);
    expect(probeCanvasGl(null).webgl).toBe(0);
  });
});

describe('probeEnv', () => {
  it('reads hardware hints and tolerates a missing navigator / matchMedia', () => {
    const e = probeEnv({
      nav: { hardwareConcurrency: 6, deviceMemory: 4, maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/120', connection: { saveData: true, effectiveType: '3g' } },
      win: { devicePixelRatio: 2.5, innerWidth: 400, innerHeight: 800, matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }) },
    });
    expect(e).toMatchObject({ cores: 6, memoryGB: 4, dpr: 2.5, coarse: true, saveData: true, android: true, ios: false });
    expect(e.screenPx).toBe(1000 * 2000);
    const bare = probeEnv({ nav: {}, win: {} });
    expect(bare).toMatchObject({ cores: 0, memoryGB: 0, dpr: 1, coarse: false, saveData: false });
    const broken = probeEnv({ nav: {}, win: { matchMedia: () => { throw new Error('x'); } } });
    expect(broken.coarse).toBe(false);
  });
  it('detects reduced data and iPadOS-as-Mac', () => {
    const e = probeEnv({ nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605', maxTouchPoints: 5 }, win: { matchMedia: (q) => ({ matches: q.includes('reduced-data') }) } });
    expect(e.saveData).toBe(true);
    expect(e.ios).toBe(true);
  });
  it('battery probe resolves null when absent or failing', async () => {
    expect(await probeBattery({})).toBeNull();
    expect(await probeBattery({ getBattery: () => Promise.reject(new Error('no')) })).toBeNull();
    expect(await probeBattery({ getBattery: async () => ({ level: 0.5, charging: true }) })).toEqual({ level: 0.5, charging: true });
  });
});

describe('chooseTier', () => {
  it('high on a strong desktop, with a reason', () => {
    const r = chooseTier(desktop());
    expect(r.tier).toBe('high');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('null (unsupported) without WebGL2', () => {
    expect(chooseTier(probeGl(null)).tier).toBeNull();
    const r = chooseTier(probeGl(fakeGl({ gl2: false })));
    expect(r.tier).toBeNull();
    expect(r.reasons[0]).toMatch(/WebGL 1/);
  });
  it('lite on software renderers, weak GPUs, tiny textures and 1 GB devices', () => {
    expect(chooseTier(desktop({ software: true, renderer: 'SwiftShader' })).tier).toBe('lite');
    expect(chooseTier(desktop({ weakGpu: true, renderer: 'Mali-400' })).tier).toBe('lite');
    expect(chooseTier(desktop({ maxTexture: 1024 })).tier).toBe('lite');
    expect(chooseTier(desktop({ memoryGB: 1 })).tier).toBe('lite');
  });
  it('low without half-float targets, with 2 GB on desktop, or with 4 GB / 4 cores on a phone', () => {
    expect(chooseTier(desktop({ halfFloatRT: false, floatRT: false })).tier).toBe('low');
    expect(chooseTier(desktop({ memoryGB: 2 })).tier).toBe('low');
    expect(chooseTier(desktop({ coarse: true, android: true, cores: 4, memoryGB: 4, midGpu: false })).tier).toBe('low');
    expect(chooseTier(desktop({ maxTexture: 2048 })).tier).toBe('low');
  });
  it('medium for laptops under 8 cores, MSAA-limited GPUs and data saver; never high on a phone', () => {
    expect(chooseTier(desktop({ cores: 4, memoryGB: 8 })).tier).toBe('medium');
    expect(chooseTier(desktop({ maxSamples: 2 })).tier).toBe('medium');
    expect(chooseTier(desktop({ maxSamples: 0 })).tier).toBe('medium');
    expect(chooseTier(desktop({ saveData: true })).tier).toBe('medium');
    expect(chooseTier(desktop({ coarse: true, cores: 8, memoryGB: 8, midGpu: true })).tier).not.toBe('high');
  });
  it('a low battery steps one tier down; unknown hints (Safari / Firefox) do not block high', () => {
    expect(chooseTier(desktop({ battery: { level: 0.1, charging: false } })).tier).toBe('medium');
    expect(chooseTier(desktop({ battery: { level: 0.1, charging: true } })).tier).toBe('high');
    expect(chooseTier(desktop({ memoryGB: 0, cores: 10 })).tier).toBe('high');
  });
  it('is monotone: a worse device never gets a better tier', () => {
    const rank = (t) => ['lite', 'low', 'medium', 'high'].indexOf(t);
    const base = desktop();
    for (const worse of [{ cores: 2 }, { memoryGB: 2 }, { software: true }, { maxTexture: 2048 }, { halfFloatRT: false, floatRT: false }, { coarse: true }]) {
      expect(rank(chooseTier({ ...base, ...worse }).tier), JSON.stringify(worse)).toBeLessThanOrEqual(rank(chooseTier(base).tier));
    }
  });
});

// The Auto policy as a table: real device shapes -> the tier a player gets before touching Graphics.
// (phones / tablets / Safari start low, a clearly flagship Android phone may start at medium, high needs a discrete GPU + 8 cores + 8 GB + 4x MSAA.)
const dev = ({ renderer = 'ANGLE (NVIDIA GeForce RTX 3060)', samples = 8, ...o } = {}) => ({
  ...probeGl(fakeGl({ exts: FULL, renderer, samples })), cores: 8, memoryGB: 8, dpr: 1, coarse: false, saveData: false, ...o,
});
const PHONE = { coarse: true, android: true };
const POLICY = [
  // name, caps, expected tier
  ['iPhone 15 Pro, Safari (GPU masked, no memory hint)', dev({ renderer: 'Apple GPU', coarse: true, ios: true, safari: true, cores: 6, memoryGB: 0 }), 'low'],
  ['iPhone 15 Pro, Chrome on iOS (still WebKit)', dev({ renderer: 'Apple GPU', coarse: true, ios: true, cores: 6, memoryGB: 0 }), 'low'],
  ['iPad Pro M2 (iPadOS reports as a Mac)', dev({ renderer: 'Apple GPU', coarse: true, ios: true, safari: true, cores: 8, memoryGB: 0 }), 'low'],
  ['iPad Air, 8 cores', dev({ renderer: 'Apple GPU', coarse: true, ios: true, cores: 8, memoryGB: 8 }), 'low'],
  ['Galaxy S24 Ultra (Adreno 750, 8 cores, 8 GB)', dev({ ...PHONE, renderer: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)', cores: 8, memoryGB: 8 }), 'medium'],
  ['Pixel 9 Pro (Mali-G715, 8 cores, 8 GB)', dev({ ...PHONE, renderer: 'ANGLE (ARM, Mali-G715, OpenGL ES 3.2)', cores: 8, memoryGB: 8 }), 'medium'],
  ['flagship GPU but only 6 GB', dev({ ...PHONE, renderer: 'Adreno (TM) 740', cores: 8, memoryGB: 6 }), 'low'],
  ['flagship GPU but 6 cores', dev({ ...PHONE, renderer: 'Adreno (TM) 740', cores: 6, memoryGB: 8 }), 'low'],
  ['2020 flagship (Adreno 650, 8 cores, 8 GB)', dev({ ...PHONE, renderer: 'Adreno (TM) 650', cores: 8, memoryGB: 8 }), 'low'],
  ['mid phone (Mali-G78, 8 cores, 8 GB)', dev({ ...PHONE, renderer: 'Mali-G78', cores: 8, memoryGB: 8 }), 'low'],
  ['mid phone (Adreno 619, 6 GB)', dev({ ...PHONE, renderer: 'Adreno (TM) 619', cores: 8, memoryGB: 6 }), 'low'],
  ['old phone (Mali-T720, 2 GB)', dev({ ...PHONE, renderer: 'Mali-T720', cores: 4, memoryGB: 2 }), 'lite'],
  ['touch laptop reporting a coarse pointer, discrete GPU', dev({ coarse: true, cores: 16, memoryGB: 8 }), 'low'],
  ['gaming desktop (RTX 4070, 16 threads, 8 GB, MSAA 8)', dev({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)', cores: 16 }), 'high'],
  ['Radeon RX 6700 XT desktop', dev({ renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11)', cores: 12 }), 'high'],
  ['MacBook Pro M2, Chrome (Apple Silicon)', dev({ renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', cores: 10 }), 'high'],
  ['Firefox on a discrete 12-thread machine (memory not reported)', dev({ cores: 12, memoryGB: 0 }), 'high'],
  ['gaming laptop, discrete GPU but 6 cores', dev({ cores: 6 }), 'medium'],
  ['discrete GPU, 8 cores, 4 GB', dev({ memoryGB: 4 }), 'medium'],
  ['discrete GPU but MSAA limited to 2x', dev({ samples: 2 }), 'medium'],
  ['office laptop (Intel UHD 620, 8 threads, 8 GB)', dev({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)', cores: 8 }), 'medium'],
  ['thin laptop (Iris Xe, 12 threads, 16 GB)', dev({ renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', cores: 12 }), 'medium'],
  ['Ryzen APU (AMD Radeon(TM) Graphics, 16 threads)', dev({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)', cores: 16 }), 'medium'],
  ['Ryzen 2400G (Radeon RX Vega 11 Graphics)', dev({ renderer: 'ANGLE (AMD, Radeon RX Vega 11 Graphics Direct3D11)', cores: 8 }), 'medium'],
  ['renderer string hidden', dev({ renderer: '', cores: 16 }), 'medium'],
  ['Safari on a Mac (GPU masked)', dev({ renderer: 'Apple GPU', safari: true, cores: 10, memoryGB: 0 }), 'low'],
  ['2012 laptop (Intel HD 4000)', dev({ renderer: 'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11)', cores: 4, memoryGB: 4 }), 'lite'],
  ['2 cores, 8 GB', dev({ cores: 2, memoryGB: 8 }), 'low'],
  ['2 GB desktop', dev({ memoryGB: 2 }), 'low'],
  ['SwiftShader (headless, CI, VM)', dev({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', cores: 16 }), 'lite'],
  ['llvmpipe', dev({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)', cores: 16 }), 'lite'],
  ['tiny max texture (1024)', dev({ maxTexture: 1024 }), 'lite'],
  ['no half-float render targets', dev({ halfFloatRT: false, floatRT: false }), 'low'],
];

describe('the Auto tier policy', () => {
  for (const [name, caps, want] of POLICY) {
    it(`${name} -> ${want}`, () => {
      const r = chooseTier(caps);
      expect(r.tier, r.reasons.join(' / ')).toBe(want);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }
  it('never gives high to a touch device, whatever it reports', () => {
    for (const caps of [dev({ ...PHONE, renderer: 'Adreno (TM) 830', cores: 16, memoryGB: 8 }), dev({ coarse: true, ios: true, cores: 16, memoryGB: 8 }), dev({ coarse: true, cores: 32, memoryGB: 8 })]) {
      expect(chooseTier(caps).tier).not.toBe('high');
    }
  });
  it('says why: phones name what is missing, desktops name what keeps them off high, high names its hardware', () => {
    expect(chooseTier(POLICY[0][1]).reasons.join(' ')).toMatch(/iOS \/ Safari/);
    expect(chooseTier(dev({ ...PHONE, renderer: 'Adreno (TM) 619', cores: 8, memoryGB: 6 })).reasons.join(' ')).toMatch(/6 GB.*not a known flagship/);
    expect(chooseTier(dev({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)', cores: 8 })).reasons.join(' ')).toMatch(/integrated or unrecognised GPU/);
    expect(chooseTier(dev({ cores: 6 })).reasons.join(' ')).toMatch(/6 CPU cores/);
    expect(chooseTier(dev({ cores: 12 })).reasons.join(' ')).toMatch(/discrete GPU.*, 12 cores, 8 GB, MSAA 8x/);
  });
  it('an explicit Graphics choice still wins on every one of them (the player knows best)', () => {
    for (const [, caps] of POLICY) {
      expect(resolveTier('high', caps).tier).toBe('high');
      expect(resolveTier('lite', caps).tier).toBe('lite');
      expect(resolveTier('auto', caps).tier).toBe(chooseTier(caps).tier);
    }
  });
  it('recognises discrete and flagship GPU strings, and not their integrated cousins', () => {
    for (const r of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11)', 'NVIDIA GeForce GTX 1060 6GB', 'ANGLE (AMD, AMD Radeon RX 7900 XTX)', 'ANGLE (AMD, Radeon(TM) Pro W6600)', 'Intel(R) Arc(TM) A770 Graphics', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'Quadro RTX 4000']) expect(isDiscreteGpu(r), r).toBe(true);
    for (const r of ['', 'Apple GPU', 'Intel(R) UHD Graphics 620', 'Intel(R) Iris(R) Xe Graphics', 'Intel(R) Arc(TM) Graphics', 'AMD Radeon(TM) Graphics', 'AMD Radeon(TM) 780M Graphics', 'Radeon RX Vega 11 Graphics', 'NVIDIA GeForce MX150', 'SwiftShader', 'GeForce GT 710']) expect(isDiscreteGpu(r), r).toBe(false);
    for (const r of ['Adreno (TM) 740', 'Adreno (TM) 830', 'Mali-G710', 'Mali-G715', 'Mali-G925', 'Samsung Xclipse 940', 'Immortalis-G720']) expect(isFlagshipMobileGpu(r), r).toBe(true);
    for (const r of ['Adreno (TM) 650', 'Adreno (TM) 619', 'Mali-G78', 'Mali-G57', 'Apple GPU', 'PowerVR GE8320', '']) expect(isFlagshipMobileGpu(r), r).toBe(false);
  });
  it('probeGl records discreteGpu and flagshipGpu', () => {
    expect(probeGl(fakeGl({ exts: FULL })).discreteGpu).toBe(true);
    expect(probeGl(fakeGl({ exts: FULL, renderer: 'Intel(R) UHD Graphics 620' })).discreteGpu).toBe(false);
    expect(probeGl(fakeGl({ exts: FULL, renderer: 'Adreno (TM) 750' })).flagshipGpu).toBe(true);
  });
});

describe('resolveTier and the Graphics preference', () => {
  const mem = () => {
    const d = {};
    return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, d };
  };
  it('an explicit pref wins over the probe, auto follows it, no WebGL2 stays null', () => {
    expect(resolveTier('lite', desktop()).tier).toBe('lite');
    expect(resolveTier('high', desktop({ software: true })).tier).toBe('high');
    expect(resolveTier('auto', desktop({ software: true })).tier).toBe('lite');
    expect(resolveTier('auto', probeGl(null)).tier).toBeNull();
    expect(resolveTier('high', probeGl(null)).tier).toBeNull();
    expect(resolveTier('bogus', desktop()).pref).toBe('auto');
  });
  it('persists under jalebi.tiffin.gfx.v1 and falls back to auto on junk or a throwing store', () => {
    const s = mem();
    expect(GFX_KEY).toBe('jalebi.tiffin.gfx.v1');
    expect(getGfxPref(s)).toBe('auto');
    expect(setGfxPref('lite', s)).toBe('lite');
    expect(s.d[GFX_KEY]).toBe('lite');
    expect(getGfxPref(s)).toBe('lite');
    expect(setGfxPref('nope', s)).toBe('auto');
    expect(s.d[GFX_KEY]).toBeUndefined();
    s.setItem(GFX_KEY, 'ultra');
    expect(getGfxPref(s)).toBe('auto');
    expect(GFX_PREFS).toEqual(['auto', 'high', 'medium', 'low', 'lite']);
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    expect(() => setGfxPref('low', bad)).not.toThrow();
    expect(getGfxPref(bad)).toBe('low'); // the session copy survives
    setGfxPref('auto', mem());
  });
  it('describeCaps never throws', () => {
    expect(describeCaps(null)).toContain('gl0');
    expect(describeCaps(desktop(), { tier: 'high', reasons: ['x'] })).toContain('-> high');
  });
});
