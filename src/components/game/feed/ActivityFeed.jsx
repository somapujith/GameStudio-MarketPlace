// The activity feed: the story of the table in plain words, newest on top.
//
//   import ActivityFeed from '@/components/game/feed/ActivityFeed.jsx';
//   <ActivityFeed session={session} max={12} compact />
//
//   props   session   the table's session (reads session.log, session.display.players, session.me)
//           max       rows shown (default 12)
//           compact   tighter rows (the 3-row strip inside the chat card)
//           variant   'panel' (default: a card with a collapsible header) | 'sheet' (the full log inside the Game log sheet)
//           className extra class on the root
//           onPick    (item) called when a row with a tile is tapped, before the pulse (the log sheet closes itself here)
//
// Each row: a tinted icon, the sentence with players / tiles / amounts as chips ("Sana paid ₹32,000 rent to Ravi"), the
// money that moved when it is yours (+/-), and its age ("now", "12s", "3m") fading as it gets old. Tapping a row that
// points at a tile pulses a ring on that tile of the board. New rows slide in from the top; the list never steals
// focus and is silent for screen readers (the table's own live region speaks).
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motionMs, motionToken, useReducedMotion } from '../ui/helpers.js';
import { pulseTile } from '../fx/pulse.js';
import { ageFade, buildFeed, chipify, moneyChip, relativeAge, rowLabel } from './feedModel.js';
import '@/styles/feed.css';

const NONE = [];
const KEY = 'hg-feed-collapsed';

function readCollapsed() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Re-render every `ms` while the tab is visible (ages tick). */
function useTick(ms, on) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) setN((n) => n + 1);
    }, ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

/** A sentence with its players, tiles and amounts as chips. */
export function Chips({ text, players, me }) {
  const parts = useMemo(() => chipify(text, { players, me }), [text, players, me]);
  return parts.map((p, i) => {
    if (p.t === 'player') return <b key={i} className="af-chip" style={p.color ? { '--c': p.color } : undefined}>{p.s}</b>;
    if (p.t === 'tile') return <b key={i} className="af-tile">{p.s}</b>;
    if (p.t === 'amount') return <b key={i} className="af-amt">{p.s}</b>;
    return <Fragment key={i}>{p.s}</Fragment>;
  });
}

function Row({ item, players, me, now, fresh, sheet, onPick }) {
  const age = item.at ? now - item.at : 0;
  const color = item.player != null ? players.find((p) => p.id === item.player)?.color : null;
  const money = moneyChip(item, me);
  const tappable = Number.isInteger(item.tile);
  const body = (
    <>
      <span className="af__ico" aria-hidden="true">{item.icon}</span>
      <span className="af__body">
        <span className="af__text"><Chips text={item.text} players={players} me={me} /></span>
        {item.label || item.at ? (
          <span className="af__meta">
            {item.label ? <span className="af__tag" aria-hidden="true">{item.label}</span> : null}
            {item.at ? <time className="af__age" dateTime={new Date(item.at).toISOString()}>{relativeAge(age)}</time> : null}
          </span>
        ) : null}
      </span>
      {money && money.mine ? <span className={`af__money${money.sign < 0 ? ' is-out' : ' is-in'}`}>{money.text}</span> : null}
    </>
  );
  return (
    <li
      className={`af__row is-${item.tone}${fresh ? ' is-fresh' : ''}${tappable ? ' is-tap' : ''}`}
      data-kind={item.kind}
      style={{ '--pc': color || undefined, '--fade': ageFade(age).toFixed(2) }}
    >
      {tappable ? (
        <button
          type="button"
          className="af__hit"
          onClick={() => {
            // inside a sheet the board is covered: let the sheet leave first, then point at the tile
            if (onPick) {
              onPick(item);
              setTimeout(() => pulseTile(item.tile), 340);
            } else pulseTile(item.tile);
          }}
          aria-label={rowLabel(item)}
        >
          {body}
        </button>
      ) : (
        <div className="af__hit">{body}</div>
      )}
    </li>
  );
}

export default function ActivityFeed({ session, max = 12, compact = false, variant = 'panel', className = '', onPick }) {
  const sheet = variant === 'sheet';
  const log = session?.log;
  const players = session?.display?.players || session?.view?.players || NONE;
  const me = session?.me;
  const reduced = useReducedMotion();
  const items = useMemo(() => buildFeed(log, { max: sheet ? 200 : max }), [log, max, sheet]);
  useTick(5000, items.length > 0);
  const now = Date.now();
  const [collapsed, setCollapsed] = useState(() => (sheet ? false : readCollapsed()));
  const list = useRef(null);
  const initial = useRef(null);
  if (initial.current === null) initial.current = new Set(items.map((i) => i.id));
  const newest = items.length ? items[0].id : null;
  const prev = useRef(newest);

  // new rows push the older ones down: slide the whole list from one row up (transform only)
  useLayoutEffect(() => {
    if (prev.current === newest) return;
    prev.current = newest;
    const ol = list.current;
    const first = ol && ol.firstElementChild;
    if (reduced || collapsed || !ol || !first || typeof ol.animate !== 'function') return;
    const gap = parseFloat(getComputedStyle(ol).rowGap) || 0;
    const shift = first.offsetHeight + gap;
    if (shift <= 0) return;
    ol.animate([{ transform: `translateY(${-shift}px)` }, { transform: 'translateY(0)' }], { duration: motionMs('--dur-3', 360), easing: motionToken('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)') });
  }, [newest, reduced, collapsed]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* private mode: the choice just does not stick */
    }
  };

  const open = sheet || !collapsed;
  return (
    <section className={`af${compact ? ' is-compact' : ''}${sheet ? ' is-sheet' : ''}${open ? '' : ' is-collapsed'}${className ? ` ${className}` : ''}`} aria-label={sheet ? 'Game log' : 'Activity'}>
      {sheet || compact ? null : (
        <header className="af__head">
          <h2 className="af__title"><span className="af__pulse" aria-hidden="true" />Activity</h2>
          <button type="button" className="af__fold" onClick={toggle} aria-expanded={open} aria-label={open ? 'Collapse activity feed' : 'Expand activity feed'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </header>
      )}
      {open ? (
        <ol ref={list} className="af__list" role="log" aria-live="off" aria-label={sheet ? 'Game log' : 'Activity feed'} tabIndex={sheet ? 0 : undefined}>
          {items.length === 0 ? <li className="af__empty">Your story starts with a roll.</li> : null}
          {items.map((item) => (
            <Row key={item.id} item={item} players={players} me={me} now={now} fresh={!initial.current.has(item.id)} sheet={sheet} onPick={onPick} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export { ActivityFeed };
