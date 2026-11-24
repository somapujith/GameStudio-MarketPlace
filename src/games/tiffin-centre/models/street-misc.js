// Street props, set B: pani-puri cart, flickering tube-light with halo, electric pole with a tangle of wires, printed flex banner.
import { AdditiveBlending, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import { cableTangle, folds, sagPoints } from './street-kit.js';
import { filmPosterArt, flexTexture, paniPuriDecal, wallAdvertArt } from './street-art.js';
import { drawnTexture } from './texgen.js';
import { sharedTexture } from './util.js';

const PI = Math.PI;

/** Soft radial glow sprite texture (shared): white centre fading to nothing. */
export const softGlowTexture = () =>
  sharedTexture('softGlow', () =>
    drawnTexture(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }, { srgb: true }),
  );

/** A spoked cart wheel (static): iron-tyred rim, hub, spokes. */
function cartWheel(k, x, y, z, R, w, spokes = 8) {
  k.tor('tyre', R - 0.014, 0.014, 4, 16, { p: [x, y, z], r: [0, PI / 2, 0], s: [1, 1, w / 0.028] });
  k.tor('stainless', R - 0.035, 0.006, 3, 16, { p: [x, y, z], r: [0, PI / 2, 0] });
  k.cyl('steelDark', 0.03, 0.03, w * 1.6, 6, { p: [x, y, z], r: [0, 0, PI / 2] });
  for (let i = 0; i < spokes / 2; i++) k.box('stainless', 0.004, (R - 0.04) * 2, 0.004, { p: [x, y, z], r: [(i * PI) / (spokes / 2), 0, 0], tint: '#c8cdd0' });
}

