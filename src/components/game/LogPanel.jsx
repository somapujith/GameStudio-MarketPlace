// Game log pieces: the scrolling `LogList` (icon rows in the full-log sheet, terminal style `mono`, and the quiet
// centred `center` variant that sits on the board's play-mat) and `LogSheet`.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { TileIcon } from '@/components/art/index.js';
import { TILES } from '@shared/board.js';
import Sheet from './ui/Sheet.jsx';
import { motionMs, motionToken, useReducedMotion } from './ui/helpers.js';
import '@/styles/controlpanel.css';

export function LogItem({ entry, fresh = false }) {
  const tile = Number.isInteger(entry.tile) ? TILES[entry.tile] : null;
  return (
    <li className={`hg-log-item is-${entry.tone || 'info'}${fresh ? ' is-fresh' : ''}`}>
      <span className="hg-log-ico" aria-hidden="true">
        {tile ? <TileIcon tile={tile} size={18} /> : <i className="hg-log-dot" />}
      </span>
      <span className="hg-log-text">{entry.text}</span>
    </li>
  );
}

/** How many lines the centred log renders: 5 you can read + the one that has just faded out (CSS gives it opacity 0). */
export const CENTER_LINES = 6;

/**
 * The lines the centred log shows, oldest first, each with its `age` (0 = newest). Pure; exported for testing.
 * -> [{ entry, key, age, index }]  (`index` = position in the whole log, so callers can tell old lines from new ones)
 */
export function centerLines(log, limit = CENTER_LINES) {
  const all = Array.isArray(log) ? log : [];
  const from = Math.max(0, all.length - Math.max(1, limit));
  return all.slice(from).map((entry, i, shown) => ({
    entry,
    key: entry.id ?? from + i,
    age: shown.length - 1 - i,
    index: from + i,
  }));
}

/**
 * The quiet log of the board centre: a few centred lines, tone-coloured, the newest brightest, the older ones fading
 * out (CSS reads `data-age`). A new line fades in while the list slides up one line (transform / opacity only,
 * skipped under reduced motion). Silent for screen readers (the die, the buttons and the full log sheet speak).
 */
function CenterLog({ log, className = '', limit = CENTER_LINES }) {
  const list = useRef(null);
  const reduced = useReducedMotion();
  const lines = centerLines(log, limit);
  const initial = useRef(null);
  if (initial.current === null) initial.current = { ids: new Set(lines.map((l) => l.key)), count: log.length };
  const newest = lines.length ? lines[lines.length - 1].key : null;
  const prev = useRef(newest);

  // slide the existing lines up by the height of the line that just arrived
  useLayoutEffect(() => {
    if (prev.current === newest) return;
    prev.current = newest;
    const ol = list.current;
    const last = ol?.lastElementChild;
    if (reduced || !ol || !last || typeof ol.animate !== 'function') return;
    const gap = parseFloat(getComputedStyle(ol).rowGap) || 0;
    const shift = last.offsetHeight + gap;
    if (shift <= 0) return;
    ol.animate(
      [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
      { duration: motionMs('--dur-3', 360), easing: motionToken('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)') },
    );
  }, [newest, reduced]);

  return (
    <div className={`cp-clog ${className}`.trim()} role="log" aria-live="off" aria-label="Game log">
      <ol ref={list} className="cp-clog__list">
        {lines.length === 0 ? <li className="cp-clog__empty">Your story starts with a roll.</li> : null}
        {lines.map(({ entry, key, age, index }) => {
          const fresh = typeof key === 'number' && entry.id == null ? index >= initial.current.count : !initial.current.ids.has(key);
          return (
            <li key={key} className={`cp-clog__line is-${entry.tone || 'info'}${fresh ? ' is-fresh' : ''}`} data-age={age}>
              {entry.text}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Scrolling list that sticks to the bottom unless the user scrolled up (`rows` and `mono`). */
function ScrollLog({ log, className = '', variant = 'rows' }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const initial = useRef(log.length);
  const lastId = log.length ? log[log.length - 1].id : null;
  const mono = variant === 'mono';

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId, log.length]);

  // the panel's inline copy is always on screen next to Dice / ActionBar / EventBanner / CardReveal, which speak for
  // themselves: it stays readable but silent (aria-live off); only the full log sheet is live
  return (
    <ol
      ref={ref}
      className={mono ? `cp-log ${className}`.trim() : `hg-log-list ${className}`}
      role="log"
      aria-live={mono ? 'off' : undefined}
      aria-label="Game log"
      tabIndex={mono ? 0 : undefined}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {log.length === 0 ? <li className={mono ? 'cp-log__empty' : 'hg-log-empty'}>Your story starts with a roll.</li> : null}
      {log.map((entry, i) => (mono ? (
        <li key={entry.id ?? i} className={`cp-log__line is-${entry.tone || 'info'}${i >= initial.current ? ' is-fresh' : ''}`}>{entry.text}</li>
      ) : (
        <LogItem key={entry.id ?? i} entry={entry} fresh={i >= initial.current} />
      )))}
    </ol>
  );
}

/**
 * The game log. variant 'rows' = icon rows for the dark log sheet (default); 'mono' = the terminal-style list;
 * 'center' = the last few lines, centred and fading, for the middle of the board (`limit` = how many it renders).
 */
export function LogList({ variant = 'rows', ...props }) {
  return variant === 'center' ? <CenterLog {...props} /> : <ScrollLog variant={variant} {...props} />;
}

/** The full log as a sheet (also reachable from the menu on short screens). */
export function LogSheet({ session, open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Game log" className="hg-logsheet">
      <LogList log={session.log || []} className="is-sheet" />
    </Sheet>
  );
}
