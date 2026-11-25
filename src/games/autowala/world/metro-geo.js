// OWNER: metro agent. Reusable geometry of the metro: the box-girder deck segment, pillars, cross-beams and the train cars. Each is
// built once and drawn as an InstancedMesh. Vertex attributes: color (linear), aTint (1 = takes the instance colour, the line
// colour), aGlow (1 = lit at night, 2 = door light). Local frame: x = left of travel, y up, z = forward.
import { Mesher, lin } from './metro-mesh.js';
import { BENT } from './metro-pillars.js';
import { TRAIN } from './metro-trains.js';

export const C = {
  concrete: lin(0x9b9ba2),
  concreteDark: lin(0x8c8c95),
  concreteLight: lin(0xc9c9cf),
  band: lin(0xdedee3),
  bed: lin(0x33333b),
  rail: lin(0x9a9da5),
  white: [1, 1, 1],
  silver: lin(0xdbe2e8),
  silverDark: lin(0x9aa4ae),
  glass: lin(0x141a28),
  roofGrey: lin(0x7c838d),
  warm: lin(0xffd9a0),
  headlight: lin(0xfff4d8),
  tail: lin(0xff3030),
  door: lin(0xd8ffe4),
  steel: lin(0x5b616b),
  steelLight: lin(0xb8c0c8),
  yellow: lin(0xf2c230),
};

export const DECK = { halfWidth: 4.5, depth: BENT.deckDepth, parapet: 1.2 };

/** One unit-length (z -0.5..0.5) segment of the viaduct: box girder, parapets with a lighter band and the line-colour stripe, rails. */
export function deckGeometry() {
  const m = new Mesher();
  const g = [
    [-4.5, 0],
    [-4.5, -0.45],
    [-3.0, -0.9],
    [-2.9, -2.0],
    [2.9, -2.0],
    [3.0, -0.9],
    [4.5, -0.45],
    [4.5, 0],
  ];
  // sides concrete, the underside darker, the top is the track bed
  const cols = [C.concrete, C.concreteDark, C.concreteDark, C.concreteDark, C.concreteDark, C.concreteDark, C.concrete, C.bed];
  m.extrude(g, -0.5, 0.5, cols);
  // parapets (both sides): concrete wall, lighter cap band, line-colour stripe on the outer face (no end or bottom faces)
  for (const sd of [-1, 1]) {
    m.box(sd * 4.34, 0.4, 0, 0.32, 0.8, 1, C.concrete, { faces: 'xXy' });
    m.box(sd * 4.34, 1.0, 0, 0.36, 0.4, 1, C.concreteLight, { faces: 'xXy' });
    m.box(sd * 4.52, 0.62, 0, 0.05, 0.26, 1, C.white, { tint: 1, faces: sd > 0 ? 'x' : 'X' });
  }
  // rails: two tracks, 1.435 m gauge
  for (const lane of [-TRAIN.lane, TRAIN.lane]) {
    for (const r of [-0.7175, 0.7175]) m.box(lane + r, 0.12, 0, 0.1, 0.24, 1, C.rail, { faces: 'xXy' });
  }
  return m.build();
}

/** Closes the open end of a line's viaduct: the girder profile as a flat fan facing +z at z = 0. */
export function capGeometry() {
  const m = new Mesher();
  const g = [[-4.5, 0], [-4.5, -0.45], [-3.0, -0.9], [-2.9, -2.0], [2.9, -2.0], [3.0, -0.9], [4.5, -0.45], [4.5, 0]];
  for (let i = 0; i < g.length; i++) {
    const p = g[i];
    const q = g[(i + 1) % g.length];
    m.tri([0, -1, 0], [p[0], p[1], 0], [q[0], q[1], 0], C.concrete);
  }
  return m.build();
}

/**
 * A pillar: an 8-sided shaft of unit height (scale y = shaft height) topped by the flared head. The head vertices carry aTint = 1
 * and the material undoes the y scale on them, so one instanced mesh serves every pillar height.
 */
export const HEAD_H = 1.3;
export function pillarGeometry() {
  const m = new Mesher();
  m.cylinder(0, 0, 0, 1, BENT.radius + 0.07, BENT.radius - 0.03, 8, C.concrete);
  const t = m.pos.length / 3;
  m.cylinder(0, 0, 1 - 0.05, 1 - 0.05 + HEAD_H, BENT.radius - 0.03, 1.28, 8, C.concrete);
  const g = m.build();
  const tint = g.getAttribute('aTint');
  for (let i = t; i < tint.count; i++) tint.setX(i, 1);
  return g;
}

/** The cross-beam of a bent: unit length along local x (scale x = span), 1.5 deep, 2.3 along the track. */
export function beamGeometry() {
  const m = new Mesher();
  const hd = BENT.beamDepth;
  m.box(0, -hd / 2, 0, 1, hd, 2.3, C.concrete, { bottom: C.concreteDark });
  return m.build();
}

// ------------------------------------------------------------------------------------------------ train cars
const L = TRAIN.carLen;
const HL = L / 2;
const W = 2.9;

