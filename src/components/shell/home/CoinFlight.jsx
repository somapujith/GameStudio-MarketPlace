import { useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CoinIcon } from '../icons.jsx';

const COINS = 14;
const rand = (a, b) => a + Math.random() * (b - a);

/** Centre of an element's box in viewport px, or null. */
export function centerOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * A shower of gold coins: they pop out of `from` (viewport point), hang for a beat and fly into `to`
 * (the top-bar coin chip) with a little pulse on arrival; without a target they burst upward and fade.
 * Web Animations on transform/opacity only; fixed overlay, so nothing in the layout moves.
 * `onDone` fires once the last coin lands. Render it only when motion is allowed.
 */
export default function CoinFlight({ from, to, targetEl, onDone }) {
  const box = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const parts = useMemo(
    () =>
      Array.from({ length: COINS }, (_, i) => {
        const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05); // upper half
        const dist = rand(36, 96);
        return { i, bx: Math.cos(ang) * dist, by: Math.sin(ang) * dist, rot: rand(-200, 200), size: Math.round(rand(16, 24)), delay: i * 34 };
      }),
    [],
  );

  useLayoutEffect(() => {
    const root = box.current;
    if (!root || !from) return undefined;
    const els = [...root.children];
    const anims = [];
    let finished = 0;
    const end = () => {
      finished += 1;
      if (finished === els.length) doneRef.current?.();
    };
    els.forEach((el, k) => {
      const p = parts[k];
      const tx = to ? to.x - from.x : p.bx * 1.4;
      const ty = to ? to.y - from.y : p.by * 1.6 - 90;
      const frames = [
        { transform: 'translate(0px, 0px) scale(0.4) rotate(0deg)', opacity: 0 },
        { transform: `translate(${p.bx}px, ${p.by}px) scale(1.1) rotate(${p.rot / 2}deg)`, opacity: 1, offset: 0.28 },
        { transform: `translate(${p.bx * 1.08}px, ${p.by * 1.08 - 6}px) scale(1) rotate(${p.rot * 0.7}deg)`, opacity: 1, offset: 0.42 },
        to
          ? { transform: `translate(${tx}px, ${ty}px) scale(0.45) rotate(${p.rot}deg)`, opacity: 1, offset: 0.94 }
          : { transform: `translate(${tx}px, ${ty}px) scale(0.8) rotate(${p.rot}deg)`, opacity: 0.6, offset: 0.9 },
        { transform: `translate(${tx}px, ${ty}px) scale(${to ? 0.3 : 0.7}) rotate(${p.rot}deg)`, opacity: 0 },
      ];
      try {
        const a = el.animate(frames, { duration: to ? 1050 : 1200, delay: p.delay, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'both' });
        a.onfinish = end;
        anims.push(a);
      } catch {
        end();
      }
    });
    let pulse = null;
    if (to && targetEl && typeof targetEl.animate === 'function') {
      try {
        pulse = targetEl.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }],
          { duration: 420, delay: 900, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
        );
      } catch {
        pulse = null;
      }
    }
    return () => {
      anims.forEach((a) => a.cancel());
      pulse?.cancel();
    };
  }, [from, to, targetEl, parts]);

  if (!from || typeof document === 'undefined') return null;
  return createPortal(
    <div className="xh-flight" ref={box} aria-hidden="true" style={{ '--fx': `${from.x}px`, '--fy': `${from.y}px` }}>
      {parts.map((p) => (
        <i key={p.i} className="xh-flight__coin" style={{ '--sz': `${p.size}px` }}>
          <CoinIcon size={p.size} />
        </i>
      ))}
    </div>,
    document.body,
  );
}
