// Every player of the auction as a chip with a status. Sealed: a submitted bid reads "Bid in" for a pass too; only the
// reveal tells a pass from a bid.
import Icon from '../ui/Icon.jsx';
import PlayerToken from '../ui/PlayerToken.jsx';

const LABEL = { thinking: 'Thinking', in: 'Bid in', out: 'Not bidding' };

export default function BidderStrip({ rows, players, me }) {
  if (!rows.length) return null;
  const byId = new Map((players || []).map((p) => [p.id, p]));
  return (
    <ul className="hga-strip" aria-label="Who has bid" style={{ '--cols': rows.length <= 4 ? rows.length : 3, '--cols-d': Math.min(rows.length, 6) }}>
      {rows.map((r) => {
        const p = byId.get(r.id);
        return (
          <li key={r.id} className={`hga-chip is-${r.status}${r.mine ? ' is-me' : ''}`} style={{ '--pc': p?.color }}>
            <PlayerToken player={p} size={34} />
            <span className="hga-chip-txt">
              <b>{r.mine ? 'You' : r.name}</b>
              <small>
                {r.status === 'in' ? <Icon name="check" size={14} /> : null}
                {r.status === 'out' && r.outWhy === 'poor' ? "Can't afford, passed" : LABEL[r.status]}
                {r.status === 'thinking' ? <span className="hg-dots" aria-hidden="true"><i /><i /><i /></span> : null}
              </small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
