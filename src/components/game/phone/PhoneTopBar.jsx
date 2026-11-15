// The calm top bar of the simple phone table: [back] [ONE objective line, event chip while a city event is on] [menu].
//   "₹50L net worth to win · Round 7 of 20"    (the target in green)
// The "..." button carries a small dot while something waits for you (an upgrade, a trade offer, a debt).
import { useEffect, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { useWorths } from '../ui/helpers.js';
import { targetOf } from '../turn/target.js';
import { attentionOf, eventChipOf, objectiveFor, targetProgress } from './phoneModel.js';

const EVENT_TIP_MS = 7000;

/** The micro-bar under the objective line: how far my net worth is towards the target (a faint tick = the best rival), gold when it is close. */
function GoalBar({ session }) {
  const { worths, state } = useWorths(session);
  const target = targetOf(session.display?.cfg || session.view?.cfg);
  const g = target ? targetProgress({ worths, me: session.me, target, players: state.players }) : null;
  if (!g) return null;
  return (
    <span className={`ph-goal${g.hot ? ' is-hot' : ''}`} role="img" aria-label={g.sr} data-pct={g.pct}>
      <i className="ph-goal__rival" style={{ transform: `scaleX(${g.rival.toFixed(3)})` }} />
      <i className="ph-goal__mine" style={{ transform: `scaleX(${g.mine.toFixed(3)})` }} />
    </span>
  );
}

export function Objective({ session }) {
  const o = objectiveFor(session);
  return (
    <p className={`ph-obj is-${o.kind}`} aria-label={o.sr}>
      <span aria-hidden="true">
        {o.target ? <><b className="ph-obj__target">{o.target}</b>{o.tail}</> : o.lead}
      </span>
    </p>
  );
}

export default function PhoneTopBar({ session, spec, onBack, onMenu }) {
  const ev = eventChipOf(session);
  const att = attentionOf(session, spec);
  const [tip, setTip] = useState(false);
  const evKey = ev ? `${ev.id}:${ev.title}` : '';

  useEffect(() => { setTip(false); }, [evKey]);
  useEffect(() => {
    if (!tip) return undefined;
    const t = setTimeout(() => setTip(false), EVENT_TIP_MS);
    const onKey = (e) => { if (e.key === 'Escape') setTip(false); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [tip]);

  return (
    <header className="ph-top" data-event={ev ? '' : undefined}>
      <button type="button" className="ph-round" onClick={onBack} aria-label="Leave game">
        <Icon name="back" size={22} strokeWidth={2.4} />
      </button>
      <div className="ph-top__mid">
        <Objective session={session} />
        <GoalBar session={session} />
        {ev ? (
          <button
            type="button"
            className="ph-event"
            onClick={() => setTip((v) => !v)}
            aria-expanded={tip}
            aria-label={`City event: ${ev.title}. ${tip ? 'Hide' : 'Read'} the details`}
          >
            <i aria-hidden="true" />
            <span>{ev.title}</span>
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="ph-round ph-menu"
        onClick={onMenu}
        aria-label={att.any ? `Menu, ${att.reasons.join(', ')}` : 'Menu'}
        aria-haspopup="dialog"
      >
        <Icon name="more" size={22} />
        {att.any ? <i className="ph-dot" aria-hidden="true" /> : null}
      </button>
      {ev && tip ? (
        <p className="ph-eventtip" role="status">
          <b>{ev.title}</b>
          {ev.text ? <span>{ev.text}</span> : null}
        </p>
      ) : null}
    </header>
  );
}
