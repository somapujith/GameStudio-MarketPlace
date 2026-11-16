// Public status chips for armed power cards: "Shield" and "Double rent" with the rounds left (docs/POWER_CARDS.md 3.2).
//   <PowerChips player round size="xs" | "sm" | "md" />   (or `chips` = already computed armedChips(...))
// Each chip has its own icon AND text (never colour alone); `xs` shows the icon and the rounds only (the pod's button label
// says the rest in words). When a chip disappears (consumed or expired) a ghost of it flashes out, found by diffing the chips
// between renders: nothing plays on mount. Also here: the glue the player surfaces use (<PlayerPower>, <PowerSheetSection>).
import { useEffect, useRef, useState } from 'react';
import PowerStack from './PowerStack.jsx';
import { armedChips, countText, goneChips, powerOf, sheetNote, SHEET_EMPTY } from './powerView.js';
import '@/styles/power-opp.css';

const svg = { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };

/** Shield: a crest with a tick. Double rent: two overlapping coins. */
export function ChipIcon({ id }) {
  return id === 'shield' ? (
    <svg {...svg}><path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.1-7.5 9.5-4.4-1.4-7.5-5.1-7.5-9.5V6z" /><path d="M8.8 12l2.4 2.4 4-4.6" /></svg>
  ) : (
    <svg {...svg}><circle cx="9" cy="9" r="5.5" /><path d="M14.2 11.2A5.5 5.5 0 1 1 11.4 17" /><path d="M9 6.8v4.4" /></svg>
  );
}

function Chip({ chip, size, gone = false }) {
  const label = gone ? undefined : chip.title;
  return (
    <span
      className={`pwo-chip pwo-chip--${size} is-${chip.id}${gone ? ' is-gone' : ''}`}
      role={gone ? undefined : 'img'}
      aria-label={label}
      aria-hidden={gone ? true : undefined}
      title={label}
      data-chip={chip.id}
    >
      <ChipIcon id={chip.id} />
      {size === 'xs' ? <b className="pwo-chip__n" aria-hidden="true">{chip.rounds}</b> : (
        <>
          <span className="pwo-chip__t" aria-hidden="true"><b>{chip.label}</b><small>{chip.rounds > 1 ? `${chip.rounds} rounds` : 'last round'}</small></span>
          {/* two chips at once: CSS swaps the words for this number (the icon says which, the label has the words) */}
          <b className="pwo-chip__n pwo-chip__n--alt" aria-hidden="true">{chip.rounds}</b>
        </>
      )}
    </span>
  );
}

export default function PowerChips({ player, round, chips: given, size = 'sm', className = '' }) {
  const chips = given || armedChips(player, round);
  const key = chips.map((c) => c.id).join(',');
  const prev = useRef(chips);
  const [ghosts, setGhosts] = useState([]);

  // Diff against the previous render: a chip that vanished flashes out for a moment. The first render never has a "previous".
  useEffect(() => {
    const gone = goneChips(prev.current, chips);
    prev.current = chips;
    setGhosts((g) => (g.length || gone.length ? gone : g));
    if (!gone.length) return undefined;
    const t = setTimeout(() => setGhosts([]), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shownGhosts = ghosts.filter((g) => !chips.some((c) => c.id === g.id));
  if (!chips.length && !shownGhosts.length) return null;
  return (
    <span className={`pwo-chips pwo-chips--${size}${className ? ` ${className}` : ''}`}>
      {chips.map((c) => <Chip key={c.id} chip={c} size={size} />)}
      {shownGhosts.map((c) => <Chip key={`gone-${c.id}`} chip={c} size={size} gone />)}
    </span>
  );
}

/**
 * What a player surface shows for one player, or nothing at all when the rule is off (zero DOM) or the player is out.
 *   variant 'pod'    (wide pods)           a small fan + the chips with text, inline in the pod's status line
 *   variant 'row'    (scoreboard rows)     the same, in the row's right column
 *   variant 'corner' (compact pods, phone cells)  the count badge on the avatar's corner, icon-only chips on its other corner
 */
export function PlayerPower({ session, player, variant = 'pod' }) {
  const info = powerOf(session, player);
  if (!info) return null;
  const stack = <PowerStack count={info.count} size={variant === 'corner' ? 'xs' : 'sm'} name={info.name} isMe={info.isMe} />;
  if (variant === 'corner') {
    return (
      <>
        <span className="pwo-corner" data-pwo="count">{stack}</span>
        <span className="pwo-flags" data-pwo="flags"><PowerChips chips={info.chips} size="xs" /></span>
      </>
    );
  }
  return (
    <>
      {stack}
      <PowerChips chips={info.chips} size="sm" />
    </>
  );
}

/** The player sheet's section: the stack, the chips and the one-line explainer. */
export function PowerSheetSection({ session, player }) {
  const info = powerOf(session, player);
  if (!info) return null;
  return (
    <section className="pwo-sec" aria-label="Power cards">
      <h3 className="hg-h3">Power cards</h3>
      <div className="pwo-sec__row">
        <PowerStack count={info.count} size="md" name={info.name} isMe={info.isMe} />
        <span className="pwo-sec__count">{info.count > 0 ? countText(info.count) : SHEET_EMPTY}</span>
        <PowerChips chips={info.chips} size="md" />
      </div>
      <p className="pwo-sec__note">{sheetNote(info.name, info.isMe)}</p>
    </section>
  );
}
