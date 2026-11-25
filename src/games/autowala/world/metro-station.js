// OWNER: metro agent. Builds the station buildings of the metro as merged geometry (solid, glass, signs, light pools):
// an elevated platform with side platforms, platform-edge screens, a long curved translucent roof, a glazed concourse hall slung
// under the viaduct above the carriageway, escalator blocks up from the pavement, name boards and the "M" roundels.
// Interchange "stack" stations get a second, higher platform level for the upper line.
import { Mesher, lin } from './metro-mesh.js';
import { C } from './metro-geo.js';
import { METRO } from './metro-routes.js';

export const ST = {
  platHalf: METRO.stationHalf, // half the platform length
  platTop: 1.25, // platform surface above rail level
  hallHalf: 22, // half the concourse length
  hallFloor: 5.4, // concourse floor this far below rail level
  stairW: 1.4,
  lane: 2.05,
};

const GLASS = lin(0x9ed6ee);
const GLASS_ROOF = lin(0xbfe6f4);
const CONC_LIGHT = lin(0xc8c8ce);
const CONC_FLOOR = lin(0x8c8c94);
const WARM = lin(0xffcf8e);
const POOL = lin(0xffa24e);

/** Quad name board / roundel facing (nx, nz), centre (cx, cy, cz), size (w, h), uv rect from the atlas. */
function board(m, cx, cy, cz, nx, nz, w, h, uv, { glow = 0 } = {}) {
  const rx = nz; // right = up x n
  const rz = -nx;
  const hw = w / 2;
  const hh = h / 2;
  m.quad(
    [cx - rx * hw, cy - hh, cz - rz * hw],
    [cx + rx * hw, cy - hh, cz + rz * hw],
    [cx + rx * hw, cy + hh, cz + rz * hw],
    [cx - rx * hw, cy + hh, cz - rz * hw],
    [1, 1, 1],
    { uv, glow },
  );
}

/**
 * One platform level (side platforms, screens, roof, boards) at rail level `yr` for a line of `color`.
 * `rise`: how much the roof arches; `eave`: roof edge height above the platform surface.
 */
function platformLevel(S, g, yr, color, { Wp, rise, eave, uvBoard, hw }) {
  const { solid, glass, signs } = S;
  const top = yr + ST.platTop;
  const L = ST.platHalf * 2;
  const lc = lin(parseInt(color.slice(1), 16));
  for (const sd of [-1, 1]) {
    // platform body (rests on the deck beams) and its pale surface
    solid.box(sd * (3.6 + Wp) / 2, (yr - 2.0 + top) / 2, 0, Wp - 3.6, top - (yr - 2.0), L, C.concrete, { top: CONC_LIGHT, bottom: C.concreteDark });
    // yellow tactile strip along the edge, line-colour stripe on the outer fascia
    solid.box(sd * 3.85, top + 0.01, 0, 0.5, 0.03, L, C.yellow, { faces: 'y' });
    solid.box(sd * (Wp + 0.02), (yr - 0.6 + top) / 2 - 0.2, 0, 0.05, 0.4, L, lc, { faces: sd > 0 ? 'x' : 'X' });
    // platform-edge screens: a glass wall with a post at every door pitch
    glass.box(sd * 3.7, top + 1.05, 0, 0.05, 2.1, L - 2, GLASS);
    for (let z = -ST.platHalf + 1; z <= ST.platHalf - 0.5; z += 4.9) solid.box(sd * 3.7, top + 1.1, z, 0.14, 2.2, 0.14, C.steelLight);
    solid.box(sd * 3.7, top + 2.15, 0, 0.12, 0.1, L - 1.8, C.steelLight);
    // roof columns
    for (let z = -ST.platHalf + 2; z <= ST.platHalf - 1; z += 12.5) solid.box(sd * (Wp - 0.3), top + eave / 2, z, 0.26, eave, 0.26, C.steel);
    // name boards on the inner faces of the platforms, readable from the trains
    for (const z of [-17, 17]) {
      board(signs, sd * (Wp - 0.4), top + 2.5, z, -sd, 0, 6.4, 1.6, uvBoard);
      solid.box(sd * (Wp - 0.33), top + 2.5, z, 0.06, 1.7, 6.5, C.steel, { faces: sd > 0 ? 'x' : 'X' }); // backing
    }
  }
  // curved roof: arch over the whole width, translucent, with steel ribs and a lit ridge
  const N = 10;
  const pts = [];
  for (let j = 0; j <= N; j++) {
    const x = -Wp + (2 * Wp * j) / N;
    const k = x / Wp;
    pts.push([x, top + eave + rise * (1 - k * k)]);
  }
  const zr = L / 2 + 1.2;
  for (let j = 0; j < N; j++) {
    const a = pts[j];
    const b = pts[j + 1];
    glass.quad([a[0], a[1], -zr], [b[0], b[1], -zr], [b[0], b[1], zr], [a[0], a[1], zr], GLASS_ROOF); // upper face
    glass.quad([a[0], a[1] - 0.02, zr], [b[0], b[1] - 0.02, zr], [b[0], b[1] - 0.02, -zr], [a[0], a[1] - 0.02, -zr], GLASS_ROOF); // underside
  }
  for (let z = -zr + 0.2; z <= zr - 0.1; z += 8.2) {
    for (let j = 0; j < N; j++) {
      const a = pts[j];
      const b = pts[j + 1];
      const y0 = a[1] + 0.06;
      const y1 = b[1] + 0.06;
      solid.quad([a[0], y0, z - 0.14], [b[0], y1, z - 0.14], [b[0], y1, z + 0.14], [a[0], y0, z + 0.14], C.steel);
      solid.quad([a[0], y0 - 0.1, z + 0.14], [b[0], y1 - 0.1, z + 0.14], [b[0], y1 - 0.1, z - 0.14], [a[0], y0 - 0.1, z - 0.14], C.steel);
    }
  }
  // line-colour trim along both eaves and a lit ridge
  for (const sd of [-1, 1]) solid.box(sd * Wp, top + eave, 0, 0.5, 0.32, zr * 2, lc);
  solid.box(0, top + eave + rise - 0.12, 0, 0.5, 0.08, L - 4, WARM, { glow: 1, faces: 'Y' });
  for (const sd of [-1, 1]) solid.box(sd * Wp * 0.52, top + eave + rise * (1 - 0.27) - 0.12, 0, 0.4, 0.08, L - 4, WARM, { glow: 1, faces: 'Y' });
}

