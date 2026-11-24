// Procedural PBR material sets (albedo + normal + roughness/metalness) for the street models. Every recipe is seamless, cached and
// shared (disposeModelCache frees them), sized by setTextureQuality() (<= 512 px, heroes <= 1024), and returns tiny stub textures in node.
//   const { map, normalMap, roughnessMap } = pbr.brushedSteel();   // roughnessMap is also the metalness map (G = roughness, B = metalness)
import { blur, canPaint, fbm, hash2, hexRGB, imageTexture, mix, normalize01, packORM, paintImage, perlin, pbrSet, scratches, smoothstep, stamps, white, worley } from './texgen.js';
import { sharedTexture, texRes } from './util.js';

const px = (out, o, r, g, b) => {
  out[o] = r < 0 ? 0 : r > 255 ? 255 : r;
  out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
};
const fieldOf = (N, fn) => {
  const f = new Float32Array(N * N);
  for (let i = 0; i < f.length; i++) f[i] = fn(i, i % N, (i / N) | 0);
  return f;
};

/** Plain-weave height field (threads per tile, thread thickness jitter). Returns { h, warp, weft, id } (id = per-thread hash for colour variation). */
function weaveField(N, threads, jit = 0.25, seed = 1) {
  const h = new Float32Array(N * N);
  const tone = new Float32Array(N * N);
  const fib = white(N, seed + 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * threads;
      const v = (y / N) * threads;
      const iu = Math.floor(u) % threads;
      const iv = Math.floor(v) % threads;
      const fu = u - Math.floor(u);
      const fv = v - Math.floor(v);
      const over = (iu + iv) & 1;
      const tu = 1 - jit * hash2(iu, 0, seed);
      const tv = 1 - jit * hash2(iv, 1, seed);
      const wu = Math.sin(Math.PI * fu) * tu;
      const wv = Math.sin(Math.PI * fv) * tv;
      const i = y * N + x;
      h[i] = (over ? wu * 0.75 + wv * 0.25 : wv * 0.75 + wu * 0.25) + (fib[i] - 0.5) * 0.12;
      tone[i] = over ? hash2(iu, 7, seed) : hash2(iv, 9, seed);
    }
  }
  return { h, tone };
}

