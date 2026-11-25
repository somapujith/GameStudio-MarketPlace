// Surface painters for the stall and the street. Two families:
//  * PBR bundles baked from per-pixel recipes (brushed steel, peeling paint, rusty tin, worn concrete, asphalt, plaster, brick, bamboo, tarpaulin):
//    albedo + normal + ORM, sized by the quality tier (`setQuality`); mapped in METRES by the geometry (see kit.js), never with texture.repeat;
//  * canvas painters for signs, banners, the menu board, posters, shop facades and small sprites (art-signs.js).
// Pure drawing + a tracker: nothing here holds global state, so a scene can dispose everything it painted.
import { canvasTexture, bakePBR, fbmField, worleyField, mulberry, clamp01, mix, sstep } from './textures.js';
import { makeSigns } from './art-signs.js';

export function makeArt(tr) {
  const T = (tex) => tr.track(tex);
  const cfg = { size: 512, normals: true };
  const trackAll = (b) => {
    T(b.map);
    if (b.normalMap) T(b.normalMap);
    if (b.ormMap) T(b.ormMap);
    return b;
  };
  /** Bake a bundle. `big` surfaces take the tier size, small ones half of it. */
  const bake = (size, shade, o = {}) => {
    const n = Math.max(64, Math.min(cfg.size, size));
    return trackAll(bakePBR(n, n, shade, { normals: cfg.normals, strength: o.strength ?? 3, ormSize: n > 256 ? n / 2 : null }));
  };
  const cache = new Map();
  const once = (key, make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };

  /** Brushed stainless sheet with water rings, tea stains, scratches and a few dents. One tile = 1 m. */
  const steel = () => once('steel', () => {
    const n = Math.min(cfg.size, 512);
    const streak = fbmField(n, n, { cx: 3, cy: n / 2, oct: 3, gain: 0.55, seed: 11 });
    const mott = fbmField(n, n, { cx: 4, cy: 4, oct: 4, seed: 12 });
    const scr = fbmField(n, n, { cx: 2, cy: n / 3, oct: 1, seed: 13 });
    const scr2 = fbmField(n, n, { cx: 3, cy: n / 5, oct: 1, seed: 17 });
    const wor = worleyField(n, n, { cells: 3, seed: 14 });
    return bake(n, (i, x, y, u, v, p) => {
      const st = streak[i];
      const m = mott[i];
      let g = 0.6 + (st - 0.5) * 0.1 + (m - 0.5) * 0.12;
      let rough = 0.3 + (st - 0.5) * 0.22 + (m - 0.5) * 0.18;
      let h = (st - 0.5) * 0.12;
      const sc = Math.max(sstep(0.84, 0.95, scr[i]), sstep(0.86, 0.96, scr2[i]) * 0.7);
      g += sc * 0.14;
      rough -= sc * 0.1;
      h -= sc * 0.5;
      const d = wor.d1[i];
      const id = wor.id[i];
      const ring = id > 0.45 ? Math.exp(-(((d - (0.2 + id * 0.12)) / 0.018) ** 2)) : 0;
      const stain = id > 0.65 ? sstep(0.34, 0.1, d) : 0;
      const dent = id > 0.8 ? sstep(0.22, 0.0, d) : 0;
      h -= dent * 2.2;
      g = g * (1 - ring * 0.18 - stain * 0.22);
      rough += ring * 0.35 + stain * 0.3;
      // tile seam: a welded joint every metre
      const seam = Math.max(sstep(0.012, 0.0, u), sstep(0.012, 0.0, v));
      h -= seam * 1.5;
      g *= 1 - seam * 0.3;
      p.r = g * (0.97 + stain * 0.18);
      p.g = g * (0.99 + stain * 0.04);
      p.b = g * (1.03 - stain * 0.2);
      p.rough = rough;
      p.metal = 1 - stain * 0.35;
      p.h = h;
    }, { strength: 2.2 });
  });

  /** Painted plank panel (teal enamel paint peeling to bare wood, grime and hand smudges). 1 m tile, 6 planks. */
  const paintedWood = (paint = [0.07, 0.42, 0.4]) => once(`pw${paint.join(',')}`, () => {
    const n = Math.min(cfg.size, 512);
    const grain = fbmField(n, n, { cx: 20, cy: 2, oct: 4, gain: 0.55, seed: 21 });
    const peel = fbmField(n, n, { cx: 5, cy: 5, oct: 5, seed: 22 });
    const dirt = fbmField(n, n, { cx: 3, cy: 6, oct: 4, seed: 23 });
    const fine = fbmField(n, n, { cx: 64, cy: 64, oct: 2, seed: 24 });
    return bake(n, (i, x, y, u, v, p) => {
      const pu = (u * 6) % 1;
      const pid = Math.floor(u * 6);
      const groove = sstep(0.045, 0.0, Math.min(pu, 1 - pu));
      const wood = 0.8 + (grain[i] - 0.5) * 0.5;
      const edgeWear = sstep(0.2, 0.0, Math.min(pu, 1 - pu));
      const pv = peel[i] + edgeWear * 0.22 + (1 - v) * 0.08 + (pid % 3) * 0.02;
      const paintMask = sstep(0.54, 0.6, 1 - pv + 0.04);
      let r = paint[0] * (0.9 + fine[i] * 0.2);
      let g = paint[1] * (0.9 + fine[i] * 0.2);
      let b = paint[2] * (0.9 + fine[i] * 0.2);
      const wr = 0.42 * wood;
      const wg = 0.27 * wood;
      const wb = 0.15 * wood;
      r = mix(wr, r, paintMask);
      g = mix(wg, g, paintMask);
      b = mix(wb, b, paintMask);
      const grime = clamp01((1 - v) * 0.55 + dirt[i] * 0.45 - 0.28);
      r *= 1 - grime * 0.7;
      g *= 1 - grime * 0.7;
      b *= 1 - grime * 0.7;
      const gv = 1 - groove * 0.8;
      p.r = r * gv;
      p.g = g * gv;
      p.b = b * gv;
      p.rough = mix(0.88, 0.5, paintMask) + grime * 0.2;
      p.metal = 0;
      p.h = paintMask * 0.5 + (grain[i] - 0.5) * 0.2 - groove * 1.2 + fine[i] * 0.05;
      p.ao = 1 - groove * 0.6;
    }, { strength: 2.4 });
  });

  /** Bare weathered timber (shelf boards, thela frame). */
  const timber = () => once('timber', () => {
    const n = Math.min(cfg.size, 256);
    const grain = fbmField(n, n, { cx: 24, cy: 2, oct: 4, gain: 0.55, seed: 31 });
    const dirt = fbmField(n, n, { cx: 4, cy: 4, oct: 3, seed: 32 });
    return bake(n, (i, x, y, u, v, p) => {
      const w = 0.75 + (grain[i] - 0.5) * 0.7;
      const d = 1 - clamp01(dirt[i] * 0.6 - 0.1);
      p.r = 0.4 * w * d;
      p.g = 0.26 * w * d;
      p.b = 0.15 * w * d;
      p.rough = 0.8 + grain[i] * 0.15;
      p.h = (grain[i] - 0.5) * 0.6;
    }, { strength: 2 });
  });

  /** Galvanised corrugated sheet gone to rust: spangle, rust blooms, vertical drip streaks, bird mess. 1 m tile (the corrugation itself is geometry). */
  const tin = () => once('tin', () => {
    const n = Math.min(cfg.size, 512);
    const sp = worleyField(n, n, { cells: 24, seed: 41 });
    const rust = fbmField(n, n, { cx: 4, cy: 4, oct: 5, gain: 0.55, seed: 42 });
    const rust2 = fbmField(n, n, { cx: 9, cy: 9, oct: 3, seed: 46 });
    const drip = fbmField(n, n, { cx: 40, cy: 2, oct: 3, gain: 0.5, seed: 43 });
    const pit = fbmField(n, n, { cx: 64, cy: 64, oct: 2, seed: 44 });
    return bake(n, (i, x, y, u, v, p) => {
      const base = 0.6 + (sp.id[i] - 0.5) * 0.1;
      const rr = clamp01((rust[i] - 0.5) * 3.4 + (rust2[i] - 0.5) * 1.2 + 0.1 + (1 - v) * 0.15);
      const streak = sstep(0.55, 0.85, drip[i]) * (0.4 + 0.6 * (1 - v));
      let r = base * 0.96;
      let g = base;
      let b = base * 1.02;
      // rust: orange-brown, darker where deep
      const deep = sstep(0.55, 1.0, rr);
      r = mix(r, 0.46 - deep * 0.18, rr * 0.9);
      g = mix(g, 0.22 - deep * 0.1, rr * 0.9);
      b = mix(b, 0.1 - deep * 0.04, rr * 0.9);
      r *= 1 - streak * 0.3;
      g *= 1 - streak * 0.3;
      b *= 1 - streak * 0.28;
      const dropping = pit[i] > 0.86 && sp.id[i] > 0.7 ? 0.5 : 0;
      r += dropping * 0.4;
      g += dropping * 0.4;
      b += dropping * 0.38;
      p.r = r;
      p.g = g;
      p.b = b;
      p.rough = mix(0.42, 0.88, rr) + streak * 0.1;
      p.metal = mix(0.92, 0.12, clamp01(rr * 1.2));
      p.h = rr * (pit[i] - 0.5) * 0.9 + (sp.id[i] - 0.5) * 0.1;
    }, { strength: 1.6 });
  });

  /** Worn concrete floor: aggregate, hairline cracks, oil and tea stains, mop streaks, polished centre line. 2 m tile. */
  const concrete = () => once('concrete', () => {
    const n = Math.min(cfg.size, 512);
    const agg = fbmField(n, n, { cx: 128, cy: 128, oct: 2, gain: 0.55, seed: 51 });
    const mott = fbmField(n, n, { cx: 4, cy: 4, oct: 5, seed: 52 });
    const stain = fbmField(n, n, { cx: 3, cy: 3, oct: 4, seed: 53 });
    const mop = fbmField(n, n, { cx: 3, cy: 40, oct: 3, seed: 54 });
    const crk = worleyField(n, n, { cells: 10, seed: 55 });
    const crkMask = fbmField(n, n, { cx: 4, cy: 4, oct: 3, seed: 56 });
    return bake(n, (i, x, y, u, v, p) => {
      const a = agg[i];
      let c = 0.47 + (mott[i] - 0.5) * 0.14 + (a - 0.5) * 0.06;
      const edge = crk.d2[i] - crk.d1[i];
      const crack = sstep(0.03, 0.0, edge) * sstep(0.55, 0.68, crkMask[i]);
      const oil = sstep(0.62, 0.75, stain[i]);
      const mopStreak = sstep(0.55, 0.8, mop[i]) * 0.5;
      c *= 1 - crack * 0.45 - oil * 0.36;
      c += mopStreak * 0.06;
      const sp = a > 0.8 ? 0.04 : 0;
      p.r = (c + sp) * 1.0;
      p.g = (c + sp) * 0.97;
      p.b = (c + sp) * 0.92;
      p.rough = 0.92 - oil * 0.38 - mopStreak * 0.12 + (a - 0.5) * 0.1;
      p.h = (a - 0.5) * 0.7 - crack * 2.2 + (mott[i] - 0.5) * 0.3;
      p.ao = 1 - crack * 0.4;
    }, { strength: 2.4 });
  });

  /** Footpath: 2 x 2 concrete slabs, dirt in the joints, chipped edges, damp green at the foot of the slab. 1.2 m tile. */
  const paving = () => once('paving', () => {
    const n = Math.min(cfg.size, 256);
    const agg = fbmField(n, n, { cx: 48, cy: 48, oct: 3, gain: 0.6, seed: 61 });
    const mott = fbmField(n, n, { cx: 4, cy: 4, oct: 5, seed: 62 });
    const chip = fbmField(n, n, { cx: 16, cy: 16, oct: 3, seed: 63 });
    const damp = fbmField(n, n, { cx: 6, cy: 6, oct: 4, seed: 64 });
    return bake(n, (i, x, y, u, v, p) => {
      const su = (u * 2) % 1;
      const sv = (v * 2) % 1;
      const sid = Math.floor(u * 2) + Math.floor(v * 2) * 2;
      const dEdge = Math.min(su, 1 - su, sv, 1 - sv);
      const joint = sstep(0.028 + chip[i] * 0.02, 0.006, dEdge);
      let c = 0.52 + (sid * 0.037 % 0.1) - 0.04 + (mott[i] - 0.5) * 0.14 + (agg[i] - 0.5) * 0.1;
      const dp = sstep(0.55, 0.78, damp[i]) * (1 - sstep(0.0, 0.3, dEdge) * 0.4);
      c *= 1 - dp * 0.25;
      let r = c * 1.0;
      let g = c * 0.96;
      let b = c * 0.88;
      g += dp * 0.03;
      r = mix(r, 0.2, joint * 0.85);
      g = mix(g, 0.17, joint * 0.85);
      b = mix(b, 0.12, joint * 0.85);
      p.r = r;
      p.g = g;
      p.b = b;
      p.rough = 0.9 - dp * 0.2 + joint * 0.08;
      p.h = (agg[i] - 0.5) * 0.5 - joint * 2.0 + (chip[i] - 0.5) * 0.15 * sstep(0.1, 0.0, dEdge);
      p.ao = 1 - joint * 0.5;
    }, { strength: 2.4 });
  });

  /** Tarred road: black bitumen, pale aggregate, hairline cracks, patched repairs. 3 m tile. */
  const asphalt = () => once('asphalt', () => {
    const n = Math.min(cfg.size, 256);
    const agg = fbmField(n, n, { cx: 96, cy: 96, oct: 2, gain: 0.6, seed: 71 });
    const mott = fbmField(n, n, { cx: 4, cy: 4, oct: 5, seed: 72 });
    const crk = worleyField(n, n, { cells: 5, seed: 73 });
    const crkMask = fbmField(n, n, { cx: 3, cy: 3, oct: 2, seed: 74 });
    return bake(n, (i, x, y, u, v, p) => {
      const a = agg[i];
      let c = 0.16 + (mott[i] - 0.5) * 0.07;
      const grit = a > 0.66 ? (a - 0.66) * 0.9 : 0;
      c += grit * 0.6;
      const crack = sstep(0.035, 0.0, crk.d2[i] - crk.d1[i]) * sstep(0.5, 0.62, crkMask[i]);
      c *= 1 - crack * 0.6;
      p.r = c * 1.0;
      p.g = c * 0.99;
      p.b = c * 1.02;
      p.rough = 0.84 - (mott[i] - 0.5) * 0.25 - (grit > 0 ? 0 : 0.05);
      p.h = (a - 0.5) * 0.9 - crack * 2.4;
    }, { strength: 2.0 });
  });

  /** Weathered plaster, near white: tint it with the material colour. Rain streaks, damp at the foot, peeling patches. 3 m tile. */
  const plaster = () => once('plaster', () => {
    const n = Math.min(cfg.size, 256);
    const stu = fbmField(n, n, { cx: 48, cy: 48, oct: 3, gain: 0.55, seed: 81 });
    const mott = fbmField(n, n, { cx: 4, cy: 4, oct: 5, seed: 82 });
    const rain = fbmField(n, n, { cx: 36, cy: 3, oct: 3, gain: 0.5, seed: 83 });
    const peel = fbmField(n, n, { cx: 5, cy: 5, oct: 4, seed: 84 });
    return bake(n, (i, x, y, u, v, p) => {
      let c = 0.9 + (mott[i] - 0.5) * 0.14 + (stu[i] - 0.5) * 0.08;
      const streak = sstep(0.55, 0.85, rain[i]) * (0.35 + 0.65 * v);
      const damp = sstep(0.38, 0.0, v) * (0.5 + 0.5 * mott[i]);
      const pl = sstep(0.62, 0.7, peel[i]);
      c *= 1 - streak * 0.22 - damp * 0.3;
      const under = 0.74;
      c = mix(c, under, pl * 0.8);
      p.r = c * (1 - damp * 0.05);
      p.g = c * (1 - damp * 0.02 + 0.0);
      p.b = c * (1 - damp * 0.12 - streak * 0.04);
      p.rough = 0.92 - pl * 0.1;
      p.h = (stu[i] - 0.5) * 0.9 - pl * 0.8;
    }, { strength: 2.4 });
  });

  /** Red brick in running bond with sooty tops. 0.69 x 0.33 m tile (3 bricks x 4 courses); square texture, so the geometry maps u = x / 0.69, v = y / 0.69. */
  const brick = () => once('brick', () => {
    const n = Math.min(cfg.size, 256);
    const mott = fbmField(n, n, { cx: 6, cy: 6, oct: 4, seed: 91 });
    const fine = fbmField(n, n, { cx: 48, cy: 48, oct: 2, seed: 92 });
    const id = worleyField(n, n, { cells: 6, seed: 93 });
    return bake(n, (i, x, y, u, v, p) => {
      const rows = 8; // 8 courses per 0.69 m
      const row = Math.floor(v * rows);
      const fv = (v * rows) % 1;
      const off = (row % 2) * 0.5;
      const fu = (u * 3 + off) % 1;
      const mortar = Math.max(sstep(0.1, 0.02, fv), sstep(0.04, 0.0, fu), sstep(0.96, 1.0, fu)) > 0.5 ? 1 : 0;
      const bid = (Math.floor(u * 3 + off) * 7 + row * 13) % 11 / 11;
      let r = 0.46 + bid * 0.12 + (mott[i] - 0.5) * 0.16;
      let g = 0.18 + bid * 0.05 + (mott[i] - 0.5) * 0.07;
      let b = 0.11 + bid * 0.03;
      const soot = sstep(0.4, 1.0, v) * 0.5 * mott[i];
      r *= 1 - soot * 0.7;
      g *= 1 - soot * 0.5;
      b *= 1 - soot * 0.4;
      r = mix(r, 0.6, mortar * 0.85);
      g = mix(g, 0.56, mortar * 0.85);
      b = mix(b, 0.5, mortar * 0.85);
      p.r = r + (fine[i] - 0.5) * 0.04;
      p.g = g;
      p.b = b;
      p.rough = 0.93;
      p.h = (fine[i] - 0.5) * 0.8 - mortar * 1.6 + id.id[i] * 0.1;
    }, { strength: 2.6 });
  });

  /** Bamboo culm: yellow-green, nodes every 0.3 m, fibres. u around, v along (the texture covers 0.9 m of pole: three nodes). */
  const bamboo = () => once('bamboo', () => {
    const n = Math.min(cfg.size, 256);
    const fib = fbmField(n, n, { cx: 24, cy: 2, oct: 3, gain: 0.55, seed: 101 });
    const mott = fbmField(n, n, { cx: 3, cy: 6, oct: 4, seed: 102 });
    return bake(n, (i, x, y, u, v, p) => {
      const nv = (v * 3) % 1;
      const node = Math.exp(-(((nv - 0.5) / 0.03) ** 2));
      const gv = 0.5 + (fib[i] - 0.5) * 0.3 + (mott[i] - 0.5) * 0.3;
      let r = mix(0.44, 0.66, gv);
      let g = mix(0.4, 0.56, gv);
      let b = mix(0.12, 0.26, gv);
      r *= 1 - node * 0.45;
      g *= 1 - node * 0.45;
      b *= 1 - node * 0.45;
      p.r = r;
      p.g = g;
      p.b = b;
      p.rough = 0.5 + node * 0.3 + (fib[i] - 0.5) * 0.2;
      p.h = node * 1.0 + (fib[i] - 0.5) * 0.3;
    }, { strength: 1.6 });
  });

  /** HDPE tarpaulin: woven rib texture, creases, sun-faded blue with a pale stripe. 0.5 m tile. */
  const tarp = (base = [0.1, 0.3, 0.64]) => once(`tarp${base.join(',')}`, () => {
    const n = Math.min(cfg.size, 256);
    const crease = fbmField(n, n, { cx: 3, cy: 3, oct: 5, seed: 111 });
    const dirt = fbmField(n, n, { cx: 4, cy: 4, oct: 4, seed: 112 });
    return bake(n, (i, x, y, u, v, p) => {
      const weave = (Math.sin(u * Math.PI * 2 * 32) * Math.sin(v * Math.PI * 2 * 32) + 1) * 0.5;
      const rib = Math.sin(u * Math.PI * 2 * 4) * 0.5 + 0.5;
      const cr = Math.abs(crease[i] - 0.5) * 2;
      const fade = clamp01(dirt[i] * 0.8 - 0.1);
      const stripe = sstep(0.42, 0.5, (u * 4) % 1) * sstep(0.58, 0.5, (u * 4) % 1) * 0.15;
      p.r = mix(base[0], 0.55, fade * 0.3 + stripe) * (0.92 + weave * 0.1) * (1 - sstep(0.1, 0.0, cr) * 0.15);
      p.g = mix(base[1], 0.55, fade * 0.3 + stripe) * (0.92 + weave * 0.1) * (1 - sstep(0.1, 0.0, cr) * 0.15);
      p.b = mix(base[2], 0.55, fade * 0.25 + stripe) * (0.92 + weave * 0.1) * (1 - sstep(0.1, 0.0, cr) * 0.15);
      p.rough = 0.55 + fade * 0.3;
      p.h = weave * 0.5 + rib * 0.15 + (crease[i] - 0.5) * 1.2;
    }, { strength: 1.8 });
  });

  /** Plain woven cloth normal (towels, gunny, awning fabric): tint with the material colour. 0.3 m tile. */
  const cloth = () => once('cloth', () => {
    const n = Math.min(cfg.size, 128);
    const fib = fbmField(n, n, { cx: 24, cy: 24, oct: 2, seed: 121 });
    return bake(n, (i, x, y, u, v, p) => {
      const w = (Math.sin(u * Math.PI * 2 * 16) * Math.sin(v * Math.PI * 2 * 16) + 1) * 0.5;
      const c = 0.85 + (fib[i] - 0.5) * 0.2 - w * 0.1;
      p.r = p.g = p.b = c;
      p.rough = 0.95;
      p.h = w + (fib[i] - 0.5) * 0.4;
    }, { strength: 1.4 });
  });

  /** Rubber / old plastic: speckled grey, for hoses, tyres, crates. */
  const grunge = () => once('grunge', () => {
    const n = Math.min(cfg.size, 128);
    const m = fbmField(n, n, { cx: 4, cy: 4, oct: 5, seed: 131 });
    const f = fbmField(n, n, { cx: 40, cy: 40, oct: 2, seed: 132 });
    return bake(n, (i, x, y, u, v, p) => {
      const c = 0.8 + (m[i] - 0.5) * 0.4 + (f[i] - 0.5) * 0.16;
      p.r = p.g = p.b = c;
      p.rough = 0.7 + m[i] * 0.25;
      p.h = (f[i] - 0.5) * 0.6;
    }, { strength: 1.2 });
  });

  const rest = makeSigns(T, { canvasTexture, mulberry });

  return {
    steel, paintedWood, timber, tin, concrete, paving, asphalt, plaster, brick, bamboo, tarp, cloth, grunge,
    ...rest,
    /** Called by the stall with the tier: texture size and whether normal maps are baked. Existing bundles keep their size. */
    setQuality(q) {
      cfg.size = Math.max(128, Math.min(512, q.texSize || 512));
      cfg.normals = q.normalMaps !== false;
    },
    redrawAll() {
      rest.redrawText?.();
    },
  };
}
