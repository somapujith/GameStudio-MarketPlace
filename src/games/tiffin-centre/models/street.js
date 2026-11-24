// Street set dressing: buildStreetProp(id, opts) -> { group, update(dt, t), dispose() }.
// Ids: lpg, tiffin-drum, batter-bucket, plate-stack, stool, bench, thela, tube-light, pole-with-wires, panipuri-cart,
// auto-rickshaw ({body, roof}), scooter ({body}), dog, cow, flex-banner ({text, te, colors:[bg, ink, accent], width}), money-box.
// Origin = ground centre, front = +z (rotate for traffic). Static geometry is merged, cached and shared; dispose() frees only
// what the instance owns (banner texture / material, per-instance geometry).
import { BufferGeometry, CatmullRomCurve3, Group, Mesh, MeshBasicMaterial, PlaneGeometry, TubeGeometry, Vector3, DoubleSide } from 'three';
import { Parts, disposeObject, materials, num, sharedGeo } from './util.js';
import { bannerTexture } from './textures.js';

const STEEL = '#c9d1d6';
const STEEL_D = '#8f9aa1';
const IRON = '#2b2623';

function wheel(P, x, y, z, r, w = 0.08, tire = '#1b1917', rim = '#9aa3a9') {
  P.cyl(r, r, w, 12, tire, { p: [x, y, z], r: [0, 0, Math.PI / 2] });
  P.cyl(r * 0.6, r * 0.6, w + 0.012, 8, rim, { p: [x, y, z], r: [0, 0, Math.PI / 2] });
  P.cyl(r * 0.18, r * 0.18, w + 0.03, 6, '#555c60', { p: [x, y, z], r: [0, 0, Math.PI / 2] });
}

