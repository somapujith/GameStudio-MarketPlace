// Street animals: a stray dog (sandy coat rendered with a shell-fur shader, ears, wagging tail, breathing, sniffing) and a zebu cow
// (white / brown hide, hump, horns, marigold garland, slow chewing, flicking ears and tail).
// Fur: the torso is drawn as 1 base layer + N shells (N by texture quality: low 0, medium 3, high 4) that push out along the normal
// and alpha-discard by a strand texture, with darker roots: an opaque, sortable, shadow-free fur.
import { Color, MeshStandardMaterial, SphereGeometry } from 'three';
import { hideMat } from './materials-street.js';
import { pbr } from './textures-pbr.js';
import { getTextureQuality, sharedMat } from './util.js';

const PI = Math.PI;

function furMaterial(layer, len, tile) {
  return sharedMat(`fur:${layer.toFixed(2)}:${len}:${tile}`, () => {
    const tex = pbr.fur();
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, color: new Color('#ffffff') });
    m.customProgramCacheKey = () => 'furshell';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.furMap = { value: tex };
      sh.uniforms.furLayer = { value: layer };
      sh.uniforms.furLen = { value: len };
      sh.uniforms.furTile = { value: tile };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFurUv;\nuniform float furLayer;\nuniform float furLen;\nuniform float furTile;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurUv = uv * furTile;\ntransformed += normal * furLen * furLayer;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFurUv;\nuniform sampler2D furMap;\nuniform float furLayer;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nvec4 furT = texture2D(furMap, vFurUv);\nif (furLayer > 0.0 && furT.r < furLayer * 0.9 + 0.08) discard;\ndiffuseColor.rgb *= (0.5 + 0.5 * furLayer) * (0.78 + 0.44 * furT.g);',
        );
    };
    return m;
  });
}

const furLayers = () => {
  const q = getTextureQuality();
  return q === 'low' ? 0 : q === 'high' ? 4 : 2;
};

