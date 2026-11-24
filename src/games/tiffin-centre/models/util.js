// Tiffin Centre models: shared helpers. Everything here is node-safe (no `document` at module load, no WebGL).
//
// Ownership rule (read this before touching dispose code):
//  * "shared" resources live in module caches (geometry, material, texture) and carry `userData.shared = true`.
//    `disposeObject()` never frees them; `disposeModelCache()` (also `materials.dispose()`) frees them all when the scene dies.
//  * everything else (per-instance geometry, material, texture) is OWNED by the factory result and freed by its `dispose()`.
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  LatheGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  AdditiveBlending,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The plan's palette (section 2) plus the few extra materials the models need.
export const palette = {
  saffron: '#ff8a1f',
  turmeric: '#ffc83d',
  chilli: '#e0392b',
  curryLeaf: '#2f9e5b',
  teal: '#12908e',
  cream: '#fff4dc',
  charcoal: '#241a14',
  steel: '#c9d1d6',
  night: '#141a33',
  // extras
  brass: '#c8962f',
  iron: '#1f1c1b',
  tealDark: '#0c6a69',
  banana: '#3f9a4a',
  paper: '#efe3c2',
  white: '#fbf6e8',
  flame: '#ff7a1a',
};

// ---------------------------------------------------------------------------------------------------------------------
// Seeded randomness (deterministic per customer).
export function hashSeed(seed) {
  const s = String(seed ?? 0);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export function rng(seed) {
  let a = hashSeed(seed) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  next.range = (a2, b2) => a2 + (b2 - a2) * next();
  next.chance = (p) => next() < p;
  return next;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, k) => a + (b - a) * k;
export const damp = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

// ---------------------------------------------------------------------------------------------------------------------
// Canvas textures (browser) with a 1x1 stub in node, so factories stay constructible in tests.
export function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  } catch {
    return null;
  }
}

/** draw(ctx, w, h). Returns a Texture whose `userData.redraw()` draws again (used when a font finishes loading). */
export function makeCanvasTexture(w, h, draw, { srgb = true, anisotropy = 4 } = {}) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) {
    const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    t.userData.stub = true;
    t.userData.redraw = () => {};
    return t;
  }
  const tex = new CanvasTexture(canvas);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.userData.redraw = () => {
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
    tex.needsUpdate = true;
  };
  tex.userData.redraw();
  return tex;
}

/** Runs `redraw` again once `document.fonts` has loaded the given faces. No-op in node. */
export function redrawWhenFontsLoad(tex, fontSpecs, text) {
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') return;
  let dead = false;
  const again = () => {
    if (!dead && tex.userData.redraw) tex.userData.redraw();
  };
  Promise.all(fontSpecs.map((f) => document.fonts.load(f, text).catch(() => null))).then(again, again);
  if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(again, () => {});
  const prev = tex.dispose.bind(tex);
  tex.dispose = () => {
    dead = true;
    prev();
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared caches.
const geoCache = new Map();
const matCache = new Map();
const texCache = new Map();

export function sharedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}
export function sharedMat(key, make) {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}
export function sharedTexture(key, make) {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    t.userData.shared = true;
    texCache.set(key, t);
  }
  return t;
}

// Modules that keep their own derived caches (street bundles, PBR texture sets) register a reset here; it runs on disposeModelCache().
const resetHooks = new Set();
export function onModelCacheReset(fn) {
  resetHooks.add(fn);
  return () => resetHooks.delete(fn);
}

export function disposeModelCache() {
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  for (const t of texCache.values()) t.dispose();
  geoCache.clear();
  matCache.clear();
  texCache.clear();
  for (const fn of resetHooks) fn();
}

// ---------------------------------------------------------------------------------------------------------------------
// Procedural texture quality. Sizes apply to NEW textures only (cached ones keep the size they were built with), so call
// setTextureQuality() before the first model is built (the scene does it from its quality setting).
const TEX_Q = { low: { base: 128, hero: 256 }, medium: { base: 256, hero: 512 }, high: { base: 512, hero: 1024 } };
let texQuality = 'medium';
export function setTextureQuality(q) {
  if (TEX_Q[q]) texQuality = q;
  return texQuality;
}
export const getTextureQuality = () => texQuality;
/** Edge length in px (power of two) of a procedural texture; `hero` ones are the close-up props. */
export const texRes = (hero = false) => (hero ? TEX_Q[texQuality].hero : TEX_Q[texQuality].base);

const TEXTURE_SLOTS = ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'bumpMap'];

/** Frees every OWNED geometry, material and texture under `obj` (shared cache entries are skipped) and detaches it. */
export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const m = o.material;
    if (m) {
      for (const mm of Array.isArray(m) ? m : [m]) {
        if (mm.userData.shared) continue;
        for (const slot of TEXTURE_SLOTS) {
          const t = mm[slot];
          if (t && !t.userData.shared) t.dispose();
        }
        mm.dispose();
      }
    }
  });
  if (obj.removeFromParent) obj.removeFromParent();
}

