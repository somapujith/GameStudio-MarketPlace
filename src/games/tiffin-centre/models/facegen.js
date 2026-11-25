// Parametric head: face parameters per kind + seed, and the sculpt (profile loft + feature displacement) used by face.js and hair.js.
// Head space: metres, origin on the eye line between the eyes, +y up, +z forward, +x the character's left. Adult reference proportions:
// crown +0.114, brow +0.029, eye line 0, nose base -0.050, mouth line -0.0745, chin -0.118. Vertical scaling (`warp`) is applied last.
import { rng } from './util.js';
import { SKIN_TONES, IRIS_COLORS } from './skin.js';

export const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const gauss = (d, s) => Math.exp(-(d * d) / (s * s));
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const MOUTH_Y = -0.0745;
export const MOUTH_EPS = 0.0005;
export const EYE_X = 0.032;
export const EYE_R = 0.0132;

const HAIR_COLORS = ['#14100d', '#1a130e', '#241a12', '#2d2118', '#0e0e10'];

/**
 * Face parameters for a kind of customer. `opts` overrides anything (gender, age, ...). Pure and deterministic per (kind, seed).
 * kind: office | student | family | uncle | autowala | techie | cook | child
 */
export function makeFaceParams(kind = 'office', seed = 0, opts = {}) {
  const r = rng(`face:${kind}:${seed}`);
  const gender = opts.gender || (kind === 'uncle' || kind === 'autowala' ? 'm' : r() < (kind === 'family' ? 0.55 : kind === 'student' ? 0.45 : kind === 'techie' ? 0.4 : kind === 'office' ? 0.4 : 0.1) ? 'f' : 'm');
  const f = gender === 'f';
  let age = opts.age;
  if (age == null) {
    age = { office: r.range(26, 46), student: r.range(17, 23), family: r.range(30, 44), uncle: r.range(58, 74), autowala: r.range(30, 52), techie: r.range(24, 35), cook: r.range(26, 48), child: r.range(5, 9) }[kind] ?? r.range(25, 45);
  }
  const child = opts.child ?? clamp((14 - age) / 9, 0, 1) * (age < 14 ? 1 : 0);
  const ageN = clamp((age - 30) / 40, 0, 1); // 0 at 30, 1 at 70
  const toneRange = { uncle: [1, 5], autowala: [2, 6], cook: [2, 6], student: [0, 5], techie: [0, 4], office: [0, 5], family: [0, 5], child: [0, 5] }[kind] || [0, 5];
  const tone = opts.tone || SKIN_TONES[Math.floor(toneRange[0] + r() * (toneRange[1] - toneRange[0] + 0.999))];
  const grey = opts.grey ?? clamp(ageN * 1.15 - 0.15 + (kind === 'uncle' ? 0.55 : 0), 0, 1) * (r() < 0.9 ? 1 : 0.6);
  const P = {
    kind,
    seed,
    gender,
    age,
    child,
    ageN,
    tone,
    hairColor: opts.hairColor || r.pick(HAIR_COLORS),
    grey,
    W: (f ? 0.94 : 1) * r.range(0.95, 1.06) * (1 - child * 0.1),
    len: r.range(0.94, 1.08) * (1 - child * 0.1),
    fore: r.range(0.94, 1.08) * (1 + child * 0.12),
    jaw: (f ? 0.9 : 1.02) * r.range(0.9, 1.1) * (1 - child * 0.12),
    jawSq: (f ? 0.15 : 0.4) * r.range(0.4, 1.6),
    chin: (f ? 0.75 : 1) * r.range(0.7, 1.3) * (1 - child * 0.45),
    cheek: r.range(0.75, 1.35) * (1 + child * 0.6) * (1 - ageN * 0.25),
    hollow: ageN * 0.8 + (f ? 0 : 0.1),
    brow: (f ? 0.5 : 1) * r.range(0.6, 1.25) * (1 - child * 0.7),
    browThick: (f ? 0.8 : 1.05) * r.range(0.75, 1.3) * (1 - child * 0.2),
    browArch: r.range(0.1, 0.9) * (f ? 1.1 : 0.7),
    browTilt: r.range(-0.2, 0.5),
    noseLen: r.range(0.9, 1.1),
    noseBridge: r.range(0.75, 1.3) * (1 - child * 0.5),
    noseW: r.range(0.85, 1.25),
    noseTip: r.range(0.75, 1.25) * (1 - child * 0.3),
    lipFull: (f ? 1.15 : 0.9) * r.range(0.75, 1.3),
    lipW: r.range(0.92, 1.1) * (1 - child * 0.1),
    mouthCurve: r.range(-0.4, 0.6),
    eyeSize: r.range(0.95, 1.08) * (1 + child * 0.2),
    eyeTilt: r.range(-0.05, 0.14),
    eyeSpace: r.range(0.95, 1.08),
    lidHeavy: ageN * 0.25 + r() * 0.12,
    earSize: r.range(0.9, 1.12),
    iris: opts.iris || IRIS_COLORS[r() < 0.85 ? Math.floor(r() * 2) : Math.floor(r() * IRIS_COLORS.length)],
    sclera: ageN > 0.5 ? '#ece1cc' : '#f2ede6',
    bindi: null,
    earrings: false,
    noseStud: false,
    glasses: null,
    mustache: null,
    beard: null,
    stubble: 0,
    wrinkles: clamp(ageN * 1.1 - 0.05, 0, 1),
  };
  // grooming per kind (kept inside the generator so a seed gives a repeatable person)
  if (!f) {
    const m = r();
    if (kind === 'uncle') {
      P.mustache = m < 0.7 ? 'thick' : 'thin';
      P.beard = r() < 0.4 ? 'short' : null;
      P.stubble = r() < 0.5 ? 0.35 : 0;
    } else if (kind === 'autowala') {
      P.mustache = m < 0.7 ? 'thick' : m < 0.85 ? 'handlebar' : 'thin';
      P.stubble = 0.35 + r() * 0.35;
    } else if (kind === 'family') {
      P.mustache = m < 0.55 ? 'thick' : null;
      P.stubble = r() < 0.4 ? 0.25 : 0;
    } else if (kind === 'office') {
      P.mustache = m < 0.3 ? 'thin' : null;
      P.stubble = r() < 0.2 ? 0.3 : 0;
    } else if (kind === 'cook') {
      P.mustache = m < 0.65 ? 'thick' : m < 0.8 ? 'handlebar' : null;
      P.stubble = r() < 0.5 ? 0.35 : 0;
    } else if (kind === 'techie') {
      P.mustache = null;
      P.beard = m < 0.25 ? 'trim' : null;
      P.stubble = r() < 0.5 ? 0.4 : 0;
    } else if (kind === 'student' && age > 18) {
      P.stubble = r() < 0.35 ? 0.2 : 0;
      P.mustache = m < 0.12 ? 'thin' : null;
    }
    if (child > 0.3) {
      P.mustache = null;
      P.beard = null;
      P.stubble = 0;
    }
  } else {
    P.bindi = kind === 'student' ? (r() < 0.35 ? 'dot' : null) : kind === 'techie' ? (r() < 0.25 ? 'dot' : null) : r() < 0.7 ? 'dot' : null;
    P.earrings = r() < 0.8;
    P.noseStud = r() < 0.45;
  }
  if (kind === 'uncle' && r() < 0.35) P.bindi = 'vibhuti';
  if (kind === 'uncle' && P.bindi == null && r() < 0.3) P.bindi = 'tilak';
  if (kind === 'autowala' || kind === 'cook') P.earrings = r() < 0.15;
  const gl = { uncle: 0.55, techie: 0.55, office: 0.3, student: 0.22, family: 0.2, autowala: 0.08, cook: 0.05, child: 0.05 }[kind] ?? 0.15;
  if (r() < gl) P.glasses = r.pick(f ? ['round', 'cat', 'rect'] : ['rect', 'round', 'wire']);
  Object.assign(P, opts.override || {});
  return P;
}

