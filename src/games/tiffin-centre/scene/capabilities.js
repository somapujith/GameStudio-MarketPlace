// Device capabilities and the automatic quality tier. Pure functions over injected environment objects (a WebGL context, `navigator`, `window`),
// so everything is unit-tested with fakes; the thin browser wrappers (`probeBrowser`, `autoTier`) are the only parts that touch globals.
//
//   probeGl(gl)              -> what the GL context can do (WebGL2 / WebGL1, texture size, anisotropy, float render targets, MSAA, renderer string, ...)
//   probeEnv(env)            -> cores, memory, DPR, coarse pointer, data-saver and reduced-data hints, battery, screen size
//   chooseTier(caps, opts)   -> { tier: 'lite'|'low'|'medium'|'high'|null, reasons: string[] }   (null = this device cannot run the scene at all)
//   getGfxPref / setGfxPref  -> the player's Graphics setting: auto | high | medium | low | lite, persisted in localStorage `jalebi.tiffin.gfx.v1`
//   resolveTier(pref, caps)  -> the tier the scene starts at (an explicit pref wins; the probe only decides on Auto)
//
// three.js 0.187 is WebGL2-only: a WebGL1-only browser is reported as unsupported (the 'webgl' StatusScreen), with the reason recorded here.

export const GFX_KEY = 'jalebi.tiffin.gfx.v1';
export const GFX_PREFS = ['auto', 'high', 'medium', 'low', 'lite'];
const ORDER = ['lite', 'low', 'medium', 'high'];

// ---------------------------------------------------------------------------------------------------------------------------------
// The Graphics preference (never throws: storage can be missing, full or blocked)
const memoryStore = { v: null };
function store(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked: fall through */ }
  return null;
}

export function getGfxPref(storage) {
  let raw = null;
  try {
    raw = store(storage)?.getItem(GFX_KEY) ?? null;
  } catch { /* ignore */ }
  if (raw == null) raw = memoryStore.v;
  return GFX_PREFS.includes(raw) ? raw : 'auto';
}

