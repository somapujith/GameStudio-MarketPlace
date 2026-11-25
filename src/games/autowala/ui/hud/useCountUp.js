import { useEffect, useRef, useState } from 'react';
import { easeCount } from './hudLogic.js';

/** A number that eases toward `target` (rupee counters). With `instant` (reduced motion) it just follows the target. */
export function useCountUp(target, instant = false) {
  const [shown, setShown] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (instant || !Number.isFinite(target)) {
      cur.current = target;
      setShown(target);
      return undefined;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      cur.current = easeCount(cur.current, target, dt);
      setShown(Math.round(cur.current));
      if (cur.current !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, instant]);
  return shown;
}

/** Remembers which way a number last moved ('up' | 'down') with a counter, to restart a flash animation. */
export function useChangeFlash(value) {
  const prev = useRef(value);
  const [flash, setFlash] = useState({ dir: '', n: 0 });
  useEffect(() => {
    if (prev.current !== value) {
      const dir = value > prev.current ? 'up' : 'down';
      prev.current = value;
      setFlash((f) => ({ dir, n: f.n + 1 }));
    }
  }, [value]);
  return flash;
}