// each builder fills Parts (layers solid / glass / fx) and may return { dyn(group) -> update(t) }
const B = {
  lpg(P) {
    P.lathe([[0, 0], [0.14, 0], [0.155, 0.04], [0.155, 0.34], [0.12, 0.43], [0.06, 0.47], [0, 0.475]], 10, '#c7372a', {});
    P.torus(0.15, 0.012, '#8d2018', { p: [0, 0.045, 0], r: [Math.PI / 2, 0, 0] }, 3, 10);
    P.torus(0.152, 0.01, '#8d2018', { p: [0, 0.34, 0], r: [Math.PI / 2, 0, 0] }, 3, 10);
    P.cyl(0.05, 0.06, 0.04, 8, '#2b2b2b', { p: [0, 0.495, 0] });
    P.box(0.03, 0.03, 0.1, '#d8b24a', { p: [0, 0.54, 0.03] });
    P.torus(0.085, 0.01, '#2b2b2b', { p: [0, 0.52, 0], r: [0, 0, 0] }, 3, 8, Math.PI); // carry guard
    P.box(0.1, 0.05, 0.006, '#f3f3f3', { p: [0, 0.2, 0.155] });
  },
  'tiffin-drum'(P) {
    // big dented steel drum with a lid, side handles and a ladle hanging
    P.lathe([[0, 0], [0.24, 0], [0.26, 0.03], [0.26, 0.64], [0.24, 0.68], [0, 0.68]], 12, '#aab4ba', {});
    P.cyl(0.275, 0.265, 0.07, 12, '#bcc5ca', { p: [0, 0.715, 0] });
    P.sph(0.035, '#2b2b2b', { p: [0, 0.77, 0] }, 5, 4);
    for (const y of [0.16, 0.46]) P.torus(0.262, 0.01, '#7c878e', { p: [0, y, 0], r: [Math.PI / 2, 0, 0] }, 3, 12);
    for (const sx of [-1, 1]) P.torus(0.05, 0.012, '#6f7a80', { p: [sx * 0.275, 0.56, 0], r: [0, Math.PI / 2, 0] }, 3, 8);
    for (const [x, y, z] of [[0.12, 0.3, 0.23], [-0.15, 0.5, 0.2], [0.2, 0.15, -0.15], [-0.1, 0.38, -0.24]]) P.sph(0.05, '#8d979d', { p: [x, y, z], s: [1, 1, 0.25], r: [0, Math.atan2(x, z), 0] }, 5, 3);
    P.cyl(0.07, 0.065, 0.035, 8, '#e8e0cc', { p: [0.12, 0.76, 0.1] }); // plate on the lid
  },
  'batter-bucket'(P) {
    P.cyl(0.19, 0.155, 0.32, 12, '#2a6fb0', { p: [0, 0.16, 0] });
    P.cyl(0.2, 0.2, 0.025, 12, '#e8e8e8', { p: [0, 0.335, 0], r: [0, 0, 0.05] });
    P.torus(0.17, 0.008, '#e8e8e8', { p: [0, 0.3, 0], r: [Math.PI / 2, 0, 0] }, 3, 12);
    P.torus(0.19, 0.01, '#33302e', { p: [0, 0.32, 0], r: [0, 0, 0], s: [1, 1.2, 1] }, 3, 10, Math.PI);
    P.cyl(0.01, 0.01, 0.4, 5, STEEL, { p: [0.17, 0.4, 0.05], r: [0.3, 0, -0.5] }); // ladle stuck in
    P.sph(0.05, '#f1ecd9', { p: [0.2, 0.15, 0.1], s: [0.3, 1.6, 0.8] }, 5, 4); // dripped batter
  },
  'plate-stack'(P) {
    for (let i = 0; i < 10; i++) P.lathe([[0, 0], [0.09, 0], [0.14, 0.014], [0.15, 0.032], [0.135, 0.02], [0, 0.008]], 9, i % 2 ? '#c4cdd2' : '#d4dbe0', { p: [0, i * 0.016, 0] });
    for (let i = 0; i < 6; i++) P.lathe([[0, 0], [0.04, 0], [0.05, 0.04], [0.045, 0.04], [0, 0.01]], 6, '#cdd4d9', { p: [0.24, i * 0.03, 0.02] });
  },
  stool(P) {
    P.cyl(0.19, 0.18, 0.04, 10, '#d0392b', { p: [0, 0.4, 0] });
    P.torus(0.19, 0.012, '#a82b20', { p: [0, 0.38, 0], r: [Math.PI / 2, 0, 0] }, 3, 10);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + Math.PI / 4;
      P.cyl(0.022, 0.026, 0.4, 5, '#b8301f', { p: [Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14], r: [Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16] });
    }
  },
  bench(P) {
    P.box(1.7, 0.06, 0.34, '#8a5a33', { p: [0, 0.44, 0] });
    P.box(1.7, 0.012, 0.01, '#6b4426', { p: [0, 0.472, 0.0] });
    for (const sx of [-1, 1]) {
      P.box(0.07, 0.42, 0.3, '#7a4f2d', { p: [sx * 0.7, 0.21, 0] });
      P.box(0.12, 0.04, 0.34, '#5b3a22', { p: [sx * 0.7, 0.02, 0] });
    }
    P.box(1.4, 0.05, 0.03, '#6b4426', { p: [0, 0.3, -0.12] });
  },
  thela(P) {
    // wooden hand-cart: plank bed, side rails, two big spoked wheels, push handles, newspaper-lined baskets
    P.box(1.35, 0.07, 0.8, '#8a5a33', { p: [0, 0.8, 0] });
    for (let i = 0; i < 5; i++) P.box(1.35, 0.012, 0.005, '#6b4426', { p: [0, 0.837, -0.32 + i * 0.16] });
    P.box(1.35, 0.3, 0.03, '#7a4f2d', { p: [0, 0.95, 0.4] });
    P.box(1.35, 0.3, 0.03, '#7a4f2d', { p: [0, 0.95, -0.4] });
    P.box(0.03, 0.3, 0.8, '#7a4f2d', { p: [-0.66, 0.95, 0] });
    P.box(0.03, 0.3, 0.8, '#7a4f2d', { p: [0.66, 0.95, 0] });
    for (const sx of [-1, 1]) {
      P.torus(0.4, 0.035, '#3a2a20', { p: [sx * 0.74, 0.4, 0], r: [0, Math.PI / 2, 0] }, 4, 14);
      for (let i = 0; i < 6; i++) P.box(0.03, 0.78, 0.03, '#6b4426', { p: [sx * 0.74, 0.4, 0], r: [(i * Math.PI) / 6, 0, 0] });
      P.cyl(0.06, 0.06, 0.1, 6, '#444', { p: [sx * 0.74, 0.4, 0], r: [0, 0, Math.PI / 2] });
    }
    P.cyl(0.02, 0.02, 1.7, 5, '#7a4f2d', { p: [-0.5, 0.75, 1.0], r: [Math.PI / 2 - 0.1, 0, 0] });
    P.cyl(0.02, 0.02, 1.7, 5, '#7a4f2d', { p: [0.5, 0.75, 1.0], r: [Math.PI / 2 - 0.1, 0, 0] });
    P.cyl(0.02, 0.02, 1.0, 5, '#7a4f2d', { p: [0, 0.85, 1.85], r: [0, 0, Math.PI / 2] });
    P.cyl(0.19, 0.17, 0.16, 8, '#9c6a3a', { p: [-0.35, 0.96, 0] }); // basket
    P.cyl(0.18, 0.18, 0.01, 8, '#e6dcc0', { p: [-0.35, 1.04, 0] });
    P.box(0.26, 0.2, 0.2, '#2a6fb0', { p: [0.3, 0.97, -0.1] }); // blue tub
    P.box(0.3, 0.012, 0.5, '#e6dcc0', { p: [0.3, 0.865, 0.2], r: [0, 0.1, 0] }); // newspaper
  },
  'tube-light'(P) {
    P.box(1.25, 0.05, 0.1, '#d8d8d2', { p: [0, 0, 0] });
    P.box(0.04, 0.07, 0.11, '#9a9a94', { p: [-0.6, 0, 0] });
    P.box(0.04, 0.07, 0.11, '#9a9a94', { p: [0.6, 0, 0] });
    P.cyl(0.021, 0.021, 1.15, 8, '#fffbe8', { p: [0, -0.04, 0], r: [0, 0, Math.PI / 2], layer: 'fx' });
    for (const sx of [-1, 1]) P.cyl(0.003, 0.003, 0.5, 3, '#3a3a3a', { p: [sx * 0.55, 0.25, 0] });
  },
  'pole-with-wires'(P) {
    P.cyl(0.085, 0.13, 6.0, 8, '#a9a49a', { p: [0, 3.0, 0] });
    for (const y of [0.6, 1.4]) P.box(0.3, 0.015, 0.3, '#8a857c', { p: [0, y, 0] });
    P.box(1.6, 0.07, 0.07, '#5b3a22', { p: [0, 5.6, 0] });
    P.box(1.2, 0.06, 0.06, '#5b3a22', { p: [0, 5.2, 0] });
    for (const x of [-0.7, -0.35, 0.35, 0.7]) P.cyl(0.025, 0.03, 0.12, 5, '#d8d0c0', { p: [x, 5.68, 0] });
    for (const x of [-0.5, 0.5]) P.cyl(0.025, 0.03, 0.12, 5, '#d8d0c0', { p: [x, 5.28, 0] });
    P.box(0.28, 0.4, 0.2, '#6c7480', { p: [0.0, 4.5, 0.17] }); // meter box
    P.box(0.5, 0.35, 0.02, '#e8e0c8', { p: [0.0, 3.3, 0.14] }); // paper notice
    P.box(0.5, 0.35, 0.02, '#d0392b', { p: [0.05, 2.7, 0.15], r: [0, 0, 0.06] }); // poster
    // wires: sagging runs both ways, one tangled loop, a hanging bunch
    const wire = (pts, r = 0.009) => P.add(new TubeGeometry(new CatmullRomCurve3(pts.map((p) => new Vector3(...p))), 10, r, 3), '#1c1a19', {});
    for (const [x0, y0, zz] of [[-0.7, 5.68, 0], [-0.35, 5.68, 0], [0.35, 5.68, 0], [0.7, 5.68, 0]]) {
      const dir = x0 < 0 ? -1 : 1;
      wire([[x0, y0, zz], [x0 + dir * 1.5, y0 - 0.35, zz + 0.2], [x0 + dir * 3.5, y0 - 0.2, zz + 0.4], [x0 + dir * 5.5, y0 + 0.1, zz + 0.6]]);
    }
    for (const x0 of [-0.5, 0.5]) wire([[x0, 5.28, 0], [x0 * 3, 4.7, -0.8], [x0 * 7, 5.0, -2.5], [x0 * 10, 5.4, -4.0]]);
    wire([[-0.3, 4.9, 0.1], [-1.0, 4.5, 0.4], [-0.6, 4.2, 0.2], [0.4, 4.4, 0.35], [0.2, 4.9, 0.1], [-0.4, 4.8, 0.3]], 0.011); // tangle
    wire([[0.1, 5.0, 0.05], [0.3, 4.0, 0.3], [0.1, 3.3, 0.2]], 0.014);
  },
  'panipuri-cart'(P) {
    P.box(1.0, 0.07, 0.7, '#8a5a33', { p: [0, 0.7, 0] });
    P.box(0.9, 0.5, 0.6, '#2f9e5b', { p: [0, 0.45, 0] });
    P.box(0.92, 0.04, 0.62, '#e8d8a8', { p: [0, 0.2, 0] });
    for (const sx of [-1, 1]) {
      P.torus(0.28, 0.03, '#3a2a20', { p: [sx * 0.52, 0.3, -0.05], r: [0, Math.PI / 2, 0] }, 4, 12);
      for (let i = 0; i < 4; i++) P.box(0.02, 0.56, 0.02, '#6b4426', { p: [sx * 0.52, 0.3, -0.05], r: [(i * Math.PI) / 4, 0, 0] });
    }
    // glass case with puris
    P.box(0.62, 0.34, 0.44, '#bfe4e4', { p: [-0.12, 0.92, 0], layer: 'glass' });
    for (let i = 0; i < 18; i++) P.sph(0.05, '#e0a03a', { p: [-0.3 + (i % 6) * 0.1, 0.8 + Math.floor(i / 6) * 0.08, -0.12 + ((i * 7) % 3) * 0.12] }, 6, 4);
    for (const [x, y] of [[-0.43, 0.76], [-0.43, 1.08], [0.19, 0.76], [0.19, 1.08]]) P.box(0.012, 0.012, 0.44, '#b8c4c4', { p: [x + 0.12 - 0.12, y, 0] });
    // steel pots: pudina water + tamarind water
    P.lathe([[0, 0], [0.12, 0], [0.14, 0.05], [0.13, 0.2], [0, 0.2]], 8, STEEL, { p: [0.33, 0.735, 0.1] });
    P.cyl(0.125, 0.125, 0.01, 8, '#58b04a', { p: [0.33, 0.93, 0.1] });
    P.lathe([[0, 0], [0.1, 0], [0.12, 0.05], [0.11, 0.18], [0, 0.18]], 8, STEEL, { p: [0.33, 0.735, -0.18] });
    P.cyl(0.105, 0.105, 0.01, 8, '#6a3d1c', { p: [0.33, 0.915, -0.18] });
    // umbrella
    P.cyl(0.015, 0.015, 1.2, 5, '#4a3a2a', { p: [0, 1.4, -0.28] });
    P.cone(0.9, 0.3, 8, '#ffc83d', { p: [0, 2.15, -0.28] }, true);
    P.torus(0.9, 0.012, '#e0392b', { p: [0, 2.0, -0.28], r: [Math.PI / 2, 0, 0] }, 3, 8);
    P.cyl(0.015, 0.015, 0.9, 5, '#4a3a2a', { p: [0.6, 0.85, 0.55], r: [Math.PI / 2, 0, 0] });
  },
  'auto-rickshaw'(P, o) {
    const body = o.body || '#f4c20d';
    const roof = o.roof || '#1c1c1c';
    wheel(P, 0, 0.22, 1.0, 0.22, 0.1);
    for (const sx of [-1, 1]) wheel(P, sx * 0.62, 0.22, -0.7, 0.22, 0.1);
    P.box(0.5, 0.05, 0.4, body, { p: [0, 0.48, 1.0] }); // front mudguard
    P.box(0.62, 0.42, 0.7, body, { p: [0, 0.62, 0.75], r: [0.12, 0, 0] }); // bonnet
    P.box(1.25, 0.1, 1.6, '#2a2a2a', { p: [0, 0.38, -0.35] }); // chassis
    P.box(1.3, 0.5, 1.15, body, { p: [0, 0.66, -0.55] }); // body
    P.box(1.1, 0.14, 0.55, '#222222', { p: [0, 0.98, -0.78] }); // rear seat
    P.box(1.1, 0.34, 0.1, '#222222', { p: [0, 1.15, -1.08] });
    P.box(0.5, 0.12, 0.35, '#222222', { p: [0, 0.93, 0.2] }); // driver seat
    P.box(1.36, 0.07, 1.65, roof, { p: [0, 1.82, -0.35], r: [-0.04, 0, 0] }); // canopy
    P.box(1.3, 0.04, 0.2, roof, { p: [0, 1.76, 0.5], r: [0.4, 0, 0] });
    for (const sx of [-1, 1]) {
      P.box(0.05, 0.9, 0.05, roof, { p: [sx * 0.66, 1.3, -0.95] });
      P.box(0.05, 0.9, 0.05, roof, { p: [sx * 0.62, 1.3, 0.35], r: [0.05, 0, 0] });
      P.box(0.03, 0.04, 0.7, body, { p: [sx * 0.66, 0.9, -0.55] });
    }
    P.box(0.95, 0.72, 0.02, '#cfe6e6', { p: [0, 1.38, 0.52], r: [-0.22, 0, 0], layer: 'glass' }); // windscreen
    P.cyl(0.015, 0.015, 0.8, 5, '#555', { p: [0, 1.02, 0.62], r: [0, 0, Math.PI / 2] }); // handlebar
    P.sph(0.09, '#fff6c8', { p: [0, 0.72, 1.28], layer: 'fx' }, 6, 4); // headlamp
    for (const sx of [-1, 1]) P.box(0.08, 0.05, 0.02, '#d0182c', { p: [sx * 0.5, 0.7, -1.13], layer: 'fx' });
    P.box(0.8, 0.12, 0.012, '#f4f4f4', { p: [0, 0.68, -1.135] }); // plate
    P.box(0.25, 0.18, 0.01, '#f1ecd9', { p: [0.3, 1.75, 0.55] });
  },
  scooter(P, o) {
    const c = o.body || '#2a6fd0';
    wheel(P, 0, 0.21, 0.62, 0.21, 0.07);
    wheel(P, 0, 0.21, -0.55, 0.21, 0.09);
    P.box(0.34, 0.1, 0.9, c, { p: [0, 0.3, 0.05] }); // floorboard
    P.box(0.4, 0.5, 0.55, c, { p: [0, 0.55, -0.5], r: [-0.12, 0, 0] }); // rear body
    P.box(0.34, 0.62, 0.1, c, { p: [0, 0.7, 0.36], r: [0.28, 0, 0] }); // leg shield
    P.box(0.3, 0.08, 0.5, '#222', { p: [0, 0.85, -0.42] }); // seat
    P.cyl(0.015, 0.015, 0.6, 5, '#444', { p: [0, 1.05, 0.5], r: [0, 0, Math.PI / 2] }); // bars
    P.box(0.14, 0.12, 0.1, c, { p: [0, 1.1, 0.55] });
    P.sph(0.07, '#fff6c8', { p: [0, 1.05, 0.62], layer: 'fx' }, 5, 4);
    P.box(0.12, 0.04, 0.3, c, { p: [0, 0.42, 0.65] }); // front mudguard
    P.cyl(0.04, 0.04, 0.25, 6, '#777', { p: [0.2, 0.25, -0.62], r: [Math.PI / 2, 0, 0] }); // exhaust
  },
  'money-box'(P) {
    P.box(0.3, 0.2, 0.2, '#8d979d', { p: [0, 0.1, 0] });
    P.box(0.32, 0.03, 0.22, '#aab4ba', { p: [0, 0.215, 0] });
    P.box(0.16, 0.006, 0.02, '#111', { p: [0, 0.232, 0.0] });
    P.box(0.05, 0.05, 0.02, '#c8962f', { p: [0, 0.14, 0.105] });
    P.sph(0.01, '#222', { p: [0, 0.14, 0.116] }, 4, 3);
    P.box(0.1, 0.04, 0.01, '#d0392b', { p: [0.08, 0.06, 0.105] });
  },
};

