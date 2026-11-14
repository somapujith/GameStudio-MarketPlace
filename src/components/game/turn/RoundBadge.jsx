// "Round 7 / 20" with a progress underline; classic mode (no round limit) shows just "Round 7".
// The last rounds get a "2 rounds left" pill and the final round a pulsing "Final round!".
import Pill from '../ui/Pill.jsx';
import { roundInfo } from '../ui/helpers.js';
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
