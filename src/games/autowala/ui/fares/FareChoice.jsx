// OWNER: fares agent. The small question the fares system may ask while you drive: meter / fixed price / bargain at pickup, a
// customer's counter-offer, an optional bit of small talk. It never pauses the game; unanswered, it takes its default.
// Keyboard 1 / 2 / 3, gamepad D-pad (left / up / right) and these touch buttons (44 px+) all call ctx.fares.choose(n).
// Mount once next to the HUD:  <FareChoice game={game} snap={snap} />   (reads snap.fareChoice and snap.trip; renders nothing when there is none)
// Under the trip panel it also shows small chips for the ride: the agreed price, surcharges, an urgent reason, a shared passenger.
// While mounted it sets ctx.fares.uiMounted = true, which turns off the HUD prompt-chip fallback.
import { useEffect } from 'react';
import { rideChips } from './fareChips.js';
import './fares.css';

function Chips({ chips }) {
  return (
    <div className="aw-fare-chips" aria-label="Ride details">
      {chips.map((c) => (
        <span key={c.key} className={`aw-fare-chip is-${c.tone}`}>
          {c.en}
          {c.te && <i lang="te"> {c.te}</i>}
        </span>
      ))}
    </div>
  );
}

export default function FareChoice({ game, snap }) {
  useEffect(() => {
    const f = game?.ctx?.fares;
    if (!f) return undefined;
    f.uiMounted = true;
    return () => {
      f.uiMounted = false;
    };
  }, [game]);

  const ch = snap?.fareChoice;
  if (snap?.menu) return null;
  const chips = rideChips(snap?.trip);
  if (!ch) return chips.length ? <Chips chips={chips} /> : null;
  const frac = ch.total > 0 ? Math.max(0, Math.min(1, ch.timeLeft / ch.total)) : 0;
  const answer = (n) => game?.ctx?.fares?.choose?.(n);
  const cls = `aw-fare aw-fare--${ch.kind}${ch.quiet ? ' is-quiet' : ''}`;
  return (
    <>
    {chips.length > 0 && <Chips chips={chips} />}
    <div className={cls} role="group" aria-label={ch.title?.en || 'Choice'} key={ch.key}>
      <div className="aw-fare-head">
        <b className="aw-fare-title">{ch.title?.en}</b>
        {ch.title?.te && <span className="aw-fare-te" lang="te">{ch.title.te}</span>}
      </div>
      {ch.note && <div className="aw-fare-note">{ch.note}</div>}
      <div className="aw-fare-opts">
        {ch.options.map((o) => (
          <button type="button" key={o.id} className={`aw-fare-opt${o.tone ? ` is-${o.tone}` : ''}`} onClick={() => answer(o.n)}>
            <kbd className="aw-fare-key">{o.n}</kbd>
            <span className="aw-fare-lbl">
              <b>{o.label?.en ?? o.label}</b>
              {o.label?.te && <i lang="te">{o.label.te}</i>}
              {o.sub && <small>{o.sub}</small>}
            </span>
          </button>
        ))}
      </div>
      <div className="aw-fare-time" aria-hidden="true">
        <i style={{ transform: `scaleX(${frac.toFixed(3)})` }} />
      </div>
    </div>
    </>
  );
}
