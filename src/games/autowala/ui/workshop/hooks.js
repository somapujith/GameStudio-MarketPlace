// Small React hooks for the garage menu: a media query, an animated number, and a gamepad poller.
import { useEffect, useRef, useState } from 'react';

export function useMedia(query) {
  const get = () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, [query]);
  return on;
}

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that eases toward `value` (instantly with reduced motion). */
export function useCountUp(value, ms = 520) {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion() || cur.current === value) {
      cur.current = value;
      setShown(value);
      return undefined;
    }
    const from = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      cur.current = Math.round(from + (value - from) * e);
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

const REPEAT_FIRST = 380;
const REPEAT_EVERY = 110;

/**
 * Poll the first gamepad while `active`. D-pad / left stick call onNav(dx, dy) with key-repeat, A -> onSelect, B -> onBack,
 * X -> onRepair, Y -> onLeave, LB / RB -> onTab(-1 | 1), right stick + triggers -> onOrbit(x, y, zoom) (continuous).
 * Handlers are read through a ref, so they may change every render.
 */
export function useGamepad(active, handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return undefined;
    let raf = 0;
    const held = new Map(); // id -> { t, next }
    const edge = (id, down, now, fire, repeat) => {
      const s = held.get(id);
      if (!down) {
        held.delete(id);
        return;
      }
      if (!s) {
        held.set(id, { next: now + REPEAT_FIRST });
        fire();
      } else if (repeat && now >= s.next) {
        s.next = now + REPEAT_EVERY;
        fire();
      }
    };
    let orbiting = false;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const pad = [...(navigator.getGamepads() || [])].find(Boolean);
      if (!pad) {
        if (orbiting) { h.current.onOrbit?.(0, 0, 0); orbiting = false; }
        return;
      }
      const b = (i) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      const any = b(0) || b(1) || b(2) || b(3) || b(12) || b(13) || b(14) || b(15) || Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5;
      if (any) h.current.onPadUse?.();
      edge('up', b(12) || ay < -0.6, now, () => h.current.onNav?.(0, -1), true);
      edge('down', b(13) || ay > 0.6, now, () => h.current.onNav?.(0, 1), true);
      edge('left', b(14) || ax < -0.6, now, () => h.current.onNav?.(-1, 0), true);
      edge('right', b(15) || ax > 0.6, now, () => h.current.onNav?.(1, 0), true);
      edge('a', b(0), now, () => h.current.onSelect?.(), false);
      edge('b', b(1), now, () => h.current.onBack?.(), false);
      edge('x', b(2), now, () => h.current.onRepair?.(), false);
      edge('y', b(3), now, () => h.current.onLeave?.(), false);
      edge('lb', b(4), now, () => h.current.onTab?.(-1), false);
      edge('rb', b(5), now, () => h.current.onTab?.(1), false);
      const dz = (x) => (Math.abs(x) < 0.18 ? 0 : x);
      const ox = dz(pad.axes[2] || 0);
      const oy = dz(pad.axes[3] || 0);
      const oz = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0);
      const on = !!(ox || oy || Math.abs(oz) > 0.1);
      if (on || orbiting) h.current.onOrbit?.(ox, oy, oz);
      orbiting = on;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      h.current.onOrbit?.(0, 0, 0);
    };
  }, [active]);
}
