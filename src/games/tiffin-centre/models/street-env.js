// Street props, set C: the environment. Corrugated tin roof, blue tarpaulin, bamboo poles, brick wall, cracked footpath, potholed wet road,
// kirana shutter, hanging banana bunch, nimbu-mirchi charm, hoarding, film poster, wall advert, signboard, bulb string, newspaper basket,
// jute sacks and a tangle of overhead cables. Hanging props have their ORIGIN AT THE ATTACHMENT POINT (hook / wire), flat wall pieces are
// centred on their origin facing +z, everything else stands on y = 0.
import { AdditiveBlending, BoxGeometry, DoubleSide, MeshBasicMaterial, PlaneGeometry } from 'three';
import { cableTangle, corrugatedGeometry, heightGrid, lumps, sagPoints, vnoise3 } from './street-kit.js';
import { filmPosterArt, hoardingArt, newsprintArt, sackStencil, shutterArt, signboardArt, wallAdvertArt } from './street-art.js';
import { smoothstep } from './texgen.js';
import { sharedMat } from './util.js';
import { softGlowTexture } from './street-misc.js';

const PI = Math.PI;
const rr = (i, s = 1) => {
  const a = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return a - Math.floor(a);
};

export const haloMat = () =>
  sharedMat('street:halo', () => new MeshBasicMaterial({ map: softGlowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, opacity: 0.8 }));