// ---- animated animals --------------------------------------------------------------------------------------------------
function dogParts(coat) {
  const body = new Parts();
  body.capsule(0.1, 0.34, coat, { p: [0, 0.34, 0], r: [Math.PI / 2, 0, 0] }, 3, 7);
  for (const [x, z] of [[-0.07, 0.2], [0.07, 0.2], [-0.07, -0.2], [0.07, -0.2]]) body.cyl(0.026, 0.02, 0.3, 5, coat, { p: [x, 0.15, z] });
  for (const [x, z] of [[-0.07, 0.2], [0.07, 0.2], [-0.07, -0.2], [0.07, -0.2]]) body.box(0.05, 0.03, 0.07, '#e8dcc0', { p: [x, 0.015, z + 0.015] });
  body.sph(0.1, '#e8dcc0', { p: [0, 0.3, 0.2], s: [1, 0.9, 0.6] }, 5, 4);
  const head = new Parts();
  head.sph(0.085, coat, { p: [0, 0, 0] }, 7, 5);
  head.cone(0.045, 0.1, 5, '#e8dcc0', { p: [0, -0.02, 0.1], r: [Math.PI / 2, 0, 0] });
  head.sph(0.018, '#111', { p: [0, 0.0, 0.15] }, 4, 3);
  for (const sx of [-1, 1]) {
    head.box(0.04, 0.09, 0.05, shadeCoat(coat), { p: [sx * 0.07, 0.07, -0.02], r: [0, 0, sx * 0.4] });
    head.sph(0.012, '#111', { p: [sx * 0.04, 0.03, 0.075] }, 4, 3);
  }
  const tail = new Parts();
  tail.cyl(0.018, 0.01, 0.24, 4, coat, { p: [0, 0.1, 0], r: [0.6, 0, 0] });
  return { body, head, tail };
}
const shadeCoat = (c) => (c === '#c9a063' ? '#8a6a3a' : '#5a4630');

