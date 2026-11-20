// Particle maths for the moments' Confetti pool. Pure (no DOM, no globals): the caller supplies `rand`, so tests can
// be deterministic. A pool never holds more than POOL_MAX particles: dead ones are recycled, never allocated again.

export const POOL_MAX = 60;

export const PALETTE = ['#ffca7a', '#ff5d73', '#3ddc97', '#4cc9f0', '#b794f6', '#ff9f43', '#ffffff'];
export const GOLD_PALETTE = ['#ffe08a', '#ffca7a', '#ffb65a', '#fff4cf', '#ffffff'];

/** How many particles a request may use: an integer in 0..POOL_MAX. */
export const clampCount = (n, max = POOL_MAX) => Math.max(0, Math.min(Math.min(max, POOL_MAX), Math.floor(Number(n) || 0)));

const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];

/** A blank particle (all numbers zero, dead). */
export const blank = () => ({ alive: false, shape: 'rect', x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, size: 6, color: '#fff', age: 0, life: 1, g: 0, drag: 0, sway: 0 });

/**
 * (Re)fill `p` for `kind`:
 *   burst   - leaves `origin` (px) in every direction, falls under gravity
 *   sparkle - small four-point stars drifting up and out from `origin`, fading
 *   rain    - drops from the top edge of the `w` x `h` area
 */
export function spawn(p, kind, { rand = Math.random, origin = { x: 0, y: 0 }, w = 300, h = 300, colors = PALETTE, speed = 1, delay = 0 } = {}) {
  p.alive = true;
  p.color = pick(colors, rand);
  p.age = -delay; // a negative age waits (staggered rain)
  if (kind === 'sparkle') {
    const a = rand() * Math.PI * 2;
    const v = (40 + rand() * 120) * speed;
    p.shape = 'star';
    p.x = origin.x + (rand() - 0.5) * 20;
    p.y = origin.y + (rand() - 0.5) * 20;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v - 30 * speed;
    p.rot = rand() * 1.2;
    p.vr = (rand() - 0.5) * 2;
    p.size = 5 + rand() * 7;
    p.life = 0.9 + rand() * 0.7;
    p.g = 40;
    p.drag = 1.6;
    p.sway = 0;
  } else if (kind === 'rain') {
    p.shape = rand() < 0.3 ? 'dot' : 'rect';
    p.x = rand() * w;
    p.y = -10 - rand() * 30;
    p.vx = (rand() - 0.5) * 50;
    p.vy = (110 + rand() * 130) * speed;
    p.rot = rand() * Math.PI * 2;
    p.vr = (rand() - 0.5) * 9;
    p.size = 6 + rand() * 6;
    p.life = (h + 60) / Math.max(40, p.vy) + 0.2;
    p.g = 0;
    p.drag = 0;
    p.sway = 20 + rand() * 30;
  } else {
    const a = rand() * Math.PI * 2;
    const v = (160 + rand() * 360) * speed;
    p.shape = rand() < 0.25 ? 'dot' : 'rect';
    p.x = origin.x;
    p.y = origin.y;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v - 220 * speed;
    p.rot = rand() * Math.PI * 2;
    p.vr = (rand() - 0.5) * 16;
    p.size = 7 + rand() * 7;
    p.life = 1.5 + rand() * 1.1;
    p.g = 640;
    p.drag = 1.3;
    p.sway = 0;
  }
  return p;
}

/** Advances `p` by `dt` seconds. Returns false once it is dead. */
export function step(p, dt) {
  if (!p.alive) return false;
  p.age += dt;
  if (p.age < 0) return true; // still waiting
  if (p.age >= p.life) {
    p.alive = false;
    return false;
  }
  const k = Math.exp(-p.drag * dt);
  p.vx *= k;
  p.vy = p.vy * k + p.g * dt;
  p.x += p.vx * dt + (p.sway ? Math.sin(p.age * 3 + p.rot) * p.sway * dt : 0);
  p.y += p.vy * dt;
  p.rot += p.vr * dt;
  return true;
}

/** 0..1 opacity over the particle's life: quick in, long hold, fade out. */
export function alphaOf(p) {
  if (p.age < 0) return 0;
  const t = p.age / p.life;
  return t < 0.08 ? t / 0.08 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
}

/** Draws one particle with a 2D context. */
export function draw(ctx, p) {
  const a = alphaOf(p);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = p.color;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  if (p.shape === 'dot') {
    ctx.beginPath();
    ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.shape === 'star') {
    const r = p.size * (0.7 + 0.3 * Math.sin(p.age * 12));
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.14, -r * 0.14, r, 0);
    ctx.quadraticCurveTo(r * 0.14, r * 0.14, 0, r);
    ctx.quadraticCurveTo(-r * 0.14, r * 0.14, -r, 0);
    ctx.quadraticCurveTo(-r * 0.14, -r * 0.14, 0, -r);
    ctx.fill();
  } else {
    ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
  }
  ctx.restore();
}