export const PROPS_MISC = {
  // ---------------------------------------------------------------------------------------------------------------------------
  'panipuri-cart': {
    build(k) {
      const TEAL = '#1f8a78';
      k.rbox('paintWorn', 1.0, 0.56, 0.68, 0.015, { p: [0, 0.56, 0], tint: TEAL }, 1);
      k.box('wood', 1.08, 0.045, 0.78, { p: [0, 0.865, 0], vary: 0.1 });
      k.box('steelDark', 1.02, 0.03, 0.7, { p: [0, 0.27, 0], tint: '#35302c' });
      k.add(new PlaneGeometry(0.72, 0.2), paniPuriDecal(), { p: [-0.1, 0.62, 0.343], proj: 'keep' });
      for (const sx of [-1, 1]) cartWheel(k, sx * 0.56, 0.3, 0.02, 0.3, 0.05);
      k.cyl('steelDark', 0.016, 0.016, 1.2, 8, { p: [0, 0.3, 0.02], r: [0, 0, PI / 2] });
      // push handle at the back + a leg at the front
      for (const sx of [-1, 1]) k.cyl('woodDark', 0.02, 0.022, 0.9, 8, { p: [sx * 0.42, 0.7, -0.78], r: [PI / 2 - 0.08, 0, 0], vary: 0.1 });
      k.cyl('woodDark', 0.018, 0.018, 0.9, 8, { p: [0, 0.77, -1.22], r: [0, 0, PI / 2] });
      for (const sx of [-1, 1]) k.cyl('steelDark', 0.02, 0.02, 0.28, 8, { p: [sx * 0.4, 0.14, 0.32] });
      // glass case on the left of the counter: aluminium frame, glass, golgappas piled inside
      const cx = -0.22;
      const cy = 0.89;
      for (const [x, z] of [[-0.3, -0.21], [0.3, -0.21], [-0.3, 0.21], [0.3, 0.21]]) k.box('stainless', 0.016, 0.44, 0.016, { p: [cx + x, cy + 0.22, z] });
      for (const [w, d, y] of [[0.62, 0.44, 0.0], [0.62, 0.44, 0.44]]) {
        k.box('stainless', w, 0.016, 0.016, { p: [cx, cy + y, d / 2] });
        k.box('stainless', w, 0.016, 0.016, { p: [cx, cy + y, -d / 2] });
        k.box('stainless', 0.016, 0.016, d, { p: [cx - w / 2, cy + y, 0] });
        k.box('stainless', 0.016, 0.016, d, { p: [cx + w / 2, cy + y, 0] });
      }
      k.plane('glass', 0.6, 0.42, 1, 1, { p: [cx, cy + 0.22, 0.222], proj: 'keep', tint: '#dff2f0' });
      k.plane('glass', 0.6, 0.42, 1, 1, { p: [cx, cy + 0.22, -0.222], proj: 'keep', tint: '#dff2f0' });
      k.plane('glass', 0.42, 0.42, 1, 1, { p: [cx - 0.31, cy + 0.22, 0], r: [0, PI / 2, 0], proj: 'keep', tint: '#dff2f0' });
      k.plane('glass', 0.42, 0.42, 1, 1, { p: [cx + 0.31, cy + 0.22, 0], r: [0, PI / 2, 0], proj: 'keep', tint: '#dff2f0' });
      k.plane('glass', 0.62, 0.44, 1, 1, { p: [cx, cy + 0.45, 0], r: [-PI / 2, 0, 0], proj: 'keep', tint: '#dff2f0' });
      const rr = (i) => {
        const a = Math.sin(i * 12.9898) * 43758.5453;
        return a - Math.floor(a);
      };
      for (let i = 0; i < 10; i++) {
        const row = Math.floor(i / 4);
        const col = i % 4;
        k.sph('matte', 0.04, 6, 4, { p: [cx - 0.24 + col * 0.08 + (row % 2) * 0.04, cy + 0.05 + row * 0.065, -0.1 + rr(i) * 0.2], s: [1, 0.9 + rr(i + 3) * 0.2, 1], tint: ['#d9902a', '#cf8325', '#e0a03a'][i % 3] });
      }
      // steel matkas (pudina and tamarind water) with lids, a ladle, a leaf-bowl stack, a tub of masala potato
      k.lathe('steel', [[0.0, 0.0], [0.09, 0.0], [0.125, 0.06], [0.14, 0.15], [0.115, 0.23], [0.08, 0.27]], 14, { p: [0.25, 0.89, 0.12] });
      k.cyl('steel', 0.085, 0.085, 0.012, 18, { p: [0.25, 1.17, 0.12] });
      k.sph('steel', 0.016, 8, 5, { p: [0.25, 1.19, 0.12] });
      k.lathe('steel', [[0.0, 0.0], [0.075, 0.0], [0.105, 0.05], [0.115, 0.13], [0.095, 0.2], [0.07, 0.23]], 12, { p: [0.4, 0.89, -0.15] });
      k.cyl('matte', 0.072, 0.072, 0.012, 16, { p: [0.4, 1.12, -0.15], tint: '#4f7f2b' });
      k.tube('stainless', [[0.45, 1.2, -0.15], [0.52, 1.1, -0.1], [0.55, 0.96, -0.05]], 0.006, undefined, 8, 5);
      for (let i = 0; i < 6; i++) k.lathe('jute', [[0, 0], [0.04, 0], [0.065, 0.018], [0.07, 0.024]], 12, { p: [0.0, 0.89 + i * 0.012, 0.22], tint: '#9bb05a' });
      k.cyl('plastic', 0.09, 0.075, 0.1, 14, { p: [0.12, 0.94, -0.22], tint: '#2a5ea8' });
      k.sph('matte', 1, 10, 6, { p: [0.12, 0.99, -0.22], s: [0.075, 0.03, 0.075], tint: '#d8b25a' });
      // umbrella
      k.cyl('stainless', 0.012, 0.012, 1.4, 8, { p: [0.3, 1.59, -0.28] });
      k.cyl('cloth', 0.02, 1.0, 0.3, 12, { p: [0.3, 2.26, -0.28], tint: '#e5ae16', pre: folds({ n: 12, amp: 0.025, yLo: -0.15, yHi: 0.0 }) }, true);
      k.tor('matte', 1.0, 0.012, 4, 24, { p: [0.3, 2.11, -0.28], r: [PI / 2, 0, 0], tint: '#a8231a' });
      for (let i = 0; i < 6; i++) k.cyl('stainless', 0.004, 0.004, 1.0, 3, { p: [0.3 + Math.cos((i / 8) * PI * 2) * 0.5, 2.19, -0.28 + Math.sin((i / 8) * PI * 2) * 0.5], r: [Math.sin((i / 8) * PI * 2) * 1.2, 0, -Math.cos((i / 8) * PI * 2) * 1.2] });
      return { ao: 0.4, aoH: 0.2 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'tube-light': {
    build(k) {
      k.rbox('steel', 1.24, 0.045, 0.085, 0.004, { p: [0, 0, 0], tint: '#d8d6cc' }, 1); // old batten channel
      for (const sx of [-1, 1]) {
        k.rbox('plastic', 0.045, 0.06, 0.09, 0.008, { p: [sx * 0.615, -0.012, 0], tint: '#e4e0d0' }, 1); // end caps
        k.cyl('steelDark', 0.003, 0.003, 0.9, 5, { p: [sx * 0.52, 0.45, 0], tint: '#222' }); // hanging wires
      }
      k.rbox('matte', 0.04, 0.03, 0.04, 0.004, { p: [0.3, 0.035, 0], tint: '#2a2622' }, 1); // choke
      k.tube('rubber', [[0.6, 0.03, 0.0], [0.8, 0.2, 0.04], [0.7, 0.9, 0.0]], 0.005, undefined, 8, 4);
      return { ao: 0, aoH: 0.1 };
    },
    extra(group, o, api) {
      // the tube itself (owned emissive material so the flicker can dim it) with burnt ends, and additive halo planes
      const tubeMat = new MeshBasicMaterial({ color: '#fffbe8', toneMapped: false });
      const tube = new Mesh(new CylinderGeometry(0.0125, 0.0125, 1.14, 10), tubeMat);
      tube.rotation.z = PI / 2;
      tube.position.set(0, -0.036, 0);
      group.add(tube);
      const haloMat = new MeshBasicMaterial({ map: softGlowTexture(), color: '#fff3c8', transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, opacity: 0.5 });
      const h1 = new Mesh(new PlaneGeometry(2.4, 0.9), haloMat);
      h1.position.set(0, -0.06, 0.08);
      const h2 = new Mesh(new PlaneGeometry(2.0, 0.9), haloMat);
      h2.rotation.x = PI / 2;
      h2.position.set(0, -0.2, 0);
      group.add(h1, h2);
      api.own(haloMat);
      api.anim((dt, t) => {
        // an old tube: slow shimmer and a rare stutter
        const stutter = Math.sin(t * 31) * Math.sin(t * 17.3) > 0.9 ? 0.25 : 1;
        const k = (0.93 + Math.sin(t * 52) * 0.04) * stutter;
        tubeMat.color.setRGB(k, 0.98 * k, 0.91 * k);
        haloMat.opacity = 0.5 * k * k;
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'pole-with-wires': {
    build(k) {
      // octagon-ish concrete pole, painted base band, cross-arms on angle iron, porcelain insulators
      k.cyl('concrete', 0.07, 0.125, 6.6, 12, { p: [0, 3.3, 0], vc: (x, y) => (y < 0.9 ? 0.82 : 1) * (y > 0.4 && y < 0.9 ? 0.55 : 1) * (0.9 + 0.1 * Math.sin(y * 9)), uvs: [2.2, 0.7] }, false, 6);
      k.cyl('concrete', 0.13, 0.15, 0.1, 12, { p: [0, 0.05, 0], tint: '#8d8b84' });
      for (const [y, w, d] of [[6.1, 1.7, 0.07], [5.65, 1.3, 0.06]]) {
        k.rbox('steelDark', w, 0.06, d, 0.004, { p: [0, y, 0], tint: '#6a5a4c' }, 1);
        for (let i = 0; i < 4; i++) {
          const x = (i - 1.5) * (w / 3.2);
          k.lathe('enamel', [[0, 0], [0.03, 0], [0.024, 0.03], [0.036, 0.055], [0.02, 0.1]], 7, { p: [x, y + 0.03, 0], tint: '#d8c8aa' });
        }
      }
      for (const sx of [-1, 1]) k.cyl('steelDark', 0.008, 0.008, 0.8, 5, { p: [sx * 0.3, 5.75, 0], r: [0, 0, sx * 0.9], tint: '#6a5a4c' }); // brace
      // meter box with a lock, junction box, street lamp on an arm, stay wire
      k.rbox('paintWorn', 0.3, 0.42, 0.17, 0.012, { p: [0, 3.3, 0.14], tint: '#6f7a82' }, 1);
      k.rbox('matte', 0.07, 0.05, 0.02, 0.004, { p: [0.06, 3.15, 0.235], tint: '#c8b060' }, 1);
      k.rbox('paintWorn', 0.2, 0.26, 0.12, 0.01, { p: [0, 4.45, 0.12], tint: '#8b8f86' }, 1);
      k.tube('steelDark', [[0.05, 5.2, 0], [0.3, 5.5, 0.0], [0.55, 5.52, 0.0]], 0.018, { tint: '#55504a' }, 8, 6);
      k.rbox('steel', 0.4, 0.08, 0.16, 0.02, { p: [0.62, 5.47, 0], tint: '#8e9396' }, 1);
      k.cap('glow', 0.07, 1.8, 10, 3, { p: [0.62, 5.42, 0], r: [PI, 0, 0], tint: '#ffb860' });
      k.tube('steelDark', [[0.0, 5.0, 0.0], [-0.5, 3.0, 1.0], [-0.9, 0.8, 2.0], [-0.95, 0.02, 2.2]], 0.006, { tint: '#3a3835' }, 14, 4);
      // posters and handbills on the pole
      k.add(new PlaneGeometry(0.26, 0.4), filmPosterArt(2), { p: [0.07, 2.2, 0.083], r: [0, 0.38, 0.05], proj: 'keep' });
      k.add(new PlaneGeometry(0.3, 0.2), wallAdvertArt('tuition'), { p: [-0.06, 1.6, 0.1], r: [0, -0.5, -0.04], proj: 'keep' });
      // wires: three phases each way, one street-ward run, a knot and a hanging loop
      for (const dir of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const x0 = (i - 1.5) * 0.53;
          k.tube('rubber', sagPoints([x0, 6.18, 0], [x0 + dir * 7, 6.0 + (i % 2) * 0.1, 0.3 + i * 0.12], 0.4 + i * 0.05, 7, 0.1, i + (dir > 0 ? 9 : 0)), 0.009, { tint: '#161514' }, 10, 3);
        }
        for (const [j, x0] of [[0, -0.35], [1, 0.35]]) {
          k.tube('rubber', sagPoints([x0, 5.7, 0], [x0 * 3 + dir * 5, 5.3, -2.2 - j], 0.5, 7, 0.1, 20 + j + dir), 0.008, { tint: '#26211e' }, 10, 3);
        }
      }
      cableTangle(k, { c: [0.05, 4.7, 0.18], size: [1.1, 0.6, 0.3], n: 7, seed: 3, r: 0.009 });
      cableTangle(k, { c: [0.0, 3.7, 0.2], size: [0.5, 1.2, 0.2], n: 3, seed: 5, r: 0.008 });
      return { ao: 0.2, aoH: 0.8 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  'flex-banner': {
    build(k, o) {
      const w = o.width || 3;
      const h = w / 4;
      // bamboo poles and rope ties, the banner cloth is per-instance (extra)
      for (const sx of [-1, 1]) {
        k.taper('bamboo', [[sx * (w / 2 + 0.05), 0, 0], [sx * (w / 2 + 0.05), (h + 0.5) / 2, 0.01], [sx * (w / 2 + 0.05), h + 0.5, 0]], (t) => 0.026 - t * 0.008, { proj: 'keep', uvs: [3, 3] }, 6, 8);
        for (const y of [0.04, h * 0.5, h - 0.02]) k.tor('rope', 0.03, 0.006, 4, 10, { p: [sx * (w / 2 + 0.05), y + 0.1, 0], r: [PI / 2, 0, 0], tint: '#c9a56a' });
      }
      return { ao: 0.3, aoH: 0.3 };
    },
    extra(group, o, api) {
      const w = o.width || 3;
      const h = w / 4;
      const tex = flexTexture({ text: o.text || 'TIFFIN CENTRE', te: o.te || '', colors: o.colors || ['#d9261c', '#fff4dc', '#ffc83d'] });
      const mat = new MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0, side: DoubleSide });
      const geo = new PlaneGeometry(w, h, 28, 5);
      const cloth = new Mesh(geo, mat);
      cloth.position.set(0, h / 2 + 0.12, 0);
      group.add(cloth);
      // grommets + hem
      const gm = new MeshStandardMaterial({ color: '#cfd5d8', metalness: 1, roughness: 0.3 });
      const gg = new SphereGeometry(0.014, 6, 4);
      for (let i = 0; i <= 6; i++) {
        for (const y of [-h / 2 + 0.025, h / 2 - 0.025]) {
          const m = new Mesh(gg, gm);
          m.scale.set(1, 1, 0.5);
          m.position.set((i / 6 - 0.5) * (w - 0.1), y, 0.004);
          cloth.add(m);
        }
      }
      const pos = geo.attributes.position;
      const base = Float32Array.from(pos.array);
      api.anim((dt, t) => {
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          const y = base[i * 3 + 1];
          const edge = 1 - Math.abs(x) / (w / 2); // pinned at the ends
          pos.setZ(i, Math.sin(x * 2.4 + t * 1.7) * 0.014 * edge + Math.sin(x * 5 - t * 2.3 + y * 3) * 0.006 * edge + (0.016 * (1 - (2 * x) ** 2 / (w * w) * 4 * 0.25)) * 0);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      });
    },
  },
};