function cowParts(coat, patch) {
  const body = new Parts();
  body.capsule(0.33, 0.7, coat, { p: [0, 0.85, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.95] }, 4, 8);
  body.sph(0.2, coat, { p: [0, 1.2, 0.4], s: [0.9, 0.8, 1.1] }, 6, 5); // hump
  for (const [x, z] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
    body.cyl(0.1, 0.07, 0.55, 6, coat, { p: [x, 0.33, z] });
    body.cyl(0.075, 0.075, 0.07, 6, '#3a3430', { p: [x, 0.035, z] });
  }
  body.sph(0.2, patch, { p: [0.14, 0.95, -0.1], s: [1, 0.9, 1.2] }, 5, 4);
  body.sph(0.16, patch, { p: [-0.18, 1.0, 0.3], s: [0.8, 0.9, 1.1] }, 5, 4);
  body.cone(0.2, 0.25, 6, shadeCoat('x'), { p: [0, 0.6, 0.36], r: [Math.PI, 0, 0], s: [0.6, 1, 0.5] }); // dewlap
  const head = new Parts();
  head.box(0.24, 0.26, 0.3, coat, { p: [0, 0, 0.15], r: [0.35, 0, 0] });
  head.box(0.17, 0.14, 0.2, '#e8c9b8', { p: [0, -0.1, 0.32], r: [0.35, 0, 0] });
  for (const sx of [-1, 1]) {
    head.cone(0.025, 0.2, 5, '#e8e2d0', { p: [sx * 0.15, 0.16, 0.0], r: [0, 0, -sx * 1.0] });
    head.box(0.14, 0.04, 0.08, coat, { p: [sx * 0.2, 0.08, -0.02], r: [0, 0, sx * 0.3] });
    head.sph(0.02, '#111', { p: [sx * 0.1, 0.05, 0.22] }, 4, 3);
  }
  const tail = new Parts();
  tail.cyl(0.02, 0.012, 0.8, 4, coat, { p: [0, -0.4, 0] });
  tail.sph(0.05, '#3a3430', { p: [0, -0.82, 0] }, 5, 4);
  return { body, head, tail };
}

