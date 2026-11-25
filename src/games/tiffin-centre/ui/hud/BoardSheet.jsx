// The MENU BOARD: the painted price board with a switch per dish. A dish switched off is "Sold out": nobody will order it, and customers who were
// waiting for it swap or leave politely. A dish the shelf cannot make right now is flagged (and the board offers to switch it off).
// Props: { state, onClose, onToggle(dish, on) }. Esc or B closes.
import { useEffect, useRef } from 'react';
import { formatINR } from '@shared/format.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { boardView } from './opsLogic.js';

export default function BoardSheet({ state, onClose, onToggle }) {
  const ref = useRef(null);
  const view = boardView(state);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.activeElement : null;
    (ref.current?.querySelector('[data-suggest="1"]') || ref.current?.querySelector('button[role="switch"]'))?.focus?.({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Escape' || k === 'b') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        const btns = [...(ref.current?.querySelectorAll('button[role="switch"]') || [])];
        if (!btns.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = btns.indexOf(document.activeElement);
        btns[i < 0 ? 0 : k === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!view) return null;
  return (
    <div className="tc-hud-sheetwrap" onClick={onClose}>
      <div ref={ref} className="tc-hud-sheet tc-hud-boardsheet" role="dialog" aria-modal="true" aria-label="Menu board" onClick={(e) => e.stopPropagation()}>
        <header className="tc-hud-sheet-head">
          <span>
            <b>Menu board</b>
            <small>Switch a dish off when you cannot make it (B or Esc to close)</small>
          </span>
          <button type="button" className="tc-hud-btn" onClick={onClose} aria-label="Close (Esc)">
            <HudIcon name="close" size={20} />
          </button>
        </header>
        <ul className="tc-hud-sheet-list">
          {view.rows.map((r) => (
            <li key={r.dish} className={`tc-hud-board-row${r.on ? '' : ' is-off'}`}>
              <button
                type="button"
                role="switch"
                aria-checked={r.on}
                data-suggest={r.suggest ? '1' : undefined}
                className="tc-hud-board-switch"
                aria-label={`${r.name}, ${formatINR(r.price)}: ${r.on ? 'on the board' : 'sold out'}${r.short ? `. Out of ${r.short.name.toLowerCase()}` : ''}`}
                onClick={() => onToggle(r.dish, !r.on)}
              >
                <DishIcon dish={r.dish} size={36} />
                <span className="tc-hud-sheet-name">
                  <b className="tc-hud-en">{r.name}</b>
                  <span className="tc-hud-te">{r.te}</span>
                  {r.short && <span className="tc-hud-board-short">{`Out of ${r.short.name.toLowerCase()}`}</span>}
                </span>
                <span className="tc-hud-tag">{formatINR(r.price)}</span>
                <span className={`tc-hud-switch${r.on ? ' is-on' : ''}`} aria-hidden="true">
                  <i />
                  <b>{r.on ? 'ON' : 'SOLD OUT'}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
