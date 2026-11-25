// Shared station furniture: stainless counter with painted stripe, batter bucket, steel plate stack, tiffin drum, glass jar, tray.
// Geometry is built once per key and shared (sharedGeo); materials are shared PBR materials. Station-local space: counter top at
// COUNTER_TOP, the station is 1.3 m wide x 0.9 m deep, +z faces the cook.
import { Vector3 } from 'three';
import { boxUV, lathe, merge, paint, place, sweep } from './geo.js';
import { pbrMaterial, plainMaterial } from './pbr.js';
import { sharedGeo, sharedTexture } from './util.js';
import { COUNTER_TOP } from './cookware-tawa.js';

const V3 = (x, y, z) => new Vector3(x, y, z);

export const MAT = {
  counterBody: () => pbrMaterial('counter-steel', { rough: 1, metal: 1, key: 'counter-body', color: '#c9d4da' }),
  counterTop: () => pbrMaterial('steel-brushed', { rough: 0.85, metal: 1, key: 'counter-top', aniso: 0.3 }),
  plinth: () => plainMaterial('plinth', { color: '#2a2421', roughness: 0.9, metalness: 0 }),
  steel: () => pbrMaterial('steel-brushed', { rough: 0.9, metal: 1, key: 'prop-steel' }),
  alu: () => pbrMaterial('aluminium', { rough: 1, metal: 1, key: 'prop-alu' }),
  aluVC: () => pbrMaterial('aluminium', { rough: 1, metal: 1, vertexColors: true, key: 'alu-vc', aniso: 0.3 }),
  vc: () => plainMaterial('vcplain', { vertexColors: true, roughness: 0.6, metalness: 0 }),
  rubber: () => plainMaterial('rubberblack', { color: '#0c0c0d', roughness: 0.55, metalness: 0 }),
  glassJar: () => plainMaterial('glassjar', { color: '#e8f2f0', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, clearcoat: 1, side: 2, depthWrite: false, envMapIntensity: 2 }),
  bucket: () => plainMaterial('bucketblue', { color: '#1c5fae', roughness: 0.42, metalness: 0, clearcoat: 0.35 }),
  bucketLid: () => plainMaterial('bucketlid', { color: '#e9ece8', roughness: 0.4, metalness: 0, clearcoat: 0.3 }),
  tin: () => plainMaterial('tinred', { color: '#bf2f22', roughness: 0.4, metalness: 0.2, clearcoat: 0.4 }),
  biscuit: () => plainMaterial('biscuit', { color: '#e3b66c', roughness: 0.7, metalness: 0 }),
};

/** The stainless counter: sheet-metal body with panel seams, a brushed top, a painted stripe, a plinth. -> { body, top, plinth, stripe } */
export function counterPack(accent = '#e0392b') {
  return sharedTexture(`props:counter:${accent}`, () => {
    const body = [
      place(boxUV(1.3, 0.72, 0.9, 0.88, 0.6), { p: [0, 0.42, 0] }),
      ...[-0.43, 0.43].map((x) => place(boxUV(0.012, 0.64, 0.012, 0.1, 0.1), { p: [x, 0.4, 0.453] })),
      place(boxUV(0.3, 0.03, 0.06, 0.3, 0.3), { p: [0.4, 0.36, 0.475] }),
    ];
    const top = [place(boxUV(1.32, 0.04, 0.92, 0.88, 0.6, [0.2, 0.2]), { p: [0, COUNTER_TOP - 0.02, 0] })];
    const plinth = [place(boxUV(1.22, 0.06, 0.82, 0.5, 0.5), { p: [0, 0.03, 0] })];
    const n = parseInt(accent.replace('#', ''), 16);
    const stripe = [paint(place(boxUV(1.3, 0.05, 0.004, 0.2, 0.2), { p: [0, 0.73, 0.4515] }), [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255])];
    const pack = { body: merge(body), top: merge(top), plinth: merge(plinth), stripe: merge(stripe, true), userData: { shared: true } };
    for (const g of [pack.body, pack.top, pack.plinth, pack.stripe]) g.userData.shared = true;
    pack.dispose = () => {
      for (const g of [pack.body, pack.top, pack.plinth, pack.stripe]) g.dispose();
    };
    return pack;
  });
}

