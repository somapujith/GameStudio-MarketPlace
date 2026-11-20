import { useEffect, useRef, useState } from 'react';

/** Rolls a number from its previous value to `value` over `ms` (ease-out). Instant when `instant` or on first render. */
export function useCountUp(value, { ms = 900, instant = false, delay = 0 } = {}) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const live = useRef(target); // the value currently on screen (an interrupted roll restarts from here)

  useEffect(() => {
    const start = live.current;
    if (instant || start === target || typeof requestAnimationFrame !== 'function') {
      live.current = target;
      setShown(target);
      return undefined;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (t) => {
      if (!t0) t0 = t + delay;
      const k = t < t0 ? 0 : Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      live.current = Math.round(start + (target - start) * e);
      setShown(live.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, instant, delay]);

  return shown;
}
