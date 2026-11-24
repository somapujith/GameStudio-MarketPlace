import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { GAMES, getGame } from '@/games/registry.js';
import { useScrollLock } from '@/lib/useScrollLock.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useAccount } from '../hooks.js';
import { useViewTransitionNavigate } from '../transitions.js';
import { OPEN_CODE_EVENT } from './events.js';
import { actionMatches, buildSections, flatten, shortcutLabel, stepIndex } from './paletteModel.js';
import { isStaff } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import { recentGames } from './recent.js';
import '@/styles/cine/overlays.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Staff only: the admin console, last of the quick actions (or its own row when a query matches only it). */
const ADMIN_ACTION = {
  id: 'a-admin',
  kind: 'action',
  label: 'Admin console',
  hint: 'Staff tools',
  icon: 'lock',
  to: paths.admin(),
  keys: 'admin console staff moderator moderate ban users dashboard audit announcements',
};

export function withAdminAction(sections, query) {
  if (String(query ?? '').trim() && !actionMatches(ADMIN_ACTION, query)) return sections;
  const i = sections.findIndex((s) => s.id === 'actions');
  if (i >= 0) return sections.map((s, j) => (j === i ? { ...s, items: [...s.items, ADMIN_ACTION] } : s));
  const at = sections.findIndex((s) => s.id === 'search');
  const sec = { id: 'actions', label: 'Quick actions', items: [ADMIN_ACTION] };
  return at >= 0 ? [...sections.slice(0, at), sec, ...sections.slice(at)] : [...sections, sec];
}

/** A game's square icon on its own colours; the initial when the art is missing. */
function GameChip({ game }) {
  const Art = game?.art?.icon;
  const t = game?.theme || {};
  return (
    <span className="cj-ov-pal__ico cj-ov-pal__ico--game" style={{ '--pal-bg': t.bg || undefined, '--pal-a': t.accent || undefined }} aria-hidden="true">
      {Art ? <Art size={40} /> : <b>{String(game?.name || '?').charAt(0).toUpperCase()}</b>}
    </span>
  );
}

function Row({ item, id, active, onPick, onHover }) {
  const soon = item.game?.status === 'coming_soon';
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      className={`cj-ov-pal__item${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
    >
      {item.game ? (
        <GameChip game={item.game} />
      ) : (
        <span className={`cj-ov-pal__ico cj-ov-pal__ico--${item.kind}`} aria-hidden="true">
          <HubIcon name={item.icon || 'search'} size={20} />
        </span>
      )}
      <span className="cj-ov-pal__txt">
        <span className="cj-ov-pal__label">
          {item.label}
          {soon && <i className="cj-ov-pal__soon">Soon</i>}
        </span>
        {item.hint ? <span className="cj-ov-pal__hint">{item.hint}</span> : null}
      </span>
      <span className="cj-ov-pal__go" aria-hidden="true">
        <HubIcon name="arrowR" size={16} />
      </span>
    </li>
  );
}

/**
 * Command palette: search the catalogue, jump to a screen, or go straight to a room code.
 * Combobox + listbox semantics (focus stays in the input, `aria-activedescendant` follows the arrows), focus trap,
 * Esc closes and restores focus. It opens from the keyboard hundreds of times a day for some people, so it has no
 * open/close animation on purpose (see `.cj-ov-pal` in styles/cine/overlays.css).
 */
export default function CommandPalette({ open, onClose }) {
  const uid = useId();
  const listId = `${uid}-list`;
  const { pathname, search } = useLocation();
  const { signedIn, user } = useAccount();
  const staff = isStaff(user);
  const go = useViewTransitionNavigate();
  const panel = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const last = useRef(null);
  const navigated = useRef(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState([]);
  useScrollLock(open);

  const sections = useMemo(() => {
    if (!open) return [];
    const built = buildSections({ query, games: GAMES, recent, signedIn, next: `${pathname}${search}` });
    return staff ? withAdminAction(built, query) : built;
  }, [open, query, recent, signedIn, staff, pathname, search]);
  const flat = useMemo(() => flatten(sections), [sections]);

  useEffect(() => {
    if (!open) return undefined;
    last.current = document.activeElement;
    navigated.current = false;
    setQuery('');
    setActive(0);
    setRecent(recentGames(getGame));
    inputRef.current?.focus();
    return () => {
      if (!navigated.current) {
        const el = last.current;
        if (el && el !== document.body && document.contains(el)) el.focus?.({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // keep the active row in view (keyboard moves only; `nearest` never scrolls the page)
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${uid}-o-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, uid]);

  const pick = useCallback(
    (item) => {
      if (!item) return;
      navigated.current = true;
      onClose?.();
      if (item.run === 'code') window.dispatchEvent(new Event(OPEN_CODE_EVENT));
      else if (item.to) go(item.to);
    },
    [go, onClose],
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => stepIndex(i, e.key === 'ArrowDown' ? 1 : -1, flat.length));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (e.target === inputRef.current && query) return; // let the caret move inside the text
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : Math.max(0, flat.length - 1));
      return;
    }
    if (e.key === 'Enter' && e.target === inputRef.current) {
      e.preventDefault();
      pick(flat[active]);
      return;
    }
    if (e.key === 'Tab' && panel.current) {
      const nodes = [...panel.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const a = nodes[0];
      const z = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
  };

  if (!open) return null;

  let n = -1;
  const count = flat.length;
  const status = query.trim() ? `${count} ${count === 1 ? 'result' : 'results'}` : '';

  return createPortal(
    <div className="xs-pal cj-ov-pal" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={panel} className="cj-ov-pal__panel" role="dialog" aria-modal="true" aria-label="Search Jalebi Games" onKeyDown={onKeyDown}>
        <div className="cj-ov-pal__bar">
          <HubIcon name="search" size={20} className="cj-ov-pal__mag" />
          <input
            ref={inputRef}
            className="cj-ov-pal__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={count ? `${uid}-o-${Math.min(active, count - 1)}` : undefined}
            aria-label="Search games, pages and room codes"
            placeholder="Search games, or type a room code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {query ? (
            <button type="button" className="cj-ov-pal__clear" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
              <HubIcon name="close" size={16} strokeWidth={2.4} />
            </button>
          ) : null}
          <button type="button" className="cj-ov-pal__close" onClick={onClose}>
            <span className="cj-ov-pal__close-long">Esc</span>
            <span className="cj-ov-pal__close-short">Cancel</span>
          </button>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label={query.trim() ? 'Results' : 'Suggestions'} className="cj-ov-pal__list">
          {sections.map((s) => (
            <li key={s.id} role="presentation" className="cj-ov-pal__sec">
              {s.label ? <div className="cj-ov-pal__sechead" role="presentation">{s.label}</div> : null}
              <ul role="presentation" className="cj-ov-pal__rows">
                {s.items.map((item) => {
                  n += 1;
                  const i = n;
                  return <Row key={item.id} item={item} id={`${uid}-o-${i}`} active={i === Math.min(active, count - 1)} onPick={() => pick(item)} onHover={() => active !== i && setActive(i)} />;
                })}
              </ul>
            </li>
          ))}
        </ul>

        <p className="cj-ov-pal__foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="cj-ov-pal__foot-end">{shortcutLabel()} anywhere</span>
        </p>
        <p className="hub-sr" role="status" aria-live="polite">{status}</p>
      </div>
    </div>,
    document.body,
  );
}
