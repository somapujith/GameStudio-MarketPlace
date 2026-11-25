// Tiffin Centre PBR foundation: quality tiers, procedurally generated albedo / normal / packed-ORM maps, cached physical materials.
//
//  * Maps are generated from procedural height + albedo functions into typed arrays (see noise.js) and uploaded as DataTextures:
//    albedo (sRGB), normal (Sobel of the height field) and ONE packed ORM texture (R = ao, G = roughness, B = metalness) that
//    feeds aoMap + roughnessMap + metalnessMap together. In node (no `document`) every texture is a 1x1 stub so tests stay fast.
//  * Everything shared lives in util.js's caches (userData.shared) and is freed by disposeModelCache() / materials.dispose().
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three';
import { sharedMat, sharedTexture } from './util.js';
import { buildMaps, clamp, fbm, hash2, mix, sstep, vnoise, worley } from './noise.js';

// ---------------------------------------------------------------------------------------------------------------------
// Quality tiers. `tex` caps every generated map; `normal` toggles normal maps; `aniso` anisotropic highlights;
// `detail` 0..2 is read by the food / tawa shaders (0 = flat colour + no bump, 2 = lace + full bump); `particles` scales emitters.
export const QUALITY_TIERS = {
  low: { name: 'low', tex: 128, normal: false, aniso: false, detail: 0, particles: 0.4, lights: false, segScale: 0.6 },
  medium: { name: 'medium', tex: 256, normal: true, aniso: false, detail: 1, particles: 0.75, lights: true, segScale: 0.85 },
  high: { name: 'high', tex: 512, normal: true, aniso: true, detail: 2, particles: 1, lights: true, segScale: 1 },
};

let current = QUALITY_TIERS.high;
const listeners = new Set();
const registry = new Set(); // anything with apply(cfg), refreshed when the tier changes

export const quality = () => current;
export const getQuality = () => current.name;

/** Tier changes affect objects built AFTER the call plus every registered live material (defines / normal maps recompile). */
export function setQuality(name) {
  const next = QUALITY_TIERS[name];
  if (!next || next === current) return current.name;
  current = next;
  for (const r of registry) r.apply(current);
  for (const fn of listeners) fn(current);
  return current.name;
}
/** Forget every registered live material (call after disposeModelCache(): the shared materials are gone). */
export function clearQualityRegistry() {
  registry.clear();
}
export const onQualityChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
/** Register anything with apply(cfg); it is applied once immediately. Returns an unregister fn. */
export function registerQuality(r) {
  registry.add(r);
  r.apply(current);
  return () => registry.delete(r);
}

const hasDom = () => typeof document !== 'undefined';

// ---------------------------------------------------------------------------------------------------------------------
function makeTex(data, w, h, { srgb = false } = {}) {
  const t = new DataTexture(data, w, h);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  t.userData.shared = true;
  return t;
}
const STUB = {
  map: () => makeTex(new Uint8Array([200, 200, 200, 255]), 1, 1, { srgb: true }),
  normal: () => makeTex(new Uint8Array([128, 128, 255, 255]), 1, 1),
  orm: () => makeTex(new Uint8Array([255, 160, 0, 255]), 1, 1),
};

function pack(map, normalMap, orm, stub, w, h) {
  const s = { map, normalMap, orm, stub, w, h, userData: { shared: true } };
  s.dispose = () => {
    map.dispose();
    normalMap.dispose();
    orm.dispose();
  };
  return s;
}

/**
 * Generate (or fetch from the cache) a map set. fn(u, v, out) fills {r,g,b,h,rough,metal,ao}. Size is capped by the tier.
 * Returns { map, normalMap, orm, stub, dispose }.
 */
