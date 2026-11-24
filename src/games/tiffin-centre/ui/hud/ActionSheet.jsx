// The action sheet: what can this station cook that is on today's menu. Big thumb rows with an enamel price tag, cook time and the
// same ready / cooking / wanted counts as the chalk board. Keys 1-9 pick, arrows move, Esc closes. A bottom sheet on phones,
// a panel over the dock on wide screens (CSS only). Each row has a '?' that opens that dish's recipe card (steps in English, Telugu, Hindi).
import { useEffect, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import RecipeCard from './RecipeCard.jsx';
import { dishForKey, placeName, stationDishes } from './hudLogic.js';

export default function ActionSheet({ sheet, state, avail, onPick, onClose }) {
  const ref = useRef(null);
  const rows = stationDishes(state, sheet.station);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const stats = new Map((avail || []).map((a) => [a.dish, a]));
  const [peek, setPeek] = useState(null);
  const peekRef = useRef(null);
  peekRef.current = peek;

  useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.activeElement : null;
    const root = ref.current;
    const first = root?.querySelector(sheet.dish ? `[data-dish="${sheet.dish}"]` : 'button[data-dish]') || root?.querySelector('button');
    first?.focus?.({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, [sheet.station, sheet.slot, sheet.dish]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (peekRef.current) setPeek(null);
        else onClose();
        return;
      }
      const row = dishForKey(rows, e.key);
      if (row) {
        e.preventDefault();
        e.stopPropagation();
        onPickRef.current(row.id);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const btns = [...(ref.current?.querySelectorAll('button[data-dish]') || [])];
        if (!btns.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = btns.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[i < 0 ? 0 : next].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rows, onClose]);

  const name = placeName(sheet.station, state);
  return (
    <div className="tc-hud-sheetwrap" onClick={onClose}>
      <div
        ref={ref}
        className="tc-hud-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Cook at ${name}, slot ${sheet.slot + 1}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tc-hud-sheet-head">
          <span>
            <b>{name}</b>
            <small>{`Slot ${sheet.slot + 1}: pick a dish (1-${Math.max(1, rows.length)})`}</small>
          </span>
          <button type="button" className="tc-hud-btn" onClick={onClose} aria-label="Close (Esc)">
            <HudIcon name="close" size={20} />
          </button>
        </header>
        <ul className="tc-hud-sheet-list">
          {rows.map((r) => {
            const a = stats.get(r.id);
            return (
              <li key={r.id} className="tc-hud-sheet-item">
                <button type="button" className="tc-hud-sheet-row" data-dish={r.id} aria-keyshortcuts={String(r.key)} onClick={() => onPick(r.id)}>
                  <span className="tc-hud-keycap" aria-hidden="true">{r.key}</span>
                  <DishIcon dish={r.id} size={44} />
                  <span className="tc-hud-sheet-name">
                    <b className="tc-hud-en">{r.name}</b>
                    <span className="tc-hud-te">{r.te}</span>
                    <span className="tc-hud-sheet-counts">{a ? `${a.ready} ready · ${a.cooking} cooking · ${a.demand} wanted` : ''}</span>
                  </span>
                  <span className="tc-hud-sheet-meta">
                    <span className="tc-hud-tag">{formatINR(r.price)}</span>
                    <small>{`${r.cook}s to cook`}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="tc-hud-sheet-peek"
                  aria-expanded={peek === r.id}
                  aria-label={`Recipe for ${r.name}`}
                  title="Recipe"
                  onClick={() => setPeek((p) => (p === r.id ? null : r.id))}
                >
                  <HudIcon name="help" size={20} />
                </button>
                {peek === r.id && <RecipeCard dish={r.id} className="tc-hud-sheet-recipe" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
