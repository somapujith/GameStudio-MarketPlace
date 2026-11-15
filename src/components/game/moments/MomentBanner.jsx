// The festival ribbon every key moment shares: a swallow-tailed band that sweeps in with a spring, holds, and sweeps
// out again, with an avatar / icon on the left, a small kicker above a big title, an optional sub line and a badge.
//   <MomentBanner tone="gold" kicker="Round 7 / 20" title="Your turn" lead={<PlayerToken .../>} life={1700} />
// tone: 'gold' (my turn) | 'player' (needs `color`) | 'final' | 'six' | 'set' (needs `color`) | 'out'
// `life` is how long it is on screen in ms (the enter and exit are fixed ~0.45 s inside it). It positions itself over
// the nearest positioned parent (full width, `top` as a CSS length, default 40%), never takes a pointer event, is
// aria-hidden (the table's live region says it in words) and degrades to a plain fade under reduced motion.
import { inkOn, useReducedMotion } from '../ui/helpers.js';
import './moments.css';

export default function MomentBanner({
  tone = 'gold', color, kicker, title, sub, lead, badge, life = 1800, compact = false, top, className = '', id,
}) {
  const reduced = useReducedMotion();
  const style = { '--mo-life': `${Math.max(900, Math.round(life))}ms` };
  if (color) {
    style['--mo-c'] = color;
    if (tone === 'player' || tone === 'set') style['--mo-ink'] = inkOn(color);
  }
  if (top) style['--mo-top'] = top;
  return (
    <div
      id={id}
      className={`mo-rib mo-rib--${tone}${compact ? ' is-compact' : ''} ${className}`.trim()}
      style={style}
      data-rm={reduced ? '' : undefined}
      aria-hidden="true"
    >
      <span className="mo-rib__band">
        <i className="mo-rib__shine" />
        {lead ? <span className="mo-rib__lead">{lead}</span> : null}
        <span className="mo-rib__text">
          {kicker ? <small className="mo-rib__kicker">{kicker}</small> : null}
          <b className="mo-rib__title">{title}</b>
          {sub ? <span className="mo-rib__sub">{sub}</span> : null}
        </span>
        {badge ? <span className="mo-rib__badge">{badge}</span> : null}
      </span>
    </div>
  );
}