// ---------------------------------------------------------------------------------------------------------------------
const R = {
  /** Stainless steel with brushed streaks, scratches and greasy dirt. Metal. */
  brushedSteel({ tone = '#cfd6da', dirt = 0.6 } = {}) {
    return pbrSet(`steel:${tone}:${dirt}`, true, (N) => {
      const a = perlin(N, 2, N / 1.5, 1);
      const b = perlin(N, 4, N / 2.5, 2);
      const c = perlin(N, 1, N / 20, 3);
      const streak = fieldOf(N, (i) => 0.5 + 0.5 * (a[i] * 0.55 + b[i] * 0.3 + c[i] * 0.18));
      const fine = scratches(new Float32Array(N * N), N, { count: N / 3, len: 0.3, angle: 0, spread: 0.06, amount: 0.16, seed: 4 });
      const cross = scratches(new Float32Array(N * N), N, { count: N / 24, len: 0.06, angle: 1.0, spread: 2, amount: 0.5, seed: 5 });
      const d1 = fbm(N, { cx: 3, oct: 6, seed: 7 });
      const d2 = fbm(N, { cx: 10, cy: 2, oct: 4, seed: 9 });
      const rim = new Float32Array(N * N);
      const base = hexRGB(tone);
      const dm = fieldOf(N, (i) => smoothstep(0.5, 0.92, d1[i]) * (0.4 + 0.6 * d2[i]) * dirt);
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.9 + streak[i] * 0.12 + fine[i] * 0.22 + cross[i] * 0.1 + rim[i];
        const d = 1 - dm[i] * 0.42;
        px(o, p, base[0] * k * d * (1 + dm[i] * 0.06), base[1] * k * d, base[2] * k * d * (1 - dm[i] * 0.12));
      });
      const height = fieldOf(N, (i) => streak[i] * 0.3 + fine[i] * 0.5 - cross[i] * 0.4);
      const rough = fieldOf(N, (i) => 0.26 + streak[i] * 0.16 + dm[i] * 0.4 + cross[i] * 0.12);
      const metal = fieldOf(N, (i) => 1 - dm[i] * 0.45);
      return { albedo, height, normalStrength: 0.8, orm: packORM(N, rough, metal) };
    });
  },

  /** Chipped enamel / car paint on steel: white base (tint it with the vertex colour); sparse irregular chips show rust, scratches show steel. */
  paint({ wear = 0.5 } = {}) {
    return pbrSet(`paint:${wear}`, true, (N) => {
      const m1 = fbm(N, { cx: 4, oct: 6, seed: 5 });
      const m2 = fbm(N, { cx: 14, oct: 4, seed: 16 });
      const edge = fbm(N, { cx: 40, oct: 2, seed: 17 });
      const chipV = fieldOf(N, (i) => m1[i] * 0.62 + m2[i] * 0.42 + (edge[i] - 0.5) * 0.18);
      const thr = 1.12 - wear * 0.22;
      const chip = fieldOf(N, (i) => smoothstep(thr, thr + 0.025, chipV[i]));
      const rimf = fieldOf(N, (i) => smoothstep(thr - 0.04, thr, chipV[i]) * (1 - chip[i]));
      const grimeA = perlin(N, 12, 2, 8);
      const grimeB = fbm(N, { cx: 3, oct: 5, seed: 6 });
      const dust = white(N, 2);
      const peel = fbm(N, { cx: N / 10, oct: 2, seed: 14 });
      const rust = fbm(N, { cx: 14, oct: 4, seed: 15 });
      const scr = scratches(new Float32Array(N * N), N, { count: N / 16, len: 0.08, angle: 0.4, spread: 3, amount: 0.6, seed: 21 });
      const albedo = paintImage(N, (i, o, p) => {
        const gr = 1 - Math.max(0, grimeA[i] - 0.15) * 0.12 - smoothstep(0.55, 0.95, grimeB[i]) * 0.1;
        const base = (238 + (peel[i] - 0.5) * 8 + (dust[i] - 0.5) * 5) * gr;
        const s2 = Math.min(1, scr[i]);
        const rr = 96 + rust[i] * 60;
        const k = chip[i];
        // scratches expose grey steel, chips expose rust
        const bareR = mix(base, 160, s2 * 0.35);
        px(o, p, mix(bareR, rr, k) + rimf[i] * 10, mix(bareR, rr * 0.58, k) + rimf[i] * 9, mix(bareR, rr * 0.4, k) + rimf[i] * 8);
      });
      const height = fieldOf(N, (i) => peel[i] * 0.07 - chip[i] * 0.4 + rimf[i] * 0.12 - scr[i] * 0.1);
      const rough = fieldOf(N, (i) => mix(0.36 + (1 - gr(grimeB[i])) * 0.25 + scr[i] * 0.2, 0.85, chip[i]));
      const metal = fieldOf(N, (i) => Math.min(1, chip[i] * 0.4 + scr[i] * 0.5));
      return { albedo, height, normalStrength: 1.2, orm: packORM(N, rough, metal) };
    });
  },

  /** Galvanised corrugated tin: spangle, rust blooms, vertical water stains. (The corrugation itself is geometry.) */
  tin({ rust = 0.55 } = {}) {
    return pbrSet(`tin:${rust}`, false, (N) => {
      const cell = worley(N, Math.max(6, N / 24), 4).f1;
      const bloom = fbm(N, { cx: 3, oct: 6, seed: 22 });
      const edge = fbm(N, { cx: 7, oct: 5, seed: 23 });
      const stain = perlin(N, 14, 2, 24);
      const stain2 = perlin(N, 5, 1, 25);
      const pit = fbm(N, { cx: N / 8, oct: 2, seed: 26 });
      const rm = fieldOf(N, (i) => smoothstep(0.62 - rust * 0.22, 0.8 - rust * 0.2, bloom[i] * 0.7 + edge[i] * 0.4));
      const albedo = paintImage(N, (i, o, p) => {
        const zn = 150 + (cell[i] - 0.5) * 22 + (pit[i] - 0.5) * 12;
        const st = Math.max(0, stain[i] - 0.1) * Math.max(0, stain2[i] + 0.5) * 110;
        const r = mix(zn - st * 0.5, 92 + edge[i] * 52, rm[i]);
        const g = mix(zn + 3 - st * 0.7, 52 + edge[i] * 26, rm[i]);
        const b = mix(zn + 6 - st, 34 + edge[i] * 14, rm[i]);
        px(o, p, r, g, b);
      });
      const height = fieldOf(N, (i) => pit[i] * 0.4 + rm[i] * 0.5 * edge[i] - cell[i] * 0.1);
      const rough = fieldOf(N, (i) => mix(0.42 + cell[i] * 0.1, 0.9, rm[i]));
      const metal = fieldOf(N, (i) => mix(0.85, 0.12, rm[i]));
      return { albedo, height, normalStrength: 1.1, orm: packORM(N, rough, metal) };
    });
  },

  /** Wood grain (grain runs along u). tone: base colour; `painted` white-wash that is worn through. */
  wood({ tone = '#8a5a33', painted = 0 } = {}) {
    return pbrSet(`wood:${tone}:${painted}`, true, (N) => {
      const warp = perlin(N, 1, 3, 31);
      const warp2 = fbm(N, { cx: 2, cy: 6, oct: 3, seed: 32 });
      const fib = perlin(N, 2, N / 3, 33);
      const fib2 = perlin(N, 3, N / 6, 34);
      const dark = hexRGB(tone).map((c) => c * 0.58);
      const light = hexRGB(tone).map((c) => Math.min(255, c * 1.28));
      const knot = worley(N, 3, 35).f1;
      const wear = fbm(N, { cx: 4, oct: 6, seed: 36 });
      const grime = fbm(N, { cx: 2, cy: 8, oct: 4, seed: 37 });
      const rings = fieldOf(N, (i, x, y) => {
        const kn = Math.max(0, 0.22 - knot[i]) * 5;
        const t = (y / N) * 9 + warp[i] * 1.6 + warp2[i] * 1.5 + kn * 1.4;
        return 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      });
      const grain = fieldOf(N, (i) => rings[i] * 0.55 + (fib[i] * 0.5 + 0.5) * 0.3 + (fib2[i] * 0.5 + 0.5) * 0.15);
      const pores = fieldOf(N, (i) => Math.max(0, fib[i]) * 0.5 + Math.max(0, fib2[i]) * 0.4);
      const wc = hexRGB('#f2efe6');
      const albedo = paintImage(N, (i, o, p) => {
        const k = grain[i];
        let r = mix(dark[0], light[0], k);
        let g = mix(dark[1], light[1], k);
        let b = mix(dark[2], light[2], k);
        const gm = 1 - smoothstep(0.55, 0.9, grime[i]) * 0.35;
        r *= gm;
        g *= gm;
        b *= gm;
        if (painted > 0) {
          const worn = smoothstep(0.42, 0.62, wear[i] * 0.8 + pores[i] * 0.3 + (1 - painted) * 0.6);
          const pc = 1 - worn;
          r = mix(r, wc[0] * gm, pc);
          g = mix(g, wc[1] * gm, pc);
          b = mix(b, wc[2] * gm, pc);
        }
        px(o, p, r, g, b);
      });
      const height = fieldOf(N, (i) => grain[i] * 0.35 - pores[i] * 0.9);
      const rough = fieldOf(N, (i) => 0.62 + grain[i] * 0.2 + (painted ? 0.1 : 0));
      return { albedo, height, normalStrength: 2.2, orm: packORM(N, rough, 0) };
    });
  },

  /** Brick wall: running bond, per-brick colour, recessed mortar, soot and salt. `rows` x `bricks` per tile. */
  brick({ rows = 12, bricks = 4, tone = '#9c4a34' } = {}) {
    return pbrSet(`brick:${rows}:${bricks}:${tone}`, true, (N) => {
      const base = hexRGB(tone);
      const surf = fbm(N, { cx: 12, oct: 5, seed: 41 });
      const grit = white(N, 42);
      const soot = fbm(N, { cx: 4, cy: 2, oct: 5, seed: 43 });
      const salt = fbm(N, { cx: 7, oct: 5, seed: 44 });
      const height = new Float32Array(N * N);
      const bmask = new Float32Array(N * N);
      const id = new Float32Array(N * N);
      const mw = 0.07;
      const mh = 0.16;
      for (let y = 0; y < N; y++) {
        const v = (y / N) * rows;
        const row = Math.floor(v);
        const fv = v - row;
        for (let x = 0; x < N; x++) {
          const u = (x / N) * bricks + (row & 1 ? 0.5 : 0);
          const bi = ((Math.floor(u) % bricks) + bricks) % bricks;
          const fu = u - Math.floor(u);
          const eu = Math.min(fu, 1 - fu) / mw;
          const ev = Math.min(fv, 1 - fv) / mh;
          const e = Math.min(eu, ev);
          const i = y * N + x;
          bmask[i] = smoothstep(0.35, 1.0, e);
          id[i] = hash2(bi, row % rows, 40);
          height[i] = bmask[i] * 0.8 + surf[i] * 0.25 + grit[i] * 0.06;
        }
      }
      const albedo = paintImage(N, (i, o, p) => {
        const v = 0.78 + id[i] * 0.4 + (surf[i] - 0.5) * 0.22 + (grit[i] - 0.5) * 0.06;
        const sm = 1 - smoothstep(0.5, 0.95, soot[i]) * 0.5;
        const sl = smoothstep(0.62, 0.9, salt[i]) * 0.22;
        const mortar = 150 + (surf[i] - 0.5) * 40 + (grit[i] - 0.5) * 22;
        const k = bmask[i];
        px(o, p, (mix(mortar, base[0] * v, k) + sl * 60) * sm, (mix(mortar - 4, base[1] * v, k) + sl * 60) * sm, (mix(mortar - 14, base[2] * v, k) + sl * 56) * sm);
      });
      const rough = fieldOf(N, (i) => 0.9 - bmask[i] * 0.05);
      return { albedo, height, normalStrength: 3.2, orm: packORM(N, rough, 0) };
    });
  },

  /** Poured concrete: aggregate, cracks, stains. */
  concrete({ crack = 0.3, tone = '#9a9890' } = {}) {
    return pbrSet(`concrete:${crack}:${tone}`, true, (N) => {
      const base = hexRGB(tone);
      const a = fbm(N, { cx: 4, oct: 7, seed: 51 });
      const b = fbm(N, { cx: 14, oct: 4, seed: 52 });
      const stain = fbm(N, { cx: 3, cy: 2, oct: 5, seed: 53 });
      const grit = white(N, 54);
      const w = worley(N, 5, 55);
      const mask = fbm(N, { cx: 2, oct: 3, seed: 56 });
      const crackF = fieldOf(N, (i) => (1 - smoothstep(0.0, 0.025 + 0.03 * crack, w.f2[i] - w.f1[i])) * smoothstep(0.74, 0.88, mask[i] + crack * 0.15));
      const peb = stamps(new Float32Array(N * N), N, { count: N * 1.2, radius: 1.6, amount: 0.7, seed: 57 });
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.86 + (a[i] - 0.5) * 0.4 + (b[i] - 0.5) * 0.1 + (grit[i] - 0.5) * 0.12 - peb[i] * 0.1;
        const st = 1 - smoothstep(0.6, 0.95, stain[i]) * 0.28;
        const c = 1 - crackF[i] * 0.45;
        px(o, p, base[0] * k * st * c, base[1] * k * st * c, base[2] * k * st * c * 0.98);
      });
      const height = fieldOf(N, (i) => a[i] * 0.4 + b[i] * 0.2 + grit[i] * 0.08 - crackF[i] * 1.2 + peb[i] * 0.3);
      const rough = fieldOf(N, (i) => 0.86 + (grit[i] - 0.5) * 0.1);
      return { albedo, height, normalStrength: 2.6, orm: packORM(N, rough, 0) };
    });
  },

  /** Road tar: gravel, old patches, cracks and shallow puddles with a wet sheen (roughness drops in puddles). */
  asphalt({ wet = 0.5 } = {}) {
    return pbrSet(`asphalt:${wet}`, true, (N) => {
      const gr = white(N, 61);
      const stone = worley(N, N / 5, 62).f1;
      const patch = fbm(N, { cx: 3, oct: 5, seed: 63 });
      const puddle = fbm(N, { cx: 3, oct: 5, seed: 64 });
      const lowf = fbm(N, { cx: 6, oct: 4, seed: 65 });
      const w = worley(N, 3, 66);
      const crack = fieldOf(N, (i) => (1 - smoothstep(0, 0.045, w.f2[i] - w.f1[i])) * smoothstep(0.4, 0.62, lowf[i]));
      const pm = fieldOf(N, (i) => smoothstep(0.8 - wet * 0.12, 0.86 - wet * 0.12, puddle[i]));
      const albedo = paintImage(N, (i, o, p) => {
        const flake = smoothstep(0.55, 0.15, stone[i]);
        let v = 54 + (gr[i] - 0.5) * 16 + flake * 12 + (patch[i] - 0.5) * 12;
        v *= 1 - crack[i] * 0.55;
        v *= 1 - pm[i] * 0.45;
        px(o, p, v, v * 0.99, v * 1.02);
      });
      const height = fieldOf(N, (i) => ((1 - stone[i]) * 0.5 + gr[i] * 0.15) * (1 - pm[i] * 0.92) - crack[i] * 0.9 * (1 - pm[i]) - pm[i] * 0.1);
      const rough = fieldOf(N, (i) => mix(0.78 - patch[i] * 0.1 - wet * 0.18, 0.06, pm[i]));
      return { albedo, height, normalStrength: 3.0, orm: packORM(N, rough, 0) };
    });
  },

  /** Blue woven HDPE tarpaulin. tone tints (white base * tone is done by the vertex colour). */
  tarp({ tone = '#2a6bb8' } = {}) {
    return pbrSet(`tarp:${tone}`, false, (N) => {
      const wv = weaveField(N, N >= 256 ? 64 : 32, 0.2, 71);
      const mott = fbm(N, { cx: 5, oct: 5, seed: 72 });
      const base = hexRGB(tone);
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.82 + wv.h[i] * 0.2 + (wv.tone[i] - 0.5) * 0.08 + (mott[i] - 0.5) * 0.25;
        px(o, p, base[0] * k, base[1] * k, base[2] * k);
      });
      const rough = fieldOf(N, (i) => 0.48 + (1 - wv.h[i]) * 0.2);
      return { albedo, height: wv.h, normalStrength: 2.6, orm: packORM(N, rough, 0) };
    });
  },

  /** Plain cloth / canvas weave (grey-white; tint with the vertex colour). */
  cloth({ threads = 64, jit = 0.3 } = {}) {
    return pbrSet(`cloth:${threads}:${jit}`, false, (N) => {
      const wv = weaveField(N, Math.min(threads, N / 2), jit, 81);
      const mott = fbm(N, { cx: 4, oct: 5, seed: 82 });
      const grime = fbm(N, { cx: 3, cy: 6, oct: 4, seed: 83 });
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.78 + wv.h[i] * 0.22 + (wv.tone[i] - 0.5) * 0.12 + (mott[i] - 0.5) * 0.14 - smoothstep(0.55, 0.95, grime[i]) * 0.2;
        px(o, p, 235 * k, 233 * k, 228 * k);
      });
      const rough = fieldOf(N, () => 0.92);
      return { albedo, height: wv.h, normalStrength: 2.2, orm: packORM(N, rough, 0) };
    });
  },

  /** Coarse jute / gunny sack weave. */
  jute() {
    return pbrSet('jute', false, (N) => {
      const wv = weaveField(N, N >= 256 ? 32 : 16, 0.5, 91);
      const mott = fbm(N, { cx: 4, oct: 5, seed: 92 });
      const fuzz = white(N, 93);
      const warp = perlin(N, 6, 6, 94);
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.62 + wv.h[i] * 0.42 + (wv.tone[i] - 0.5) * 0.3 + (mott[i] - 0.5) * 0.3 + (fuzz[i] - 0.5) * 0.12 + warp[i] * 0.04;
        px(o, p, 190 * k, 152 * k, 98 * k);
      });
      const rough = fieldOf(N, () => 0.95);
      return { albedo, height: wv.h, normalStrength: 3.2, orm: packORM(N, rough, 0) };
    });
  },

  /** Moulded plastic: orange-peel, scuffs, dirt in the low spots. Tint with the vertex colour. */
  plastic() {
    return pbrSet('plastic', true, (N) => {
      const peel = fbm(N, { cx: N / 5, oct: 2, seed: 101 });
      const dirt = fbm(N, { cx: 4, oct: 6, seed: 102 });
      const scuff = scratches(new Float32Array(N * N), N, { count: N / 3, len: 0.07, angle: 0.5, spread: 3, amount: 0.7, seed: 103 });
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.94 - smoothstep(0.55, 0.95, dirt[i]) * 0.2 + (peel[i] - 0.5) * 0.04 + scuff[i] * 0.1;
        px(o, p, 252 * k, 250 * k, 244 * k);
      });
      const height = fieldOf(N, (i) => peel[i] * 0.18 - scuff[i] * 0.35);
      const rough = fieldOf(N, (i) => 0.36 + smoothstep(0.55, 0.95, dirt[i]) * 0.2 + scuff[i] * 0.3);
      return { albedo, height, normalStrength: 0.6, orm: packORM(N, rough, 0) };
    });
  },

  /** Black rubber / vinyl / cable sheath. */
  rubber() {
    return pbrSet('rubber', false, (N) => {
      const g = white(N, 111);
      const m = fbm(N, { cx: 4, oct: 5, seed: 112 });
      const albedo = paintImage(N, (i, o, p) => {
        const k = 26 + (g[i] - 0.5) * 8 + (m[i] - 0.5) * 14;
        px(o, p, k, k, k * 1.02);
      });
      const rough = fieldOf(N, (i) => 0.82 + (m[i] - 0.5) * 0.2);
      return { albedo, height: fieldOf(N, (i) => g[i] * 0.4 + m[i] * 0.3), normalStrength: 1.4, orm: packORM(N, rough, 0) };
    });
  },

  /** Tyre: u wraps around the rim, v across the tread. Chevron blocks + sidewall dust. */
  tyre() {
    return pbrSet('tyre', true, (N) => {
      const g = white(N, 121);
      const m = fbm(N, { cx: 6, oct: 4, seed: 122 });
      const height = fieldOf(N, (i, x, y) => {
        const u = (x / N) * 48;
        const v = y / N;
        const chevron = Math.abs(v - 0.5) * 2.2;
        const t = (u + chevron * 1.2) % 1;
        const block = smoothstep(0.1, 0.22, t) * (1 - smoothstep(0.62, 0.74, t));
        const tread = smoothstep(0.1, 0.18, v) * (1 - smoothstep(0.82, 0.9, v));
        return mix(0.5, block, tread) + g[i] * 0.06;
      });
      const albedo = paintImage(N, (i, o, p) => {
        const k = 28 + (g[i] - 0.5) * 8 + (m[i] - 0.5) * 22 + height[i] * 8;
        px(o, p, k, k, k);
      });
      return { albedo, height, normalStrength: 3.4, orm: packORM(N, 0.88, 0) };
    });
  },

  /** Cow hide: white with brown patches (use 'keep'/box UV with a large tile so the patches do not repeat visibly). */
  hide({ patch = '#8a5a34', coat = '#ece6d6', amount = 0.5 } = {}) {
    return pbrSet(`hide:${patch}:${coat}:${amount}`, true, (N) => {
      const pa = hexRGB(patch);
      const co = hexRGB(coat);
      const big = fbm(N, { cx: 2, oct: 4, seed: 131 });
      const edge = fbm(N, { cx: 9, oct: 4, seed: 132 });
      const hair = perlin(N, N / 3, N / 3, 133);
      const hair2 = white(N, 134);
      const dirt = fbm(N, { cx: 5, oct: 5, seed: 135 });
      const albedo = paintImage(N, (i, o, p) => {
        const m = smoothstep(0.5 + (1 - amount) * 0.12, 0.54 + (1 - amount) * 0.12, big[i] + (edge[i] - 0.5) * 0.18);
        const k = 0.94 + (hair[i] * 0.5) * 0.06 + (hair2[i] - 0.5) * 0.06 - smoothstep(0.6, 0.95, dirt[i]) * 0.14;
        px(o, p, mix(co[0], pa[0], m) * k, mix(co[1], pa[1], m) * k, mix(co[2], pa[2], m) * k);
      });
      const height = fieldOf(N, (i) => hair[i] * 0.2 + hair2[i] * 0.12);
      return { albedo, height, normalStrength: 0.35, orm: packORM(N, 0.72, 0) };
    });
  },

  /** Bamboo culm (cylinder UV: u around, v along): green-yellow fibres, speckle, sun bleaching. */
  bamboo({ tone = '#a9a84a' } = {}) {
    return pbrSet(`bamboo:${tone}`, false, (N) => {
      const base = hexRGB(tone);
      const fib = perlin(N, N / 6, 2, 141);
      const fib2 = perlin(N, 5, 2, 142);
      const bleach = fbm(N, { cx: 2, cy: 3, oct: 4, seed: 143 });
      const spk = white(N, 144);
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.8 + fib[i] * 0.15 + fib2[i] * 0.1 + (spk[i] - 0.5) * 0.05;
        const b = smoothstep(0.5, 0.9, bleach[i]) * 0.25;
        px(o, p, base[0] * k + b * 80, base[1] * k + b * 70, base[2] * k + b * 30);
      });
      const height = fieldOf(N, (i) => fib[i] * 0.4 + fib2[i] * 0.2);
      return { albedo, height, normalStrength: 1.4, orm: packORM(N, fieldOf(N, (i) => 0.45 + fib[i] * 0.12), 0) };
    });
  },

  /** Pebbled black vinyl (seats, auto hood lining). */
  vinyl() {
    return pbrSet('vinyl', false, (N) => {
      const w = worley(N, N / 8, 151);
      const m = fbm(N, { cx: 4, oct: 4, seed: 152 });
      const height = fieldOf(N, (i) => smoothstep(0.0, 0.55, 1 - w.f1[i]) * 0.9 + (1 - smoothstep(0, 0.12, w.f2[i] - w.f1[i])) * -0.3);
      const albedo = paintImage(N, (i, o, p) => {
        const k = 24 + height[i] * 8 + (m[i] - 0.5) * 12;
        px(o, p, k, k * 0.98, k * 0.97);
      });
      return { albedo, height, normalStrength: 2.4, orm: packORM(N, fieldOf(N, (i) => 0.42 + (1 - height[i]) * 0.2), 0) };
    });
  },

  /** Twisted rope / cord (v around, u along): diagonal strands. */
  rope({ tone = '#c9a56a' } = {}) {
    return pbrSet(`rope:${tone}`, false, (N) => {
      const base = hexRGB(tone);
      const g = white(N, 161);
      const height = fieldOf(N, (i, x, y) => {
        const t = ((x / N) * 6 + (y / N) * 3) % 1;
        return Math.sin(t * Math.PI) * 0.9 + g[i] * 0.2;
      });
      const albedo = paintImage(N, (i, o, p) => {
        const k = 0.55 + height[i] * 0.5;
        px(o, p, base[0] * k, base[1] * k, base[2] * k);
      });
      return { albedo, height, normalStrength: 2.4, orm: packORM(N, 0.92, 0) };
    });
  },

  /** Short animal-fur strands: R = strand height (for alpha-tested shells), G = coat variation. One repeating texture, not a PBR set. */
  fur() {
    const N = texRes(false);
    return sharedTexture(`fur@${N}`, () => {
      if (!canPaint()) return imageTexture(1, new Uint8ClampedArray([255, 255, 255, 255]));
      const w = white(N, 171);
      const s = normalize01(blur(w, N, 1));
      const coat = fbm(N, { cx: 4, oct: 5, seed: 172 });
      const out = new Uint8ClampedArray(N * N * 4);
      for (let i = 0; i < N * N; i++) {
        out[i * 4] = (s[i] * 0.65 + w[i] * 0.35) * 255;
        out[i * 4 + 1] = coat[i] * 255;
        out[i * 4 + 2] = 128;
        out[i * 4 + 3] = 255;
      }
      return imageTexture(N, out, { kind: 'white' });
    });
  },
};

// small local helper used by the paint recipe
function gr(v) {
  return 1 - smoothstep(0.55, 0.95, v);
}

export const pbr = R;
