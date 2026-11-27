// Top-centre: the live trip panel (customer, destination, ticking fare meter, distance / ETA, mood, countdown, next turn),
// or the soft "find a customer" hint when there is no trip. Every field except the snapshot's `trip` is optional.
import { memo } from 'react';
import { ArrowIcon, ClockIcon, FlagIcon, KindIcon, PinIcon, UTurnIcon } from './icons.jsx';
import { formatCountdown, formatDistance, formatEta, groupIndian, moodColor, timerTone } from './hudLogic.js';
import { useChangeFlash, useCountUp } from './useCountUp.js';

function TurnArrow({ dir }) {
  if (dir === 'uturn') return <UTurnIcon size={22} />;
  if (dir === 'arrive') return <FlagIcon size={22} />;
  const rot = dir === 'left' ? -90 : dir === 'right' ? 90 : 0;
  return <ArrowIcon size={22} style={{ transform: `rotate(${rot}deg)` }} className="aw-turn__arrow" />;
}

// (class aw-fmeter, not aw-fare: fares/fares.css owns .aw-fare, the position:absolute choice card)
function FareMeter({ fare, reduced }) {
  const shown = useCountUp(fare, reduced);
  const flash = useChangeFlash(fare);
  return (
    <div className="aw-fmeter" aria-label={`Fare ${fare} rupees`}>
      <small>FARE</small>
      <div key={flash.n} className={`aw-fmeter__val ${flash.dir ? 'is-tick' : ''}`}>
        <span>Rs</span>
        <b>{groupIndian(shown)}</b>
      </div>
    </div>
  );
}

function Trip({ t, reduced }) {
  const tone = timerTone(t.timeLeft);
  return (
    <div className={`aw-trip ${t.arrived ? 'is-arrived' : ''}`} role="status">
      <div className="aw-trip__head">
        <span className="aw-trip__badge" title={t.kind.label}>
          <KindIcon kind={t.kind.key} size={22} />
        </span>
        <div className="aw-trip__who">
          <b className="aw-trip__name">{t.name}</b>
          <span className="aw-trip__sub">
            {t.te && <span className="aw-te">{t.te}</span>}
            <em>{t.kind.label}{t.pax > 1 ? ' · 2 riding' : ''}</em>
          </span>
        </div>
        <FareMeter fare={t.fare} reduced={reduced} />
      </div>

      <div className="aw-trip__dest">
        <PinIcon size={16} className="aw-trip__pin" />
        <span className="aw-trip__destname">
          {t.arrived ? 'Arrived at ' : 'To '}
          <b>{t.destName}</b>
          {t.destTe && <span className="aw-te"> {t.destTe}</span>}
        </span>
      </div>

      {(t.distance != null || t.eta != null) && (
        <div className="aw-trip__nav">
          {t.distance != null && <span className="aw-chip"><b>{formatDistance(t.distance)}</b> to go</span>}
          {t.eta != null && <span className="aw-chip"><b>{formatEta(t.eta)}</b></span>}
        </div>
      )}

      {(t.mood != null || t.timeLeft != null) && (
        <div className="aw-trip__state">
          {t.mood != null && (
            <div className="aw-mood" title="Passenger mood">
              <span>MOOD</span>
              <div className="aw-mood__bar">
                <i style={{ transform: `scaleX(${t.mood.toFixed(3)})`, background: moodColor(t.mood) }} />
              </div>
            </div>
          )}
          {t.timeLeft != null && (
            <div className={`aw-timer is-${tone}`}>
              <ClockIcon size={14} />
              <b>{formatCountdown(t.timeLeft)}</b>
            </div>
          )}
        </div>
      )}

      {t.turn && (
        <div className={`aw-turn aw-turn--${t.turn.dir}`}>
          <TurnArrow dir={t.turn.dir} />
          <span>
            {t.turn.text}
            {t.turn.distance != null && t.turn.dir !== 'arrive' && <b> in {formatDistance(t.turn.distance)}</b>}
          </span>
        </div>
      )}
    </div>
  );
}

function FindHint({ waiting }) {
  const n = Number.isFinite(waiting) ? Math.max(0, Math.round(waiting)) : null;
  return (
    <div className="aw-find" role="status">
      <i className="aw-find__dot" />
      <span>{n === 0 ? 'No one is waiting right now. Cruise the streets' : 'Find a customer: follow the pink markers'}</span>
      {n > 0 && <b className="aw-find__count">{n} waiting</b>}
    </div>
  );
}

/** `t` is the trip view (hud/views.js tripViewOf: normalizeTrip with the ticking numbers rounded to what they print), or null for the find-a-customer hint. */
function TripPanel({ t, waitingCount, reduced, children }) {
  return (
    <div className="aw-hud-tc">
      {t ? <Trip t={t} reduced={reduced} /> : <FindHint waiting={waitingCount} />}
      {children}
    </div>
  );
}

export default memo(TripPanel);