function buildAnimal(kind, coat, patch) {
  const parts = kind === 'dog' ? dogParts(coat) : cowParts(coat, patch);
  const key = `street:${kind}:${coat}:${patch}`;
  const g = new Group();
  const body = new Mesh(sharedGeo(`${key}:body`, () => parts.body.build('solid')), materials.vertex());
  g.add(body);
  const headG = new Group();
  const tailG = new Group();
  if (kind === 'dog') {
    headG.position.set(0, 0.46, 0.34);
    tailG.position.set(0, 0.4, -0.3);
  } else {
    headG.position.set(0, 1.0, 0.7);
    tailG.position.set(0, 1.05, -0.7);
  }
  headG.add(new Mesh(sharedGeo(`${key}:head`, () => parts.head.build('solid')), materials.vertex()));
  tailG.add(new Mesh(sharedGeo(`${key}:tail`, () => parts.tail.build('solid')), materials.vertex()));
  g.add(headG, tailG);
  return {
    group: g,
    update(t) {
      if (kind === 'dog') {
        tailG.rotation.set(0, Math.sin(t * 9) * 0.55, 0);
        headG.rotation.set(Math.sin(t * 0.6) * 0.12 + 0.1, Math.sin(t * 0.37) * 0.35, 0);
        body.scale.y = 1 + Math.sin(t * 2.2) * 0.012;
      } else {
        tailG.rotation.set(Math.sin(t * 1.2) * 0.15, 0, Math.sin(t * 1.7) * 0.3);
        headG.rotation.set(0.15 + Math.sin(t * 0.5) * 0.1, Math.sin(t * 0.3) * 0.2, 0);
        headG.position.y = 1.0 + Math.max(0, Math.sin(t * 3.1)) * 0.012; // chewing
        body.scale.y = 1 + Math.sin(t * 1.1) * 0.008;
      }
    },
  };
}

