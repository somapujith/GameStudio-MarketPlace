// A number that counts up to `value` (ease-out) once, after `delay` ms. The visible text animates and is aria-hidden; a
// visually-hidden copy always carries the final value, so screen readers never hear the tumbling digits. With `skip`
// (or reduced motion) the final value shows at once. Used by the game-over podium for net worth.
import { useEffect, useState } from 'react';
import { useReducedMotion } from '../ui/helpers.js';
import { countAt } from './momentsModel.js';

export default function CountUp({ value, format = String, delay = 0, duration = 1000, skip = false, className = '' }) {
  const reduced = useReducedMotion();
  const target = Number(value) || 0;
  const instant = reduced || skip;
  const [now, setNow] = useState(instant ? target : 0);

  useEffect(() => {
    if (instant) {
      setNow(target);
      return undefined;
    }
    let raf = 0;
    let start = 0;
    const tick = (t) => {
      if (!start) start = t;
      const k = (t - start) / duration;
      setNow(countAt(target, k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, instant, delay, duration]);

  return (
    <>
      <span className={className} aria-hidden="true">{format(now)}</span>
      <span className="hg-sr">{format(target)}</span>
    </>
  );
}
