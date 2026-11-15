import { useLayoutEffect, useRef, useState } from 'react';
import { buzz } from '@/lib/haptics.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { NAV_ITEMS, useIsActive } from './nav/navItems.js';
import TransitionLink from './nav/TransitionLink.jsx';

/** Visual badge on a nav icon: a count of things waiting, else a live dot (`badges` comes from useNavBadges in AppShell). */
function NavBadge({ id, badges }) {
  const b = badges && badges[id];
  if (!b) return null;
  if (b.count > 0) {
    return (
      <i className="hub-navbadge" aria-hidden="true">
        {b.count > 9 ? '9+' : b.count}
      </i>
    );
  }
  return b.online > 0 ? <i className="hub-navbadge hub-navbadge--live st-live" aria-hidden="true" /> : null;
}

/** Screen-reader note for the same badge. */
function NavNote({ id, badges }) {
  const b = badges && badges[id];
  if (!b) return null;
  if (b.count > 0) return <span className="hub-sr">, {b.count} waiting</span>;
  return b.online > 0 ? <span className="hub-sr">, {b.online} online</span> : null;
}

/** Kept for the barrel (`@/components/shell/index.js`): both lists are the same four hub destinations. */
export const TABS = NAV_ITEMS;
export const NAV = NAV_ITEMS;

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

function useNav() {
  const active = useIsActive();
  const activeIndex = NAV_ITEMS.findIndex((t) => active(t));
  const onTab = (on) => () => {
    if (!on) buzz('tap');
  };
  return { active, activeIndex, onTab };
}

/** Bottom tab bar, shown on phones and tablets (hidden >= 900 px, where the left rail takes over). */
export default function TabBar({ badges }) {
  const { active, activeIndex, onTab } = useNav();
  const listRef = useRef(null);
  const ind = useIndicator(listRef, activeIndex, '.hub-tab__icon');
  return (
    <nav className="hub-tabbar xs-ind-host" aria-label="Primary">
      <ul ref={listRef} className="xs-ind-list">
        {NAV_ITEMS.map((t) => {
          const on = active(t);
          return (
            <li key={t.id}>
              <TransitionLink to={t.to} className={`hub-tab${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined} onClick={onTab(on)}>
                <span className="hub-tab__icon">
                  <HubIcon name={t.icon} size={22} strokeWidth={on ? 2.3 : 2} />
                  <NavBadge id={t.id} badges={badges} />
                </span>
                <span className="hub-tab__label">{t.label}<NavNote id={t.id} badges={badges} /></span>
              </TransitionLink>
            </li>
          );
        })}
        <li className="xs-ind xs-ind--tab" aria-hidden="true" style={ind.style} />
      </ul>
    </nav>
  );
}

/** Left rail for wide screens (>= 900 px; hidden below by CSS). Same destinations as the tab bar. */
export function TopNav({ badges }) {
  const { active, activeIndex, onTab } = useNav();
  const listRef = useRef(null);
  const ind = useIndicator(listRef, activeIndex, '.hub-rail__link');
  return (
    <nav className="hub-rail xs-ind-host" aria-label="Main">
      <ul ref={listRef} className="xs-ind-list">
        {NAV_ITEMS.map((t) => {
          const on = active(t);
          return (
            <li key={t.id}>
              <TransitionLink to={t.to} className={`hub-rail__link${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined} onClick={onTab(on)}>
                <span className="hub-rail__icon">
                  <HubIcon name={t.icon} size={22} strokeWidth={on ? 2.3 : 2} />
                  <NavBadge id={t.id} badges={badges} />
                </span>
                <span className="hub-rail__label">{t.label}<NavNote id={t.id} badges={badges} /></span>
              </TransitionLink>
            </li>
          );
        })}
        <li className="xs-ind xs-ind--rail" aria-hidden="true" style={ind.style} />
      </ul>
    </nav>
  );
}
