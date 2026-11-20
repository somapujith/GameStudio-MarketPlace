import { useEffect, useRef, useState } from 'react';
import '@/styles/badge.css';

/** Pure: the whole count as a normalised integer (anything that is not a positive number is 0). */
export function badgeCount(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Pure: the pill text; 99+ above the cap. */
export function badgeText(n, cap = 99) {
  const v = badgeCount(n);
  return v > cap ? `${cap}+` : String(v);
}

/** Pure: the default screen-reader label when the caller does not pass one. */
export function badgeLabel(n) {
  const v = badgeCount(n);
  return `${v} pending ${v === 1 ? 'request' : 'requests'}`;
}

/** Pure: the pop counter, bumped only when the count went up. */
export function nextPop(pop, prev, next) {
  return badgeCount(next) > badgeCount(prev) ? pop + 1 : pop;
}

/**
 * Small count pill. Nothing at 0. `label` is what a screen reader hears ("3 pending requests"); the pill itself
 * is a picture of that. Pops (transform / opacity only) when the count goes up; the pop alternates between two
 * identical keyframes so it restarts every time, and reduced motion turns it off in CSS.
 */
export default function Badge({ count, label, className = '' }) {
  const n = badgeCount(count);
  const prev = useRef(n);
  const [pop, setPop] = useState(0);
  useEffect(() => {
    setPop((p) => nextPop(p, prev.current, n));
    prev.current = n;
  }, [n]);
  if (!n) return null;
  const cls = ['bd-badge', pop ? `bd-badge--pop${pop % 2 ? 'a' : 'b'}` : '', className].filter(Boolean).join(' ');
  return (
    <span className={cls} role="img" aria-label={label || badgeLabel(n)}>
      <span aria-hidden="true">{badgeText(n)}</span>
    </span>
  );
}
