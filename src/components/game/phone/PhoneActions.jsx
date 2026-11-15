// The action row of the simple phone table, in the thumb zone under the players.
//   [ Your move · 30s  ▬▬▬▬ ]          the decision timer (TurnTimer's TimerBar), only while a clock runs
//   [ Use chai ] [ Ride ₹35,000 ]      secondary actions as small pills, only when the spec has any
//   [ Manage ] [   ROLL / BUY ₹3,20,000 / END TURN …   ] [ Trade ]
// The one big primary comes from the shared action spec (ActionBar.useActionSpec), so every rule behind Roll, Buy, End turn,
// Pay the fine, Use chai, Ride, Wait it out stays exactly as it was. While somebody else plays it is a calm, disabled
// "Waiting for Sana…". Manage (upgrades, mortgages) and Trade stay one tap away on either side of it.
import { Avatar } from '@/components/art/index.js';
import { sfx } from '@/lib/sfx.js';
import Icon from '../ui/Icon.jsx';
import { TimerBar } from '../turn/TurnTimer.jsx';
import { pillFor, primaryFor, soundOf } from './phoneModel.js';

const play = (action) => {
  try { sfx.play(soundOf(action)); } catch { /* sound is optional */ }
};

function Tool({ icon, label, badge, onClick, hint }) {
  return (
    <button
      type="button"
      className="pa-tool"
      onClick={onClick}
      aria-label={badge ? `${label}, ${badge.label}` : label}
      title={hint || label}
    >
      <Icon name={icon} size={22} />
      <span aria-hidden="true">{label}</span>
      {badge ? <i className="pa-tool__badge" aria-hidden="true">{badge.text}</i> : null}
    </button>
  );
}

export default function PhoneActions({ session, spec, fire, badges = {}, onManage, onTrade, hidePills = [] }) {
  const prim = primaryFor(spec);
  const pills = (spec.secondaries || []).filter((s) => !hidePills.includes(s.key)).map((s) => pillFor(s, session));
  const out = spec.kind === 'out';
  const waiting = prim.disabled;
  const tradeHint = session.options?.trade?.canOffer === false && !session.view?.trade ? 'You can propose a trade on your own turn' : undefined;

  return (
    <section className="pa" aria-label="Your actions" data-kind={spec.kind} data-pills={pills.length || undefined}>
      <p className="cp-sr" role="status" aria-live="polite">{spec.sr}</p>
      <TimerBar session={session} className="pa-timer" />

      {pills.length ? (
        <div className="pa-pills" role="group" aria-label="More actions">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`pa-pill is-${p.key}`}
              aria-label={p.aria}
              onClick={() => { play(p.action); fire(p.action)(); }}
            >
              {p.icon ? <Icon name={p.icon} size={16} /> : null}
              <span>{p.text}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="pa-main">
        {out ? <span className="pa-tool pa-tool--gap" aria-hidden="true" /> : <Tool icon="home" label="Manage" badge={badges.manage} onClick={onManage} />}

        {waiting ? (
          <div className={`pa-primary is-wait is-${prim.key}`} role="status" aria-label={prim.aria} data-kind={prim.kind}>
            {prim.kind === 'busy' ? (
              <span className="pa-dots" aria-hidden="true"><i /><i /><i /></span>
            ) : (
              <>
                {prim.waitFor ? <span className="pa-primary__ava" style={{ '--pc': prim.waitFor.color }}><Avatar preset={prim.waitFor.avatar} size={26} /></span> : null}
                <span className="pa-primary__txt">{prim.text}</span>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            key={prim.key}
            className={`pa-primary is-${prim.key} tone-${prim.tone}`}
            aria-label={prim.aria}
            onClick={() => { play(spec.primary.action); fire(spec.primary.action)(); }}
          >
            <span className="pa-primary__txt">{prim.text}</span>
            {prim.sub ? <small className="pa-primary__sub">{prim.sub}</small> : null}
          </button>
        )}

        {out ? <span className="pa-tool pa-tool--gap" aria-hidden="true" /> : <Tool icon="swap" label="Trade" badge={badges.trade} onClick={onTrade} hint={tradeHint} />}
      </div>
    </section>
  );
}