/** buildStreetProp(id, opts) */
export function buildStreetProp(id, opts = {}) {
  const group = new Group();
  group.name = `street-${id}`;
  group.userData.prop = id;
  let tick = null;
  let owned = null;

  if (id === 'dog' || id === 'cow') {
    const a = id === 'dog' ? buildAnimal('dog', opts.coat || '#c9a063', '') : buildAnimal('cow', opts.coat || '#ece5d3', opts.patch || '#a8723e');
    group.add(a.group);
    tick = a.update;
  } else if (id === 'flex-banner') {
    const w = opts.width || 3;
    const h = w / 4;
    const tex = bannerTexture({ text: opts.text || 'TIFFIN CENTRE', te: opts.te || '', colors: opts.colors || ['#d9261c', '#fff4dc', '#ffc83d'] });
    const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide, toneMapped: false });
    const cloth = new Mesh(sharedGeo(`flex:${w}`, () => new PlaneGeometry(w, h, 6, 1)), mat);
    cloth.position.y = h / 2;
    group.add(cloth);
    const P = new Parts();
    for (const sx of [-1, 1]) {
      P.cyl(0.02, 0.02, h + 0.4, 5, '#6f7a80', { p: [sx * (w / 2 + 0.03), h / 2 - 0.1, 0] });
      for (const sy of [0.05, h - 0.05]) P.sph(0.02, '#c9d1d6', { p: [sx * (w / 2 - 0.03), sy, 0.01] }, 4, 3);
    }
    P.cyl(0.015, 0.015, w + 0.1, 5, '#6f7a80', { p: [0, h + 0.1, 0], r: [0, 0, Math.PI / 2] });
    group.add(new Mesh(sharedGeo(`flex:frame:${w}`, () => P.build('solid')), materials.vertex()));
    owned = [tex];
    tick = (t) => {
      cloth.rotation.y = Math.sin(t * 0.9) * 0.012; // breathing in the breeze
    };
  }
  if (B[id]) {
    const key = `street:${id}:${opts.body || ''}:${opts.roof || ''}`;
    let pack = null;
    const make = () => {
      if (pack) return pack;
      const P = new Parts();
      B[id](P, opts);
      pack = { solid: P.build('solid'), glass: P.build('glass'), fx: P.build('fx') };
      return pack;
    };
    const empty = () => new BufferGeometry();
    const s = sharedGeo(`${key}:S`, () => make().solid || empty());
    const gl = sharedGeo(`${key}:G`, () => make().glass || empty());
    const fx = sharedGeo(`${key}:F`, () => make().fx || empty());
    if (s.attributes.position) group.add(new Mesh(s, materials.vertex()));
    if (gl.attributes.position) group.add(new Mesh(gl, materials.glass()));
    if (fx.attributes.position) {
      const m = new Mesh(fx, materials.glow());
      group.add(m);
      if (id === 'tube-light') tick = (t) => (m.visible = Math.sin(t * 31) * Math.sin(t * 17.3) > -0.93); // an old tube flickering now and then
    }
  }
  let disposed = false;
  return {
    group,
    id,
    update(dt, t) {
      if (!disposed && tick) tick(num(t, 0));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject(group);
      if (owned) for (const t of owned) t.dispose();
    },
  };
}

export const STREET_PROP_IDS = ['lpg', 'tiffin-drum', 'batter-bucket', 'plate-stack', 'stool', 'bench', 'thela', 'tube-light', 'pole-with-wires', 'panipuri-cart', 'auto-rickshaw', 'scooter', 'dog', 'cow', 'flex-banner', 'money-box'];
