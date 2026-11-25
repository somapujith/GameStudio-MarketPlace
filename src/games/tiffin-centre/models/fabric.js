// Cloth materials for people: cached, shared (freed by disposeModelCache), canvas-generated colour and weave normal maps.
// Node-safe: makeCanvasTexture returns a 1x1 stub without `document`; stubs are never assigned as maps.
import { Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, Vector2 } from 'three';
import { makeCanvasTexture, sharedMat, sharedTexture } from './util.js';
import { tierOf } from './charquality.js';

const real = (t) => (t && !t.userData.stub ? t : null);
const hex = (c) => `#${new Color(c).getHexString()}`;

function weaveNormal(kind) {
  return sharedTexture(`fab:nrm:${kind}`, () => {
    const t = makeCanvasTexture(
      64,
      64,
      (g, w, h) => {
        const img = g.createImageData(w, h);
        const hgt = (x, y) => {
          if (kind === 'twill') return 0.5 + 0.5 * Math.sin(((x + y) / w) * Math.PI * 2 * 8);
          if (kind === 'crochet') return 0.5 + 0.25 * Math.sin((x / w) * Math.PI * 2 * 8) * Math.sin((y / h) * Math.PI * 2 * 8);
          const a = Math.sin((x / w) * Math.PI * 2 * 8) > 0 ? 1 : 0;
          const b = Math.sin((y / h) * Math.PI * 2 * 8) > 0 ? 1 : 0;
          return 0.5 + 0.35 * (a ^ b ? 1 : -1) * 0.5 + 0.12 * Math.sin((x / w) * Math.PI * 2 * 16) * Math.sin((y / h) * Math.PI * 2 * 16);
        };
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = hgt((x + 1) % w, y) - hgt((x + w - 1) % w, y);
            const dy = hgt(x, (y + 1) % h) - hgt(x, (y + h - 1) % h);
            const i = (y * w + x) * 4;
            img.data[i] = Math.max(0, Math.min(255, 128 - dx * 150));
            img.data[i + 1] = Math.max(0, Math.min(255, 128 - dy * 150));
            img.data[i + 2] = 255;
            img.data[i + 3] = 255;
          }
        }
        g.putImageData(img, 0, 0);
      },
      { srgb: false }
    );
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(9, 9);
    return t;
  });
}

function patternTex(key, draw, w = 128, h = 128) {
  return sharedTexture(`fab:tex:${key}`, () => {
    const t = makeCanvasTexture(w, h, draw);
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  });
}

/** `o`: { color, color2, pattern: plain|check|stripe|crochet|sari|denim|gamchha, rough, quality, repeat:[u,v] } */
export function fabricMat(o = {}) {
  const tier = tierOf(o.quality);
  const color = hex(o.color || '#cccccc');
  const color2 = hex(o.color2 || '#ffffff');
  const pattern = o.pattern || 'plain';
  const key = `fab:${pattern}:${color}:${color2}:${o.rough ?? ''}:${tier.normalMaps ? 1 : 0}:${o.ds ? 1 : 0}`;
  return sharedMat(key, () => {
    const m = new MeshStandardMaterial({ color: '#ffffff', roughness: o.rough ?? 0.88, metalness: 0, side: o.ds === false ? 0 : DoubleSide });
    let map = null;
    if (pattern === 'check' || pattern === 'gamchha') {
      map = patternTex(`${pattern}:${color}:${color2}`, (g, w, h) => {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.fillStyle = color2;
        const bands = pattern === 'gamchha' ? [[0.1, 0.06], [0.5, 0.06]] : [[0.0, 0.06]];
        for (const [p, th] of bands) {
          g.globalAlpha = 0.95;
          g.fillRect(p * w, 0, th * w, h);
          g.fillRect(0, p * h, w, th * h);
        }
        g.globalAlpha = 0.5;
        g.fillRect(0.25 * w, 0, 0.012 * w, h);
        g.fillRect(0, 0.25 * h, w, 0.012 * h);
        g.fillRect(0.75 * w, 0, 0.012 * w, h);
        g.fillRect(0, 0.75 * h, w, 0.012 * h);
        g.globalAlpha = 1;
      });
    } else if (pattern === 'stripe') {
      map = patternTex(`stripe:${color}:${color2}`, (g, w, h) => {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.fillStyle = color2;
        g.globalAlpha = 0.5;
        for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
        g.globalAlpha = 1;
      });
    } else if (pattern === 'crochet') {
      map = patternTex(`crochet:${color}:${color2}`, (g, w, h) => {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = color2;
        g.lineWidth = 3;
        for (let i = -h; i < w + h; i += 16) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i + h, h);
          g.moveTo(i + h, 0);
          g.lineTo(i, h);
          g.stroke();
        }
      });
    } else if (pattern === 'sari') {
      map = patternTex(`sari:${color}:${color2}`, (g, w, h) => {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.fillStyle = color2;
        g.fillRect(0, 0, w, h * 0.12);
        g.fillStyle = '#e6c25a';
        g.fillRect(0, h * 0.12, w, h * 0.025);
        for (let x = 0; x < w; x += 16) g.fillRect(x + 4, h * 0.02, 8, h * 0.05);
      });
    } else if (pattern === 'denim') {
      map = patternTex(`denim:${color}`, (g, w, h) => {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        for (let i = 0; i < w; i += 4) g.fillRect(i, 0, 1, h);
      });
    }
    if (real(map)) {
      m.map = map;
    } else m.color = new Color(pattern === 'plain' || pattern === 'denim' || !map ? color : '#ffffff');
    if (tier.normalMaps) {
      const kind = pattern === 'denim' ? 'twill' : pattern === 'crochet' ? 'crochet' : 'weave';
      const n = real(weaveNormal(kind));
      if (n) {
        m.normalMap = n;
        m.normalScale = new Vector2(0.4, 0.4);
      }
    }
    if (!real(map)) m.color = new Color(color);
    m.userData.pattern = pattern;
    return m;
  });
}

export const fabricRepeat = (m, u, v) => {
  void m;
  void u;
  void v;
};