/** Shared body of a car (no nose): sill, line-colour band, windows with posts, upper skirt, roof, doors, bogies. */
function carBody(m, { nose = 0 }) {
  const end = nose ? 8.6 : HL; // the body stops short of the cab nose
  const len = end + HL; // from -HL to `end`
  const cz = (end - HL) / 2;
  // bogies and underframe
  m.box(0, 0.38, 0, 2.3, 0.3, L - 3, C.steel);
  for (const z of [-6.2, 6.2]) {
    m.box(0, 0.12, z, 2.0, 0.34, 2.8, C.steel);
    for (const sd of [-1, 1]) for (const dz of [-0.9, 0.9]) m.box(sd * 0.72, 0.1, z + dz, 0.18, 0.2, 0.2, C.concreteDark);
  }
  // lower skirt (silver), colour band (line colour), window zone, upper skirt, roof
  m.box(0, 0.8, cz, W, 0.5, len, C.silver);
  m.box(0, 1.3, cz, W + 0.02, 0.5, len, C.white, { tint: 1 });
  m.box(0, 3.2, cz, W, 0.8, len, C.silver);
  m.box(0, 3.72, cz, 2.55, 0.26, len, C.roofGrey);
  m.box(0, 3.93, cz - 3, 1.5, 0.22, 4.4, C.silverDark);
  m.box(0, 3.93, cz + 4, 1.5, 0.22, 4.4, C.silverDark);
  // window zone: dark pane box with lit panes (glow, dark by day) and silver posts between them
  m.box(0, 2.25, cz, W - 0.04, 1.2, len, C.glass);
  const panes = nose ? 7 : 8;
  const x0 = -HL + 1.3;
  const x1 = end - 1.0;
  for (let i = 0; i < panes; i++) {
    const z = x0 + ((x1 - x0) * (i + 0.5)) / panes;
    const pw = ((x1 - x0) / panes) * 0.74;
    for (const sd of [-1, 1]) m.box(sd * (W / 2 + 0.005), 2.25, z, 0.02, 0.95, pw, C.warm, { glow: 1, faces: sd > 0 ? 'x' : 'X' });
  }
  for (let i = 0; i <= panes; i++) {
    const z = x0 + ((x1 - x0) * i) / panes;
    m.box(0, 2.25, z, W + 0.04, 1.2, 0.2, C.silver, { faces: 'xXyY' });
  }
  // doors: three per side, silver-dark panels with a light above (lit while the doors are open)
  for (const z of [-6.0, 0, 6.0]) {
    if (z > end - 1.2) continue;
    for (const sd of [-1, 1]) {
      m.box(sd * (W / 2 + 0.03), 1.75, z, 0.04, 2.3, 1.45, C.silverDark, { faces: sd > 0 ? 'x' : 'X' });
      m.box(sd * (W / 2 + 0.05), 2.98, z, 0.02, 0.1, 1.3, C.door, { glow: 2, faces: sd > 0 ? 'x' : 'X' });
    }
  }
}

/** A cab car nose at +z: a raked windscreen above a lower front with lamps. `lamp`: head (white) or tail (red). */
function nose(m, lamp) {
  const z0 = 8.6;
  const z1 = HL;
  const yb = 0.55;
  const yl = 2.0;
  const yt = 3.65;
  const hw = W / 2;
  const zf = z1 + 0.25;
  // lower front block
  m.box(0, (yb + yl) / 2, (z0 + zf) / 2, W, yl - yb, zf - z0, C.silver, { faces: 'xXYz' });
  // colour band wraps the front too
  m.box(0, 1.3, (z0 + zf) / 2 + 0.01, W + 0.02, 0.5, zf - z0, C.white, { tint: 1, faces: 'xXz' });
  // raked windscreen: a sloped dark quad from the lower front up to the roof line
  m.quad([-hw, yl, zf], [hw, yl, zf], [hw * 0.96, yt, z0], [-hw * 0.96, yt, z0], C.glass);
  // side cheeks of the nose (silver triangles as quads)
  for (const sd of [-1, 1]) {
    const a = [sd * hw, yl, zf];
    const b = [sd * hw, yt, z0];
    const c = [sd * hw, yb, z0];
    const d = [sd * hw, yb, zf];
    // outward normal of this side face: +x for sd=1
    if (sd > 0) m.quad(d, c, b, a, C.silver);
    else m.quad(c, d, a, b, C.silver);
  }
  // lamps (two) and a thin glow bar above them
  const col = lamp === 'head' ? C.headlight : C.tail;
  for (const sd of [-1, 1]) m.box(sd * 0.95, 1.05, zf + 0.02, 0.38, 0.2, 0.06, col, { glow: 1, faces: 'z' });
  m.box(0, 1.62, zf + 0.02, 1.9, 0.07, 0.05, col, { glow: 1, faces: 'z' });
  // destination board
  m.box(0, 2.35, zf - 0.28, 1.4, 0.28, 0.06, C.warm, { glow: 1, faces: 'z' });
  // roof cap over the nose
  m.box(0, 3.72, (z0 + z1) / 2 + 0.1, 2.55, 0.26, z1 - z0 + 0.2, C.roofGrey);
}

/** 'head' (white lamps), 'tail' (red lamps) or 'mid' (no nose). The nose points to +z; a tail car is placed turned around. */
export function carGeometry(kind) {
  const m = new Mesher();
  carBody(m, { nose: kind === 'mid' ? 0 : 1 });
  if (kind !== 'mid') nose(m, kind);
  return m.build();
}
