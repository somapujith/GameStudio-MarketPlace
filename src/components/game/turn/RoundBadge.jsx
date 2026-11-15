// "Round 7 / 20" with a progress underline; classic mode (no round limit) shows just "Round 7".
// The last rounds get a "2 rounds left" pill and the final round a pulsing "Final round!".
import Pill from '../ui/Pill.jsx';
import Icon from '../ui/Icon.jsx';
import { roundInfo, useWorths } from '../ui/helpers.js';
import { anyoneHot, targetBadge } from './target.js';
import '@/styles/turn.css';

/** Pure: what the badge says. -> { text, sr, pct|null, final, left|null } */
export function roundBadgeInfo(session) {
  const cfg = session?.display?.cfg || session?.view?.cfg || {};
  const raw = roundInfo(session);
  // classic plays until one is left: its safety cap is not a round limit worth showing
  const r = cfg.mode === 'classic' ? { ...raw, max: null, final: false, soon: false, left: null } : raw;
  const text = r.max != null ? `Round ${r.round} / ${r.max}` : `Round ${r.round}`;
  const sr = r.max != null ? `Round ${r.round} of ${r.max}${r.final ? ', the final round' : ''}` : `Round ${r.round}`;
  return { text, sr, pct: r.max != null ? r.pct : null, final: r.final, left: r.soon ? r.left : null };
}

export default function RoundBadge({ session, showPills = true }) {
  const b = roundBadgeInfo(session);
  return (
    <span className="tb-round" aria-label={b.sr}>
      <span
        className={`tb-round__txt${b.final ? ' is-final' : ''}`}
        style={b.pct != null ? { '--rp': `${(b.pct * 100).toFixed(1)}%`, '--rs': Math.max(0, Math.min(1, b.pct)).toFixed(3) } : undefined}
        aria-hidden="true"
      >
        {b.text}
      </span>
      {showPills && b.final ? <Pill tone="bad" pulse aria-hidden="true">Final round!</Pill> : null}
      {showPills && !b.final && b.left != null ? (
        <Pill tone="warn" aria-hidden="true">{b.left} {b.left === 1 ? 'round' : 'rounds'} left</Pill>
      ) : null}
    </span>
  );
}

/**
 * "First to ₹50L": the net worth target, next to the round badge. Goes gold once somebody is at 80% of it.
 * Renders nothing when the table has no target (old rooms). The words shrink to the icon + amount on narrow bars (CSS).
 */
export function TargetBadge({ session }) {
  const { worths, state } = useWorths(session);
  const b = targetBadge(session?.display?.cfg || session?.view?.cfg);
  if (!b) return null;
  const hot = anyoneHot(state.players, worths, b.target);
  return (
    <span className={`tb-target${hot ? ' is-hot' : ''}`} title={b.sr} aria-label={b.sr + (hot ? '. Somebody is close' : '')}>
      <Icon name="target" size={14} />
      <span className="tb-target__txt" aria-hidden="true">
        <span className="tb-target__long">{b.text}</span>
        <span className="tb-target__short">{b.short}</span>
      </span>
    </span>
  );
}
