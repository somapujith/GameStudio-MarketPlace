// DOM speech bubbles above each customer: the dish(es) they still need, or a pay-note when they hold money out. Positioned from
// scene.project() once per frame with transform only; hidden when the customer is off screen. Tapping one acts on that customer.
import { useRef } from 'react';
import { formatINR } from '@shared/format.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { useFrame } from './hooks.js';
import { activeCustomers, customerTarget, needsOf } from './hudLogic.js';

export default function WorldBubbles({ scene, state, onTarget }) {
  const els = useRef(new Map());
  const register = (id, el) => {
    if (el) els.current.set(id, { el, last: '' });
    else els.current.delete(id);
  };
  useFrame(() => {
    if (!scene?.project) return;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    for (const [id, rec] of els.current) {
      const p = scene.project(customerTarget(id));
      const ok = !!p && p.visible !== false && Number.isFinite(p.x) && Number.isFinite(p.y) && (!vw || (p.x > -20 && p.x < vw + 20 && p.y > -20 && p.y < vh + 20));
      const key = ok ? `${Math.round(p.x)},${Math.round(p.y)}` : 'off';
      if (key === rec.last) continue;
      rec.last = key;
      if (!ok) {
        rec.el.dataset.hidden = '1';
      } else {
        rec.el.dataset.hidden = '0';
        rec.el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0) translate(-50%, -100%)`;
      }
    }
  });
  const list = activeCustomers(state).filter((c) => c.st === 'waiting' || c.st === 'paying');
  return (
    <div className="tc-hud-bubbles" aria-hidden="true">
      {list.map((c) => {
        const needs = needsOf(c).slice(0, 3);
        return (
          <button
            key={c.id}
            type="button"
            tabIndex={-1}
            ref={(el) => register(c.id, el)}
            className={`tc-hud-bubble${c.st === 'paying' ? ' is-pay' : ''}`}
            data-hidden="1"
            onClick={() => onTarget(customerTarget(c.id))}
          >
            {c.st === 'paying' ? (
              <>
                <HudIcon name="rupee" size={16} />
                <b>{formatINR(c.total)}</b>
              </>
            ) : (
              needs.map((d, i) => <DishIcon key={i} dish={d} size={30} />)
            )}
          </button>
        );
      })}
    </div>
  );
}
