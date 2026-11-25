// Low-poly bodies for the traffic: ONE merged geometry per kind (plain boxes and 8-sided wheels, no rounded corners), drawn with ONE
// shared material. Every vertex has a fixed colour (glass, tyres, trim, the people inside) and a `aPaint` mask: where the mask is 1 the
// per-instance colour `aTint` is multiplied in (the lacquer), elsewhere the fixed colour shows. So a kind is a single draw call.
// Triangle budgets (per instance): car 450, bike 250, bus 600, truck 600, auto 700, pedestrian 80, cow 150 (see the unit test).
// Local space: +z is forward, +x is the vehicle's LEFT (the driver of these right-hand-drive vehicles sits at -x).
import { BoxGeometry, BufferAttribute, Color, CylinderGeometry, Euler, Matrix4, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpC = new Color();
const M = new Matrix4();
const E = new Matrix4();

/** A geometry with a flat vertex colour and a paint mask, moved into place. Non-indexed: position, normal, color, aPaint. */
export function part(geo, hex, paint, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  if (rx || ry || rz) {
    E.makeRotationFromEuler(new Euler(rx, ry, rz));
    g.applyMatrix4(E);
  }
  M.makeTranslation(x, y, z);
  g.applyMatrix4(M);
  tmpC.set(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const mask = new Float32Array(n).fill(paint ? 1 : 0);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aPaint', new BufferAttribute(mask, 1));
  return g;
}

export const merge = (parts) => {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!g) throw new Error('traffic-models: mergeGeometries failed (every part must be non-indexed with the same attributes)');
  g.computeBoundingSphere();
  return g;
};

const box = (w, h, d) => new BoxGeometry(w, h, d);
const wheel = (r, w) => new CylinderGeometry(r, r, w, 8, 1).rotateZ(Math.PI / 2);

const GLASS = '#1b2433';
const TYRE = '#101013';
const TRIM = '#2b2b33';
const CHROME = '#c9ccd8';
const SKINS = ['#a86e4a', '#c08a62', '#8d5a3c'];

/** A seated head and shoulders. */
function driver(d, x, y, z, shirt = '#c9a86a') {
  d.push(part(box(0.36, 0.42, 0.26), shirt, false, x, y, z));
  d.push(part(box(0.24, 0.24, 0.24), SKINS[1], false, x, y + 0.36, z + 0.02));
}

// ---------------------------------------------------------------------------------------------------------------- car (hatchback)
function car() {
  const p = [
    part(box(1.66, 0.5, 3.7), '#ffffff', true, 0, 0.58, 0),
    part(box(1.5, 0.5, 2.0), '#ffffff', true, 0, 1.06, -0.3),
    part(box(1.1, 0.12, 0.9), '#ffffff', true, 0, 0.9, 1.3, -0.12), // bonnet
    part(box(1.53, 0.32, 1.95), GLASS, false, 0, 1.08, -0.3),
    part(box(1.0, 0.34, 0.06), GLASS, false, 0, 1.0, 0.7, -0.5), // windscreen
    part(box(1.7, 0.12, 0.12), TRIM, false, 0, 0.4, 1.88),
    part(box(1.7, 0.12, 0.12), TRIM, false, 0, 0.4, -1.88),
    part(box(1.1, 0.06, 0.05), CHROME, false, 0, 0.76, 1.86),
  ];
  for (const sx of [-1, 1]) for (const z of [1.2, -1.2]) p.push(part(wheel(0.3, 0.2), TYRE, false, sx * 0.8, 0.3, z));
  driver(p, -0.4, 0.98, 0.15);
  return { geo: merge(p), len: 3.9, height: 1.45 };
}

// ---------------------------------------------------------------------------------------------------------------- bus
function bus() {
  const p = [
    part(box(2.5, 2.05, 10.4), '#ffffff', true, 0, 1.9, 0),
    part(box(2.46, 0.4, 10.2), '#ffffff', true, 0, 0.72, 0),
    part(box(2.52, 0.86, 9.5), GLASS, false, 0, 2.3, -0.2),
    part(box(2.2, 1.0, 0.1), GLASS, false, 0, 2.2, 5.18),
    part(box(2.52, 0.16, 10.3), '#f6e7cf', false, 0, 1.62, 0),
    part(box(2.52, 0.12, 10.3), '#f6e7cf', false, 0, 2.96, 0),
    part(box(1.5, 0.24, 0.1), '#ffb100', false, 0, 2.88, 5.22),
    part(box(2.5, 0.14, 0.14), TRIM, false, 0, 0.5, 5.24),
    part(box(2.5, 0.14, 0.14), TRIM, false, 0, 0.5, -5.24),
  ];
  for (const sx of [-1, 1]) for (const z of [3.5, -3.1, -4.2]) p.push(part(wheel(0.5, 0.3), TYRE, false, sx * 1.1, 0.5, z));
  driver(p, -0.7, 1.55, 4.0);
  return { geo: merge(p), len: 10.5, height: 3.1 };
}

// ---------------------------------------------------------------------------------------------------------------- truck (truck art)
function truck() {
  const p = [
    part(box(2.3, 1.7, 2.2), '#ffffff', true, 0, 1.55, 2.95), // cab
    part(box(2.4, 2.15, 5.5), '#ffffff', true, 0, 2.25, -1.25), // cargo box
    part(box(2.32, 0.6, 1.5), GLASS, false, 0, 1.95, 3.15),
    part(box(2.2, 0.35, 8.0), TRIM, false, 0, 0.62, 0.3),
    part(box(2.2, 0.5, 0.08), '#ffc400', false, 0, 1.0, 4.08),
    part(box(0.14, 1.4, 0.14), CHROME, false, -1.05, 2.4, 2.1),
    part(box(2.4, 0.16, 5.5), '#ffc400', false, 0, 3.38, -1.25),
    part(box(2.0, 0.5, 0.06), '#ffc400', false, 0, 2.55, -4.02),
    part(box(0.5, 0.5, 0.06), '#e8213a', false, 0, 1.7, -4.02),
  ];
  // truck art: bands of colour along both sides of the cargo box
  const bands = ['#ffc400', '#e8213a', '#18a05e'];
  for (const sx of [-1, 1]) bands.forEach((c, i) => p.push(part(box(0.05, 0.3, 5.2), c, false, sx * 1.22, 1.75 + i * 0.4, -1.25)));
  for (const sx of [-1, 1]) for (const z of [3.0, -1.7, -3.1]) p.push(part(wheel(0.55, 0.32), TYRE, false, sx * 1.05, 0.55, z));
  driver(p, -0.55, 1.45, 3.2, '#d9d9e8');
  return { geo: merge(p), len: 8.2, height: 3.4 };
}

// ---------------------------------------------------------------------------------------------------------------- bike with rider
function bike() {
  const p = [
    part(box(0.32, 0.3, 0.75), '#ffffff', true, 0, 0.82, 0.12),
    part(box(0.3, 0.22, 0.4), '#ffffff', true, 0, 0.55, -0.62),
    part(box(0.26, 0.12, 0.62), TRIM, false, 0, 0.76, -0.4),
    part(box(0.1, 0.5, 0.1), CHROME, false, 0, 0.55, 0.62),
    part(box(0.72, 0.05, 0.06), TRIM, false, 0, 1.03, 0.55),
    part(wheel(0.32, 0.12), TYRE, false, 0, 0.32, 0.66),
    part(wheel(0.32, 0.14), TYRE, false, 0, 0.32, -0.66),
    part(box(0.36, 0.56, 0.3), '#e8453c', false, 0, 1.28, -0.12, 0.25),
    part(box(0.26, 0.26, 0.28), '#1b1b22', false, 0, 1.7, 0.02), // helmet
    part(box(0.12, 0.5, 0.18), '#2a3350', false, 0.17, 0.82, 0.05, -0.9),
    part(box(0.12, 0.5, 0.18), '#2a3350', false, -0.17, 0.82, 0.05, -0.9),
    part(box(0.1, 0.45, 0.1), SKINS[1], false, 0.27, 1.25, 0.32, -1.1),
    part(box(0.1, 0.45, 0.1), SKINS[1], false, -0.27, 1.25, 0.32, -1.1),
  ];
  return { geo: merge(p), len: 2.0, height: 1.8 };
}

// ---------------------------------------------------------------------------------------------------------------- auto-rickshaw
function auto() {
  const p = [
    part(box(1.5, 0.8, 1.9), '#ffffff', true, 0, 0.98, -0.45),
    part(box(1.1, 0.72, 0.95), '#ffffff', true, 0, 0.96, 0.92),
    part(box(1.62, 0.16, 1.95), '#0e8a5a', false, 0, 0.76, -0.45),
    part(box(1.72, 0.14, 2.2), '#241f2c', false, 0, 2.0, -0.3),
    part(box(1.46, 0.78, 1.5), '#6b6046', false, 0, 1.5, -0.5),
    part(box(1.2, 0.5, 0.06), GLASS, false, 0, 1.55, 0.55, -0.15),
    part(wheel(0.34, 0.2), TYRE, false, 0, 0.34, 1.28),
    part(wheel(0.34, 0.2), TYRE, false, -0.78, 0.34, -0.82),
    part(wheel(0.34, 0.2), TYRE, false, 0.78, 0.34, -0.82),
    part(box(0.1, 0.1, 0.1), CHROME, false, 0, 1.4, 0.7),
  ];
  driver(p, 0, 1.15, 0.15, '#c9a86a');
  return { geo: merge(p), len: 2.9, height: 2.1 };
}

export const BUILDERS = { car, auto, bike, bus, truck };

/** Lamp positions per kind, in local space: [x, y, z]. Head and tail lamps (pairs), then the front and rear indicators. */
export function lampLayout(kind, len) {
  const h = len / 2;
  switch (kind) {
    case 'bus': return { head: [0.9, 0.62, h], tail: [0.95, 0.9, -h], ind: [1.2, 0.62, h - 0.05, 1.2, 0.9, -h + 0.05] };
    case 'truck': return { head: [0.85, 0.9, 4.1], tail: [0.95, 0.85, -4.05], ind: [1.1, 0.9, 4.05, 1.15, 0.85, -4.0] };
    case 'bike': return { head: [0, 0.98, 0.78], tail: [0, 0.7, -0.9], ind: [0.22, 1.0, 0.7, 0.18, 0.7, -0.85] };
    case 'auto': return { head: [0.0, 1.0, 1.5], tail: [0.55, 0.92, -1.46], ind: [0.5, 0.75, 1.3, 0.65, 0.9, -1.46] };
    default: return { head: [0.56, 0.7, h], tail: [0.6, 0.76, -h], ind: [0.7, 0.62, h - 0.05, 0.72, 0.76, -h + 0.04] };
  }
}

/** Palette: car paints, bus liveries, truck cab colours, scooter colours, auto paints. */
export const PAINTS = {
  car: ['#f4f4f6', '#c8cbd4', '#2c3a6a', '#b4252f', '#1d1d22', '#e7c64a', '#2f8f6a', '#7d8aa8', '#e8e0cf', '#c46a2c', '#3b6fd0', '#7a2f6b'],
  bus: ['#e0245e', '#d8204c', '#e83a6c'],
  truck: ['#e8602c', '#2a6cf0', '#d8204c', '#18a05e', '#f2b50e'],
  bike: ['#d8204c', '#1d1d22', '#2a6cf0', '#f4f4f6', '#e8602c', '#18a05e', '#7a2f6b'],
  auto: ['#ffc400', '#ffc400', '#ffc400', '#18a05e', '#ffb000'],
};

/**
 * The one material every traffic mesh shares: vertex colours, with the instance attribute `aTint` multiplied in where the vertex
 * attribute `aPaint` is 1. (Both attributes are added to the geometry by the caller.)
 */
export function createTrafficMaterial() {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTint;\nattribute float aPaint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb *= mix(vec3(1.0), aTint, aPaint);\n#endif');
  };
  m.customProgramCacheKey = () => 'traffic-tint';
  return m;
}

/** Triangles in a geometry (for the budget test). */
export const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
