import { useEffect, useRef } from 'react';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { GameIcon } from './GameArt.jsx';

/**
 * Overall + one tab per live game, as signage pills with the game's icon. WAI-ARIA tabs: roving tabindex,
 * arrow keys / Home / End. The row scrolls sideways on phones and keeps the active tab in view.
 */
export default function LeaderTabs({ games, value, onChange, panelId }) {
  const list = useRef(null);
  const tabs = [{ id: 'overall', label: 'Overall', game: null }, ...games.map((g) => ({ id: g.id, label: g.name, game: g }))];

  useEffect(() => {
    const el = list.current?.querySelector('[aria-selected="true"]');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [value]);

  const onKeyDown = (e) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    const idx = Math.max(0, tabs.findIndex((t) => t.id === value));
    let next = idx;
    if (keys[e.key] === 'first') next = 0;
    else if (keys[e.key] === 'last') next = tabs.length - 1;
    else next = (idx + keys[e.key] + tabs.length) % tabs.length;
    e.preventDefault();
    onChange(tabs[next].id);
    requestAnimationFrame(() => list.current?.querySelector(`[data-tab="${CSS.escape(tabs[next].id)}"]`)?.focus());
  };

  return (
    <div className="sl-tabs" role="tablist" aria-label="Leaderboard" ref={list} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`hh2-tab-${t.id}`}
            data-tab={t.id}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            className={`sl-tab ${on ? 'is-on' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.game ? <GameIcon game={t.game} size={26} /> : <HubIcon name="podium" size={20} />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
