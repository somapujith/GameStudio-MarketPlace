import { memo, useEffect, useState } from 'react';
import '@/styles/eventflag.css';
import { flagStart, flagStep } from './eventFlag.js';

const BUNTING = 5;
const CONFETTI = 7;
const LOWER_MS = 760; // a little longer than the lowering animation (CSS), so the node is only dropped after it has played

/** '×1.5' -> the sign apart from the number, so a very small board can print just the number (eventflag.css). */
const Label = ({ text }) =>
  text.startsWith('×') ? (
    <b className="hb-flag__x">
      <i className="hb-flag__t">×</i>
      {text.slice(1)}
    </b>
  ) : (
    <b className="hb-flag__x">{text}</b>
  );

const confetti = (kind) =>
  Array.from({ length: CONFETTI }, (_, i) => (
    <i key={i} style={{ '--a': `${Math.round((i / CONFETTI) * 360 + 20)}deg`, '--i': i }} className={kind ? `is-${kind}` : undefined} />
  ));

/**
 * The flag a city event raises on a board tile (descriptor from board/eventFlag.js, `null` = no event here).
 *   pennant  a small flagpole on the tile's outer edge, the pennant slides up it with a spring, then flutters (desktop):
 *            the event's emoji and its multiplier / bonus
 *   bunting  a string of little pennants along the top of a corner tile, with a tag (emoji, START also the amount)
 * The story is told once, by CHANGES after mount (same render-phase pattern as BuildSite): first paint, a reconnect or a
 * snapshot of an event that is already running shows the flag standing still; a new event (id / round) raises it with a
 * burst of confetti; when the event ends or the next round drops it, it lowers and fades, then unmounts.
 * Transform / opacity only; reduced motion = a plain fade (eventflag.css). Decorative: the tile's aria-label carries the words.
 */
function EventFlagImpl({ flag = null }) {
  const [st, setSt] = useState(() => flagStart(flag));
  const next = flagStep(st, flag);
  if (next !== st) setSt(next); // render-phase, like BuildSite: the animation starts in the same paint as the change

  useEffect(() => {
    if (st.mode !== 'lower') return undefined;
    const t = setTimeout(() => setSt((s) => (s.mode === 'lower' ? { ...s, mode: 'none', flag: null } : s)), LOWER_MS);
    return () => clearTimeout(t);
  }, [st.mode, st.n]);

  const f = st.flag;
  if (st.mode === 'none' || !f) return null;
  const cls = `hb-flag hb-flag--${f.shape} hb-flag--${f.tone} is-${st.mode}`;

  if (f.shape === 'bunting') {
    return (
      <span className={cls} key={st.n} data-tone={f.tone} aria-hidden="true">
        <span className="hb-flag__string">
          {Array.from({ length: BUNTING }, (_, i) => (
            <i key={i} style={{ '--i': i }} />
          ))}
        </span>
        <span className="hb-flag__tag">
          <span className="hb-flag__em">{f.emoji}</span>
          {f.label ? <Label text={f.label} /> : null}
        </span>
        {st.mode === 'raise' ? <span className="hb-flag__burst">{confetti('b')}</span> : null}
      </span>
    );
  }
  return (
    <span className={cls} key={st.n} data-tone={f.tone} aria-hidden="true">
      <i className="hb-flag__pole" />
      <span className="hb-flag__cloth">
        <span className="hb-flag__wave">
          <span className="hb-flag__em">{f.emoji}</span>
          {f.label ? <Label text={f.label} /> : null}
        </span>
      </span>
      {st.mode === 'raise' ? <span className="hb-flag__burst">{confetti()}</span> : null}
    </span>
  );
}

export const EventFlag = memo(EventFlagImpl);
export default EventFlag;
