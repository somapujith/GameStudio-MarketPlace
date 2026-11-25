// OWNER: quests agent. The mission result card (complete / failed), shown for ~9 s at the top centre. Reads snap.quest.last.
import { groupIndian } from '../hud/hudLogic.js';
import { whyFailed } from './questUi.js';

export default function ResultCard({ q }) {
  const l = q.last;
  if (!l) return null;
  return (
    <div className={`aw-quest-result ${l.ok ? 'is-ok' : 'is-bad'}`} role="status" aria-live="polite">
      <small>{l.tutorial ? "MAMA'S FIRST DAY" : 'MISSION'}</small>
      <h3>
        {l.ok ? 'COMPLETE' : 'FAILED'} <span className="aw-te">{l.ok ? 'పూర్తయింది' : 'విఫలం'}</span>
      </h3>
      <p className="aw-quest-result__title">{l.title}</p>
      {l.ok ? (
        <>
          <ul className="aw-quest-parts">
            {l.payout.parts.map((p) => (
              <li key={p.label}>
                <span>{p.label}</span>
                <b>+{groupIndian(p.amount)}</b>
              </li>
            ))}
          </ul>
          <p className="aw-quest-result__total">
            <b>Rs {groupIndian(l.payout.cash)}</b>
            {l.payout.rep > 0 && <em>+{l.payout.rep} rep</em>}
          </p>
        </>
      ) : (
        <p className="aw-quest-result__why">{whyFailed(l.reason)}</p>
      )}
    </div>
  );
}
