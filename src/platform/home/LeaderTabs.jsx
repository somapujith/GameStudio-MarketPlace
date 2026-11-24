import { useEffect, useRef } from 'react';

/**
 * Overall + one tab per live game, then any `extra` tabs (`{ id, label }`, e.g. the Season race), drawn as the dim
 * sibling tabs of a cine page head (`.cj-pagehead__tab`: the selected one turns white). WAI-ARIA tabs: roving
 * tabindex, arrow keys / Home / End. The row scrolls sideways on phones and keeps the active tab in view.
 */
export default function LeaderTabs({ games, value, onChange, panelId, extra = [] }) {
  const list = useRef(null);
  const tabs = [
    { id: 'overall', label: 'Overall', game: null },
    ...games.map((g) => ({ id: g.id, label: g.name, game: g })),
    ...extra.map((t) => ({ id: t.id, label: t.label, game: null })),
  ];

  useEffect(() => {
    const row = list.current;
    const el = row?.querySelector('[aria-selected="true"]');
    // scroll the tab row itself (never the page): the leaderboard fits the viewport
    if (row && el && row.scrollWidth > row.clientWidth) row.scrollTo?.({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2 });
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
    <div className="cj-lb-tabs" role="tablist" aria-label="Leaderboard" ref={list} onKeyDown={onKeyDown}>
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
            className="cj-pagehead__tab cj-lb-tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
