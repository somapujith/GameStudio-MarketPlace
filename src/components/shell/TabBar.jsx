import { useLayoutEffect, useRef, useState } from 'react';
import { buzz } from '@/lib/haptics.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Badge from '@/platform/social/Badge.jsx';
import { OPEN_SEARCH_EVENT } from './nav/events.js';
import { NAV_ITEMS, useIsActive } from './nav/navItems.js';
import TransitionLink from './nav/TransitionLink.jsx';

/** Visual badge on a nav icon: a count of things waiting, else a live dot (`badges` comes from useNavBadges in AppShell). */
function NavBadge({ id, badges }) {
  const b = badges && badges[id];
  if (!b) return null;
  if (b.count > 0) return <Badge count={b.count} label={b.label || `${b.count} waiting`} className="bd-badge--nav" />; // announces itself
  return b.online > 0 ? <i className="hub-navbadge hub-navbadge--live st-live" aria-hidden="true" /> : null;
}

/** Screen-reader note for the live dot (a count badge carries its own label). */
function NavNote({ id, badges }) {
  const b = badges && badges[id];
  if (!b || b.count > 0) return null;
  return b.online > 0 ? <span className="hub-sr">, {b.online} online</span> : null;
}

/** Kept for the barrel (`@/components/shell/index.js`): both lists are the same hub destinations. */
export const TABS = NAV_ITEMS;
export const NAV = NAV_ITEMS;

/** The search slot in the phone dock: a button (it opens the command palette), not a destination. */
const SEARCH = { id: 'search', label: 'Search', icon: 'search', search: true };

/** Dock order on phones: Arcade, Browse, The Adda, Leaderboard, Search, Profile. */
const DOCK_ITEMS = [...NAV_ITEMS.filter((t) => t.id !== 'profile'), SEARCH, ...NAV_ITEMS.filter((t) => t.id === 'profile')];
/** The desktop pill: the four destinations (Profile is the avatar in the cluster). */
const PILL_ITEMS = NAV_ITEMS.filter((t) => t.id !== 'profile');

/**
 * Sliding active indicator: measures the active item's `selector` element inside `listRef` and returns
 * a transform-only style (position via translate; size set once per layout change). Hidden when nothing is
 * active or the list is not displayed. The first placement does not animate.
 */
function useIndicator(listRef, activeIndex, selector) {
  const [box, setBox] = useState(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const measure = () => {
      const items = list.querySelectorAll(':scope > li');
      const li = activeIndex >= 0 ? items[activeIndex] : null;
      const el = li ? li.querySelector(selector) || li : null;
      if (!el || !list.offsetParent) {
        setBox(null);
        placed.current = false;
        return;
      }
      const a = list.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) {
        setBox(null);
        placed.current = false;
        return;
      }
      setBox((prev) => {
        const next = { x: Math.round(b.left - a.left), y: Math.round(b.top - a.top), w: Math.round(b.width), h: Math.round(b.height), animate: placed.current };
        placed.current = true;
        if (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return prev;
        return next;
      });
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(list);
      list.querySelectorAll(':scope > li').forEach((li) => ro.observe(li));
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [listRef, activeIndex, selector]);

  if (!box) return { style: { opacity: 0 }, on: false };
  return {
    on: true,
    style: {
      width: `${box.w}px`,
      height: `${box.h}px`,
      transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
      transition: box.animate ? undefined : 'none',
    },
  };
}

function useNav(items) {
  const active = useIsActive();
  const activeIndex = items.findIndex((t) => !t.search && active(t));
  const onTab = (on) => () => {
    if (!on) buzz('tap');
  };
  return { active, activeIndex, onTab };
}

/**
 * Phones and tablets (< 900 px): the floating glass dock at the bottom. Icons only (each link still carries its name
 * for screen readers), the active one in a rounded-square highlight that springs between items, badges on the icons.
 * Search opens the command palette. Hidden from 900 px, where the top bar's pill takes over.
 */
export default function TabBar({ badges }) {
  const { active, activeIndex, onTab } = useNav(DOCK_ITEMS);
  const listRef = useRef(null);
  const ind = useIndicator(listRef, activeIndex, '.cj-dock__item');
  return (
    <nav className="cj-dock" aria-label="Primary" data-tour="nav-tabbar">
      <ul ref={listRef} className={`cj-dock__list${ind.on ? ' has-ind' : ''}`}>
        {DOCK_ITEMS.map((t) => {
          if (t.search) {
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="cj-dock__item"
                  aria-haspopup="dialog"
                  onClick={() => {
                    buzz('tap');
                    window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
                  }}
                >
                  <span className="cj-dock__icon">
                    <HubIcon name={t.icon} size={22} />
                  </span>
                  <span className="hub-sr">Search games and pages</span>
                </button>
              </li>
            );
          }
          const on = active(t);
          return (
            <li key={t.id}>
              <TransitionLink to={t.to} className={`cj-dock__item${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined} onClick={onTab(on)}>
                <span className="cj-dock__icon">
                  <HubIcon name={t.icon} size={22} strokeWidth={on ? 2.2 : 1.9} />
                  <NavBadge id={t.id} badges={badges} />
                </span>
                <span className="hub-sr">
                  {t.label}
                  <NavNote id={t.id} badges={badges} />
                </span>
              </TransitionLink>
            </li>
          );
        })}
        <li className="cj-dock__ind" aria-hidden="true" style={ind.style} />
      </ul>
    </nav>
  );
}

/**
 * Wide screens (>= 900 px): the destinations inside the top bar's floating glass pill. The active one is a white
 * pill with its icon (it springs from item to item); the others are plain 80% white labels. Hidden below 900 px.
 */
export function TopNav({ badges }) {
  const { active, activeIndex, onTab } = useNav(PILL_ITEMS);
  const listRef = useRef(null);
  const ind = useIndicator(listRef, activeIndex, '.cj-nav__link');
  return (
    <nav className="cj-nav__links" aria-label="Main" data-tour="nav-rail">
      <ul ref={listRef} className={`cj-nav__list${ind.on ? ' has-ind' : ''}`}>
        {PILL_ITEMS.map((t) => {
          const on = active(t);
          return (
            <li key={t.id}>
              <TransitionLink to={t.to} className={`cj-nav__link${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined} onClick={onTab(on)}>
                <HubIcon name={t.icon} size={16} strokeWidth={2.2} className="cj-nav__ico" />
                <span>
                  {t.label}
                  <NavNote id={t.id} badges={badges} />
                </span>
                <NavBadge id={t.id} badges={badges} />
              </TransitionLink>
            </li>
          );
        })}
        <li className="cj-nav__ind" aria-hidden="true" style={ind.style} />
      </ul>
    </nav>
  );
}