export const PROPS_ENV = {
  // ---------------------------------------------------------------------------------------------------------------------------
  'tin-roof': {
    key: (o) => `${o.w || 3.2}:${o.d || 2.4}:${o.tilt ?? 0.16}`,
    build(k, o) {
      const w = o.w || 3.2;
      const d = o.d || 2.4;
      const tilt = o.tilt ?? 0.16;
      const n = Math.max(1, Math.ceil(w / 0.72));
      const sw = w / n + 0.05;
      const c = Math.cos(tilt);
      const sn = Math.sin(tilt);
      const on = (x, y, z) => [x, y * c - z * sn, y * sn + z * c]; // a point in the (tilted) sheet frame
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + sw / 2 + i * (w / n);
        k.add(corrugatedGeometry(sw, d, { rows: 3, perPeriod: 4, sag: 0.004 }), 'tin', { p: [x, 0.012 * (i % 2), 0.003 * i], r: [tilt, (rr(i) - 0.5) * 0.01, 0], proj: 'keep', uvs: [sw / 1.1, d / 1.1], vary: 0.13, tint: i % 3 === 0 ? '#e6d8c8' : '#ffffff' });
        // roofing bolts on the crests, two rows per sheet
        for (const zz of [-d * 0.36, d * 0.36]) {
          for (let b = 0; b < 3; b++) {
            const ridge = Math.round((-0.3 + b * 0.3) / 0.076) * 0.076 + 0.019;
            k.sph('steelDark', 0.016, 5, 3, { p: on(x + ridge, 0.0125 + 0.012, zz), s: [1, 0.6, 1], tint: '#5a4a3c' });
          }
        }
      }
      // purlins + rafters below, loose bricks weighing the sheets down
      for (const z of [-d * 0.4, 0, d * 0.4]) k.rbox('wood', w + 0.2, 0.05, 0.05, 0.005, { p: on(0, -0.045, z), r: [tilt, 0, 0], vary: 0.1 }, 1);
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) k.rbox('woodDark', 0.06, 0.06, d + 0.1, 0.005, { p: on(x, -0.1, 0), r: [tilt, 0, 0], uvr: true }, 1);
      for (let i = 0; i < 3; i++) {
        const z = (rr(i, 4) - 0.5) * d * 0.5;
        k.rbox('brick', 0.22, 0.07, 0.105, 0.008, { p: on((rr(i, 7) - 0.5) * w * 0.7, 0.06, z), r: [tilt, rr(i, 9), 0], tint: '#b9654a' }, 1);
      }
      return { ao: 0, aoH: 0.1 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  tarpaulin: {
    key: (o) => `${o.w || 3}:${o.d || 2.4}:${o.tint || ''}`,
    build(k, o) {
      const w = o.w || 3;
      const d = o.d || 2.4;
      const tint = o.tint || '#4aa0dc';
      const fn = (x, z) => {
        const u = (2 * x) / w;
        const v = (2 * z) / d;
        const sag = -0.1 * (1 - u * u) * (1 - v * v);
        const edge = Math.max(Math.abs(u), Math.abs(v)) > 0.92 ? -0.04 * Math.abs(Math.sin((u + v) * 9)) : 0;
        const folds1 = vnoise3(x * 1.5, 0, z * 2.2) * 0.1 + vnoise3(x * 4.3, 1, z * 3.1) * 0.03;
        return -z * 0.12 + sag + edge + folds1 * (1 - 0.5 * v * v);
      };
      k.add(heightGrid(w, d, 28, 22, fn), 'tarp', {
        tint,
        vc: (x, y, z) => 0.88 + 0.12 * Math.sin(x * 2.2 + z * 1.3) + 0.06 * Math.sin(x * 9 - z * 5),
      });
      // grommets and tie ropes running to the poles
      const ties = [[-w / 2, -d / 2], [0, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [0, d / 2], [w / 2, d / 2], [-w / 2, 0], [w / 2, 0]];
      ties.forEach(([x, z], i) => {
        const y = fn(x, z);
        k.tor('stainless', 0.017, 0.004, 4, 10, { p: [x, y + 0.003, z], r: [PI / 2, 0, 0] });
        const ox = Math.sign(x) * 0.28 || (rr(i) - 0.5) * 0.2;
        const oz = Math.sign(z) * 0.28 || 0;
        k.tube('rope', [[x, y, z], [x + ox * 0.5, y - 0.12, z + oz * 0.5], [x + ox, y - 0.42, z + oz]], 0.006, { tint: i % 2 ? '#c9a56a' : '#3a6aa8', uvs: [10, 1] }, 8, 5);
      });
      return { ao: 0, aoH: 0.1 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'bamboo-pole': {
    key: (o) => `${o.h || 2.4}:${o.r || 0.032}`,
    build(k, o) {
      const h = o.h || 2.4;
      const r = o.r || 0.032;
      const seg = Math.max(3, Math.round(h / 0.27));
      const L = h / seg;
      for (let i = 0; i < seg; i++) {
        const y0 = i * L;
        const rb = r * (1 - (i / seg) * 0.28);
        const rt = r * (1 - ((i + 1) / seg) * 0.28);
        k.cyl('bamboo', rt, rb, L - 0.012, 8, { p: [(rr(i) - 0.5) * 0.004, y0 + L / 2, 0], uvs: [2, 1.2], tint: i % 2 ? '#c4c060' : '#d3ce72', vary: 0.08 }, false, 1);
        k.tor('bamboo', rt * 1.07, rt * 0.2, 4, 8, { p: [0, y0 + L, 0], r: [PI / 2, 0, 0], tint: '#a8a24a' });
      }
      // lashings: rope wraps and a cross lash
      for (const y of o.lash || [h * 0.45, h * 0.9]) {
        for (let j = 0; j < 4; j++) k.tor('rope', r * 1.08, 0.0045, 4, 10, { p: [0, y + j * 0.011, 0], r: [PI / 2, 0, 0], tint: '#bfa070', uvs: [14, 1] });
        k.tube('rope', [[r * 1.1, y - 0.03, 0], [0, y + 0.02, r * 1.12], [-r * 1.1, y + 0.05, 0], [0, y + 0.0, -r * 1.12]], 0.005, { tint: '#bfa070', uvs: [10, 1] }, 10, 4, true);
      }
      return { ao: 0.2, aoH: 0.4 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'brick-wall': {
    key: (o) => `${o.w || 4}:${o.h || 2.6}`,
    build(k, o) {
      const w = o.w || 4;
      const h = o.h || 2.6;
      const t = 0.23;
      const soot = (x, y) => {
        const top = 1 - 0.42 * smoothstep(h * 0.45, h, y);
        const plume = 1 - 0.32 * Math.exp(-(((x + w * 0.15) / 0.55) ** 2)) * smoothstep(h * 0.3, h * 0.8, y);
        const damp = 1 - 0.2 * smoothstep(0.5, 0, y);
        return top * plume * damp * (0.93 + 0.07 * Math.sin(x * 7 + y * 3));
      };
      k.add(new BoxGeometry(w, h, t, 22, 12, 1), 'brick', { p: [0, h / 2, 0], vc: (x, y) => soot(x, y) });
      // ragged top: a few missing / stepped bricks
      for (let i = 0; i < 9; i++) {
        const bw = 0.23 + rr(i) * 0.1;
        const x = -w / 2 + 0.2 + (i / 8) * (w - 0.4);
        if (rr(i, 3) > 0.35) k.rbox('brick', bw, 0.075 * (1 + Math.floor(rr(i, 5) * 2)), t * 0.92, 0.004, { p: [x, h + 0.04, (rr(i, 6) - 0.5) * 0.02], tint: '#a85a40', vary: 0.15 }, 1);
      }
      // patchy plaster, a blue dado stripe, old conduit
      k.add(new PlaneGeometry(1.1, 0.9, 6, 5), 'concrete', { p: [-w * 0.2, h * 0.58, t / 2 + 0.003], tint: '#c8b99c', uvs: 3, pre: lumps({ amp: 0.003, freq: 3, oct: 1 }), vc: (x, y) => soot(x, y) * 0.95 });
      k.add(new PlaneGeometry(0.8, 0.6, 5, 4), 'concrete', { p: [w * 0.25, h * 0.35, t / 2 + 0.003], tint: '#d2c5a8', uvs: 3, vc: (x, y) => soot(x, y) });
      k.add(new PlaneGeometry(w, 0.28, 12, 1), 'concrete', { p: [0, 0.3, t / 2 + 0.002], tint: '#3b6ea0', uvs: 3, vc: (x, y) => 0.8 + 0.2 * Math.sin(x * 5) });
      k.tube('rubber', [[-w / 2, h * 0.85, t / 2 + 0.02], [-w * 0.1, h * 0.85, t / 2 + 0.02], [w * 0.1, h * 0.7, t / 2 + 0.02], [w / 2, h * 0.7, t / 2 + 0.02]], 0.012, { tint: '#2a2622' }, 12, 5);
      return { ao: 0.3, aoH: 0.6 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  footpath: {
    key: (o) => `${o.w || 8}:${o.d || 1.6}`,
    build(k, o) {
      const w = o.w || 8;
      const d = o.d || 1.6;
      const n = Math.max(2, Math.round(w / 1.6));
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        const dy = (rr(i, 2) - 0.5) * 0.018;
        k.add(heightGrid(sw - 0.014, d, 8, 4, (x, z) => dy + vnoise3(x * 2 + i * 7, 0, z * 2) * 0.004 - 0.0 + (Math.abs(x) > sw / 2 - 0.05 ? -0.004 : 0)), 'concrete', { p: [-w / 2 + sw / 2 + i * sw, 0.14, 0], vary: 0.1, tint: i % 3 === 1 ? '#b8b4a8' : '#ffffff', uvr: i % 2 === 1 });
        k.box('matte', 0.02, 0.1, d, { p: [-w / 2 + i * sw, 0.09, 0], tint: '#1a1714' }); // joints
      }
      // painted kerb (alternating black and white), manhole and drain grate
      const stripes = (x) => (Math.floor((x + w) / 0.6) % 2 ? 0.2 : 1);
      k.rbox('concrete', w, 0.2, 0.24, 0.015, { p: [0, 0.1, d / 2 + 0.12], vc: (x) => stripes(x) * 0.95 }, 1);
      k.rbox('concrete', w, 0.12, 0.2, 0.01, { p: [0, 0.06, -d / 2 - 0.1], tint: '#9d998f' }, 1);
      k.cyl('steelDark', 0.3, 0.3, 0.018, 18, { p: [w * 0.18, 0.148, 0.05], tint: '#4a4540' });
      k.tor('steelDark', 0.31, 0.012, 4, 20, { p: [w * 0.18, 0.146, 0.05], r: [PI / 2, 0, 0], tint: '#35302c' });
      for (let i = -3; i <= 3; i++) k.box('steelDark', 0.5, 0.012, 0.012, { p: [w * 0.18, 0.157, 0.05 + i * 0.07], r: [0, i * 0.01, 0], tint: '#2a2622' });
      k.rbox('steelDark', 0.5, 0.03, 0.18, 0.006, { p: [-w * 0.3, 0.1, d / 2 - 0.12], tint: '#3a3632' }, 1);
      for (let i = 0; i < 6; i++) k.box('steelDark', 0.008, 0.02, 0.15, { p: [-w * 0.3 - 0.22 + i * 0.088, 0.118, d / 2 - 0.12], tint: '#6a5a4c' });
      return { ao: 0.2, aoH: 0.1 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  road: {
    key: (o) => `${o.w || 12}:${o.d || 6}`,
    build(k, o) {
      const w = o.w || 12;
      const d = o.d || 6;
      const holes = [[-w * 0.22, d * 0.12, 0.45], [w * 0.1, -d * 0.18, 0.62], [w * 0.3, d * 0.2, 0.36], [-w * 0.05, d * 0.3, 0.3]];
      const depth = (x, z) => {
        let m = 0;
        for (const [hx, hz, hr] of holes) {
          const dd = Math.hypot(x - hx, z - hz) / (hr * (1 + vnoise3(x * 4, 2, z * 4) * 0.25));
          if (dd < 1) m = Math.max(m, 1 - smoothstep(0.35, 1, dd));
        }
        return m;
      };
      const fn = (x, z) => -0.07 * depth(x, z) - 0.00025 * (z / (d / 2)) ** 2 + vnoise3(x * 3, 5, z * 3) * 0.004;
      k.add(heightGrid(w, d, 48, 22, fn), 'asphalt', { vc: (x, y, z) => 1 - 0.45 * depth(x, z) });
      // worn dashed centre line and a faded zebra patch
      for (let i = 0; i < Math.floor(w / 1.6); i++) {
        const x = -w / 2 + 0.8 + i * 1.6;
        k.box('matte', 0.8, 0.002, 0.12, { p: [x, 0.004, 0.0], tint: '#cfc9b6', vc: (xx) => 0.55 + 0.45 * Math.abs(Math.sin(xx * 9)) });
      }
      return { ao: 0, aoH: 0.1 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  shutter: {
    key: (o) => `${o.w || 2.6}:${o.h || 2.4}`,
    build(k, o) {
      const w = o.w || 2.6;
      const h = o.h || 2.4;
      const sh = new PlaneGeometry(w, h, 2, Math.round(h / 0.0375));
      const pos = sh.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        pos.setZ(i, Math.sin((y / 0.075) * PI * 2) * 0.011 + Math.sin(pos.getX(i) * 3.1 + y * 1.2) * 0.003);
      }
      sh.computeVertexNormals();
      k.add(sh, shutterArt(), { p: [0, h / 2, 0], proj: 'keep' });
      // posts, lintel, roller housing, guides, lock and pull handles
      for (const sx of [-1, 1]) {
        k.rbox('concrete', 0.28, h + 0.5, 0.3, 0.01, { p: [sx * (w / 2 + 0.14), (h + 0.5) / 2, -0.03], tint: '#c4b89c' }, 1);
        k.rbox('steelDark', 0.055, h, 0.07, 0.006, { p: [sx * (w / 2 + 0.0), h / 2, 0.0], tint: '#5a4c40' }, 1);
      }
      k.rbox('concrete', w + 0.56, 0.3, 0.3, 0.01, { p: [0, h + 0.35, -0.03], tint: '#c4b89c' }, 1);
      k.cyl('steelDark', 0.13, 0.13, w + 0.05, 14, { p: [0, h - 0.12, 0.13], r: [0, 0, PI / 2], tint: '#b08e76' });
      k.rbox('paintWorn', w, 0.1, 0.1, 0.01, { p: [0, 0.05, 0.03], tint: '#4b4a44' }, 1);
      k.rbox('steelDark', 0.1, 0.05, 0.03, 0.006, { p: [0, 0.36, 0.04], tint: '#4a4036' }, 1);
      k.rbox('brass', 0.052, 0.062, 0.026, 0.005, { p: [0, 0.31, 0.055] }, 1);
      k.tor('stainless', 0.018, 0.004, 4, 10, { p: [0, 0.35, 0.055], r: [0, 0, 0] }, PI);
      for (const sx of [-1, 1]) k.rbox('steel', 0.14, 0.022, 0.03, 0.006, { p: [sx * 0.7, 0.22, 0.04] }, 1);
      // painted signboard above the door
      k.add(new PlaneGeometry(w + 0.3, 0.46), signboardArt('kirana', [
        { text: 'శ్రీ లక్ష్మి కిరాణా', font: 'te', size: 74, color: '#fff4dc' },
        { text: 'SRI LAKSHMI KIRANA & GENERAL STORES', font: 'en', size: 40, color: '#ffd24a' },
      ], { base: '#1d4d8c', edge: '#e8c21a', ink: '#fff4dc', w: 1024, h: 180 }), { p: [0, h + 0.355, 0.13], proj: 'keep' });
      return { ao: 0.25, aoH: 0.5 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'banana-bunch': {
    key: (o) => `${o.hands || 3}`,
    build(k, o) {
      const hands = o.hands || 3;
      const B = k.sub('bunch', [0, 0, 0]);
      B.tube('rope', [[0, 0.5, 0], [0, 0.25, 0], [0, 0.02, 0]], 0.006, { tint: '#bfa070', uvs: [6, 1] }, 6, 5);
      B.taper('matte', [[0, 0.02, 0], [0.005, -0.25, 0.005], [0.0, -0.55 - hands * 0.04, 0.01]], (t) => 0.026 - t * 0.012, { tint: '#586b2a' }, 8, 7);
      for (let h = 0; h < hands; h++) {
        const y = -0.1 - h * 0.14;
        const cnt = 7 - (h === hands - 1 ? 2 : 0);
        for (let i = 0; i < cnt; i++) {
          const a = (i / cnt) * PI * 2 + h * 0.5;
          const dx = Math.cos(a);
          const dz = Math.sin(a);
          const ripe = rr(h * 9 + i) > 0.25 ? '#e7c42b' : '#b4c23a';
          B.taper('matte', [[dx * 0.02, y, dz * 0.02], [dx * 0.055, y - 0.045, dz * 0.055], [dx * 0.08, y - 0.12, dz * 0.08], [dx * 0.1, y - 0.2, dz * 0.1]], (t) => 0.012 + 0.011 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - t * 0.004, { tint: ripe }, 5, 5);
          B.sph('matte', 0.006, 4, 3, { p: [dx * 0.1, y - 0.205, dz * 0.1], tint: '#3a2a16' });
        }
      }
      return { ao: 0, aoH: 0.1 };
    },
    rig({ sub }, o, api) {
      api.anim((dt, t) => {
        if (sub.bunch) sub.bunch.rotation.set(Math.sin(t * 0.8) * 0.025, 0, Math.sin(t * 0.9 + 1) * 0.04);
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'lemon-chilli': {
    build(k) {
      const B = k.sub('charm', [0, 0, 0]);
      B.tube('rope', [[0, 0.3, 0], [0, 0.15, 0], [0, -0.28, 0]], 0.0025, { tint: '#f1ecd9', uvs: [6, 1] }, 8, 4);
      B.sph('matte', 1, 12, 8, { p: [0, -0.05, 0], s: [0.034, 0.042, 0.034], pre: lumps({ amp: 0.0016, freq: 18, oct: 1 }), tint: '#e8d640' });
      B.sph('matte', 0.006, 5, 4, { p: [0, -0.095, 0], tint: '#6a7a26' });
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? 1 : -1;
        const y = -0.1 - i * 0.026;
        B.taper('matte', [[0, y, 0], [side * 0.022, y - 0.01, 0.004], [side * 0.034, y - 0.05, 0.006], [side * 0.03, y - 0.09, 0.0]], (t) => 0.0062 * (1 - t * 0.8) + 0.002, { tint: i % 3 === 0 ? '#2f7d2a' : '#3f9a32' }, 5, 5);
      }
      B.sph('matte', 1, 6, 5, { p: [0, -0.3, 0], s: [0.012, 0.022, 0.012], tint: '#141210' }); // the black charm
      B.sph('matte', 0.01, 5, 4, { p: [0.0, -0.12, 0.03], tint: '#141210' });
      return { ao: 0, aoH: 0.1 };
    },
    rig({ sub }, o, api) {
      api.anim((dt, t) => {
        if (sub.charm) sub.charm.rotation.set(Math.sin(t * 1.3) * 0.05, Math.sin(t * 0.7) * 0.5, Math.sin(t * 1.1 + 2) * 0.07);
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  hoarding: {
    key: (o) => `${o.kind || 'charminar'}:${o.w || 2.4}:${o.h || 1.6}`,
    build(k, o) {
      const w = o.w || 2.4;
      const h = o.h || 1.6;
      const y0 = 1.3;
      k.add(new PlaneGeometry(w, h, 12, 8), hoardingArt(o.kind || 'charminar'), { p: [0, y0 + h / 2, 0.035], pre: lumps({ amp: 0.005, freq: 1.6, oct: 2 }), proj: 'keep' });
      for (const [bw, bh, x, y] of [[w + 0.1, 0.07, 0, y0], [w + 0.1, 0.07, 0, y0 + h], [0.07, h, -w / 2, y0 + h / 2], [0.07, h, w / 2, y0 + h / 2]]) k.rbox('steelDark', bw, bh, 0.07, 0.006, { p: [x, y, 0], tint: '#6a4a38' }, 1);
      for (const sx of [-1, 1]) {
        k.cyl('steelDark', 0.04, 0.045, y0 + h * 0.5, 10, { p: [sx * (w / 2 - 0.2), (y0 + h * 0.5) / 2, -0.12], tint: '#5a4a3c' });
        k.rbox('steelDark', 0.05, 0.05, 0.12, 0.005, { p: [sx * (w / 2 - 0.2), y0 + h * 0.5, -0.06], tint: '#5a4a3c' }, 1);
      }
      k.tube('steelDark', [[0, y0 + h + 0.03, 0.03], [0, y0 + h + 0.3, 0.2], [0, y0 + h + 0.3, 0.6]], 0.012, { tint: '#3a3632' }, 8, 5); // gooseneck lamp
      k.rbox('steel', 0.3, 0.07, 0.14, 0.012, { p: [0, y0 + h + 0.3, 0.62], tint: '#8e9396' }, 1);
      return { ao: 0.15, aoH: 0.4 };
    },
  },

  'film-poster': {
    key: (o) => `${o.seed || 1}`,
    build(k, o) {
      k.add(new PlaneGeometry(0.5, 0.75, 8, 12), filmPosterArt(o.seed || 1), { pre: lumps({ amp: 0.004, freq: 2.2, oct: 2, seed: o.seed || 1 }), proj: 'keep', p: [0, 0, 0.002] });
      k.add(new PlaneGeometry(0.1, 0.1, 2, 2), filmPosterArt(o.seed || 1), { p: [0.2, -0.3, 0.012], r: [0.5, -0.3, 0.3], proj: 'keep' }); // curling corner
      return { ao: 0, aoH: 0.1 };
    },
  },

  'wall-advert': {
    key: (o) => o.kind || 'clinic',
    build(k, o) {
      k.add(new PlaneGeometry(2.1, 1.1, 1, 1), 'concrete', { p: [0, 0, 0.001], tint: '#cfc4a8' });
      k.add(new PlaneGeometry(2, 1, 1, 1), wallAdvertArt(o.kind || 'clinic'), { p: [0, 0, 0.004], proj: 'keep' });
      return { ao: 0, aoH: 0.1 };
    },
  },

  signboard: {
    key: (o) => JSON.stringify(o.lines || []) + (o.w || 1.6) + (o.h || 0.5),
    build(k, o) {
      const w = o.w || 1.6;
      const h = o.h || 0.5;
      const lines = o.lines || [{ text: 'ఇడ్లీ దోశ చాయ్', font: 'te', size: 76 }, { text: 'IDLY - DOSA - CHAI', font: 'en', size: 52, color: '#1f5fa8' }, { text: 'इडली डोसा चाय', font: 'hi', size: 48 }];
      const S = k.sub('board', [0, h / 2 + 0.28, 0]);
      S.add(new PlaneGeometry(w, h, 1, 1), signboardArt(`sb:${lines.map((l) => l.text).join('|')}`, lines, { w: 1024, h: Math.round(1024 * (h / w)) }), { p: [0, 0, 0.012], proj: 'keep' });
      S.rbox('steelDark', w, h, 0.02, 0.008, { p: [0, 0, 0], tint: '#3c3a36' }, 1);
      for (const sx of [-1, 1]) S.tube('steelDark', [[sx * (w / 2 - 0.08), h / 2, 0], [sx * (w / 2 - 0.05), h / 2 + 0.16, 0], [sx * 0.02, h / 2 + 0.28, 0]], 0.004, { tint: '#4a4640' }, 8, 4);
      return { ao: 0, aoH: 0.1 };
    },
    rig({ sub }, o, api) {
      api.anim((dt, t) => {
        if (sub.board) sub.board.rotation.set(0, Math.sin(t * 0.7) * 0.05, Math.sin(t * 1.1) * 0.012);
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'bulb-string': {
    key: (o) => `${o.n || 7}:${o.span || 3.2}:${o.sag ?? 0.22}`,
    build(k, o) {
      const n = o.n || 7;
      const span = o.span || 3.2;
      const sag = o.sag ?? 0.22;
      const S = k.sub('sway', [0, 0, 0]);
      const wire = sagPoints([-span / 2, 0, 0], [span / 2, 0, 0], sag, 12, 0.02, 3);
      S.tube('rubber', wire, 0.0055, { tint: '#1b1917' }, 36, 4);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = -span / 2 + t * span;
        const y = -sag * 4 * t * (1 - t);
        S.cyl('matte', 0.016, 0.02, 0.05, 8, { p: [x, y - 0.03, 0], tint: '#17120e' });
        S.cyl('brass', 0.013, 0.013, 0.015, 8, { p: [x, y - 0.06, 0], tint: '#b8903a' });
        S.lathe('glow', [[0.0, -0.067], [0.012, -0.07], [0.028, -0.092], [0.034, -0.12], [0.026, -0.15], [0.012, -0.165], [0.0, -0.17]], 12, { p: [x, y, 0], tint: '#ffd68a' });
        S.add(new PlaneGeometry(0.62, 0.62), haloMat(), { p: [x, y - 0.12, 0.01], proj: 'keep', tint: '#ffb25a' });
        S.add(new PlaneGeometry(0.62, 0.62), haloMat(), { p: [x, y - 0.12, 0], r: [0, PI / 2, 0], proj: 'keep', tint: '#ffb25a' });
      }
      return { ao: 0, aoH: 0.1 };
    },
    rig({ sub }, o, api) {
      api.anim((dt, t) => {
        if (sub.sway) sub.sway.rotation.set(Math.sin(t * 0.9) * 0.01, 0, Math.sin(t * 1.3) * 0.012);
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'newspaper-basket': {
    build(k) {
      const news = newsprintArt();
      k.lathe('bamboo', [[0, 0.0], [0.17, 0.0], [0.2, 0.04], [0.24, 0.13], [0.27, 0.22]], 22, { tint: '#d8b672', uvs: [10, 3] });
      k.tor('bamboo', 0.27, 0.014, 5, 22, { p: [0, 0.22, 0], r: [PI / 2, 0, 0], tint: '#c4a05a' });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2;
        k.cyl('bamboo', 0.006, 0.006, 0.23, 4, { p: [Math.cos(a) * 0.222, 0.12, Math.sin(a) * 0.222], r: [Math.sin(a) * -0.25, 0, Math.cos(a) * 0.25], tint: '#bf9a52' });
      }
      k.lathe(news, [[0, 0.04], [0.16, 0.045], [0.235, 0.13], [0.262, 0.205], [0.265, 0.23]], 22, { proj: 'keep', pre: lumps({ amp: 0.012, freq: 8, oct: 2, seed: 2 }) });
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7;
        k.add(new PlaneGeometry(0.22, 0.3, 4, 4), news, { p: [Math.cos(a) * 0.2, 0.235, Math.sin(a) * 0.2], r: [-PI / 2 + Math.sin(a) * 0.3, a, 0.1], proj: 'keep', pre: lumps({ amp: 0.02, freq: 6, oct: 2, seed: i }) });
      }
      for (let i = 0; i < 3; i++) {
        k.cyl(news, 0.002, 0.048, 0.18, 10, { p: [0.4 + i * 0.07, 0.09, 0.05 - i * 0.03], r: [0.2, i, 0.25], proj: 'keep' }, true);
      }
      return { ao: 0.3, aoH: 0.12 };
    },
  },

  'jute-sacks': {
    build(k) {
      const layout = [[-0.32, 0.0, 0.0, 0.1], [0.12, 0.0, 0.04, -0.15], [0.52, 0.0, -0.02, 0.3], [-0.12, 0.62, 0.02, 0.5], [0.3, 0.6, 0.0, -0.4], [0.05, 1.18, 0.0, 0.2]];
      layout.forEach(([x, y, z, ry], i) => {
        const cy = y + 0.34;
        k.sph('jute', 1, 12, 9, { p: [x, cy, z], s: [0.27, 0.34, 0.19], r: [0, ry, 0], pre: lumps({ amp: 0.03, freq: 3.5, oct: 2, seed: i + 2 }), tint: '#e0bf8c', vary: 0.1 });
        k.cyl('jute', 0.07, 0.09, 0.13, 8, { p: [x, cy + 0.33, z], r: [0.1, ry, 0.15], tint: '#d5b480' }, false);
        k.tor('rope', 0.075, 0.009, 4, 10, { p: [x, cy + 0.3, z], r: [PI / 2, 0, 0], tint: '#bfa070', uvs: [8, 1] });
        if (i < 5) k.add(new PlaneGeometry(0.34, 0.25), sackStencil(['BASMATI RICE', 'TOOR DAL', 'SUGAR', 'WHEAT ATTA', 'RICE'][i]), { p: [x - Math.sin(ry) * 0.02, cy + 0.02, z + 0.195 * Math.cos(ry * 0.3)], r: [0, ry * 0.3, 0], proj: 'keep' });
      });
      return { ao: 0.4, aoH: 0.4 };
    },
  },

  'cable-tangle': {
    key: (o) => `${o.n || 14}:${o.w || 3}`,
    build(k, o) {
      const w = o.w || 3;
      cableTangle(k, { c: [0, 0, 0], size: [w, 0.9, 0.5], n: o.n || 14, seed: 11, r: 0.0095 });
      cableTangle(k, { c: [w * 0.1, -0.1, 0.1], size: [w * 0.4, 0.5, 0.2], n: 6, seed: 12, r: 0.008 });
      k.rbox('paintWorn', 0.16, 0.2, 0.1, 0.008, { p: [-w * 0.3, -0.25, 0.05], tint: '#7a7e78' }, 1);
      // a torn kite caught on the wires
      k.add(new PlaneGeometry(0.34, 0.34, 3, 3), 'cloth', { p: [w * 0.22, -0.3, 0.1], r: [0.2, 0.3, PI / 4], tint: '#d9322a', pre: lumps({ amp: 0.012, freq: 5, oct: 1 }) });
      k.tube('rope', [[w * 0.22 - 0.17, -0.47, 0.1], [w * 0.22 - 0.2, -0.9, 0.12], [w * 0.22 - 0.1, -1.4, 0.1]], 0.003, { tint: '#d9d2bd', uvs: [8, 1] }, 10, 4);
      return { ao: 0, aoH: 0.1 };
    },
  },
};