export const PROPS_ANIMALS = {
  // ---------------------------------------------------------------------------------------------------------------------------
  dog: {
    key: (o) => `${o.coat || ''}:${furLayers()}`,
    build(k, o) {
      const coat = o.coat || '#c9a063';
      const dark = '#7a5a34';
      const light = '#eadcbc';
      const shells = furLayers();
      const mats = [];
      for (let i = 0; i <= shells; i++) mats.push(furMaterial(shells ? i / shells : 0, 0.015, 6));
      const T = k.sub('torso', [0, 0.34, 0]);
      const fur = (fn) => mats.forEach((m) => fn((geo, op) => T.add(geo, m, { proj: 'box', uvs: 1.1, ...op })));
      const ell = (add, p, s, tint, ws = 8, hs = 5) => add(new SphereGeometry(1, ws, hs), { p, s, tint });
      fur((add) => {
        ell(add, [0, 0.335, 0.17], [0.125, 0.16, 0.19], coat); // deep chest
        ell(add, [0, 0.29, 0.26], [0.07, 0.1, 0.07], light, 7, 5); // pale bib
        ell(add, [0, 0.32, -0.03], [0.105, 0.125, 0.2], coat);
        ell(add, [0, 0.33, -0.22], [0.11, 0.14, 0.15], coat);
        ell(add, [0, 0.375, 0.02], [0.098, 0.1, 0.24], '#b88a4e', 8, 4); // darker saddle
        for (const sx of [-1, 1]) {
          ell(add, [sx * 0.085, 0.25, -0.23], [0.065, 0.11, 0.1], coat, 8, 5); // thighs
          ell(add, [sx * 0.07, 0.24, 0.17], [0.04, 0.12, 0.05], coat, 6, 4); // forearms
        }
        ell(add, [0, 0.42, 0.3], [0.075, 0.1, 0.13], coat, 8, 5); // neck
      });
      // base-fur limbs, head, tail (no shells)
      const base = mats[0];
      for (const sx of [-1, 1]) {
        for (const z of [0.17, -0.23]) {
          const hind = z < 0;
          k.taper(base, hind ? [[sx * 0.075, 0.2, z], [sx * 0.07, 0.11, z - 0.03], [sx * 0.065, 0.025, z + 0.01]] : [[sx * 0.07, 0.2, z], [sx * 0.065, 0.1, z + 0.005], [sx * 0.065, 0.025, z + 0.015]], (t) => 0.03 - t * 0.012, { proj: 'box', tint: hind ? coat : light }, 3, 6);
          k.sph(base, 1, 7, 4, { p: [sx * 0.065, 0.012, z + 0.03], s: [0.026, 0.016, 0.04], tint: light, proj: 'box' });
        }
      }
      const H = k.sub('head', [0, 0.45, 0.34]);
      H.sph(base, 1, 12, 9, { p: [0, 0.5, 0.4], s: [0.072, 0.07, 0.078], tint: coat, proj: 'box' });
      H.taper(base, [[0, 0.5, 0.45], [0, 0.49, 0.52], [0, 0.485, 0.575]], (t) => 0.043 - t * 0.014, { tint: '#d6bd92', proj: 'box' }, 3, 9);
      H.sph('enamel', 1, 8, 6, { p: [0, 0.495, 0.58], s: [0.02, 0.016, 0.015], tint: '#0a0807' });
      H.sph(base, 1, 8, 5, { p: [0, 0.478, 0.52], s: [0.036, 0.016, 0.05], tint: '#5b4630', proj: 'box' });
      for (const sx of [-1, 1]) {
        H.sph('enamel', 0.0125, 8, 6, { p: [sx * 0.044, 0.52, 0.455], tint: '#120c08' });
        H.sph('enamel', 0.0035, 5, 4, { p: [sx * 0.041, 0.525, 0.466], tint: '#ffffff' });
        H.sph(base, 1, 6, 4, { p: [sx * 0.044, 0.537, 0.452], s: [0.016, 0.006, 0.012], r: [0, 0, sx * 0.25], tint: '#6b4a26', proj: 'box' }); // brows
        H.cyl(base, 0.002, 0.036, 0.075, 6, { p: [sx * 0.058, 0.575, 0.375], r: [-0.55, 0, sx * -0.45], s: [1, 1, 0.35], tint: '#8a6238', proj: 'box' }); // ears, semi-folded
      }
      const Tl = k.sub('tail', [0, 0.4, -0.34]);
      Tl.taper(base, [[0, 0.4, -0.34], [0, 0.46, -0.42], [0, 0.57, -0.45], [0, 0.65, -0.4]], (t) => 0.026 - t * 0.017, { tint: coat, proj: 'box' }, 6, 5);
      Tl.sph(base, 0.014, 6, 4, { p: [0, 0.655, -0.395], tint: light, proj: 'box' });
      return { ao: 0, aoH: 0.1 };
    },
    rig({ sub }, o, api) {
      api.anim((dt, t) => {
        if (sub.tail) sub.tail.rotation.set(0, Math.sin(t * 8.5) * 0.5, Math.sin(t * 1.3) * 0.08);
        if (sub.head) {
          const sniff = Math.max(0, Math.sin(t * 0.45)) ** 3;
          sub.head.rotation.set(0.12 + Math.sin(t * 0.6) * 0.1 + sniff * 0.35, Math.sin(t * 0.37) * 0.4 + Math.sin(t * 1.9) * 0.02, Math.sin(t * 0.5) * 0.06);
        }
        if (sub.torso) {
          const b = Math.sin(t * 2.6);
          sub.torso.scale.set(1 + b * 0.004, 1 + b * 0.012, 1 + b * 0.004);
        }
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  cow: {
    key: (o) => `${o.coat || ''}:${o.patch || ''}`,
    build(k, o) {
      const hide = hideMat(o.coat || '#ece6d6', o.patch || '#8a5a34', 0.55);
      const H = (op = {}) => ({ proj: 'box', uvs: 0.45, ...op });
      const horn = '#e6dcc4';
      // body
      k.capsule(hide, 0.33, 0.7, H({ p: [0, 0.88, -0.05], r: [PI / 2, 0, 0], s: [1, 0.78, 1] }), 3, 10);
      k.sph(hide, 1, 10, 7, H({ p: [0, 1.16, 0.4], s: [0.2, 0.16, 0.27] })); // hump
      k.sph(hide, 1, 10, 7, H({ p: [0, 0.9, -0.62], s: [0.3, 0.3, 0.28] })); // rump
      k.sph(hide, 1, 10, 7, H({ p: [0, 0.78, 0.5], s: [0.24, 0.3, 0.3] })); // chest
      k.sph(hide, 1, 10, 6, H({ p: [0, 0.52, 0.5], s: [0.07, 0.2, 0.2] })); // dewlap
      k.sph('enamel', 1, 8, 6, { p: [0, 0.5, -0.3], s: [0.1, 0.09, 0.13], tint: '#e3b7a8' }); // udder
      k.taper(hide, [[0, 0.98, 0.5], [0, 1.0, 0.75], [0, 0.96, 0.98]], (t) => 0.2 - t * 0.07, H(), 5, 10); // neck
      // legs
      for (const sx of [-1, 1]) {
        k.taper(hide, [[sx * 0.2, 0.7, 0.52], [sx * 0.2, 0.4, 0.52], [sx * 0.2, 0.09, 0.53]], (t) => 0.1 - t * 0.055, H(), 4, 8);
        k.taper(hide, [[sx * 0.21, 0.8, -0.58], [sx * 0.23, 0.5, -0.66], [sx * 0.2, 0.3, -0.58], [sx * 0.2, 0.09, -0.6]], (t) => 0.11 - t * 0.065, H(), 6, 8);
        for (const z of [0.53, -0.6]) k.cyl('matte', 0.052, 0.058, 0.09, 8, { p: [sx * (z > 0 ? 0.2 : 0.2), 0.045, z], tint: '#1c1713' });
      }
      // head (sub) + jaw + ears
      const Hd = k.sub('head', [0, 0.97, 0.98]);
      Hd.sph(hide, 1, 10, 7, H({ p: [0, 0.97, 1.08], s: [0.14, 0.16, 0.2] }));
      Hd.taper(hide, [[0, 0.93, 1.16], [0, 0.85, 1.3], [0, 0.8, 1.38]], (t) => 0.1 - t * 0.02, H(), 4, 9); // muzzle
      Hd.sph('enamel', 1, 8, 6, { p: [0, 0.8, 1.39], s: [0.095, 0.075, 0.06], tint: '#6a4a44' }); // nose pad
      for (const sx of [-1, 1]) {
        Hd.sph('matte', 0.012, 6, 4, { p: [sx * 0.03, 0.81, 1.435], tint: '#150f0d' });
        Hd.sph('enamel', 0.022, 8, 6, { p: [sx * 0.125, 1.0, 1.12], tint: '#1a110c' }); // eyes
        Hd.sph('enamel', 0.006, 5, 4, { p: [sx * 0.133, 1.01, 1.135], tint: '#ffffff' });
        Hd.taper('matte', [[sx * 0.1, 1.08, 1.04], [sx * 0.18, 1.14, 1.0], [sx * 0.23, 1.24, 1.02], [sx * 0.21, 1.34, 1.1]], (t) => 0.034 - t * 0.03, { tint: horn }, 6, 6); // horns
      }
      const Jw = k.sub('jaw', [0, 0.86, 1.2]);
      Jw.taper(hide, [[0, 0.86, 1.2], [0, 0.8, 1.3], [0, 0.78, 1.37]], (t) => 0.065 - t * 0.02, H({ tint: '#f3e6d6' }), 3, 8);
      for (const sx of [-1, 1]) {
        const E = k.sub(sx < 0 ? 'earL' : 'earR', [sx * 0.15, 1.02, 1.0]);
        E.sph(hide, 1, 8, 5, H({ p: [sx * 0.24, 1.0, 1.0], s: [0.1, 0.03, 0.06], r: [0, 0, sx * -0.3] }));
        E.sph('enamel', 1, 6, 4, { p: [sx * 0.24, 0.995, 1.0], s: [0.07, 0.012, 0.035], tint: '#d7a99a' });
      }
      // tail + garland
      const Tl = k.sub('tail', [0, 1.05, -0.84]);
      Tl.taper(hide, [[0, 1.05, -0.84], [0, 0.85, -0.9], [0, 0.55, -0.92], [0, 0.22, -0.9]], (t) => 0.03 - t * 0.02, H(), 6, 5);
      Tl.sph('matte', 1, 8, 5, { p: [0, 0.16, -0.9], s: [0.04, 0.12, 0.04], tint: '#2a2019' });
      k.tor('matte', 0.24, 0.012, 5, 18, { p: [0, 0.9, 0.66], r: [0, 0, 0], tint: '#3c7a2a' });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        k.sph('matte', 0.034, 6, 4, { p: [Math.cos(a) * 0.24, 0.9 + Math.sin(a) * 0.24, 0.66], s: [1, 1, 0.85], tint: i % 2 ? '#f29a1a' : '#f6c21c' });
      }
      return { ao: 0.25, aoH: 0.4 };
    },
    rig({ sub }, o, api) {
      api.anim((dt, t) => {
        if (sub.jaw) sub.jaw.rotation.set(Math.max(0, Math.sin(t * 3.1)) * 0.07, 0, Math.sin(t * 1.55) * 0.05);
        if (sub.head) sub.head.rotation.set(0.12 + Math.sin(t * 0.4) * 0.07, Math.sin(t * 0.23) * 0.18, 0);
        if (sub.tail) sub.tail.rotation.set(Math.sin(t * 1.1) * 0.12, 0, Math.sin(t * 1.7) * 0.3);
        const flick = Math.max(0, Math.sin(t * 0.9 + 1)) ** 8;
        if (sub.earL) sub.earL.rotation.z = flick * 0.5 + Math.sin(t * 0.7) * 0.03;
        if (sub.earR) sub.earR.rotation.z = -flick * 0.2 - Math.sin(t * 0.6) * 0.03;
      });
    },
  },
};
