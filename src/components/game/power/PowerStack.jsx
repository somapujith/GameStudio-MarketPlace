// A face-down stack of power cards with a count badge: the PUBLIC part of someone's hand (docs/POWER_CARDS.md 3.2).
//   <PowerStack count size="xs" | "sm" | "md" label? name? isMe? />
//   xs = just a tiny card glyph and the count (compact pods, phone cells); sm = a fan of 1-2 card backs (rows, pods); md = the sheet.
// 0 cards renders nothing at all (no layout shift). The badge ticks when the count changes AFTER mount (never on the first render).
// The art is looked up by name at render time so a build without it (or a strict test mock) still works.
import { useEffect, useRef, useState } from 'react';
import * as Art from '@/components/art/index.js';
import { stackLabel } from './powerView.js';
import '@/styles/power-opp.css';

const part = (name) => {
  try {
    return Art[name] || null;
  } catch {
    return null; // a strict test mock throws on unknown exports
  }
};

/** Card width in px of the backs per size. */
export const STACK_W = Object.freeze({ sm: 20, md: 34 });

export default function PowerStack({ count, size = 'sm', label, name, isMe = false, className = '' }) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  // Tick on a change after mount only: the counter starts at 0 and the effect bumps it when `n` differs from the last render.
  const prev = useRef(n);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prev.current === n) return;
    prev.current = n;
    setTick((t) => t + 1);
  }, [n]);

  if (n <= 0) return null;
  const text = label || stackLabel(name, n, isMe);
  const cls = `pwo-stack pwo-stack--${size}${n > 1 ? ' is-two' : ''}${tick ? ' is-ticked' : ''}${className ? ` ${className}` : ''}`;
  const Back = size === 'xs' ? null : part('CardBack');
  const w = STACK_W[size] || STACK_W.sm;
  const back = (cn) => (
    <span className={`pwo-card ${cn}`}>
      {Back ? <Back deck="drama" size={w} /> : <i className="pwo-card__fill" />}
    </span>
  );
  return (
    <span className={cls} role="img" aria-label={text} title={text} data-count={n} style={{ '--pwo-w': `${w}px` }}>
      {size === 'xs' ? (
        <i className="pwo-mini" aria-hidden="true" />
      ) : (
        <span className="pwo-cards" aria-hidden="true">
          {n > 1 ? back('pwo-card--under') : null}
          {back('pwo-card--top')}
        </span>
      )}
      <b key={tick} className="pwo-badge" aria-hidden="true">{n}</b>
    </span>
  );
}
