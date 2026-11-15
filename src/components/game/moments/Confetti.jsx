// A small pooled particle layer shared by the key moments: card sparkles, set-complete confetti, the final-round glints
// and the game-over fireworks. One canvas, one requestAnimationFrame loop, a FIXED pool of at most POOL_MAX (60)
// particles that is recycled (nothing is allocated while it runs). It never takes a pointer event, stops its loop as soon
// as the effect is over, and renders nothing at all under reduced motion.
//
//   <Confetti kind="burst" count={48} origin={[0.5, 0.4]} colors={[...]} />       one pop of confetti
//   <Confetti kind="sparkle" count={28} origin={[0.5, 0.5]} colors={GOLD_PALETTE} />   little gold stars
//   <Confetti kind="rain" count={40} loop />                                       a shower that keeps going
//   <Confetti kind="festival" count={60} />                                        rain + fireworks (the game-over finale)
//
// `burstKey` replays the effect when it changes. `delay` (ms) waits before the first particle. `onDone` fires when a
// finite effect has finished. The canvas fills its positioned parent; give the parent `position: relative/absolute/fixed`.
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../ui/helpers.js';
import { PALETTE, POOL_MAX, blank, clampCount, draw, spawn, step } from './particles.js';

const DPR_MAX = 2;

export default function Confetti({
  kind = 'burst', count = 40, origin = [0.5, 0.5], colors = PALETTE, loop = false, delay = 0, speed = 1,
  burstKey = 0, onDone, className = '',
}) {
  const reduced = useReducedMotion();
  const canvasRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const n = clampCount(count);
  const colorKey = colors.join('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (reduced || !canvas || n <= 0) return undefined;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return undefined;
    let w = 0;
    let h = 0;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    ro?.observe(canvas);

    const pool = Array.from({ length: Math.min(n, POOL_MAX) }, blank);
    const festival = kind === 'festival';
    const rainSlots = festival ? Math.ceil(pool.length * 0.55) : pool.length;
    const ox = () => ({ x: origin[0] * w, y: origin[1] * h });
    const fire = (slots, cx, cy) => {
      let used = 0;
      for (const p of slots) {
        if (p.alive) continue;
        spawn(p, 'burst', { origin: { x: cx, y: cy }, colors, speed: 0.55 });
        p.g = 160;
        p.life = 1 + Math.random() * 0.6;
        if (++used >= 14) break;
      }
    };

    let timer = 0;
    let raf = 0;
    let last = 0;
    let t = 0;
    let nextFire = 0.5;
    let stopped = false;

    const begin = () => {
      pool.forEach((p, i) => {
        if (festival && i >= rainSlots) return; // the rest of a festival pool is for fireworks
        if (kind === 'rain' || festival) spawn(p, 'rain', { w, h, colors, speed, delay: (i / rainSlots) * 1.6 });
        else spawn(p, kind, { origin: ox(), w, h, colors, speed });
      });
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const frame = (now) => {
      if (stopped) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      t += dt;
      let alive = 0;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.alive) continue;
        if (!step(p, dt)) {
          if ((loop || festival) && i < rainSlots) spawn(p, 'rain', { w, h, colors, speed });
          else continue;
        }
        alive++;
        draw(ctx, p);
      }
      ctx.globalAlpha = 1;
      if (festival && t >= nextFire) {
        nextFire = t + 0.9 + Math.random() * 0.8;
        fire(pool.slice(rainSlots), w * (0.15 + Math.random() * 0.7), h * (0.12 + Math.random() * 0.3));
      }
      if (alive === 0 && !loop && !festival) {
        ctx.clearRect(0, 0, w, h);
        doneRef.current?.();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    if (delay > 0) timer = setTimeout(begin, delay);
    else begin();
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, kind, n, loop, delay, speed, burstKey, colorKey, origin[0], origin[1]]);

  if (reduced) return null;
  return <canvas ref={canvasRef} className={`mo-confetti ${className}`} aria-hidden="true" />;
}
