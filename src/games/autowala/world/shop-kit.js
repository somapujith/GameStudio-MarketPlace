// Tools shared by the shop builders: a geometry Batch (many primitives -> one vertex-coloured mesh per material), a Pen that
// draws canvas textures in METRES (so signs line up with the geometry), people, night lighting, the optional logo override and
// the disposal bookkeeping. Wordmarks are always drawn in code; an optional same-origin /art/brands file replaces the main logo.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../render/textures.js';
import { fitContain, overrideUrls, pickOverride } from './shop-brands.js';

export const FONT = '"Bricolage Grotesque Variable", "Segoe UI", Arial, sans-serif';
export const FONT_TE = '"Noto Sans Telugu Variable", sans-serif';
export const SCRIPT = '"Segoe Script", "Brush Script MT", "Lucida Handwriting", "Snell Roundhand", "Apple Chancery", cursive';
export const SERIF = '"Georgia", "Times New Roman", serif';

const tmpE = new Euler();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const ONE = new Vector3(1, 1, 1);

// ---------------------------------------------------------------------------------------------- Batch
/** Collects primitives (each tinted with a vertex colour) and merges them into one mesh per material key. */
export class Batch {
  constructor() {
    this.parts = new Map();
    this.stack = [new Matrix4()];
  }
  get m() {
    return this.stack[this.stack.length - 1];
  }
  /** Enter a local frame at (x,y,z) rotated by ry about y. Close it with pop(). */
  push(x = 0, y = 0, z = 0, ry = 0) {
    const t = new Matrix4().makeRotationY(ry);
    t.setPosition(x, y, z);
    this.stack.push(this.m.clone().multiply(t));
    return this;
  }
  pop() {
    this.stack.pop();
    return this;
  }
  add(geo, color, mat = 'solid', local = null) {
    if (local) geo.applyMatrix4(local);
    geo.applyMatrix4(this.m);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const n = g.getAttribute('position').count;
    const c = new Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(arr, 3));
    if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    return this;
  }
  _local(x, y, z, o = {}) {
    const q = tmpQ.setFromEuler(tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0));
    return new Matrix4().compose(tmpV.set(x, y, z), q, ONE);
  }
  /** Box with its bottom-centre at (x,y,z). */
  box(w, h, d, x, y, z, color, o = {}) {
    return this.add(new BoxGeometry(w, h, d), color, o.mat || 'solid', this._local(x, y + h / 2, z, o));
  }
  cyl(rt, rb, h, x, y, z, color, o = {}) {
    return this.add(new CylinderGeometry(rt, rb, h, o.seg || 12, 1, !!o.open), color, o.mat || 'solid', this._local(x, y + h / 2, z, o));
  }
  cone(r, h, x, y, z, color, o = {}) {
    return this.add(new ConeGeometry(r, h, o.seg || 8), color, o.mat || 'solid', this._local(x, y + h / 2, z, o));
  }
  /** Sphere (or ellipsoid via sx/sy/sz) centred at (x,y,z). */
  sph(r, x, y, z, color, o = {}) {
    const g = new SphereGeometry(r, o.w || 8, o.h || 6);
    if (o.sx || o.sy || o.sz) g.scale(o.sx || 1, o.sy || 1, o.sz || 1);
    return this.add(g, color, o.mat || 'solid', this._local(x, y, z, o));
  }
  /** Triangular prism: width w (x), apex height h (y), depth d (z); base on y. */
  prism(w, h, d, x, y, z, color, o = {}) {
    const s = new Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return this.add(g, color, o.mat || 'solid', this._local(x, y, z, o));
  }
  /** A flat quad (single sided, facing +z in its own frame) with uv rect [u0,v0,u1,v1]. */
  quad(w, h, x, y, z, color, o = {}) {
    const g = new PlaneGeometry(w, h);
    if (o.uv) {
      const uv = g.getAttribute('uv');
      const [u0, v0, u1, v1] = o.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    return this.add(g, color, o.mat || 'solid', this._local(x, y + h / 2, z, o));
  }
  /** Merge to one mesh per material key. `mats` maps key -> material. Returns the meshes (already added to `parent`). */
  flush(parent, mats, track) {
    const out = [];
    for (const [key, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!geo) continue;
      track.geos.push(geo);
      const mesh = new Mesh(geo, mats[key]);
      mesh.castShadow = key === 'solid' || key === 'metal';
      mesh.receiveShadow = key !== 'lamp';
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** A person standing at (x,z) facing local +z rotated by yaw. ~7 primitives. */
export function addPerson(b, x, z, { y = 0, yaw = 0, h = 1.68, shirt = '#c0392b', pants = '#2c3e50', skin = '#9a6a4a', hair = '#1a1110', arm = 0 } = {}) {
  const s = h / 1.7;
  b.push(x, y, z, yaw);
  b.box(0.12 * s, 0.82 * s, 0.14 * s, -0.1 * s, 0, 0, pants);
  b.box(0.12 * s, 0.82 * s, 0.14 * s, 0.1 * s, 0, 0, pants);
  b.box(0.4 * s, 0.62 * s, 0.22 * s, 0, 0.8 * s, 0, shirt);
  b.box(0.1 * s, 0.56 * s, 0.1 * s, -0.26 * s, 0.84 * s, arm * 0.1, shirt);
  b.box(0.1 * s, 0.56 * s, 0.1 * s, 0.26 * s, 0.84 * s, arm * 0.1, shirt);
  b.sph(0.12 * s, 0, 1.55 * s, 0, skin, { w: 7, h: 5 });
  b.sph(0.125 * s, 0, 1.59 * s, -0.012 * s, hair, { w: 7, h: 5, sy: 0.8 });
  b.pop();
}
export const SHIRTS = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#8e44ad', '#ecf0f1', '#e67e22', '#16a085', '#d35486'];
export const SKINS = ['#8d5a3b', '#a8714b', '#c68c64', '#6f4529', '#b88055'];

// ---------------------------------------------------------------------------------------------- Pen (metre-based canvas drawing)
/** Draws in metres on a canvas covering a W x H metre surface: x centred (-W/2..W/2), y up from the bottom. */
export class Pen {
  constructor(g, ppm, W, H) {
    this.g = g;
    this.ppm = ppm;
    this.W = W;
    this.H = H;
  }
  X(x) {
    return (x + this.W / 2) * this.ppm;
  }
  Y(y) {
    return (this.H - y) * this.ppm;
  }
  S(m) {
    return m * this.ppm;
  }
  rect(x, y, w, h, fill) {
    this.g.fillStyle = fill;
    this.g.fillRect(this.X(x), this.Y(y + h), this.S(w), this.S(h));
    return this;
  }
  /** Gradient fill; stops = [[0,'#fff'],[1,'#000']] running bottom (0) to top (1) unless horizontal. */
  grad(x, y, w, h, stops, horizontal = false) {
    const g = this.g;
    const gr = horizontal ? g.createLinearGradient(this.X(x), 0, this.X(x + w), 0) : g.createLinearGradient(0, this.Y(y), 0, this.Y(y + h));
    for (const [t, c] of stops) gr.addColorStop(t, c);
    g.fillStyle = gr;
    g.fillRect(this.X(x), this.Y(y + h), this.S(w), this.S(h));
    return this;
  }
  rrectPath(x, y, w, h, r) {
    const g = this.g;
    const X = this.X(x);
    const Y = this.Y(y + h);
    const Wp = this.S(w);
    const Hp = this.S(h);
    const R = Math.min(this.S(r), Wp / 2, Hp / 2);
    g.beginPath();
    g.moveTo(X + R, Y);
    g.arcTo(X + Wp, Y, X + Wp, Y + Hp, R);
    g.arcTo(X + Wp, Y + Hp, X, Y + Hp, R);
    g.arcTo(X, Y + Hp, X, Y, R);
    g.arcTo(X, Y, X + Wp, Y, R);
    g.closePath();
  }
  rrect(x, y, w, h, r, fill, stroke = null, sw = 0.05) {
    this.rrectPath(x, y, w, h, r);
    if (fill) {
      this.g.fillStyle = fill;
      this.g.fill();
    }
    if (stroke) {
      this.g.lineWidth = this.S(sw);
      this.g.strokeStyle = stroke;
      this.g.stroke();
    }
    return this;
  }
  circle(cx, cy, r, fill, stroke = null, sw = 0.05) {
    const g = this.g;
    g.beginPath();
    g.arc(this.X(cx), this.Y(cy), this.S(r), 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.lineWidth = this.S(sw);
      g.strokeStyle = stroke;
      g.stroke();
    }
    return this;
  }
  line(x0, y0, x1, y1, w, color, cap = 'butt') {
    const g = this.g;
    g.beginPath();
    g.moveTo(this.X(x0), this.Y(y0));
    g.lineTo(this.X(x1), this.Y(y1));
    g.lineWidth = this.S(w);
    g.strokeStyle = color;
    g.lineCap = cap;
    g.stroke();
    return this;
  }
  poly(pts, fill, stroke = null, sw = 0.05) {
    const g = this.g;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y))));
    g.closePath();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.lineWidth = this.S(sw);
      g.strokeStyle = stroke;
      g.lineJoin = 'round';
      g.stroke();
    }
    return this;
  }
  clipRect(x, y, w, h) {
    this.g.save();
    this.g.beginPath();
    this.g.rect(this.X(x), this.Y(y + h), this.S(w), this.S(h));
    this.g.clip();
    return this;
  }
  restore() {
    this.g.restore();
    return this;
  }
  /**
   * Text centred at (x, y). size = em height in metres. opts: color, font (family), weight, italic, align, stroke, strokeW,
   * spacing (m), maxW (shrink to fit), rot (radians, counter-clockwise), shadow {color, blur(m)}.
   */
  text(str, x, y, size, o = {}) {
    const g = this.g;
    let px = this.S(size);
    const family = o.font || FONT;
    const style = `${o.italic ? 'italic ' : ''}${o.weight || 800} `;
    g.save();
    g.font = `${style}${px}px ${family}`;
    if ('letterSpacing' in g) g.letterSpacing = `${this.S(o.spacing || 0)}px`;
    if (o.maxW) {
      const w = g.measureText(str).width;
      if (w > this.S(o.maxW)) {
        px *= this.S(o.maxW) / w;
        g.font = `${style}${px}px ${family}`;
        if ('letterSpacing' in g) g.letterSpacing = `${this.S(o.spacing || 0) * (px / this.S(size))}px`;
      }
    }
    g.textAlign = o.align || 'center';
    g.textBaseline = 'middle';
    g.translate(this.X(x), this.Y(y));
    if (o.rot) g.rotate(-o.rot);
    if (o.shadow) {
      g.shadowColor = o.shadow.color;
      g.shadowBlur = this.S(o.shadow.blur || 0.1);
    }
    if (o.stroke) {
      g.lineWidth = this.S(o.strokeW || 0.06);
      g.strokeStyle = o.stroke;
      g.lineJoin = 'round';
      g.strokeText(str, 0, 0);
    }
    g.fillStyle = o.color || '#fff';
    g.fillText(str, 0, 0);
    g.restore();
    return this;
  }
}