// ---------------------------------------------------------------------------------------------------------------------
// Profile loft: for every std height y -> half width W, front z, back z, and superellipse squareness.
export const ROWS = [
  0.1085, 0.0975, 0.084, 0.07, 0.0585, 0.0475, 0.039, 0.032, 0.0255, 0.019, 0.012, 0.005, -0.002, -0.01, -0.019, -0.028, -0.036, -0.043, -0.05, -0.0545, -0.0595, -0.065, -0.07,
  'M0', 'M1', -0.079, -0.0835, -0.088, -0.093, -0.099, -0.106, -0.112, -0.118, -0.1235, -0.128,
];
export const CROWN = 0.114;
export const BOTTOM = -0.1315;

function hermite(keys) {
  // keys: [[y, v], ...] ascending in y; Catmull-Rom with non-uniform tangents
  const n = keys.length;
  const tan = keys.map((k, i) => {
    const a = keys[Math.max(0, i - 1)];
    const b = keys[Math.min(n - 1, i + 1)];
    return (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]);
  });
  return (y) => {
    if (y <= keys[0][0]) return keys[0][1];
    if (y >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (y > keys[i + 1][0]) i++;
    const [y0, v0] = keys[i];
    const [y1, v1] = keys[i + 1];
    const h = y1 - y0;
    const t = (y - y0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * tan[i] + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * tan[i + 1];
  };
}

export function makeShape(P) {
  const jw = P.jaw;
  const Wk = [
    [-0.1315, 0.002],
    [-0.126, 0.02 * jw],
    [-0.121, 0.0285 * jw],
    [-0.114, 0.043 * jw],
    [-0.103, 0.0505 * jw],
    [-0.09, 0.0585 * jw],
    [-0.075, 0.0612 * (0.8 + 0.2 * jw)],
    [-0.06, 0.0655],
    [-0.04, 0.0708],
    [-0.02, 0.0738],
    [0.0, 0.0748],
    [0.02, 0.0745],
    [0.045, 0.0735],
    [0.07, 0.0675],
    [0.09, 0.0575],
    [0.104, 0.0405],
    [0.1125, 0.0195],
    [CROWN, 0.002],
  ].map(([y, w]) => [y, w * P.W]);
  const chinZ = 0.078 + 0.006 * (P.chin - 1);
  const Zf = hermite([
    [-0.1315, 0.01],
    [-0.126, 0.032],
    [-0.121, 0.053],
    [-0.114, 0.0745],
    [-0.103, chinZ + 0.0035],
    [-0.09, 0.0828],
    [-0.075, 0.0835],
    [-0.06, 0.0838],
    [-0.04, 0.0838],
    [-0.02, 0.0868],
    [0.0, 0.0888],
    [0.02, 0.0918],
    [0.045, 0.0915],
    [0.07, 0.0855],
    [0.09, 0.0735],
    [0.104, 0.052],
    [0.1125, 0.028],
    [CROWN, 0.0],
  ]);
  const Zb = hermite([
    [-0.1315, 0.0],
    [-0.126, -0.01],
    [-0.121, -0.022],
    [-0.114, -0.034],
    [-0.103, -0.046],
    [-0.09, -0.058],
    [-0.075, -0.07],
    [-0.06, -0.08],
    [-0.04, -0.089],
    [-0.02, -0.095],
    [0.0, -0.099],
    [0.02, -0.1],
    [0.045, -0.097],
    [0.07, -0.088],
    [0.09, -0.07],
    [0.104, -0.048],
    [0.1125, -0.024],
    [CROWN, -0.004],
  ]);
  const Wf = hermite(Wk);
  const sq = (y) => 2 / (2 + P.jawSq * smooth(-0.04, -0.09, y) * 1.2); // superellipse exponent: >1 flattens into a boxier jaw
  const baseOut = { x: 0, y: 0, z: 0, sx: 0, sz: 1 };
  function base(theta, y, out = baseOut) {
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const e = sq(y);
    const W = Wf(y);
    const zf = Zf(y);
    const zb = Zb(y);
    const zc = (zf + zb) / 2;
    out.x = W * Math.sign(s) * Math.abs(s) ** e;
    out.z = zc + (c >= 0 ? zf - zc : zc - zb) * Math.sign(c) * Math.abs(c) ** e;
    out.y = y;
    out.sx = s;
    out.sz = c;
    return out;
  }

  const cheekAmt = P.cheek;
  const ageHollow = P.hollow;
  const ageA = P.ageN;
  const lipU = P.lipFull;
  // feature height field: z displacement (along the surface normal in xz) at (ax, y)
  function feat(ax, y, x) {
    const g = gauss;
    let d = 0;
    // brow ridge and frontal bone
    const bY = 0.0215 + 0.0032 * smooth(0, 0.05, ax) * (0.6 + P.browArch) + P.browTilt * 0.0016 * smooth(0, 0.06, ax);
    d += 0.0058 * P.brow * g(y - bY, 0.0078) * (smooth(0.0, 0.012, ax) * 0.6 + 0.4) * smooth(0.074, 0.05, ax);
    d += 0.0028 * g(ax - 0.026, 0.021) * g(y - 0.056, 0.02);
    // eye socket, nasal root dip
    d -= 0.0095 * g(ax - EYE_X * P.eyeSpace, 0.0208) * g(y - 0.0005, 0.0128);
    d -= 0.0052 * g(x, 0.0105) * g(y - 0.0045, 0.0085);
    // cheekbone, malar fat, hollow below, temple
    d += 0.0052 * cheekAmt * g(ax - 0.0555, 0.0175) * g(y + 0.0225, 0.0165);
    d += 0.0048 * cheekAmt * g(ax - 0.041, 0.02) * g(y + 0.041, 0.018);
    d -= 0.0032 * ageHollow * g(ax - 0.042, 0.018) * g(y + 0.062, 0.012);
    d -= 0.0022 * ageHollow * g(ax - 0.066, 0.012) * g(y - 0.02, 0.016);
    d -= 0.0016 * ageHollow * g(ax - 0.034, 0.014) * g(y + 0.013, 0.006);
    // nose: ridge with a bulbous tip, alae and a short columella
    const u = clamp((0.01 - y) / 0.05, 0, 1);
    const Hn = 0.0228 * P.noseTip * (1 - P.child * 0.25);
    const hy = (0.0035 + (Hn - 0.0035) * u ** 1.15) * P.noseBridge ** (1 - u);
    const wN = (0.0062 + 0.0046 * u) * P.noseW;
    const under = smooth(-0.0555, -0.0472, y) ** 1.25;
    d += hy * g(x, wN) * under * (1 - smooth(0.006, 0.02, y));
    d += 0.0046 * P.noseTip * g(x, 0.0098) * g(y + 0.041 * P.noseLen, 0.0088);
    d += 0.0046 * P.noseW * g(ax - 0.0148 * P.noseW, 0.0066) * g(y + 0.0455, 0.0072);
    d -= 0.004 * g(ax - 0.0088, 0.0045) * g(y + 0.0486, 0.0034);
    // upper lip, lower lip, philtrum, muzzle bulge, corner dimples
    const lw = P.lipW;
    d += 0.0062 * lipU * g(y + 0.067, 0.0052) * Math.exp(-((ax / (0.0215 * lw)) ** 4));
    d += 0.0072 * lipU * g(y + 0.0805, 0.0056) * Math.exp(-((ax / (0.0205 * lw)) ** 4));
    d += 0.0032 * g(ax, 0.034) * g(y - MOUTH_Y, 0.014);
    d -= 0.0028 * g(x, 0.0022) * smooth(-0.0505, -0.0555, y) * (1 - smooth(-0.0605, -0.0645, y));
    d += 0.0018 * g(ax - 0.0058, 0.0024) * smooth(-0.0505, -0.0555, y) * (1 - smooth(-0.0605, -0.0645, y));
    d -= 0.0016 * g(ax - 0.0275 * lw, 0.003) * g(y - MOUTH_Y, 0.0042);
    // chin, mentolabial dip, jowls, nasolabial fold with the cheek ridge beside it
    d += 0.0078 * P.chin * g(x, 0.0175) * g(y + 0.1065, 0.0105);
    d -= 0.0038 * g(x, 0.02) * g(y + 0.0928, 0.0036);
    d += 0.0034 * ageA * g(ax - 0.041, 0.012) * g(y + 0.092, 0.012);
    const fx = 0.0185 + (-0.047 - y) * 0.55;
    d -= 0.0032 * g(ax - fx, 0.0038) * smooth(-0.043, -0.052, y) * smooth(-0.092, -0.074, y) * (0.5 + 0.8 * ageA);
    d += 0.0022 * cheekAmt * g(ax - fx - 0.011, 0.007) * smooth(-0.043, -0.052, y) * smooth(-0.088, -0.074, y);
    return d;
  }

  const vwarp = (y) => (y >= 0 ? y * P.fore : y * P.len);
  const tmp = { x: 0, y: 0, z: 0, sx: 0, sz: 1 };
  /** Full head surface point at angle theta and std height y (features on the front, vertical warp last). */
  function point(theta, y, out = { x: 0, y: 0, z: 0 }, withFeat = true) {
    base(theta, y, tmp);
    let { x, z } = tmp;
    if (withFeat) {
      const fm = smooth(-0.15, 0.5, tmp.sz);
      if (fm > 0) {
        const d = feat(Math.abs(x), y, x) * fm;
        x += tmp.sx * d;
        z += tmp.sz * d;
      }
      // mouth line curvature (corners up or down) bends the lip rows
      const ym = y - MOUTH_Y;
      const ax = Math.abs(x);
      const bend = P.mouthCurve * 0.0032 * smooth(0.032, 0.0, ax) * (ax / 0.026) ** 2 * gauss(ym, 0.011) * fm;
      y += bend;
    }
    out.x = x;
    out.y = vwarp(y);
    out.z = z;
    return out;
  }
  /** Front surface z at lateral x and std y (for placing brows, eyes, moustache ...). Includes the features. */
  function surfaceZ(x, y, withFeat = true) {
    const ax = Math.abs(x);
    const W = Wf(y);
    const e = sq(y);
    const s = Math.min(0.999, (ax / W) ** (1 / e));
    const c = Math.sqrt(1 - s * s);
    const zf = Zf(y);
    const zb = Zb(y);
    const zc = (zf + zb) / 2;
    const bz = zc + (zf - zc) * c ** e;
    const d = withFeat ? feat(ax, y, x) * smooth(-0.15, 0.5, c) : 0;
    return bz + c * d;
  }
  return { P, base, point, feat, surfaceZ, vwarp, Wf, Zf, Zb, unwarp: (y) => (y >= 0 ? y / P.fore : y / P.len), sq };
}
