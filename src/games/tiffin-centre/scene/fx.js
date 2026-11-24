// Pooled particles + floating labels. Two Points pools (normal blend: steam, smoke, puffs; additive: sparks, stars, coins) driven by a
// small shader (soft dot / four-point star / bubble ring). Fixed-size typed arrays: nothing is allocated per frame or per spawn.
import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, NormalBlending, Points, ShaderMaterial, Sprite, SpriteMaterial, Group, DynamicDrawUsage,
} from 'three';
import { clamp } from './interp.js';

const VERT = /* glsl */ `
  attribute vec4 aColor; attribute float aSize; attribute float aShape;
  uniform float uScale;
  varying vec4 vColor; varying float vShape;
  void main() {
    vColor = aColor; vShape = aShape;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(0.0, aSize * uScale / max(0.1, -mv.z));
  }
`;
const FRAG = /* glsl */ `
  varying vec4 vColor; varying float vShape;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float a;
    if (vShape < 0.5) a = smoothstep(1.0, 0.15, r);
    else if (vShape < 1.5) { float s = max(0.0, 1.0 - (abs(p.x * p.y) * 7.0 + r * 0.8)); a = s * s * 1.6 + smoothstep(0.35, 0.0, r); }
    else a = smoothstep(0.45, 0.7, r) * smoothstep(1.0, 0.82, r) + smoothstep(0.5, 0.0, r) * 0.18;
    gl_FragColor = vec4(vColor.rgb, vColor.a * clamp(a, 0.0, 1.0));
    if (gl_FragColor.a < 0.003) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makePool(n, additive, tr) {
  const vel = new Float32Array(n * 3);
  const age = new Float32Array(n).fill(9);
  const life = new Float32Array(n).fill(1);
  const s0 = new Float32Array(n);
  const s1 = new Float32Array(n);
  const a0 = new Float32Array(n);
  const grav = new Float32Array(n);
  const drag = new Float32Array(n);
  const base = new Float32Array(n * 3);
  const g = tr.track(new BufferGeometry());
  g.setAttribute('position', new Float32BufferAttribute(n * 3, 3).setUsage(DynamicDrawUsage));
  g.setAttribute('aColor', new Float32BufferAttribute(n * 4, 4).setUsage(DynamicDrawUsage));
  g.setAttribute('aSize', new Float32BufferAttribute(n, 1).setUsage(DynamicDrawUsage));
  g.setAttribute('aShape', new Float32BufferAttribute(n, 1).setUsage(DynamicDrawUsage));
  // the attributes own their arrays: write straight into them
  const pos = g.attributes.position.array;
  const col = g.attributes.aColor.array;
  const size = g.attributes.aSize.array;
  const shape = g.attributes.aShape.array;
  const mat = tr.track(new ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  }));
  const points = new Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 11 : 10;
  return { n, next: 0, pos, col, size, shape, vel, age, life, s0, s1, a0, grav, drag, base, g, mat, points };
}

export function createFx({ scene, art, tr, quality, reducedMotion }) {
  const N = quality.particles;
  const soft = makePool(Math.ceil(N * 0.6), false, tr);
  const glow = makePool(Math.ceil(N * 0.4), true, tr);
  const root = new Group();
  root.add(soft.points, glow.points);
  scene.add(root);
  const amount = reducedMotion ? 0.35 : 1;
  const rnd = Math.random; // visual only: not part of the game state

  function spawn(pool, x, y, z, vx, vy, vz, lifeS, size0, size1, r, g, b, alpha, shape, grav = 0, drag = 0.6) {
    const i = pool.next;
    pool.next = (i + 1) % pool.n;
    pool.pos[i * 3] = x; pool.pos[i * 3 + 1] = y; pool.pos[i * 3 + 2] = z;
    pool.vel[i * 3] = vx; pool.vel[i * 3 + 1] = vy; pool.vel[i * 3 + 2] = vz;
    pool.col[i * 4] = r; pool.col[i * 4 + 1] = g; pool.col[i * 4 + 2] = b;
    pool.a0[i] = alpha;
    pool.age[i] = 0;
    pool.life[i] = lifeS;
    pool.s0[i] = size0;
    pool.s1[i] = size1;
    pool.shape[i] = shape;
    pool.grav[i] = grav;
    pool.drag[i] = drag;
    pool.size[i] = size0;
  }

  const j = (s) => (rnd() - 0.5) * 2 * s;

  /** One-shot effects. `n` scales the count. */
  const KINDS = {
    steam: (x, y, z) => spawn(soft, x + j(0.08), y, z + j(0.06), j(0.05), 0.45 + rnd() * 0.25, j(0.04), 1.2 + rnd() * 0.5, 0.18, 0.55, 1, 1, 1, 0.34, 0, 0, 0.4),
    chai: (x, y, z) => spawn(soft, x + j(0.05), y, z + j(0.05), j(0.03), 0.4 + rnd() * 0.2, j(0.03), 1.0 + rnd() * 0.4, 0.12, 0.38, 1, 0.97, 0.92, 0.3, 0, 0, 0.4),
    sizzle: (x, y, z) => spawn(glow, x + j(0.14), y, z + j(0.1), j(0.12), 0.7 + rnd() * 0.7, j(0.1), 0.28 + rnd() * 0.18, 0.07, 0.11, 1, 0.86, 0.45, 0.9, 2, -4, 0.2),
    oil: (x, y, z) => spawn(soft, x + j(0.14), y, z + j(0.1), j(0.1), 0.8 + rnd() * 0.5, j(0.08), 0.5 + rnd() * 0.3, 0.06, 0.1, 1, 0.9, 0.6, 0.7, 0, -3, 0.3),
    coin: (x, y, z) => spawn(glow, x, y, z, j(1.6), 2.6 + rnd() * 1.8, j(1.4) + 0.4, 0.8 + rnd() * 0.3, 0.17, 0.08, 1, 0.82 + rnd() * 0.12, 0.2, 1, 1, -9, 0.1),
    smoke: (x, y, z) => spawn(soft, x + j(0.1), y, z + j(0.08), j(0.18), 0.7 + rnd() * 0.5, j(0.12), 1.7 + rnd() * 0.7, 0.3, 1.2, 0.16, 0.14, 0.14, 0.78, 0, 0, 0.5),
    ping: (x, y, z) => spawn(glow, x, y, z, 0, 0.5, 0, 0.7, 0.2, 0.95, 1, 0.92, 0.5, 1, 1, 0, 1),
    ring: (x, y, z) => spawn(glow, x, y, z, 0, 0, 0, 0.55, 0.15, 0.9, 1, 0.95, 0.6, 0.8, 2, 0, 0),
    angry: (x, y, z) => spawn(soft, x + j(0.12), y, z + j(0.1), j(0.5), 0.9 + rnd() * 0.6, j(0.3), 0.8 + rnd() * 0.3, 0.25, 0.8, 0.95, 0.18, 0.1, 0.85, 0, 0.5, 1.2),
    nopay: (x, y, z) => spawn(soft, x + j(0.2), y, z + j(0.12), j(0.4), 0.5 + rnd() * 0.4, j(0.2), 0.9 + rnd() * 0.3, 0.25, 0.85, 0.55, 0.55, 0.58, 0.7, 0, 0, 1.2),
    sparkle: (x, y, z) => spawn(glow, x + j(0.7), y + rnd() * 0.5, z + j(0.3), j(0.3), 0.5 + rnd() * 0.8, j(0.2), 0.7 + rnd() * 0.5, 0.16, 0.02, 1, 0.9, 0.45 + rnd() * 0.4, 1, 1, -0.6, 0.5),
    dust: (x, y, z) => spawn(soft, x + j(0.18), y + 0.02, z + j(0.1), j(0.4), 0.25 + rnd() * 0.2, j(0.15), 0.55 + rnd() * 0.2, 0.15, 0.45, 0.78, 0.7, 0.6, 0.45, 0, -0.6, 2),
    puff: (x, y, z) => spawn(soft, x + j(0.1), y, z + j(0.08), j(0.3), 0.4 + rnd() * 0.3, j(0.2), 0.5 + rnd() * 0.2, 0.15, 0.5, 1, 0.97, 0.9, 0.5, 0, 0, 1.5),
    confetti: (x, y, z) => spawn(glow, x + j(0.4), y, z + j(0.3), j(2.2), 2 + rnd() * 2.4, j(1.2), 1 + rnd() * 0.5, 0.16, 0.06, rnd(), 0.5 + rnd() * 0.5, rnd(), 1, 0, -6, 0.3),
  };
  const COUNTS = { steam: 1, chai: 1, sizzle: 1, oil: 1, coin: 14, smoke: 9, ping: 1, ring: 1, angry: 10, nopay: 8, sparkle: 8, dust: 6, puff: 6, confetti: 22 };

  function burst(kind, x, y, z, n = 1) {
    const f = KINDS[kind];
    if (!f) return;
    const total = Math.max(1, Math.round((COUNTS[kind] || 1) * n * amount));
    for (let i = 0; i < total; i++) f(x, y, z);
    if (kind === 'ping') {
      KINDS.ring(x, y, z);
      for (let i = 0; i < Math.round(5 * amount); i++) KINDS.sparkle(x, y, z);
    }
  }

  /** Continuous emitter: { kind, rate (per second), acc }. Call each frame with the emitter's position. */
  function emit(em, x, y, z, dt) {
    if (em.rate <= 0) {
      em.acc = 0;
      return;
    }
    em.acc += em.rate * dt * amount;
    const f = KINDS[em.kind];
    while (em.acc >= 1) {
      em.acc -= 1;
      f(x, y, z);
    }
  }

  // --- floating labels ------------------------------------------------------------------------------------------------------------
  const labelCache = new Map(); // key -> texture (LRU, max 24)
  const getLabel = (text, color) => {
    const key = `${color}|${text}`;
    let t = labelCache.get(key);
    if (t) {
      labelCache.delete(key);
      labelCache.set(key, t);
      return t;
    }
    t = art.label(text, color);
    labelCache.set(key, t);
    if (labelCache.size > 24) {
      const [oldKey, old] = labelCache.entries().next().value;
      labelCache.delete(oldKey);
      old.dispose();
    }
    return t;
  };
  const floats = [];
  for (let i = 0; i < 8; i++) {
    const m = new SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, opacity: 0, fog: false });
    const s = new Sprite(m);
    s.visible = false;
    s.renderOrder = 20;
    root.add(s);
    floats.push({ s, m, t: 9, life: 1.3, x: 0, y: 0, z: 0, rise: 0.9, scale: 1 });
  }
  let nextFloat = 0;
  function floatText(text, color, x, y, z, { life = 1.4, rise = 0.9, scale = 1, delay = 0 } = {}) {
    const f = floats[nextFloat];
    nextFloat = (nextFloat + 1) % floats.length;
    f.m.map = getLabel(text, color);
    f.m.needsUpdate = true;
    f.t = -delay;
    f.life = reducedMotion ? life * 1.2 : life;
    f.x = x; f.y = y; f.z = z;
    f.rise = reducedMotion ? rise * 0.4 : rise;
    f.scale = scale;
    f.s.visible = false;
  }

  function update(dt, viewScale) {
    soft.mat.uniforms.uScale.value = viewScale;
    glow.mat.uniforms.uScale.value = viewScale;
    for (const p of [soft, glow]) {
      const { pos, vel, col, size, age, life, s0, s1, a0, grav, drag } = p;
      for (let i = 0; i < p.n; i++) {
        if (age[i] >= life[i]) {
          size[i] = 0;
          continue;
        }
        age[i] += dt;
        const u = clamp(age[i] / life[i], 0, 1);
        const k = Math.max(0, 1 - drag[i] * dt);
        vel[i * 3] *= k; vel[i * 3 + 2] *= k;
        vel[i * 3 + 1] = vel[i * 3 + 1] * k + grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        size[i] = s0[i] + (s1[i] - s0[i]) * u;
        const fadeIn = Math.min(1, u * 8);
        col[i * 4 + 3] = a0[i] * fadeIn * (1 - u) * (1 - u * 0.2);
      }
      p.g.attributes.position.needsUpdate = true;
      p.g.attributes.aColor.needsUpdate = true;
      p.g.attributes.aSize.needsUpdate = true;
      p.g.attributes.aShape.needsUpdate = true;
    }
    for (const f of floats) {
      if (f.t >= f.life) {
        f.s.visible = false;
        continue;
      }
      f.t += dt;
      if (f.t < 0) continue;
      const u = clamp(f.t / f.life, 0, 1);
      f.s.visible = true;
      const pop = u < 0.12 ? 0.6 + (u / 0.12) * 0.55 : 1.15 - 0.15 * Math.min(1, (u - 0.12) / 0.2);
      f.s.position.set(f.x, f.y + f.rise * (1 - (1 - u) * (1 - u)), f.z);
      f.s.scale.set(1.5 * f.scale * pop, 0.56 * f.scale * pop, 1);
      f.m.opacity = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
    }
  }

  function dispose() {
    scene.remove(root);
    for (const f of floats) f.m.dispose();
    for (const t of labelCache.values()) t.dispose();
    labelCache.clear();
  }

  return { burst, emit, floatText, update, dispose, root };
}