// ---------------------------------------------------------------------------------------------- drawing helpers shared by brands
/** Cheap deterministic hash -> 0..1. */
export const hash01 = (a, b = 0, c = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A small chef emblem (toque on a cream disc) used by Bawarchi. */
export function drawChef(p, cx, cy, r, disc = '#f4ead2', ink = '#2b2b2f') {
  p.circle(cx, cy, r, disc, ink, r * 0.08);
  p.circle(cx - r * 0.3, cy + r * 0.28, r * 0.28, '#fff', ink, r * 0.05);
  p.circle(cx + r * 0.3, cy + r * 0.28, r * 0.28, '#fff', ink, r * 0.05);
  p.circle(cx, cy + r * 0.42, r * 0.32, '#fff', ink, r * 0.05);
  p.rrect(cx - r * 0.5, cy - r * 0.2, r, r * 0.4, r * 0.08, '#fff', ink, r * 0.05);
  p.line(cx - r * 0.5, cy - r * 0.2, cx + r * 0.5, cy - r * 0.2, r * 0.07, ink);
  p.circle(cx, cy - r * 0.52, r * 0.16, ink);
}

/** An extruded board from a 2D shape spanning w x h (x centred, y from 0); the front face is uv-mapped to the sign texture. */
export function shapeBoard(kit, shape, w, h, depth, faceMat, sideMat) {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 });
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, pos.getY(i) / h);
  kit.track.geos.push(g);
  const m = new Mesh(g, [faceMat, sideMat]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A rounded-rectangle shape w x h with corner radius r (x centred, y from 0). */
export function roundedShape(w, h, r) {
  const s = new Shape();
  s.moveTo(-w / 2 + r, 0);
  s.lineTo(w / 2 - r, 0);
  s.quadraticCurveTo(w / 2, 0, w / 2, r);
  s.lineTo(w / 2, h - r);
  s.quadraticCurveTo(w / 2, h, w / 2 - r, h);
  s.lineTo(-w / 2 + r, h);
  s.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
  s.lineTo(-w / 2, r);
  s.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0);
  return s;
}

