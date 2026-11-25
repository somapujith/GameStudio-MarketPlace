// Street props, set A: the stall kit seen at arm's length (LPG cylinder, steel drum, batter bucket, plates, stool, bench, thela, gallaa).
// Real proportions in metres, PBR materials (materials-street.js), dents and wear baked into the geometry and the textures.
// Each def: { key(o), build(kit, o) -> kit.build options, rig?({group, sub}, o, api), extra?(group, o, api) }.
import { AdditiveBlending, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { dents, folds, lumps } from './street-kit.js';
import { lpgDecal, moneyBoxSticker } from './street-art.js';

const TAU = Math.PI * 2;
const ring = (n, fn) => {
  for (let i = 0; i < n; i++) fn((i / n) * TAU, i);
};

export const PROPS_A = {
  // ---------------------------------------------------------------------------------------------------------------------------
  // Domestic LPG cylinder (14.2 kg): dented red steel, black foot ring, valve + guard ring, blue regulator, orange hose.
  lpg: {
    key: (o) => o.color || '',
    build(k, o) {
      const red = o.color || '#b5271c';
      const dent = dents({ seed: 2, n: 10, depth: -0.0032, radius: 0.04, yMin: 0.08, yMax: 0.46 });
      k.lathe('paintWorn', [[0.0, 0.042], [0.075, 0.044], [0.12, 0.062], [0.146, 0.1], [0.1535, 0.16], [0.1545, 0.25], [0.1535, 0.36], [0.149, 0.42], [0.122, 0.47], [0.088, 0.5], [0.054, 0.516], [0.037, 0.522]], 32, { tint: red, pre: dent, vary: 0.04, vc: (x, y, z) => (0.78 + 0.22 * Math.min(1, y / 0.16)) * (0.94 + 0.06 * Math.sin(x * 90 + z * 40)) });
      // foot ring (black, scuffed) and the weld seams
      k.lathe('paintWorn', [[0.106, 0.0], [0.124, 0.0], [0.127, 0.03], [0.124, 0.056], [0.106, 0.05]], 28, { tint: '#2a2522' });
      for (const [y, rr] of [[0.074, 0.129], [0.455, 0.1305]]) k.tor('paintWorn', rr, 0.0028, 4, 32, { p: [0, y, 0], r: [Math.PI / 2, 0, 0], tint: '#8f2018' });
      // collar, valve, regulator, guard ring
      k.lathe('steelDark', [[0.034, 0.518], [0.052, 0.524], [0.054, 0.548], [0.046, 0.556], [0.032, 0.55]], 18, { tint: '#8a8a86' });
      k.cyl('brass', 0.019, 0.022, 0.05, 12, { p: [0, 0.578, 0], tint: '#c79a3c' });
      k.cyl('enamel', 0.032, 0.03, 0.07, 14, { p: [0, 0.628, 0], tint: '#1f58a8' });
      k.cyl('enamel', 0.012, 0.012, 0.006, 8, { p: [0, 0.665, 0], tint: '#141414' });
      k.rbox('enamel', 0.012, 0.012, 0.07, 0.003, { p: [0.0, 0.676, 0.025], r: [-0.35, 0, 0], tint: '#d3231a' }, 1); // regulator lever
      k.cyl('steel', 0.009, 0.009, 0.05, 8, { p: [0.05, 0.63, 0], r: [0, 0, Math.PI / 2] });
      k.cyl('brass', 0.011, 0.011, 0.012, 8, { p: [0.082, 0.63, 0], r: [0, 0, Math.PI / 2], tint: '#c79a3c' });
      k.tube('enamel', [[0.085, 0.63, 0], [0.12, 0.6, 0.02], [0.17, 0.46, 0.05], [0.2, 0.22, 0.09], [0.225, 0.04, 0.12], [0.3, 0.012, 0.2], [0.38, 0.012, 0.12], [0.34, 0.012, 0.02], [0.22, 0.012, -0.04], [0.14, 0.012, -0.02]], 0.0085, { tint: '#f26a14' }, 36, 6);
      ring(3, (a) => {
        k.rbox('paint', 0.022, 0.12, 0.004, 0.0015, { p: [Math.cos(a) * 0.098, 0.532, Math.sin(a) * 0.098], r: [0, -a + Math.PI / 2, 0], tint: red }, 1);
      });
      k.tor('paint', 0.1, 0.0065, 5, 24, { p: [0, 0.587, 0], r: [Math.PI / 2, 0, 0], tint: red });
      // the stencilled marking (curved decal on the +z face)
      k.add(new CylinderGeometry(0.1552, 0.1552, 0.138, 18, 1, true, -0.92, 1.84), lpgDecal(), { p: [0, 0.262, 0], proj: 'keep' });
      return { ao: 0.45, aoH: 0.12 };
    },
    // the live parts: a pressure gauge on the regulator (the needle follows setLevel) and a tiny hissing flame at the valve when the gas runs low
    extra(group, o, api, out) {
      const faceMat = new MeshBasicMaterial({ color: '#f4f0e0', toneMapped: false });
      const face = new Mesh(new CircleGeometry(0.021, 16), faceMat);
      face.position.set(0, 0.7, 0.012);
      const arcMat = new MeshBasicMaterial({ color: '#2fbf5a', toneMapped: false, side: DoubleSide });
      const bar = new Mesh(new PlaneGeometry(0.03, 0.006), arcMat);
      bar.position.set(0, -0.007, 0.0008);
      face.add(bar);
      const needleMat = new MeshBasicMaterial({ color: '#c0261c', toneMapped: false, side: DoubleSide });
      const needle = new Mesh(new PlaneGeometry(0.0035, 0.019).translate(0, 0.0095, 0), needleMat);
      needle.position.z = 0.0016;
      face.add(needle);
      group.add(face);
      const flameMat = new MeshBasicMaterial({ color: '#7aaaff', transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
      const flame = new Mesh(new ConeGeometry(0.008, 0.05, 6).translate(0, 0.025, 0), flameMat);
      flame.position.set(0.082, 0.64, 0);
      flame.rotation.z = -Math.PI / 2 + 0.5;
      flame.visible = false;
      group.add(flame);
      let level = 1;
      let low = false;
      out.setLevel = (f) => {
        level = Math.max(0, Math.min(1, f));
        needle.rotation.z = (0.5 - level) * 2.1; // full = swung right, empty = left
        arcMat.color.set(level < 0.2 ? '#d93a2a' : level < 0.45 ? '#e0b020' : '#2fbf5a');
      };
      out.setLow = (b) => {
        low = !!b;
        if (!low) flame.visible = false;
      };
      out.setLevel(1);
      api.anim((dt, t) => {
        if (!low) return;
        // a thin blue lick that gutters: on most of the time, a stutter now and then
        const on = Math.sin(t * 23) * Math.sin(t * 7.3) > -0.55;
        flame.visible = on;
        flame.scale.set(1, 0.7 + 0.5 * Math.abs(Math.sin(t * 31)), 1);
      });
      api.own({ dispose: () => { faceMat.dispose(); arcMat.dispose(); needleMat.dispose(); flameMat.dispose(); face.geometry.dispose(); bar.geometry.dispose(); needle.geometry.dispose(); flame.geometry.dispose(); } });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // Big stainless tiffin drum: spun body, rolled rim, swages, dished lid with a bakelite knob, riveted loop handles, dents.
  'tiffin-drum': {
    build(k) {
      const dent = dents({ seed: 5, n: 9, depth: -0.006, radius: 0.085, yMin: 0.05, yMax: 0.42 });
      k.lathe('steel', [[0, 0], [0.17, 0.0], [0.188, 0.008], [0.198, 0.028], [0.2, 0.06], [0.204, 0.2], [0.208, 0.34], [0.212, 0.44], [0.214, 0.452]], 24, { pre: dent });
      k.tor('steel', 0.2125, 0.0105, 4, 24, { p: [0, 0.455, 0], r: [Math.PI / 2, 0, 0] });
      for (const [y, r] of [[0.125, 0.2055], [0.305, 0.2095]]) k.tor('steel', r, 0.0045, 3, 24, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
      k.tor('steelDark', 0.198, 0.0055, 3, 24, { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0], tint: '#9aa3a8' }); // base bead
      const lidDent = dents({ seed: 6, n: 4, depth: -0.003, radius: 0.04 });
      k.lathe('steel', [[0.0, 0.0], [0.2, 0.0], [0.226, 0.004], [0.233, 0.013], [0.231, 0.022], [0.206, 0.03], [0.13, 0.042], [0.06, 0.054], [0.0, 0.058]], 24, { p: [0, 0.452, 0], pre: lidDent });
      k.tor('steel', 0.205, 0.0045, 3, 24, { p: [0, 0.484, 0], r: [Math.PI / 2, 0, 0] });
      k.cyl('steelDark', 0.012, 0.016, 0.022, 10, { p: [0, 0.518, 0] });
      k.sph('matte', 0.024, 12, 8, { p: [0, 0.542, 0], tint: '#15110e' });
      for (const sx of [-1, 1]) {
        k.rbox('steel', 0.012, 0.05, 0.06, 0.004, { p: [sx * 0.207, 0.33, 0], r: [0, 0, sx * 0.03] }, 1);
        k.tor('steel', 0.048, 0.0075, 6, 18, { p: [sx * 0.214, 0.33, 0], r: [0, 0, sx * -Math.PI / 2] }, Math.PI);
        for (const dz of [-0.02, 0.02]) k.cyl('steelDark', 0.006, 0.006, 0.006, 8, { p: [sx * 0.215, 0.33, dz], r: [0, 0, Math.PI / 2] });
      }
      return { ao: 0.4, aoH: 0.12 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // White HDPE batter bucket under a cotton cloth, wire bail, a ladle through the cloth, dried batter runs.
  'batter-bucket': {
    key: (o) => `${o.dyn ? 'dyn' : o.open ? 'open' : 'cloth'}`,
    build(k, o) {
      const prof = [[0, 0], [0.1, 0.0], [0.114, 0.008], [0.119, 0.03], [0.128, 0.12], [0.137, 0.21], [0.147, 0.28], [0.152, 0.296], [0.156, 0.302]];
      k.lathe('plastic', prof, 24, { tint: '#f1efe8', pre: lumps({ amp: 0.0015, freq: 12, oct: 1 }) });
      for (const y of [0.07, 0.125, 0.185, 0.245]) k.tor('plastic', 0.119 + (y / 0.3) * 0.032 + 0.0012, 0.0042, 3, 22, { p: [0, y, 0], r: [Math.PI / 2, 0, 0], tint: '#e9e6dc' });
      k.tor('plastic', 0.1555, 0.0085, 4, 24, { p: [0, 0.3, 0], r: [Math.PI / 2, 0, 0], tint: '#f4f2ea' });
      // wire bail + grip + ear lugs
      k.tor('stainless', 0.158, 0.0026, 4, 28, { p: [0, 0.272, 0], r: [0, 0, 0] }, Math.PI);
      k.cyl('plastic', 0.0105, 0.0105, 0.1, 10, { p: [0, 0.43, 0], r: [0, 0, Math.PI / 2], tint: '#2b6fb3' });
      for (const sx of [-1, 1]) k.rbox('plastic', 0.012, 0.03, 0.03, 0.004, { p: [sx * 0.153, 0.272, 0], tint: '#e8e5da' }, 1);
      if (!o.open && !o.dyn) {
        // the cloth cover, tied under the rim with string, stained
        k.lathe('cloth', [[0, 0.326], [0.05, 0.329], [0.11, 0.326], [0.153, 0.316], [0.171, 0.29], [0.176, 0.25], [0.172, 0.222]], 24, {
          tint: '#efe9d8',
          pre: folds({ n: 11, amp: 0.0085, yLo: 0.25, yHi: 0.31, seed: 1 }),
          vc: (x, y, z) => 0.94 + 0.06 * Math.sin(x * 31 + z * 7) * Math.cos(z * 19 + y * 13) - (y < 0.27 ? 0.04 : 0),
        });
        k.tor('matte', 0.1685, 0.0032, 3, 20, { p: [0, 0.255, 0], r: [Math.PI / 2, 0, 0], tint: '#b9a77a' });
        k.tube('stainless', [[0.04, 0.328, 0.0], [0.09, 0.35, 0.02], [0.17, 0.43, 0.04], [0.215, 0.49, 0.05], [0.245, 0.48, 0.055], [0.252, 0.455, 0.055]], 0.0052, undefined, 10, 5); // ladle handle
        k.sph('stainless', 0.011, 8, 6, { p: [0.04, 0.328, 0.0] });
      } else {
        if (!o.dyn) k.lathe('matte', [[0, 0.255], [0.14, 0.255], [0.148, 0.29]], 24, { tint: '#efe3c8' }); // batter surface
        k.tube('stainless', [[0.02, 0.26, 0.0], [0.09, 0.33, 0.02], [0.17, 0.43, 0.04], [0.215, 0.49, 0.05], [0.245, 0.48, 0.055], [0.252, 0.455, 0.055]], 0.0052, undefined, 10, 5);
      }
      // batter runs down the outside
      for (const [a, len, w] of [[0.5, 0.07, 0.011], [1.4, 0.045, 0.008], [2.5, 0.09, 0.012], [4.1, 0.05, 0.009], [5.3, 0.06, 0.01]]) {
        const y = 0.215 - len / 2;
        const r = 0.148 + 0.0025 - (0.3 - y) * 0.04;
        k.sph('enamel', 1, 6, 5, { p: [Math.cos(a) * r, y, Math.sin(a) * r], s: [w * 0.5, len / 2, w], r: [0, -a, 0], tint: '#f0e6cc' });
      }
      return { ao: 0.35, aoH: 0.1 };
    },
    // `dyn`: an open bucket whose batter has a level and a sourness that follow the stock (setFill(fill 0..1, sour 0..1))
    extra(group, o, api, out) {
      if (!o.dyn) return;
      const mat = new MeshStandardMaterial({ color: '#efe3c8', roughness: 0.55, metalness: 0 });
      const geo = new CircleGeometry(1, 24).rotateX(-Math.PI / 2);
      const surf = new Mesh(geo, mat);
      const foam = new Mesh(geo, new MeshStandardMaterial({ color: '#f6efd8', roughness: 0.9, transparent: true, opacity: 0.0, depthWrite: false }));
      foam.position.y = 0.002;
      surf.add(foam);
      group.add(surf);
      const fresh = new Color('#efe3c8');
      const sourC = new Color('#cdb862');
      out.setFill = (fill, sour = 0) => {
        const f = Math.max(0, Math.min(1, fill));
        const y = 0.035 + f * 0.225;
        const r = 0.1 + 0.047 * (y / 0.28) - 0.008;
        surf.position.y = y;
        surf.scale.set(r, 1, r);
        surf.visible = f > 0.001;
        mat.color.copy(fresh).lerp(sourC, Math.max(0, Math.min(1, sour)));
        foam.material.opacity = Math.max(0, Math.min(1, sour)) * 0.7; // sour batter froths
      };
      out.setFill(0.7, 0);
      api.own({ dispose: () => { mat.dispose(); foam.material.dispose(); geo.dispose(); } });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // Stack of stainless thali plates with rolled rims (each tilted and turned a little) and a stack of katoris.
  'plate-stack': {
    build(k) {
      const plate = [[0, 0], [0.094, 0.0], [0.112, 0.004], [0.131, 0.018], [0.137, 0.024], [0.132, 0.027]];
      for (let i = 0; i < 12; i++) {
        const a = Math.sin(i * 12.9898) * 43758.5453;
        const f = a - Math.floor(a);
        k.lathe('steel', plate, 18, { p: [0.004 * (f - 0.5), 0.0105 * i, 0.004 * (Math.cos(i * 4.1) * 0.5)], r: [0.012 * (f - 0.5), i * 1.9, 0.012 * Math.cos(i * 7.7)], vary: 0.07 });
      }
      const bowl = [[0, 0], [0.026, 0.0], [0.04, 0.01], [0.05, 0.034], [0.052, 0.042]];
      for (let i = 0; i < 5; i++) k.lathe('steel', bowl, 14, { p: [0.235, 0.0125 * i, 0.03], r: [0.015 * Math.sin(i * 3), i, 0.015 * Math.cos(i * 5)], vary: 0.06 });
      for (let i = 0; i < 2; i++) k.lathe('steel', bowl, 14, { p: [-0.21 + i * 0.07, 0.044, 0.06 + i * 0.01], r: [Math.PI, 0, 0.1] }); // two katoris upside-down
      return { ao: 0.3, aoH: 0.06 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // Moulded plastic stool: dished seat, skirt, splayed legs with a ring brace, rubber feet. Scuffed.
  stool: {
    key: (o) => o.color || '',
    build(k, o) {
      const c = o.color || '#c4281d';
      k.lathe('plastic', [[0, 0.385], [0.14, 0.388], [0.184, 0.4], [0.196, 0.42], [0.193, 0.434], [0.176, 0.441], [0.1, 0.4375], [0.0, 0.435]], 28, { tint: c, vary: 0.03 });
      k.cyl('plastic', 0.167, 0.171, 0.05, 28, { p: [0, 0.365, 0], tint: c }, true);
      k.rbox('matte', 0.1, 0.004, 0.032, 0.0015, { p: [0, 0.4375, 0.115], tint: '#241311' }, 1);
      ring(4, (a) => {
        const t = 0.1;
        k.cyl('plastic', 0.026, 0.028, 0.37, 10, { p: [Math.cos(a + 0.785) * 0.168, 0.18, Math.sin(a + 0.785) * 0.168], r: [Math.sin(a + 0.785) * t, 0, -Math.cos(a + 0.785) * t], tint: c });
        k.cyl('rubber', 0.029, 0.031, 0.008, 10, { p: [Math.cos(a + 0.785) * 0.2, 0.004, Math.sin(a + 0.785) * 0.2], tint: '#1a1614' });
      });
      k.tor('plastic', 0.178, 0.0085, 5, 28, { p: [0, 0.17, 0], r: [Math.PI / 2, 0, 0], tint: c });
      return { ao: 0.4, aoH: 0.15 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // Plank bench (tea-stall style): three worn seat planks, trestle ends, a long stretcher, bolts.
  bench: {
    build(k) {
      for (let i = 0; i < 3; i++) {
        k.rbox('wood', 1.72, 0.036, 0.098, 0.006, { p: [(i - 1) * 0.004, 0.452, (i - 1) * 0.106], vary: 0.14 }, 1);
      }
      for (const sx of [-1, 1]) {
        const x = sx * 0.72;
        k.rbox('woodDark', 0.05, 0.43, 0.05, 0.005, { p: [x, 0.215, -0.12], r: [0.1, 0, 0], uvr: true, vary: 0.1 }, 1);
        k.rbox('woodDark', 0.05, 0.43, 0.05, 0.005, { p: [x, 0.215, 0.12], r: [-0.1, 0, 0], uvr: true, vary: 0.1 }, 1);
        k.rbox('woodDark', 0.055, 0.04, 0.3, 0.005, { p: [x, 0.425, 0], vary: 0.1 }, 1);
        k.rbox('woodDark', 0.04, 0.035, 0.27, 0.005, { p: [x, 0.17, 0] }, 1);
        for (const dz of [-0.13, 0.13]) k.cyl('steelDark', 0.012, 0.012, 0.008, 8, { p: [x + sx * 0.03, 0.425, dz], r: [0, 0, Math.PI / 2], tint: '#7a6a5a' });
        k.rbox('steelDark', 0.012, 0.09, 0.012, 0.002, { p: [x - sx * 0.032, 0.395, 0.14] }, 1);
      }
      k.rbox('woodDark', 1.42, 0.04, 0.032, 0.005, { p: [0, 0.17, 0], vary: 0.1 }, 1);
      return { ao: 0.4, aoH: 0.15 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // Thela (hand-cart): plank bed, painted side boards, big wooden spoked wheels with iron tyres, long push handles, a sack and a drum.
  thela: {
    build(k) {
      const WZ = -0.12; // axle z
      // bed: six planks along z on two bearers
      for (let i = 0; i < 6; i++) k.rbox('wood', 0.15, 0.034, 1.5, 0.004, { p: [-0.375 + i * 0.15, 0.665, 0], r: [0, 0, 0], uvr: true, vary: 0.16 }, 1);
      for (const sx of [-0.3, 0.3]) k.rbox('woodDark', 0.07, 0.07, 1.62, 0.006, { p: [sx, 0.61, 0.0], uvr: true }, 1);
      for (const z of [-0.6, 0.15, 0.6]) k.rbox('woodDark', 0.92, 0.05, 0.06, 0.005, { p: [0, 0.572, z], vary: 0.1 }, 1);
      // side boards and the back board (painted, worn)
      for (const sx of [-1, 1]) {
        k.rbox('woodPaint', 0.028, 0.15, 1.45, 0.004, { p: [sx * 0.455, 0.76, 0], tint: '#5fb0cf', uvr: false }, 1);
        for (const z of [-0.7, 0.7]) k.rbox('woodDark', 0.05, 0.18, 0.05, 0.005, { p: [sx * 0.455, 0.775, z], uvr: true }, 1);
      }
      k.rbox('woodPaint', 0.92, 0.15, 0.028, 0.004, { p: [0, 0.76, -0.725], tint: '#5fb0cf' }, 1);
      // axle + wheels
      k.cyl('steelDark', 0.022, 0.022, 1.2, 6, { p: [0, 0.36, WZ], r: [0, 0, Math.PI / 2] });
      for (const sx of [-1, 1]) {
        const x = sx * 0.57;
        k.tor('wood', 0.33, 0.026, 4, 20, { p: [x, 0.36, WZ], r: [0, Math.PI / 2, 0], vary: 0.08 });
        k.tor('steelDark', 0.357, 0.0125, 3, 24, { p: [x, 0.36, WZ], r: [0, Math.PI / 2, 0], tint: '#3b3a38' });
        k.cyl('steelDark', 0.05, 0.05, 0.1, 8, { p: [x, 0.36, WZ], r: [0, 0, Math.PI / 2], tint: '#44403c' });
        k.cyl('steelDark', 0.03, 0.03, 0.125, 8, { p: [x + sx * 0.012, 0.36, WZ], r: [0, 0, Math.PI / 2] });
        for (let i = 0; i < 6; i++) k.rbox('woodDark', 0.032, 0.66, 0.024, 0.004, { p: [x, 0.36, WZ], r: [(i * Math.PI) / 6, 0, 0], uvr: true, vary: 0.1 }, 1);
        k.rbox('steelDark', 0.03, 0.05, 0.2, 0.004, { p: [sx * 0.505, 0.55, WZ], tint: '#4a4642' }, 1); // bracket
      }
      // push handles, cross bar, prop leg, rope
      for (const sx of [-1, 1]) {
        k.taper('wood', [[sx * 0.3, 0.62, 0.7], [sx * 0.29, 0.66, 1.4], [sx * 0.28, 0.7, 2.1]], (t) => 0.034 - t * 0.012, { vary: 0.1 }, 6, 6);
      }
      k.cyl('woodDark', 0.015, 0.015, 0.62, 8, { p: [0, 0.69, 1.8], r: [0, 0, Math.PI / 2] });
      k.cyl('woodDark', 0.022, 0.026, 0.62, 8, { p: [0, 0.31, 1.15], r: [0.04, 0, 0] });
      k.tube('rope', [[0.3, 0.7, 1.45], [0.1, 0.68, 1.5], [-0.15, 0.68, 1.48], [-0.3, 0.7, 1.45]], 0.007, { tint: '#b99a66', uvs: [8, 1] }, 12, 5);
      // cargo: a jute sack, a blue drum, a bundle of newspaper
      k.sph('jute', 1, 10, 7, { p: [-0.18, 0.84, -0.3], s: [0.2, 0.17, 0.3], pre: lumps({ amp: 0.03, freq: 5, oct: 2, seed: 4 }), tint: '#d9b886' });
      k.cyl('plastic', 0.115, 0.105, 0.34, 14, { p: [0.22, 0.85, -0.38], tint: '#1f5fa8' });
      k.tor('plastic', 0.118, 0.007, 3, 14, { p: [0.22, 0.675, -0.38], r: [Math.PI / 2, 0, 0], tint: '#1f5fa8' });
      k.tor('plastic', 0.118, 0.007, 3, 14, { p: [0.22, 1.015, -0.38], r: [Math.PI / 2, 0, 0], tint: '#1f5fa8' });
      k.rbox('matte', 0.36, 0.08, 0.26, 0.01, { p: [0.12, 0.72, 0.38], r: [0, 0.25, 0], tint: '#d6cdb2' }, 1);
      return { ao: 0.45, aoH: 0.2 };
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  // The gallaa: an old green cash box with a hinged lid, slot, brass lock plate, folding handle and a stuck-on "shubh labh" sticker.
  'money-box': {
    build(k) {
      const dent = dents({ seed: 9, n: 3, depth: -0.002, radius: 0.03 });
      k.rbox('paintWorn', 0.3, 0.112, 0.19, 0.008, { p: [0, 0.056 + 0.01, 0], tint: '#35614a', pre: dent }, 2);
      k.rbox('paintWorn', 0.304, 0.056, 0.194, 0.01, { p: [0, 0.14 + 0.01, 0], tint: '#3b6a52' }, 2);
      k.rbox('matte', 0.17, 0.003, 0.012, 0.001, { p: [0, 0.1695 + 0.01, 0.0], tint: '#0c0a08' }, 1); // slot
      k.rbox('brass', 0.052, 0.04, 0.007, 0.002, { p: [0, 0.1, 0.098] }, 1); // lock plate
      k.cyl('matte', 0.005, 0.005, 0.008, 8, { p: [0, 0.095, 0.1], r: [Math.PI / 2, 0, 0], tint: '#0c0a08' });
      k.rbox('brass', 0.03, 0.026, 0.006, 0.002, { p: [0, 0.145, 0.099] }, 1); // hasp tab
      for (const sx of [-1, 1]) {
        k.cyl('brass', 0.007, 0.007, 0.03, 8, { p: [sx * 0.1, 0.14, -0.096], r: [0, 0, Math.PI / 2] });
        k.cyl('rubber', 0.014, 0.016, 0.01, 8, { p: [sx * 0.12, 0.005, 0.07], tint: '#151210' });
        k.cyl('rubber', 0.014, 0.016, 0.01, 8, { p: [sx * 0.12, 0.005, -0.07], tint: '#151210' });
        k.rbox('steelDark', 0.008, 0.03, 0.012, 0.002, { p: [sx * 0.05, 0.188, 0], tint: '#6b6762' }, 1);
      }
      k.cyl('steelDark', 0.0045, 0.0045, 0.1, 8, { p: [0, 0.2, 0], r: [0, 0, Math.PI / 2], tint: '#6b6762' }); // folded-up handle bar
      k.add(new PlaneGeometry(0.1, 0.05), moneyBoxSticker(), { p: [0.07, 0.07, 0.0965], proj: 'keep' });
      for (let i = 0; i < 5; i++) k.cyl('brass', 0.0125, 0.0125, 0.0017, 14, { p: [0.105 + (i % 2) * 0.003, 0.1707 + 0.0017 * i + 0.01, -0.05], r: [0, i * 0.7, 0], tint: '#cfc7b6' });
      return { ao: 0.3, aoH: 0.05 };
    },
  },
};