/**
 * Build all station meshes.
 * @param groups [{ x, z, tx, tz, w, hw?, levels: [{ y, color, boardUv, stationId }], name, slots, roundelUv }]
 *   levels[0] is the lower (concourse) level.
 * @returns {{ solid, glass, signs, pools, colliders: [{x, z, w, d}] }} (Mesher instances; call .build())
 */
export function buildStationMeshes(groups) {
  const S = { solid: new Mesher(), glass: new Mesher(), signs: new Mesher(), pools: new Mesher() };
  const colliders = [];
  for (const gr of groups) {
    const yaw = Math.atan2(gr.tx, gr.tz);
    for (const m of Object.values(S)) m.frame(gr.x, 0, gr.z, yaw);
    const hw = gr.w / 2;
    const Wp = Math.max(7.6, Math.min(9.2, hw + 0.6));
    const stack = gr.levels.length > 1;
    const low = gr.levels[0];
    const yr = low.y;
    const floorY = yr - ST.hallFloor;
    const { solid, glass, signs, pools } = S;

    // ---- platform levels
    gr.levels.forEach((lv, i) => {
      const isLower = i === 0;
      const rise = stack && isLower ? 1.0 : 3.0;
      const eave = stack && isLower ? 2.7 : 3.4;
      platformLevel(S, gr, lv.y, lv.color, { Wp, rise, eave, uvBoard: lv.boardUv, hw });
    });

    // ---- the concourse hall under the platform, spanning the carriageway
    const HH = ST.hallHalf;
    const hh = yr - 2.0 - floorY; // hall height
    solid.box(0, floorY - 0.25, 0, hw * 2 + 0.4, 0.5, HH * 2 + 1, CONC_FLOOR, { bottom: C.concreteDark });
    // frame: ceiling beam, mullions on the long sides, end frames
    for (const sd of [-1, 1]) {
      glass.box(sd * hw, floorY + hh / 2, 0, 0.05, hh - 0.3, HH * 2, GLASS);
      for (let z = -HH; z <= HH + 0.1; z += 5.5) solid.box(sd * hw, floorY + hh / 2, z, 0.2, hh, 0.2, C.steelLight);
      solid.box(sd * hw, floorY + 0.15, 0, 0.22, 0.3, HH * 2, C.steelLight);
    }
    for (const e of [-1, 1]) {
      glass.box(0, floorY + hh / 2, e * HH, hw * 2, hh - 0.3, 0.05, GLASS);
      for (const sx of [-1, 0, 1]) solid.box(sx * hw * 0.98, floorY + hh / 2, e * HH, 0.22, hh, 0.22, C.steelLight);
      // the line-colour header over the end wall, and the big name board facing along the road
      const lc = lin(parseInt(low.color.slice(1), 16));
      solid.box(0, yr - 2.0 - 0.12, e * HH, hw * 2, 0.3, 0.3, lc);
      const bw = Math.min(11, hw * 2 - 1);
      board(signs, 0, yr - 2.0 - 1.45, e * (HH + 0.32), 0, e, bw, bw / 4, low.boardUv);
    }
    // warm interior (lit at night, dark glass by day) and a lit underside so the road below is not left black
    solid.box(0, floorY + 0.15 + (hh - 0.6) / 2, 0, hw * 2 - 0.8, hh - 0.6, HH * 2 - 0.6, WARM, { glow: 1 });
    solid.box(0, floorY - 0.52, 0, hw * 2 - 1.2, 0.04, HH * 2 - 2, WARM, { glow: 1, faces: 'Y' });
    // "M" roundels on both long sides
    const ru = gr.roundelUv;
    if (ru) {
      for (const sd of [-1, 1]) {
        board(signs, sd * (hw + 0.06), floorY + hh * 0.55, 0, sd, 0, 3.6, 3.6, ru[low.line], { glow: 0 });
        board(signs, sd * (hw + 0.06), floorY + hh * 0.55, -11, sd, 0, 2.6, 2.6, ru[low.line]);
        board(signs, sd * (hw + 0.06), floorY + hh * 0.55, 11, sd, 0, 2.6, 2.6, ru[low.line]);
      }
    }

    // ---- escalator blocks up from the pavement, a landing and a canopy at the top
    for (const q of gr.slots) {
      const end = q.end;
      const sd = q.side;
      const from = METRO.stairFrom;
      const to = METRO.stairTo;
      const rise = floorY - 0.25;
      const run = to - from;
      const ang = Math.atan2(rise, run);
      const len = Math.hypot(rise, run);
      const cx = sd * (hw + 2.55);
      const cz = end * (from + to) / 2;
      const cy = 0.25 + rise / 2;
      const pitch = end > 0 ? -ang : ang;
      solid.box(cx, cy - 0.1, cz, ST.stairW, 0.5, len, C.steel, { pitch, top: C.concreteDark });
      for (const e2 of [-1, 1]) {
        glass.box(cx + e2 * (ST.stairW / 2 + 0.03), cy + 0.55, cz, 0.04, 0.9, len, GLASS, { pitch });
        solid.box(cx + e2 * (ST.stairW / 2 + 0.03), cy + 1.02, cz, 0.08, 0.06, len, C.steelLight, { pitch });
      }
      solid.box(cx, cy + 0.17, cz, ST.stairW - 0.5, 0.03, len - 0.6, WARM, { pitch, glow: 1, faces: 'y' });
      // landing + canopy at the hall end
      const lz = end * (from - 1.2);
      solid.box(sd * (hw + 1.65), floorY - 0.25, lz, 3.3, 0.5, 3.6, CONC_FLOOR);
      glass.box(sd * (hw + 1.65), floorY + 2.5, lz, 3.3, 0.06, 3.6, GLASS);
      for (const e2 of [-1, 1]) solid.box(sd * (hw + 3.1), floorY + 1.3, lz + e2 * 1.6, 0.12, 2.6, 0.12, C.steelLight);
      solid.box(sd * (hw + 3.2), floorY + 0.55, lz, 0.05, 1.0, 3.6, GLASS, { faces: sd > 0 ? 'xX' : 'xX' });
      // collider (world axis-aligned box around the pitched block)
      const wx = gr.x + cx * Math.cos(yaw) + cz * Math.sin(yaw);
      const wz = gr.z - cx * Math.sin(yaw) + cz * Math.cos(yaw);
      const alongX = Math.abs(gr.tx) > 0.7;
      colliders.push({ x: wx, z: wz, w: alongX ? run : ST.stairW + 0.2, d: alongX ? ST.stairW + 0.2 : run });
    }

    // ---- stacked interchange: vertical circulation up to the upper platform
    if (stack) {
      const up = gr.levels[1];
      const top = up.y + ST.platTop;
      for (const q of gr.slots.filter((s, i, a) => a.findIndex((t) => t.end === s.end) === i)) {
        const tz = q.end * (METRO.stairTo + 3.2);
        const tx = q.side * (hw + 2.2);
        glass.box(tx, top / 2, tz, 2.2, top, 2.4, GLASS);
        for (const a of [-1, 1]) for (const b of [-1, 1]) solid.box(tx + a * 1.05, top / 2, tz + b * 1.15, 0.16, top, 0.16, C.steelLight);
        solid.box(tx, top + 0.1, tz, 2.6, 0.25, 2.8, C.concreteDark);
        solid.box(tx, top / 2, tz, 1.4, top - 0.4, 1.4, WARM, { glow: 1 });
        // a bridge from the tower to the end of the upper platform
        solid.box(q.side * (hw + 1.2), top - 0.15, q.end * (ST.platHalf + 1.6), 4.6, 0.3, 3.6, C.concreteDark);
        colliders.push({ x: gr.x + tx * Math.cos(yaw) + tz * Math.sin(yaw), z: gr.z - tx * Math.sin(yaw) + tz * Math.cos(yaw), w: 2.6, d: 2.8 });
      }
    }

    // ---- warm light pool on the road under the hall
    pools.box(0, 0.13, 0, hw * 2 + 10, 0.01, HH * 2 + 14, POOL, { faces: 'y', uvs: { y: [0, 0, 1, 1] } });
  }
  return { ...S, colliders };
}