export function setGfxPref(value, storage) {
  const v = GFX_PREFS.includes(value) ? value : 'auto';
  memoryStore.v = v;
  try {
    const s = store(storage);
    if (s) {
      if (v === 'auto') s.removeItem(GFX_KEY);
      else s.setItem(GFX_KEY, v);
    }
  } catch { /* the in-memory copy still holds for this session */ }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GPU renderer strings
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|basic render driver|software rasteri|mesa offscreen|apple software renderer|cpu\b/i;
// weak = integrated GPUs of roughly 2012-2016 and the low end of mobile GPUs. They run the lite / low tiers.
const WEAK_GPU = [
  /mali-4\d\d/i, /mali-t[678]\d\d/i, /mali-g(31|51|52)\b/i, /adreno \(?tm\)? ?(2\d\d|3\d\d|40\d|50\d)\b/i, /adreno[^0-9]*(2\d\d|3\d\d|40\d|50\d)\b/i,
  /powervr (sgx|rogue ge8|gx6|g6)/i, /powervr ge8/i, /sgx ?5\d\d/i, /vivante/i, /videocore/i, /tegra [234]\b/i, /\bgma\b/i,
  /intel.*hd graphics (2000|2500|3000|4000|4400|4600|5000)\b/i, /intel.*hd graphics\s*$/i, /intel\(r\) hd graphics$/i, /intel.*graphics media/i, /intel.*(bay ?trail|ironlake|sandybridge|ivybridge|haswell)/i,
  /radeon (hd )?[2345]\d\d\d\b/i, /geforce (8|9)\d\d\d/i, /geforce gt ?[1-5]\d\d\b/i,
];
// middling: fine for medium
const MID_GPU = [/adreno[^0-9]*6[0-4]\d\b/i, /mali-g(5[7-9]|6\d|7\d)/i, /intel.*(uhd|iris|hd graphics 5\d\d|hd graphics 6\d\d)/i, /apple gpu/i, /radeon (rx )?vega ?[3-8]\b/i];

export const isSoftwareRenderer = (s) => !!s && SOFTWARE.test(String(s));
export const isWeakGpu = (s) => !!s && WEAK_GPU.some((r) => r.test(String(s)));
export const isMidGpu = (s) => !!s && MID_GPU.some((r) => r.test(String(s)));

// ---------------------------------------------------------------------------------------------------------------------------------
// GL probe. `gl` is a WebGL(2)RenderingContext (or a fake with the same getParameter / getExtension surface).
export function probeGl(gl) {
  const out = {
    webgl: 0, maxTexture: 0, maxAniso: 0, maxSamples: 0, maxVertexTex: 0, maxVaryings: 0, maxUniformVectors: 0,
    floatRT: false, halfFloatRT: false, floatLinear: false, derivatives: false, instancing: false, parallelCompile: false,
    renderer: '', vendor: '', software: false, weakGpu: false, midGpu: false, loseContext: false,
  };
  if (!gl || typeof gl.getParameter !== 'function') return out;
  const isGl2 = typeof WebGL2RenderingContext !== 'undefined' ? gl instanceof WebGL2RenderingContext : typeof gl.texStorage2D === 'function' && typeof gl.drawArraysInstanced === 'function';
  out.webgl = isGl2 ? 2 : 1;
  const ext = (n) => {
    try {
      return gl.getExtension(n) || null;
    } catch {
      return null;
    }
  };
  const param = (p, fallback = 0) => {
    try {
      const v = gl.getParameter(p);
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    } catch {
      return fallback;
    }
  };
  out.maxTexture = param(gl.MAX_TEXTURE_SIZE);
  out.maxVertexTex = param(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
  out.maxVaryings = param(gl.MAX_VARYING_VECTORS);
  out.maxUniformVectors = param(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
  if (isGl2) out.maxSamples = param(gl.MAX_SAMPLES);
  const an = ext('EXT_texture_filter_anisotropic') || ext('WEBKIT_EXT_texture_filter_anisotropic') || ext('MOZ_EXT_texture_filter_anisotropic');
  if (an) out.maxAniso = param(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  // render targets: WebGL2 renders to float / half float only with these extensions; WebGL1 has its own
  if (isGl2) {
    out.floatRT = !!ext('EXT_color_buffer_float');
    out.halfFloatRT = out.floatRT || !!ext('EXT_color_buffer_half_float');
    out.derivatives = true;
    out.instancing = true;
  } else {
    out.floatRT = !!ext('WEBGL_color_buffer_float');
    out.halfFloatRT = out.floatRT || !!ext('EXT_color_buffer_half_float');
    out.derivatives = !!ext('OES_standard_derivatives');
    out.instancing = !!ext('ANGLE_instanced_arrays');
  }
  out.floatLinear = !!ext('OES_texture_float_linear');
  out.parallelCompile = !!ext('KHR_parallel_shader_compile');
  out.loseContext = !!ext('WEBGL_lose_context');
  const dbg = ext('WEBGL_debug_renderer_info');
  if (dbg) {
    try {
      out.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      out.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
    } catch { /* ignore */ }
  }
  if (!out.renderer) {
    try {
      out.renderer = String(gl.getParameter(gl.RENDERER) || '');
      out.vendor = out.vendor || String(gl.getParameter(gl.VENDOR) || '');
    } catch { /* ignore */ }
  }
  const s = `${out.renderer} ${out.vendor}`;
  out.software = isSoftwareRenderer(s);
  out.weakGpu = !out.software && isWeakGpu(out.renderer);
  out.midGpu = !out.software && !out.weakGpu && isMidGpu(out.renderer);
  return out;
}

/** Creates a throw-away canvas, asks for WebGL2 (then WebGL1, only to explain a failure), probes it and releases the context. */
export function probeCanvasGl(doc = typeof document !== 'undefined' ? document : null) {
  const none = probeGl(null);
  if (!doc?.createElement) return none;
  let canvas;
  try {
    canvas = doc.createElement('canvas');
  } catch {
    return none;
  }
  const attrs = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false };
  for (const kind of ['webgl2', 'webgl', 'experimental-webgl']) {
    let gl = null;
    try {
      gl = canvas.getContext(kind, attrs);
    } catch { /* try the next */ }
    if (!gl) continue;
    const caps = probeGl(gl);
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* ignore */ }
    return caps;
  }
  return none;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Environment probe (navigator / window)
export function probeEnv({ nav, win, mm } = {}) {
  nav = nav ?? (typeof navigator !== 'undefined' ? navigator : {});
  win = win ?? (typeof window !== 'undefined' ? window : {});
  const media = mm ?? (typeof win.matchMedia === 'function' ? (q) => {
    try {
      return !!win.matchMedia(q)?.matches;
    } catch {
      return false;
    }
  } : () => false);
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;
  const ua = String(nav.userAgent || '');
  const scr = win.screen || {};
  const dpr = Number(win.devicePixelRatio) || 1;
  return {
    cores: Number(nav.hardwareConcurrency) || 0, // 0 = unknown
    memoryGB: Number(nav.deviceMemory) || 0, // Chromium only (capped at 8); 0 = unknown
    dpr,
    coarse: media('(pointer: coarse)') || (Number(nav.maxTouchPoints) > 1 && media('(hover: none)')),
    saveData: !!conn?.saveData || media('(prefers-reduced-data: reduce)'),
    slowNet: /(^|-)2g$/.test(String(conn?.effectiveType || '')),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    ios: /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1),
    android: /Android/i.test(ua),
    firefox: /Firefox\//.test(ua),
    safari: /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android/.test(ua),
    screenPx: Math.round((Number(scr.width) || Number(win.innerWidth) || 0) * dpr) * Math.round((Number(scr.height) || Number(win.innerHeight) || 0) * dpr),
    battery: null, // filled by probeBattery() when the API exists
  };
}

/** Resolves to { level, charging } or null. Battery Status is Chromium-only and optional. */
export async function probeBattery(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  try {
    if (typeof nav.getBattery !== 'function') return null;
    const b = await Promise.race([nav.getBattery(), new Promise((r) => setTimeout(() => r(null), 800))]);
    if (!b) return null;
    return { level: Number(b.level), charging: !!b.charging };
  } catch {
    return null;
  }
}

/** The full probe in a real browser; cached for the page's life (the GL probe makes and releases a context). */
let cached = null;
export function probeBrowser({ force = false } = {}) {
  if (cached && !force) return cached;
  let gl;
  try {
    gl = probeCanvasGl();
  } catch {
    gl = probeGl(null);
  }
  let env;
  try {
    env = probeEnv();
  } catch {
    env = probeEnv({ nav: {}, win: {} });
  }
  cached = { ...gl, ...env };
  return cached;
}
export const forgetProbe = () => {
  cached = null;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The automatic tier
/**
 * chooseTier(caps) -> { tier, reasons }. Starts from the best the hardware allows and only ever steps DOWN, recording why.
 * `tier: null` means the scene cannot run (no WebGL2).
 */
export function chooseTier(caps, { tiers = ORDER } = {}) {
  const reasons = [];
  if (!caps || !caps.webgl) return { tier: null, reasons: ['no WebGL: this browser or device cannot create a WebGL context'] };
  if (caps.webgl < 2) return { tier: null, reasons: ['WebGL 1 only: the 3D stall needs WebGL 2 (three.js dropped WebGL 1)'] };
  let level = tiers.indexOf('high');
  const cap = (to, why) => {
    const i = tiers.indexOf(to);
    if (i < level) {
      level = i;
      reasons.push(`${to}: ${why}`);
    }
  };
  const mobile = !!(caps.coarse || caps.ios || caps.android);
  const cores = caps.cores || 0;
  const mem = caps.memoryGB || 0;

  if (caps.software) cap('lite', `software renderer (${caps.renderer || 'unknown'})`);
  if (caps.weakGpu) cap('lite', `weak GPU (${caps.renderer})`);
  if (caps.maxTexture && caps.maxTexture < 2048) cap('lite', `max texture size ${caps.maxTexture} px`);
  else if (caps.maxTexture && caps.maxTexture < 4096) cap('low', `max texture size ${caps.maxTexture} px`);
  if (!caps.halfFloatRT) cap('low', 'no half-float render targets (HDR post pipeline unavailable)');
  if (mem && mem <= 1) cap('lite', `${mem} GB device memory`);
  else if (mem && mem <= 2) cap(mobile ? 'lite' : 'low', `${mem} GB device memory`);
  else if (mem && mem <= 4) cap(mobile ? 'low' : 'medium', `${mem} GB device memory`);
  if (cores && cores <= 2) cap(mobile || mem <= 2 ? 'lite' : 'low', `${cores} CPU cores`);
  else if (cores && cores <= 4 && mobile) cap('low', `${cores} CPU cores on a phone`);
  if (mobile) cap(caps.midGpu || caps.ios ? 'medium' : 'low', caps.midGpu || caps.ios ? 'phone / tablet: no high tier' : 'phone / tablet with an unrecognised GPU');
  if (cores && cores < 8 && mem && mem < 8) cap('medium', 'fewer than 8 cores and under 8 GB');
  else if (cores && cores < 8) cap('medium', `${cores} CPU cores`);
  if (caps.maxSamples && caps.maxSamples < 4) cap('medium', `MSAA limited to ${caps.maxSamples}x`);
  if (!caps.floatLinear && !caps.floatRT) cap('medium', 'no float render targets');
  if (caps.saveData) cap('medium', 'data saver / reduced data requested');
  if (caps.battery && caps.battery.level <= 0.2 && !caps.battery.charging) cap(tiers[Math.max(0, level - 1)], `battery ${Math.round(caps.battery.level * 100)}% and not charging`);
  if (!reasons.length) reasons.push('desktop-class GPU, 8+ cores: full pipeline');
  return { tier: tiers[level], reasons };
}

/**
 * The tier the scene starts at. `pref` is the player's setting (auto | high | medium | low | lite). An explicit tier wins over the probe
 * (the player knows best), except that no tier exists on a device without WebGL2.
 */
export function resolveTier(pref, caps) {
  const auto = chooseTier(caps);
  if (!auto.tier) return { ...auto, pref, auto: null };
  if (ORDER.includes(pref)) return { tier: pref, reasons: [`Graphics set to ${pref}`], pref, auto: auto.tier };
  return { ...auto, pref: 'auto', auto: auto.tier };
}

/** The auto tier for this browser (probes once). Never throws: any failure answers 'low'. */
export function autoTier() {
  try {
    return chooseTier(probeBrowser());
  } catch {
    return { tier: 'low', reasons: ['capability probe failed'] };
  }
}

/** A one-line summary for the console / bug reports. */
export function describeCaps(caps, verdict) {
  const c = caps || {};
  return `gl${c.webgl || 0} tex${c.maxTexture || 0} aniso${c.maxAniso || 0} msaa${c.maxSamples || 0} halfRT:${c.halfFloatRT ? 1 : 0} cores:${c.cores || '?'} mem:${c.memoryGB || '?'} dpr:${c.dpr || 1} coarse:${c.coarse ? 1 : 0} gpu:"${c.renderer || '?'}"${verdict ? ` -> ${verdict.tier} (${verdict.reasons.join('; ')})` : ''}`;
}