export function bucketGeo(seg = 20) {
  return sharedGeo(`props:bucket:${seg}`, () => {
    const body = lathe([[0, 0], [0.095, 0], [0.1, 0.006], [0.121, 0.24], [0.1245, 0.246], [0.1265, 0.2495], [0.1235, 0.2525]], seg, { sub: 0, uv: [2, 3] });
    const handle = sweep([V3(-0.122, 0.23, 0), V3(-0.115, 0.285, 0), V3(0, 0.325, 0), V3(0.115, 0.285, 0), V3(0.122, 0.23, 0)], () => [0.0035, 0.0035], 6, { up: V3(0, 0, 1) });
    return merge([body, handle]);
  });
}
export function bucketLidGeo(seg = 20) {
  return sharedGeo(`props:bucketlid:${seg}`, () => lathe([[0, 0.258], [0.12, 0.256], [0.131, 0.253], [0.133, 0.242], [0.13, 0.236]], seg, { sub: 0, uv: [2, 2], flip: false }));
}
export function plateStackGeo(n = 6, seg = 22) {
  // one lathe for the whole stack: the stacked rim beads, and the top plate's dish
  return sharedGeo(`props:platestack:${n}:${seg}`, () => {
    const pts = [[0, 0.0066], [0.09, 0.0072], [0.1085, 0.0145]];
    const pitch = 0.0215;
    for (let k = 0; k < n; k++) {
      const y = k * pitch;
      pts.push([0.1175 + 0.0005 * (k % 2), y + 0.0246]);
      pts.push([0.1228, y + 0.0272]);
      pts.push([0.1208 - 0.0006 * (k % 2), y + 0.0286, true]);
      if (k < n - 1) pts.push([0.1185, y + 0.0286 - 0.0045]);
    }
    const top = (n - 1) * pitch;
    pts.push([0.1158, top + 0.0246], [0.1085, top + 0.0145], [0.092, top + 0.0078], [0, top + 0.0066]);
    return lathe(pts, seg, { sub: 0, uv: [8, 3] });
  });
}
export function drumGeo(seg = 20) {
  return sharedGeo(`props:drum:${seg}`, () => {
    const body = lathe([[0, 0], [0.18, 0], [0.195, 0.03], [0.195, 0.44], [0.18, 0.478], [0.1, 0.484], [0, 0.486]], seg, { sub: 0, uv: [3, 2] });
    const bands = [0.2].map((y) => place(lathe([[0.1945, y], [0.2005, y + 0.006], [0.1945, y + 0.014]], seg, { sub: 0 }), {}));
    const knob = place(lathe([[0, 0], [0.022, 0.002], [0.024, 0.014], [0.014, 0.026], [0, 0.028]], 12, { sub: 0 }), { p: [0, 0.484, 0] });
    return merge([body, ...bands, knob]);
  });
}
export function trayGeo(seg = 20) {
  return sharedGeo(`props:tray:${seg}`, () => lathe([[0, 0.002], [0.12, 0.002], [0.134, 0.006], [0.1385, 0.016], [0.1345, 0.018], [0.13, 0.009], [0, 0.0055]], seg, { sub: 0, uv: [3, 3] }));
}
export function jarGeo(seg = 20) {
  return sharedGeo(`props:jar:${seg}`, () => {
    const glass = lathe([[0.001, 0.003], [0.085, 0.003], [0.095, 0.02], [0.098, 0.18], [0.092, 0.2], [0.075, 0.204], [0.073, 0.196], [0.088, 0.18], [0.084, 0.022], [0, 0.012]], seg, { sub: 0 });
    return glass;
  });
}
export function jarLidGeo(seg = 20) {
  return sharedGeo(`props:jarlid:${seg}`, () => {
    const lid = lathe([[0.0, 0.222], [0.04, 0.2225], [0.086, 0.218], [0.1015, 0.2085], [0.1015, 0.196], [0.092, 0.1985], [0, 0.2]], seg, { sub: 0, uv: [2, 2] });
    const knob = place(lathe([[0, 0], [0.012, 0.001], [0.0135, 0.012], [0.006, 0.022], [0, 0.0225]], 10, { sub: 0 }), { p: [0, 0.222, 0] });
    return merge([lid, knob]);
  });
}
