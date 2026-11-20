// A player's Snatch buttons as a small bolt chip with the count ("⚡ 1"), dim at 0. It sits next to the player's piece token
// (phone table) or by the name (desktop pods). When the count GOES UP (a Snatch card) a "+1 Snatch" flourish rises from it.
//   <SnatchChip count={1} />            renders nothing for a count that is not a number (a game without the rule)
//   useTokenBump(count) -> 0 | n        a counter that is non-zero for ~1.7 s after the count rises
import { useEffect, useRef, useState } from 'react';
import '@/styles/snatch.css';

export const BUMP_MS = 1700;

/** A key (1, 2, ...) while a "+1 Snatch" flourish is showing, 0 otherwise. Never fires on the first render. */
export function useTokenBump(count) {
  const prev = useRef(count);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const was = prev.current;
    prev.current = count;
    if (!(Number.isFinite(count) && Number.isFinite(was) && count > was)) return undefined;
    setBump((b) => b + 1);
    const t = setTimeout(() => setBump(0), BUMP_MS);
    return () => clearTimeout(t);
  }, [count]);
  return bump;
}

export const BoltIcon = ({ size = 12 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
    <path d="M13.5 2 5 13.5h5.6L9.6 22 19 9.8h-5.7z" fill="currentColor" />
  </svg>
);

/** The words for assistive tech: "Snatch buttons: 1" (and what they do, once). */
export const snatchChipLabel = (count) => `Snatch ${count === 1 ? 'button' : 'buttons'}: ${count}`;

export default function SnatchChip({ count, className = '' }) {
  const bump = useTokenBump(count);
  if (!Number.isFinite(count)) return null;
  const n = Math.max(0, count);
  return (
    <span className={`sn-chip${n > 0 ? '' : ' is-zero'}${className ? ` ${className}` : ''}`} role="img" aria-label={snatchChipLabel(n)} title={`${snatchChipLabel(n)}: press one to grab a district someone just bought`}>
      <BoltIcon size={12} />
      <b aria-hidden="true">{n}</b>
      {bump ? <i key={bump} className="sn-chip__plus" aria-hidden="true">+1 Snatch</i> : null}
    </span>
  );
}
