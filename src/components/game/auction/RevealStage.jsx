// The reveal (auction_end): bid cards flip lowest to highest, the winner slams in last under a SOLD stamp. Timing comes
// from revealPlan (CSS animation-delay per card: transform + opacity only). A tap anywhere skips to the end; reduced
// motion shows everything at once with a fade.
import { useState } from 'react';
import { formatINR } from '@shared/format.js';
import Icon from '../ui/Icon.jsx';
import PlayerToken from '../ui/PlayerToken.jsx';
import { resultCaption, revealPlan } from './auctionModel.js';

export default function RevealStage({ end, players, me, tileName, ms, reduced, only = null }) {
  const [skipped, setSkipped] = useState(false);
  const byId = new Map((players || []).map((p) => [p.id, p]));
  const nameOf = (id) => (id === me ? 'You' : byId.get(id)?.name || 'Someone');
  const plan = revealPlan(end, players, { ms, reduced, only });
  const cap = resultCaption(end, nameOf, { tileName });
  const winner = end.winner !== null && end.winner !== undefined ? byId.get(end.winner) : null;
  const sold = cap?.kind === 'sold';

  return (
    <div
      className={`hga-reveal${skipped ? ' is-skipped' : ''}${sold ? ' is-sold' : ''}`}
      style={{ '--flip': `${plan.flipMs}ms`, ...(winner ? { '--win': winner.color } : null) }}
      onClick={() => setSkipped(true)}
      role="group"
      aria-label="Auction result"
    >
      {plan.cards.length ? (
        <ul className="hga-cards" data-n={plan.cards.length}>
          {plan.cards.map((c) => {
            const p = byId.get(c.id);
            return (
              <li key={c.id} className={`hga-card${c.winner ? ' is-winner' : ''}${c.id === me ? ' is-me' : ''}`} style={{ '--at': `${c.at}ms`, '--pc': p?.color }}>
                {c.winner ? <span className="hga-crown" aria-hidden="true"><Icon name="crown" size={22} /></span> : null}
                <PlayerToken player={p} size={c.winner ? 46 : 38} />
                <b className="hga-card-name">{nameOf(c.id)}</b>
                <span className="hga-card-amt">{formatINR(c.amount)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {plan.passers.length ? (
        <p className="hga-passed" style={{ '--at': '0ms' }}>
          <span>Passed</span>
          {plan.passers.map((id) => {
            const p = byId.get(id);
            return (
              <span key={id} className="hga-passer" style={{ '--pc': p?.color }}>
                <PlayerToken player={p} size={20} ring={false} />
                {nameOf(id)}{plan.timedOut.includes(id) ? ' (time ran out)' : ''}
              </span>
            );
          })}
        </p>
      ) : null}

      {cap ? (
        <div className={`hga-stamp is-${cap.kind}`} style={{ '--at': `${plan.stampAt}ms` }} role="status">
          <b className="hga-stamp-main">{cap.headline}</b>
          {cap.savedText ? <span className="hga-stamp-saved">{cap.savedText}</span> : null}
          {cap.tieNote ? <span className="hga-stamp-tie">{cap.tieNote}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
