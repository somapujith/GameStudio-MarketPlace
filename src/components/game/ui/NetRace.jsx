// The net-worth race: every player still in as a pawn-coloured dot on a slim track that ends at the win target (the flag).
// Lives in the desktop / tablet top bar. Dots glide with a springy settle when net worth changes (transform only);
// the leader's dot is the biggest and wears a tiny crown. Decorative for the eyes, one sentence for screen readers.
// Also here: <LeaderChip> (crown + leader name + net worth) and <ConnChip> (your own connection, as the signal bars).
import { compactINR } from '@shared/format.js';
import { useNetStats } from '@/lib/netStats.js';
import Icon from './Icon.jsx';
import SignalBars from './SignalBars.jsx';
import { useWorths } from './helpers.js';
import { raceModel } from './hudModel.js';
import { signalOf, signalWords } from './signalModel.js';
import { roomPlayer } from '../turn/room.js';
import { targetOf } from '../turn/target.js';
import '@/styles/hud.css';

export default function NetRace({ session }) {
  const { worths, leaderId, state } = useWorths(session);
  const race = raceModel({ players: state.players, worths, target: targetOf(session.display?.cfg || session.view?.cfg), me: session.me, leaderId });
  if (!race || race.runners.length < 2) return null;
  const top = race.runners[race.runners.length - 1];
  const lead = Math.max(0, Math.min(1, top.frac));
  return (
    <div className={`nr${race.hasTarget ? '' : ' is-open'}${race.hasTarget && lead >= 0.8 ? ' is-hot' : ''}`} role="img" aria-label={race.sr}>
      <span className="nr__track" aria-hidden="true">
        <i className="nr__line" />
        <i className="nr__lead" style={{ '--f': lead.toFixed(3), '--pc': top.color }} />
        {race.runners.map((r) => (
          <span
            key={r.id}
            className={`nr__dot${r.isMe ? ' is-me' : ''}${r.lead ? ' is-lead' : ''}`}
            data-lane={r.lane || undefined}
            style={{ '--f': r.frac.toFixed(3), '--pc': r.color, '--dx': `${r.dx || 0}px` }}
            title={`${r.isMe ? 'You' : r.name}: ${compactINR(r.worth)}`}
          >
            {r.lead ? <Icon name="crown" size={9} className="nr__crown" /> : null}
          </span>
        ))}
      </span>
      {race.hasTarget ? (
        <span className="nr__goal" aria-hidden="true" title={race.flag}>
          <Icon name="flag" size={12} />
          <b>{race.label}</b>
        </span>
      ) : null}
    </div>
  );
}

/** Crown + the leader's name and net worth. Nothing when nobody is strictly ahead. */
export function LeaderChip({ session }) {
  const { worths, leaderId, state } = useWorths(session);
  const lead = leaderId ? state.players.find((p) => p.id === leaderId) : null;
  if (!lead) return null;
  const mine = lead.id === session.me;
  return (
    <span key={lead.id} className="tb-leader" style={{ '--pc': lead.color }} title={`${mine ? 'You are' : `${lead.name} is`} leading with ${compactINR(worths[lead.id])} net worth`}>
      <Icon name="crown" size={13} className="tb-leader__crown" />
      <span className="hg-sr">{mine ? 'You are' : `${lead.name} is`} leading, net worth </span>
      <span className="tb-leader__txt">
        <b>{mine ? 'You' : lead.name}</b>
        <small>{compactINR(worths[lead.id])}</small>
      </span>
    </span>
  );
}

/** Your own connection as the signal bars, in a quiet chip (the same measurement as your pod). */
export function ConnChip({ session }) {
  const local = useNetStats();
  const me = (session.display?.players ?? session.view?.players ?? []).find((p) => p.id === session.me);
  if (!me) return null;
  const sig = signalOf(roomPlayer(session, me.id), { isMe: true, local });
  if (sig.kind === 'none') return null;
  return (
    <span className={`tb-conn is-${sig.kind}`} title={signalWords(sig)}>
      <SignalBars {...sig} size="sm" pill={sig.kind === 'offline' || sig.kind === 'reconnecting'} />
    </span>
  );
}
