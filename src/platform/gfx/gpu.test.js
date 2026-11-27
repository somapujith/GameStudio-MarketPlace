import { describe, expect, it } from 'vitest';
import { classifyGpu, classifyRenderer, cleanRenderer, describeGpu, gpuKey, minTier, readEnv, readGlCaps, readGpuStrings, tierCapFor, withRefresh } from './gpu.js';

// [raw string as WebGL reports it, class, vendor, a substring of the model, generic tier cap on a plain desktop]
const CASES = [
  // ---- the dev laptop and its kin: AMD integrated ----
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'AMD', 'Radeon Graphics', 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'AMD', 'Vega 8 Graphics', 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) RX Vega 11 Graphics (0x000015DD) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'AMD', 'Vega 11 Graphics', 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 3 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'AMD', 'Vega 3', 'low'],
  ['ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'AMD', '780M', 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) 610M (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'AMD', '610M', 'medium'],
  ['AMD Radeon(TM) R7 Graphics', 'integrated', 'AMD', 'R7 Graphics', 'low'],
  // ---- Intel integrated ----
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'Intel', 'UHD Graphics 620', 'low'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004688) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'Intel', 'UHD Graphics 770', 'low'],
  ['ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'Intel', 'UHD Graphics', 'low'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'Intel', 'Iris Xe', 'medium'],
  ['Intel(R) Iris(TM) Plus Graphics 640', 'integrated', 'Intel', 'Iris Plus Graphics 640', 'medium'],
  ['Intel Iris OpenGL Engine', 'integrated', 'Intel', 'Iris', 'low'],
  ['Intel(R) HD Graphics 4000', 'integrated', 'Intel', 'HD Graphics 4000', 'low'],
  ['Intel(R) HD Graphics 530', 'integrated', 'Intel', 'HD Graphics 530', 'low'],
  ['Intel(R) HD Graphics', 'integrated', 'Intel', 'HD Graphics', 'lite'],
  ['Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'integrated', 'Intel', 'UHD Graphics 620', 'low'],
  ['Mesa Intel(R) Xe Graphics (TGL GT2)', 'integrated', 'Intel', 'Xe', 'medium'],
  ['ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'Intel', 'Arc Graphics', 'medium'],
  ['Intel(R) Graphics Media Accelerator 3150', 'integrated', 'Intel', 'Graphics Media', 'lite'],
  // ---- NVIDIA discrete ----
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4601)', 'discrete', 'NVIDIA', 'RTX 3060', 'high'],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'NVIDIA', 'GTX 1650', 'medium'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'NVIDIA', 'RTX 4090', 'high'],
  ['NVIDIA GeForce RTX 4090/PCIe/SSE2', 'discrete', 'NVIDIA', 'RTX 4090', 'high'],
  ['NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2', 'discrete', 'NVIDIA', 'GTX 1050 Ti', 'medium'],
  ['ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)', 'discrete', 'NVIDIA', 'GTX 1060', 'medium'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER (0x00001E84) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'NVIDIA', 'RTX 2070 Super', 'high'],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 970 Direct3D11 vs_5_0 ps_5_0)', 'discrete', 'NVIDIA', 'GTX 970', 'medium'],
  ['ANGLE (NVIDIA, NVIDIA GeForce MX150 (0x00001D12) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'NVIDIA', 'MX150', 'medium'],
  ['NVIDIA GeForce GT 710', 'discrete', 'NVIDIA', 'GT 710', 'low'],
  ['Quadro P620/PCIe/SSE2', 'discrete', 'NVIDIA', 'Quadro P620', 'medium'],
  ['NVIDIA Quadro T1000 with Max-Q Design', 'discrete', 'NVIDIA', 'Quadro T1000', 'medium'],
  ['ANGLE (NVIDIA, NVIDIA RTX A4000 (0x000024B0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'NVIDIA', 'A4000', 'high'],
  ['ANGLE (NVIDIA, NVIDIA GeForce 940MX (0x00001D10) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'NVIDIA', '940MX', 'medium'],
  // ---- AMD / Intel discrete ----
  ['ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'AMD', 'RX 6800 XT', 'high'],
  ['ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'AMD', 'RX 7900 XTX', 'high'],
  ['ANGLE (AMD, AMD Radeon RX 6600M (0x000073E0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'AMD', 'RX 6600 M', 'medium'],
  ['AMD Radeon RX 580 Series (polaris10, LLVM 15.0.7, DRM 3.49, 6.1.0-18-amd64)', 'discrete', 'AMD', 'RX 580', 'medium'],
  ['AMD Radeon Pro 5500M OpenGL Engine', 'discrete', 'AMD', 'Radeon Pro 5500M', 'medium'],
  ['AMD Radeon Pro Vega 20 OpenGL Engine', 'discrete', 'AMD', 'Vega 20', 'medium'],
  ['ATI Radeon HD 4850 OpenGL Engine', 'discrete', 'AMD', 'Radeon HD 4850', 'medium'],
  ['ANGLE (AMD, AMD Radeon RX Vega 56 (0x000067FF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'AMD', 'Vega 56', 'high'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'Intel', 'Arc A770', 'high'],
  // ---- Apple ----
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'integrated', 'Apple', 'M1', 'medium'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'integrated', 'Apple', 'M2 Pro', 'medium'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', 'integrated', 'Apple', 'M3 Max', 'high'],
  ['Apple A15 GPU', 'mobile', 'Apple', 'A15', 'low'],
  // ---- mobile ----
  ['ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', 'mobile', 'Qualcomm', 'Adreno 740', 'medium'],
  ['Adreno (TM) 650', 'mobile', 'Qualcomm', 'Adreno 650', 'low'],
  ['Adreno (TM) 506', 'mobile', 'Qualcomm', 'Adreno 506', 'low'],
  ['ANGLE (Qualcomm, Vulkan 1.3.128 (Adreno (TM) 730 (0x43050A01)), Qualcomm)', 'mobile', 'Qualcomm', 'Adreno 730', 'medium'],
  ['Mali-G78', 'mobile', 'ARM', 'Mali-G78', 'medium'],
  ['Mali-G52 MC2', 'mobile', 'ARM', 'Mali-G52', 'low'],
  ['Mali-T830', 'mobile', 'ARM', 'Mali-T830', 'low'],
  ['Mali-400 MP', 'mobile', 'ARM', 'Mali-400', 'lite'],
  ['Immortalis-G715', 'mobile', 'ARM', 'G715', 'medium'],
  ['PowerVR Rogue GE8320', 'mobile', 'Imagination', 'PowerVR', 'lite'],
  ['Samsung Xclipse 920', 'mobile', 'Samsung', 'Xclipse 920', 'medium'],
  ['Qualcomm(R) Adreno(TM) X1-85 GPU', 'integrated', 'Qualcomm', 'Adreno X1', 'medium'],
  // ---- software and virtual ----
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software', 'Google', 'SwiftShader', 'lite'],
  ['Google SwiftShader', 'software', 'Google', 'SwiftShader', 'lite'],
  ['llvmpipe (LLVM 12.0.0, 256 bits)', 'software', 'Mesa', 'llvmpipe', 'lite'],
  ['Microsoft Basic Render Driver', 'software', 'Microsoft', 'Basic Render Driver', 'lite'],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software', 'Microsoft', 'Basic Render Driver', 'lite'],
  ['SVGA3D; build: RELEASE; LLVM;', 'software', 'Virtual', '', 'lite'],
  ['VirtualBox Graphics Adapter', 'software', 'Virtual', '', 'lite'],
  ['Apple Software Renderer', 'software', 'Software', '', 'lite'],
  // ---- unknown / masked ----
  ['WebKit WebGL', 'unknown', '', '', 'medium'],
  ['Mozilla', 'unknown', '', '', 'medium'],
  ['', 'unknown', '', '', 'medium'],
];

describe('classifyRenderer: a table of real renderer strings', () => {
  it('has at least 40 strings', () => expect(CASES.length).toBeGreaterThanOrEqual(40));
  for (const [raw, cls, vendor, model] of CASES) {
    it(`${raw || '(empty)'} -> ${cls}`, () => {
      const g = classifyRenderer(raw);
      expect(g.class).toBe(cls);
      if (vendor) expect(g.vendor).toBe(vendor);
      if (model) expect(g.model.toLowerCase().replace(/\s+/g, '')).toContain(model.toLowerCase().replace(/\s+/g, ''));
    });
  }
});

describe('classifyGpu: generic tier cap on a plain desktop', () => {
  const desktop = { nav: { hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 }, win: { devicePixelRatio: 1.25 }, mm: () => false };
  for (const [raw, cls, , , cap] of CASES) {
    it(`${raw || '(empty)'} starts at most on ${cap}`, () => {
      const g = classifyGpu({ renderer: raw, ...desktop });
      expect(g.class).toBe(cls === 'mobile' ? 'mobile' : cls);
      expect(g.tierCap).toBe(cap);
    });
  }
  it('an integrated GPU never starts on high, whatever its marketing', () => {
    for (const [raw, cls] of CASES) {
      const g = classifyGpu({ renderer: raw, ...desktop });
      if (cls === 'integrated' && g.family !== 'apple-silicon') expect(g.tierCap).not.toBe('high');
    }
  });
  it('only a discrete GPU or large Apple Silicon reaches high', () => {
    for (const [raw] of CASES) {
      const g = classifyGpu({ renderer: raw, ...desktop });
      if (g.tierCap === 'high') expect(g.class === 'discrete' || g.family === 'apple-silicon').toBe(true);
    }
  });
  it('mobile never reaches high', () => {
    for (const [raw, cls] of CASES) if (cls === 'mobile') expect(classifyGpu({ renderer: raw, ...desktop }).tierCap).not.toBe('high');
  });
});

describe('classifyGpu: record shape and environment', () => {
  const env = { nav: { hardwareConcurrency: 16, deviceMemory: 8, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 }, win: { devicePixelRatio: 1.25 }, mm: () => false };
  it('fills class, vendor, model, dpr, cores, memoryGB and a null refreshHz', () => {
    const g = classifyGpu({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', ...env });
    expect(g).toMatchObject({ class: 'integrated', vendor: 'AMD', model: 'Radeon Graphics', dpr: 1.25, cores: 16, memoryGB: 8, refreshHz: null, tierCap: 'medium', mobile: false });
    expect(g.key).toBe('amd|radeon graphics');
    expect(withRefresh(g, 144).refreshHz).toBe(144);
    expect(withRefresh(g, 0).refreshHz).toBeNull();
    expect(describeGpu(withRefresh(g, 144))).toContain('144Hz');
  });
  it('a masked string on a phone is assumed to be a phone GPU', () => {
    const g = classifyGpu({ renderer: 'WebKit WebGL', nav: { hardwareConcurrency: 6, deviceMemory: 4, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 }, win: { devicePixelRatio: 3 }, mm: () => true });
    expect(g.class).toBe('mobile');
    expect(g.masked).toBe(true);
    expect(g.tierCap).toBe('low');
  });
  it('Safari on iPhone ("Apple GPU") starts low, on a Mac it is an integrated medium', () => {
    const phone = classifyGpu({ renderer: 'Apple GPU', nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5, hardwareConcurrency: 6 }, win: { devicePixelRatio: 3 }, mm: () => true });
    expect(phone).toMatchObject({ class: 'mobile', tierCap: 'low', masked: true });
    const mac = classifyGpu({ renderer: 'Apple GPU', ...env });
    expect(mac).toMatchObject({ class: 'integrated', tierCap: 'medium', masked: true });
  });
  it('an RTX with a 2 GB / 2-core device profile is capped by the hardware limits', () => {
    const g = classifyGpu({ renderer: 'NVIDIA GeForce RTX 4090/PCIe/SSE2', nav: { hardwareConcurrency: 2, deviceMemory: 2, userAgent: 'x' }, win: {}, mm: () => false });
    expect(g.tierCap).toBe('low');
    expect(g.reasons.join(' ')).toMatch(/GB device memory/);
  });
  it('caps lower the tier: no half-float targets -> low; tiny textures -> lite', () => {
    expect(classifyGpu({ renderer: 'NVIDIA GeForce RTX 4090/PCIe/SSE2', caps: { halfFloatRT: false, maxTexture: 8192 }, ...env }).tierCap).toBe('low');
    expect(classifyGpu({ renderer: 'NVIDIA GeForce RTX 4090/PCIe/SSE2', caps: { maxTexture: 1024 }, ...env }).tierCap).toBe('lite');
    expect(classifyGpu({ renderer: 'NVIDIA GeForce RTX 4090/PCIe/SSE2', caps: { maxTexture: 2048 }, ...env }).tierCap).toBe('low');
  });
  it('never throws on garbage', () => {
    for (const v of [undefined, null, 0, {}, [], 'ANGLE (', 'ANGLE ()', 'ANGLE (,,)']) expect(() => classifyGpu({ renderer: v })).not.toThrow();
    expect(() => classifyGpu()).not.toThrow();
  });
});

describe('cleanRenderer', () => {
  it('strips the ANGLE wrapper, device id and backend', () => {
    expect(cleanRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4601)')).toMatchObject({ renderer: 'NVIDIA GeForce RTX 3060 Laptop GPU', vendor: 'NVIDIA' });
  });
  it('handles the old single-field ANGLE form', () => {
    expect(cleanRenderer('ANGLE (NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0)').renderer).toBe('NVIDIA GeForce GTX 1050 Ti');
  });
  it('keeps a plain string, dropping (R)/(TM) and Mesa driver details', () => {
    expect(cleanRenderer('Mesa Intel(R) UHD Graphics 620 (KBL GT2)').renderer).toBe('Intel UHD Graphics 620 (KBL GT2)');
    expect(cleanRenderer('AMD Radeon RX 580 Series (polaris10, LLVM 15.0.7, DRM 3.49, 6.1.0-18-amd64)').renderer).toBe('AMD Radeon RX 580 Series');
  });
});

describe('tierCapFor / minTier / gpuKey', () => {
  it('software is lite; unknown desktop is medium; unknown phone is low', () => {
    expect(tierCapFor({ cls: 'software' }).tier).toBe('lite');
    expect(tierCapFor({ cls: 'unknown', tflops: null }).tier).toBe('medium');
    expect(tierCapFor({ cls: 'unknown', tflops: null, mobileHint: true }).tier).toBe('low');
  });
  it('minTier picks the lower', () => {
    expect(minTier('high', 'low')).toBe('low');
    expect(minTier('lite', 'medium')).toBe('lite');
  });
  it('gpuKey is lower-case, id-free and bounded', () => {
    expect(gpuKey({ vendor: 'NVIDIA', model: 'GeForce RTX 3060 Laptop GPU' })).toBe('nvidia|geforce rtx 3060 laptop gpu');
    expect(gpuKey({ vendor: 'x'.repeat(500), model: '' }).length).toBeLessThanOrEqual(96);
    expect(gpuKey({})).toBe('unknown');
  });
});

describe('GL readers', () => {
  const fakeGl = (renderer, { unmasked = true } = {}) => ({
    RENDERER: 1, VENDOR: 2, MAX_TEXTURE_SIZE: 3, MAX_SAMPLES: 4, MAX_TEXTURE_IMAGE_UNITS: 5,
    getParameter(p) {
      if (p === 'UNMASKED_R') return renderer;
      if (p === 'UNMASKED_V') return 'Google Inc. (AMD)';
      if (p === 1) return 'WebKit WebGL';
      if (p === 2) return 'WebKit';
      if (p === 3) return 16384;
      if (p === 4) return 4;
      if (p === 5) return 16;
      return null;
    },
    getExtension(n) {
      if (n === 'WEBGL_debug_renderer_info') return unmasked ? { UNMASKED_RENDERER_WEBGL: 'UNMASKED_R', UNMASKED_VENDOR_WEBGL: 'UNMASKED_V' } : null;
      if (n === 'EXT_color_buffer_half_float') return {};
      if (n === 'KHR_parallel_shader_compile') return {};
      return null;
    },
  });
  it('reads the unmasked strings, falls back to the masked ones', () => {
    expect(readGpuStrings(fakeGl('ANGLE (AMD, AMD Radeon(TM) Graphics, D3D11)'))).toMatchObject({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics, D3D11)', masked: false });
    expect(readGpuStrings(fakeGl('x', { unmasked: false }))).toMatchObject({ renderer: 'WebKit WebGL', masked: true });
    expect(readGpuStrings(null)).toMatchObject({ renderer: '', masked: true });
  });
  it('readGlCaps reads limits and extension flags', () => {
    const caps = readGlCaps(fakeGl('x'));
    expect(caps).toMatchObject({ maxTexture: 16384, halfFloatRT: true, parallelCompile: true, timerQuery: false });
    expect(readGlCaps(null).maxTexture).toBe(0);
  });
  it('classifyGpu takes a context directly', () => {
    const g = classifyGpu({ gl: fakeGl('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)'), nav: { hardwareConcurrency: 8, userAgent: 'x' }, win: {}, mm: () => false });
    expect(g.class).toBe('integrated');
    expect(g.caps.maxTexture).toBe(16384);
    expect(g.masked).toBe(false);
  });
});

describe('readEnv', () => {
  it('detects phones, tablets and desktops', () => {
    expect(readEnv({ nav: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 8 }, win: { devicePixelRatio: 2.6 }, mm: () => true })).toMatchObject({ android: true, mobile: true, dpr: 2.6, cores: 8 });
    expect(readEnv({ nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, win: {}, mm: () => false }).ios).toBe(true); // iPadOS posing as a Mac
    expect(readEnv({ nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 }, win: {}, mm: () => false })).toMatchObject({ mobile: false, ios: false, android: false });
  });
});