// ---------------------------------------------------------------------------------------------- Kit
/** One kit per buildShops call: owns the root group, shared materials, textures and every disposable. */
export function createKit(scene) {
  const root = new Group();
  root.name = 'shops';
  scene.add(root);
  const track = { geos: [], mats: [], texs: [] };
  const redraws = []; // { tex, w, h, draw }
  const nightMats = []; // { mat, k, fn? }
  const logos = {}; // brand -> HTMLImageElement | null (override files)
  const pass = { night: 0 };

  const own = (m) => {
    track.mats.push(m);
    return m;
  };
  const mats = {
    solid: own(new MeshStandardMaterial({ color: new Color(1.18, 1.18, 1.18), vertexColors: true, roughness: 0.82, metalness: 0.02 })),
    metal: own(new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.34, metalness: 0.7 })),
    // lit things (bulbs, light strips): unlit; dimmer by day so only night makes them pop (bloom threshold is 1.05)
    lamp: own(new MeshBasicMaterial({ color: 0xffffff, vertexColors: true })),
    glass: own(new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.32, depthWrite: false })),
  };

  /** Canvas texture (anisotropy 8) that can be redrawn when fonts or a logo override arrive. */
  // Branches of one brand draw the same signs: while a brand scope is open (setScope), the Nth texture of a given pixel size is
  // drawn once and shared by every branch (a different size is a different key, so nothing is shared by mistake).
  let scope = null;
  let seq = 0;
  const shared = new Map();
  const setScope = (name) => { scope = name; seq = 0; };
  function tex(w, h, draw) {
    const key = scope ? `${scope}|${seq++}|${w}x${h}` : null;
    if (key && shared.has(key)) return shared.get(key);
    const t = canvasTexture(w, h, draw, { anisotropy: 8 });
    track.texs.push(t);
    redraws.push({ tex: t, w, h, draw });
    if (key) shared.set(key, t);
    return t;
  }
  /**
   * A textured surface material. `glow` (emissiveMap: a texture, or true to reuse the map) is scaled by k * night.
   */
  function texMat({ map, glow = null, k = 0.9, base = 0, tint = 1.22, rough = 0.7, metal = 0.02, offset = 0, transparent = false, alphaTest = 0, side }) {
    const m = new MeshStandardMaterial({ map, roughness: rough, metalness: metal, transparent, alphaTest, polygonOffset: offset !== 0, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset });
    if (side !== undefined) m.side = side;
    m.color.setScalar(tint); // the scene's key light is soft: lift the paint a little so it reads true by day
    if (glow) {
      m.emissive = new Color(0xffffff);
      m.emissiveMap = glow === true ? map : glow;
      m.emissiveIntensity = 0;
      nightMats.push({ mat: m, k, base });
      m.emissiveIntensity = base;
    }
    own(m);
    return m;
  }
  /** A plane of w x h metres, bottom-centre at (x,y,z), facing +z rotated by ry; optional uv repeat. */
  function plane(parent, material, w, h, x, y, z, ry = 0, { repeat = null, shadow = false, uv = null } = {}) {
    const g = new PlaneGeometry(w, h);
    if (uv) {
      const a = g.getAttribute('uv');
      for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
    }
    if (repeat) {
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat[0], uv.getY(i) * repeat[1]);
    }
    track.geos.push(g);
    const m = new Mesh(g, material);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.castShadow = shadow;
    parent.add(m);
    return m;
  }
  /** A ground glow pool (additive) in front of a shop. */
  const poolTex = (() => {
    const t = canvasTexture(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.3)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }, { anisotropy: 1 });
    track.texs.push(t);
    return t;
  })();
  const poolMats = new Map();
  function pool(parent, color, w, d, x, z, k = 0.5, y = 0.04) {
    let m = poolMats.get(color);
    if (!m) {
      m = own(new MeshBasicMaterial({ color: new Color(color), map: poolTex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      poolMats.set(color, m);
      nightMats.push({ mat: m, k, pool: true });
    }
    const g = new PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    track.geos.push(g);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // ---- redraw (fonts, override logos)
  function redrawAll() {
    for (const r of redraws) {
      const g = r.tex.image.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, r.w, r.h);
      r.draw(g, r.w, r.h);
      r.tex.needsUpdate = true;
    }
  }
  let fontsStarted = false;
  function loadFonts() {
    if (fontsStarted || typeof document === 'undefined' || !document.fonts?.load) return;
    fontsStarted = true;
    const wants = [`800 48px ${FONT}`, `700 48px ${FONT}`, `700 32px ${FONT_TE}`, `italic 700 48px ${SERIF}`];
    Promise.all(wants.map((f) => document.fonts.load(f, 'Paradise Bawarchi Delhi OYO పారడైజ్').catch(() => null)))
      .then(() => {
        if (!disposed) redrawAll();
      })
      .catch(() => {});
  }
  /** Probe /art/brands/<brand>.(png|webp|svg); a missing file fails silently and the generated wordmark stays. */
  function loadLogo(brand) {
    if (typeof Image === 'undefined' || brand in logos) return;
    logos[brand] = null;
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
    const urls = overrideUrls(brand, base);
    const results = [];
    const next = (i) => {
      if (disposed) return;
      if (i >= urls.length) return;
      const img = new Image();
      img.onload = () => {
        results[i] = { url: urls[i], ok: img.naturalWidth > 0 };
        if (pickOverride(results) === urls[i] && img.naturalWidth > 0) {
          logos[brand] = img;
          redrawAll();
        } else next(i + 1);
      };
      img.onerror = () => {
        results[i] = { url: urls[i], ok: false };
        next(i + 1);
      };
      img.src = urls[i];
    };
    next(0);
  }
  /** Draw the override logo (if any) fitted into a pen rect. Returns true when it was drawn. */
  function drawLogo(brand, p, x, y, w, h) {
    const img = logos[brand];
    if (!img) return false;
    const f = fitContain(img.naturalWidth, img.naturalHeight, p.S(w), p.S(h));
    p.g.drawImage(img, p.X(x) + f.x, p.Y(y + h) + f.y, f.w, f.h);
    return true;
  }

  function update(night) {
    pass.night = night;
    const lit = Math.min(1, Math.max(0, (night - 0.08) / 0.45));
    for (const n of nightMats) {
      if (n.pool) n.mat.opacity = lit * n.k;
      else n.mat.emissiveIntensity = n.base + lit * (n.k - n.base);
    }
    // unlit bulbs: dim by day, gently bright at night (<= 1.25 so the bloom pass only catches the brightest)
    const l = 0.5 + 0.75 * lit;
    mats.lamp.color.setRGB(l, l, l);
  }

  let disposed = false;
  function dispose() {
    disposed = true;
    scene.remove(root);
    track.geos.forEach((g) => g.dispose());
    track.mats.forEach((m) => m.dispose());
    track.texs.forEach((t) => t.dispose());
    track.geos.length = track.mats.length = track.texs.length = 0;
    redraws.length = nightMats.length = 0;
  }

  return { root, mats, track, tex, setScope, texMat, plane, pool, redrawAll, loadFonts, loadLogo, drawLogo, logos, update, dispose, own, flush: (b, parent = root) => b.flush(parent, mats, track) };
}

/** A pen over a fresh canvas texture pair: day map + glow (emissive) map, both drawn by draw(pen, pass). */
export function facadeTextures(kit, W, H, { ppm = 40, glowScale = 0.5, draw, glow = true, maxPx = 1024 }) {
  const wpx = Math.min(maxPx, Math.round(W * ppm));
  const k = wpx / W;
  const hpx = Math.round(H * k);
  const map = kit.tex(wpx, hpx, (g) => draw(new Pen(g, k, W, H), 'day'));
  let emissive = null;
  if (glow) {
    const gw = Math.round(wpx * glowScale);
    const gh = Math.round(hpx * glowScale);
    emissive = kit.tex(gw, gh, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, gw, gh);
      draw(new Pen(g, k * glowScale, W, H), 'glow');
    });
  }
  return { map, glow: emissive };
}