export function mapSet(name, w, h, fn, { normalStrength = 2 } = {}) {
  const cap = current.tex;
  const k = Math.max(w, h) > cap ? cap / Math.max(w, h) : 1;
  const W = Math.max(16, Math.round(w * k));
  const H = Math.max(16, Math.round(h * k));
  return sharedTexture(`set:${name}:${W}x${H}`, () => {
    if (!hasDom()) return pack(STUB.map(), STUB.normal(), STUB.orm(), true, 1, 1);
    const m = buildMaps(W, H, fn, { normalStrength });
    return pack(makeTex(m.albedo, W, H, { srgb: true }), makeTex(m.normal, W, H), makeTex(m.orm, W, H), false, W, H);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Recipes. u,v tile in [0,1). Noise lattices use integer periods so every map tiles.
const lerp3 = (o, a, b, t) => {
  o.r = mix(a[0], b[0], t);
  o.g = mix(a[1], b[1], t);
  o.b = mix(a[2], b[2], t);
};

/** Brushed stainless: streaks run along u (lathe parts get concentric rings), faint scratches and finger smudges. */
function steelBrushed(u, v, o) {
  const streak = vnoise(u * 6, v * 260, 6, 260, 3);
  const fine = vnoise(u * 12, v * 700, 12, 700, 9);
  const scratch = hash2(Math.floor(v * 512), 5, 1) > 0.965 ? 0.5 + 0.5 * vnoise(u * 3, v * 40, 3, 40, 2) : 0;
  const smudge = fbm(u * 8, v * 3, 3, 8, 3, 21);
  const base = 0.76 + 0.03 * streak + 0.015 * fine - 0.05 * scratch - 0.02 * sstep(0.55, 0.8, smudge);
  o.r = base;
  o.g = base + 0.008;
  o.b = base + 0.02;
  o.metal = 1;
  o.rough = 0.3 + 0.1 * streak + 0.05 * fine + 0.07 * sstep(0.5, 0.78, smudge) + 0.12 * scratch;
  o.h = streak * 0.22 + fine * 0.15 - scratch * 0.5;
}

/** Light pitted aluminium (steamer, kettles): oxidation mottling, spun lines. */
function aluminium(u, v, o) {
  const spun = vnoise(u * 2, v * 150, 2, 150, 4);
  const m = fbm(u * 6, v * 6, 4, 6, 6, 5);
  const pit = worley(u * 16, v * 16, 16, 16, 6);
  const dull = sstep(0.45, 0.75, m);
  const base = 0.82 + 0.05 * spun - 0.12 * dull;
  o.r = base;
  o.g = base + 0.005;
  o.b = base + 0.01;
  o.metal = 1;
  o.rough = 0.34 + 0.16 * spun + 0.3 * dull + (pit < 0.08 ? 0.12 : 0);
  o.h = spun * 0.2 + m * 0.5 - (pit < 0.09 ? 0.25 : 0);
}

/** Cast / seasoned iron (kadai, kettles' soot parts): very dark with oil sheen and rust specks. */
function ironDark(u, v, o) {
  const m = fbm(u * 8, v * 8, 4, 8, 8, 12);
  const grain = worley(u * 60, v * 60, 60, 60, 4);
  const rust = sstep(0.62, 0.8, fbm(u * 5, v * 5, 3, 5, 5, 7)) * 0.5;
  const base = 0.1 + 0.07 * m;
  o.r = base + rust * 0.25;
  o.g = base + rust * 0.1;
  o.b = base;
  o.metal = 0.75;
  o.rough = 0.42 + 0.35 * m + (grain < 0.2 ? 0.1 : 0);
  o.h = m * 0.5 + (1 - grain) * 0.3;
}

/** Kiln brick, running bond, 4 bricks wide x 8 courses = 0.88 x 0.6 m. u across, v up. */
function brick(u, v, o) {
  const BW = 0.25;
  const rows = 8;
  const rowF = v * rows;
  const row = Math.floor(rowF);
  const yIn = rowF - row;
  const off = row % 2 ? 0.5 * BW : 0;
  const xF = (((u + off) % 1) + 1) % 1 / BW;
  const col = Math.floor(xF);
  const xIn = xF - col;
  const mortarY = 0.08;
  const mortarX = 0.045;
  const dEdge = Math.min(yIn, 1 - yIn, xIn * 0.34, (1 - xIn) * 0.34);
  const inMortar = yIn < mortarY || yIn > 1 - mortarY || xIn < mortarX || xIn > 1 - mortarX;
  const bid = hash2(col & 3, row, 17);
  const grit = vnoise(u * 160, v * 160, 160, 160, 3);
  const mott = fbm(u * 10, v * 10, 3, 10, 10, 8);
  if (inMortar) {
    const m = 0.62 + 0.14 * grit;
    o.r = m;
    o.g = m * 0.93;
    o.b = m * 0.8;
    o.rough = 0.95;
    o.h = -0.9 + grit * 0.25;
    o.ao = 0.7;
    return;
  }
  const t = 0.35 + 0.65 * bid;
  lerp3(o, [0.62, 0.22, 0.12], [0.46, 0.14, 0.08], clamp(t * 0.8 + mott * 0.5 - 0.15));
  const pit = worley(u * 90, v * 90, 90, 90, 9) < 0.1 ? 0.16 : 0;
  o.r *= 0.92 + 0.16 * grit - pit;
  o.g *= 0.9 + 0.2 * grit - pit;
  o.b *= 0.9 + 0.2 * grit - pit;
  o.rough = 0.92;
  o.h = 0.35 + 0.2 * grit + 0.3 * sstep(0, 0.2, dEdge) - pit * 2;
  o.ao = 0.85 + 0.15 * sstep(0, 0.16, dEdge);
}

/** Warm wood grain along v. */
function wood(u, v, o) {
  const warp = vnoise(u * 6, v * 2, 6, 2, 3) * 0.6;
  const ring = Math.sin((u * 7 + warp * 2) * Math.PI * 2 + vnoise(u * 3, v * 5, 3, 5, 8) * 5) * 0.5 + 0.5;
  const fine = vnoise(u * 90, v * 6, 90, 6, 4);
  const t = clamp(ring * 0.6 + fine * 0.3);
  lerp3(o, [0.62, 0.42, 0.24], [0.4, 0.24, 0.12], t);
  o.rough = 0.62 + 0.2 * fine;
  o.h = fine * 0.5 + ring * 0.2;
  o.ao = 0.9 + 0.1 * (1 - ring);
}

/** Brass: golden, tarnish blooms. */
function brass(u, v, o) {
  const tar = fbm(u * 5, v * 5, 4, 5, 5, 31);
  const sc = vnoise(u * 3, v * 300, 3, 300, 5);
  lerp3(o, [0.86, 0.64, 0.24], [0.45, 0.3, 0.1], sstep(0.45, 0.8, tar) * 0.8);
  o.metal = 1;
  o.rough = 0.28 + 0.3 * sstep(0.4, 0.8, tar) + 0.1 * sc;
  o.h = sc * 0.2 + tar * 0.3;
}

/** Plain-weave cotton cloth (idli cloth, rag). */
function cloth(u, v, o) {
  const N = 48;
  const fx = u * N;
  const fy = v * N;
  const over = (Math.floor(fx) + Math.floor(fy)) & 1;
  const sx = Math.sin((fx % 1) * Math.PI);
  const sy = Math.sin((fy % 1) * Math.PI);
  const h = over ? sx : sy;
  const fiber = vnoise(u * 380, v * 380, 380, 380, 2);
  const slub = fbm(u * 6, v * 6, 3, 6, 6, 3);
  const shade = 0.78 + 0.14 * h + 0.06 * fiber - 0.06 * slub;
  o.r = shade;
  o.g = shade * 0.985;
  o.b = shade * 0.94;
  o.rough = 0.92;
  o.h = h * 1.2 + fiber * 0.2;
  o.ao = 0.78 + 0.22 * h;
}

/** Banana leaf: u across the leaf (midrib at 0.5), v along it. */
function bananaLeaf(u, v, o) {
  const d = Math.abs(u - 0.5) * 2; // 0 at midrib
  const vein = Math.sin(v * 140 - d * 26) * 0.5 + 0.5; // slanted parallel veins
  const vein2 = vein ** 6;
  const rib = Math.exp(-((d / 0.035) ** 2));
  const blot = fbm(u * 8, v * 10, 4, 0, 0, 5);
  lerp3(o, [0.1, 0.34, 0.11], [0.3, 0.55, 0.16], clamp(0.25 + vein2 * 0.35 + blot * 0.5 - d * 0.1));
  o.r += rib * 0.2;
  o.g += rib * 0.18;
  o.b += rib * 0.06;
  o.rough = 0.38 + 0.3 * blot;
  o.h = vein2 * 0.35 + rib * 1.6 - d * 0.1;
}

/** Newspaper print: column text lines with random glyph blocks and a bold headline band. */
function newspaper(u, v, o) {
  const paper = 0.9 + 0.05 * fbm(u * 8, v * 8, 3, 8, 8, 2) - 0.04 * vnoise(u * 300, v * 300, 300, 300, 1);
  let ink = 0;
  const colF = u * 3;
  const cx = Math.floor(colF);
  const inCol = colF - cx;
  const lf = v * 46;
  const li = Math.floor(lf);
  const lIn = lf - li;
  const headline = v > 0.82 && v < 0.94;
  if (!headline && inCol > 0.06 && inCol < 0.94 && lIn > 0.2 && lIn < 0.8) {
    const gx = ((inCol - 0.06) / 0.88) * 22;
    const ci = Math.floor(gx);
    const cIn = gx - ci;
    const present = hash2(ci + cx * 40, li, 5) > 0.2;
    const gl = hash2(Math.floor(cIn * 3) + ci * 5, Math.floor(((lIn - 0.2) / 0.6) * 4) + li * 11, 6) > 0.42 ? 1 : 0;
    ink = present && cIn > 0.1 && cIn < 0.9 ? gl * 0.75 : 0;
  } else if (headline) {
    const gx = u * 18;
    const ci = Math.floor(gx);
    const cIn = gx - ci;
    const vv = (v - 0.82) / 0.12;
    ink = hash2(ci, 99, 7) > 0.25 && cIn > 0.12 && cIn < 0.88 && vv > 0.12 && vv < 0.88 ? 0.9 : 0;
  }
  const photo = u < 0.62 && u > 0.4 && v > 0.45 && v < 0.62 ? 0.5 + 0.25 * fbm(u * 40, v * 40, 3, 0, 0, 3) : 0;
  const k = paper * (1 - ink * 0.82) * (photo ? 1 - photo * 0.6 : 1);
  o.r = k;
  o.g = k * 0.96;
  o.b = k * 0.84;
  o.rough = 0.88;
  o.h = -ink * 0.2 + vnoise(u * 200, v * 200, 200, 200, 3) * 0.1;
}

/** Soft rubber (hose): satin black. */
function rubber(u, v, o) {
  const n = fbm(u * 30, v * 4, 3, 30, 4, 3);
  const b = 0.05 + 0.04 * n;
  o.r = b;
  o.g = b;
  o.b = b * 1.1;
  o.rough = 0.5 + 0.3 * n;
  o.h = n * 0.3;
}

/** Counter steel panel: broad worn grain with dents. */
function counterSteel(u, v, o) {
  steelBrushed(u, v, o);
  const dent = fbm(u * 3, v * 3, 3, 3, 3, 44);
  o.h += (dent - 0.5) * 4;
  o.rough += 0.1;
  o.r *= 0.9;
  o.g *= 0.9;
  o.b *= 0.92;
}

const RECIPES = {
  'steel-brushed': { w: 512, h: 512, fn: steelBrushed, ns: 1.6 },
  aluminium: { w: 512, h: 512, fn: aluminium, ns: 1.2 },
  'iron-dark': { w: 512, h: 512, fn: ironDark, ns: 3 },
  brick: { w: 512, h: 352, fn: brick, ns: 3.5 },
  wood: { w: 256, h: 256, fn: wood, ns: 2 },
  brass: { w: 256, h: 256, fn: brass, ns: 2 },
  cloth: { w: 256, h: 256, fn: cloth, ns: 3 },
  leaf: { w: 512, h: 512, fn: bananaLeaf, ns: 3 },
  newspaper: { w: 512, h: 512, fn: newspaper, ns: 1.2 },
  rubber: { w: 128, h: 128, fn: rubber, ns: 1 },
  'counter-steel': { w: 512, h: 512, fn: counterSteel, ns: 2 },
};
export const RECIPE_NAMES = Object.keys(RECIPES);

export function textureSet(name) {
  const r = RECIPES[name];
  if (!r) throw new Error(`unknown pbr recipe ${name}`);
  return mapSet(name, r.w, r.h, r.fn, { normalStrength: r.ns });
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials
/**
 * pbrMaterial(recipe, { color, rough, metal, aniso, vertexColors, side, ns, clearcoat, sheen, env }) -> SHARED MeshPhysicalMaterial.
 * The packed ORM map drives ao / roughness / metalness; `rough` / `metal` multiply it (default 1 = map as generated).
 */
export function pbrMaterial(recipe, opts = {}) {
  const key = ['pbr', recipe, opts.key ?? '', opts.color ?? '', opts.rough ?? 1, opts.metal ?? 1, opts.aniso ?? 0, opts.vertexColors ? 1 : 0, opts.side ?? 0, opts.clearcoat ?? 0, opts.sheen ?? 0, opts.ns ?? 1, opts.env ?? 1].join(':');
  return sharedMat(key, () => {
    const set = textureSet(recipe);
    const m = new MeshPhysicalMaterial({
      color: opts.color ?? '#ffffff',
      map: set.map,
      roughnessMap: set.orm,
      metalnessMap: set.orm,
      aoMap: set.orm,
      roughness: opts.rough ?? 1,
      metalness: opts.metal ?? 1,
      vertexColors: !!opts.vertexColors,
      side: opts.side ?? 0,
      clearcoat: opts.clearcoat ?? 0,
      clearcoatRoughness: 0.25,
      sheen: opts.sheen ?? 0,
      sheenRoughness: 0.6,
      sheenColor: opts.sheenColor ?? '#ffffff',
      envMapIntensity: opts.env ?? 1,
    });
    m.normalScale = new Vector2(opts.ns ?? 1, opts.ns ?? 1);
    m.userData.recipe = recipe;
    const aniso = opts.aniso ?? 0;
    registerQuality({
      apply(cfg) {
        const n = cfg.normal ? set.normalMap : null;
        const a = cfg.aniso ? aniso : 0;
        if (m.normalMap !== n || m.anisotropy !== a) {
          m.normalMap = n;
          m.anisotropy = a;
          m.needsUpdate = true;
        }
      },
    });
    return m;
  });
}

/** A plain (non-textured) shared physical material, e.g. paint, rubber, plastic. */
export function plainMaterial(key, params) {
  return sharedMat(`plain:${key}`, () => new MeshPhysicalMaterial({ envMapIntensity: 1, ...params }));
}