/** Triangle count of everything renderable under `obj` (instanced / draw ranges ignored). */
export function countTriangles(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials: toon-ish MeshStandardMaterial (flatShading, rough .8), shared and cached.
const stdKey = (c, o) => `std:${new Color(c).getHexString()}:${o.rough ?? 0.8}:${o.metal ?? 0}:${o.emissive ?? ''}:${o.ei ?? 0}`;
export const materials = {
  /** One flat colour. */
  solid(color, { rough = 0.8, metal = 0, emissive = null, ei = 0 } = {}) {
    return sharedMat(stdKey(color, { rough, metal, emissive, ei }), () => {
      const m = new MeshStandardMaterial({ color, flatShading: true, roughness: rough, metalness: metal, side: DoubleSide });
      if (emissive) {
        m.emissive = new Color(emissive);
        m.emissiveIntensity = ei;
      }
      return m;
    });
  },
  /** Per-vertex colours (every merged static mesh uses this). `emissive` gives the 'perfect' sheen. */
  vertex({ rough = 0.8, metal = 0, emissive = null, ei = 0 } = {}) {
    return sharedMat(`vc:${rough}:${metal}:${emissive ?? ''}:${ei}`, () => {
      const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: rough, metalness: metal, side: DoubleSide });
      if (emissive) {
        m.emissive = new Color(emissive);
        m.emissiveIntensity = ei;
      }
      return m;
    });
  },
  glass() {
    return sharedMat('glass', () => new MeshStandardMaterial({ color: '#cfeeee', flatShading: true, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: DoubleSide }));
  },
  steam() {
    return sharedMat('steam', () => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
  },
  smoke() {
    return sharedMat('smoke', () => new MeshBasicMaterial({ color: '#3a3532', transparent: true, opacity: 0.5, depthWrite: false }));
  },
  bubble() {
    return sharedMat('bubble', () => new MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.8, depthWrite: false }));
  },
  flame() {
    return sharedMat('flame', () => new MeshBasicMaterial({ color: palette.flame, toneMapped: false, side: DoubleSide }));
  },
  flameGlow() {
    return sharedMat('flameGlow', () => new MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  },
  /** Unlit per-vertex colours that ignore the lighting (tube lights, bulbs, headlamps). */
  glow() {
    return sharedMat('glow', () => new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  },
  face() {
    return sharedMat('face', () => new MeshStandardMaterial({ color: '#1b1210', flatShading: true, roughness: 0.6 }));
  },
  dispose: () => disposeModelCache(),
};

/** A fresh, owned MeshStandardMaterial (per-instance tints). */
export function ownedStd(color, opts = {}) {
  return new MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0, ...opts });
}

// ---------------------------------------------------------------------------------------------------------------------
// Parts: bake many small primitives (with per-vertex colours) into ONE merged geometry per layer.
const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

export class Parts {
  constructor() {
    this.layers = { solid: [], glass: [], fx: [] };
    /** optional (Color) => void tint applied to parts added with `{ food: true }` */
    this.food = null;
  }

  /** `geo` must be a fresh geometry: it is consumed (cloned, transformed, disposed). */
  add(geo, color, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    const sc = o.s;
    _p.set(p[0], p[1], p[2]);
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    if (typeof sc === 'number') _s.set(sc, sc, sc);
    else if (sc) _s.set(sc[0], sc[1], sc[2]);
    else _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    _c.set(color);
    if (o.food && this.food) this.food(_c);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _c.r;
      arr[i * 3 + 1] = _c.g;
      arr[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
    (this.layers[o.layer || 'solid'] || this.layers.solid).push(g);
    return this;
  }

  box(w, h, d, color, o) {
    return this.add(new BoxGeometry(w, h, d), color, o);
  }
  cyl(rt, rb, h, seg, color, o, open = false) {
    return this.add(new CylinderGeometry(rt, rb, h, seg, 1, open), color, o);
  }
  cone(r, h, seg, color, o, open = false) {
    return this.add(new ConeGeometry(r, h, seg, 1, open), color, o);
  }
  sph(r, color, o, ws = 8, hs = 6) {
    return this.add(new SphereGeometry(r, ws, hs), color, o);
  }
  /** Upper hemisphere. */
  dome(r, color, o, ws = 10, hs = 4) {
    return this.add(new SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2), color, o);
  }
  /** Sphere cap from the pole down to `theta` radians (hair, caps). */
  cap(r, theta, color, o, ws = 9, hs = 4) {
    return this.add(new SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, theta), color, o);
  }
  torus(R, t, color, o, rs = 5, ts = 10, arc = Math.PI * 2) {
    return this.add(new TorusGeometry(R, t, rs, ts, arc), color, o);
  }
  capsule(r, len, color, o, cs = 3, rs = 6) {
    return this.add(new CapsuleGeometry(r, len, cs, rs), color, o);
  }
  disc(r, color, o, seg = 12) {
    return this.add(new CircleGeometry(r, seg), color, o);
  }
  ring(ri, ro, color, o, seg = 16) {
    return this.add(new RingGeometry(ri, ro, seg, 1), color, o);
  }
  /** points = [[radius, y], ...] bottom to top. */
  lathe(points, seg, color, o) {
    return this.add(new LatheGeometry(points.map((p) => new Vector2(p[0], p[1])), seg), color, o);
  }

  /** Merge one layer into a single geometry (or null when empty) and clear it. */
  build(layer = 'solid') {
    const list = this.layers[layer];
    if (!list || !list.length) return null;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    this.layers[layer] = [];
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}


/** A shared unit geometry helper for dynamic bits. */
export const unit = {
  sphere: (seg = 6) => sharedGeo(`u:sphere:${seg}`, () => new SphereGeometry(1, seg, Math.max(3, seg - 2))),
  ring: (ri, ro, seg = 20) => sharedGeo(`u:ring:${ri}:${ro}:${seg}`, () => new RingGeometry(ri, ro, seg, 1).rotateX(-Math.PI / 2)),
  disc: (r, seg = 20) => sharedGeo(`u:disc:${r}:${seg}`, () => new CircleGeometry(r, seg).rotateX(-Math.PI / 2)),
};

/** Mesh helper: shared geometry/material unless told otherwise. */
export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Make sure a thing is a real number (NaN guard for state coming from the engine). */
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export { BufferGeometry };
