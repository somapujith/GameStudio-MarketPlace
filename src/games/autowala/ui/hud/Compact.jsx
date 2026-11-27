// The phone / tablet HUD pieces (see hud/layoutLogic.js for which layouts use them): ONE compact top strip (wallet + rating, the trip,
// the clock, a "More" button, pause) and the "More" sheet that holds every secondary panel (rating, job chip, mission, weather, road
// rules, radio). Live road alerts (signal, camera, police, road rage, mission timer) get their own small lane.
// Positions come from hud/phone.css; nothing here knows a pixel. Every snapshot key is optional.
import { memo, useEffect, useMemo, useRef } from 'react';
import { RadioControls } from '../Radio.jsx';
import JobChip from './JobChip.jsx';
import RulesStrip from './RulesStrip.jsx';
import RageMeter from './RageMeter.jsx';
import { CloseIcon, DuskIcon, FlagIcon, KindIcon, MoonIcon, MoreIcon, PauseIcon, PinIcon, RainIcon, StarShape, SunIcon, ClockIcon } from './icons.jsx';
import { dayPhase, formatClock, formatCountdown, formatDistance, formatEta, groupIndian, moodColor, timerTone } from './hudLogic.js';
import { filterRules } from './layoutLogic.js';
import { shallowEqual, useView } from './snapStore.js';
import { EMPTY_MORE, alertsSelector, selCareer, selClock, selMore, selTrip, selWallet, selWaiting, selWeather } from './views.js';
import { useChangeFlash, useCountUp } from './useCountUp.js';
import { GearIcon, MapIcon, PhoneIcon, QuestIcon, RadioIcon } from '../touch/icons.jsx';

const PHASE_ICON = { night: MoonIcon, dawn: SunIcon, day: SunIcon, dusk: DuskIcon };

function WalletChip({ wallet, rating, rides, reduced }) {
  const target = Number.isFinite(wallet) ? wallet : 0;
  const shown = useCountUp(target, reduced);
  const flash = useChangeFlash(target);
  const r = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0;
  const n = Math.max(0, Math.round(rides || 0));
  return (
    <div key={flash.n} className={`aw-cwallet ${flash.dir ? `is-${flash.dir}` : ''}`} aria-label={`Wallet ${groupIndian(target)} rupees`}>
      <div className="aw-cwallet__row">
        <span>Rs</span>
        <b>{groupIndian(shown)}</b>
      </div>
      <div className="aw-cwallet__meta" title={r ? `Rating ${r.toFixed(1)} out of 5` : 'No rides rated yet'}>
        <StarShape id="strip" size={14} fill={r > 0 ? 1 : 0} />
        <em>{r > 0 ? r.toFixed(1) : '-'}</em>
        <span>{n} {n === 1 ? 'ride' : 'rides'}</span>
      </div>
    </div>
  );
}

function ClockChip({ hour, day, weather }) {
  const c = formatClock(hour);
  const phase = dayPhase(hour);
  const Icon = PHASE_ICON[phase] || SunIcon;
  return (
    <div className={`aw-cclock aw-cclock--${phase}`} aria-label={`${c.label}, day ${Math.max(1, Math.floor(day || 1))}`}>
      <Icon size={24} className="aw-cclock__icon" />
      <div className="aw-cclock__text">
        <span className="aw-cclock__time">
          <b>{c.time}</b>
          <small>{c.ampm}</small>
        </span>
        <span className="aw-cclock__day">Day {Math.max(1, Math.floor(day || 1))}</span>
      </div>
      {weather && <RainIcon size={20} className={`aw-cclock__wx is-${weather.state}`} />}
    </div>
  );
}

function TripChip({ t, reduced }) {
  const fare = useCountUp(t.fare, reduced);
  const flash = useChangeFlash(t.fare);
  const tone = timerTone(t.timeLeft);
  const nav = [t.distance != null ? formatDistance(t.distance) : '', t.eta != null ? formatEta(t.eta) : ''].filter(Boolean).join(' Ã‚Â· ');
  return (
    <div className={`aw-ctrip ${t.arrived ? 'is-arrived' : ''}`} role="status">
      <span className="aw-ctrip__badge" title={t.kind.label}>
        <KindIcon kind={t.kind.key} size={22} />
      </span>
      <div className="aw-ctrip__main">
        <div className="aw-ctrip__l1">
          <b className="aw-ctrip__name">{t.name}</b>
          {t.pax > 1 && <em className="aw-ctrip__pax">+1</em>}
          <span key={flash.n} className={`aw-ctrip__fare ${flash.dir ? 'is-tick' : ''}`} aria-label={`Fare ${t.fare} rupees`}>
            <small>Rs</small>
            <b>{groupIndian(fare)}</b>
          </span>
        </div>
        <div className="aw-ctrip__l2">
          <PinIcon size={16} className="aw-ctrip__pin" />
          <span className="aw-ctrip__dest">
            {t.arrived ? 'Arrived at ' : 'To '}
            <b>{t.destName}</b>
          </span>
          {nav && <span className="aw-ctrip__nav">{nav}</span>}
          {t.timeLeft != null && (
            <span className={`aw-ctrip__timer is-${tone}`}>
              <ClockIcon size={14} />
              <b>{formatCountdown(t.timeLeft)}</b>
            </span>
          )}
        </div>
      </div>
      {t.mood != null && (
        <span className="aw-ctrip__mood" title="Passenger mood" aria-hidden="true">
          <i style={{ transform: `scaleX(${t.mood.toFixed(3)})`, background: moodColor(t.mood) }} />
        </span>
      )}
    </div>
  );
}

function FindChip({ waiting }) {
  const n = Number.isFinite(waiting) ? Math.max(0, Math.round(waiting)) : null;
  return (
    <div className="aw-cfind" role="status">
      <i className="aw-find__dot" />
      <span>{n === 0 ? 'No one is waiting. Cruise the streets' : 'Find a customer: follow the pink markers'}</span>
      {n > 0 && <b>{n} waiting</b>}
    </div>
  );
}

// Each chip of the strip reads its own view of the snapshot (hud/views.js), so a ticking fare does not re-render the wallet or the clock.
function WalletSlot({ reduced }) {
  const w = useView(selWallet, shallowEqual);
  return w ? <WalletChip wallet={w.wallet} rating={w.rating} rides={w.rides} reduced={reduced} /> : null;
}
function ClockSlot() {
  const c = useView(selClock, shallowEqual);
  const weather = useView(selWeather);
  return c ? <ClockChip hour={c.hour} day={c.day} weather={weather} /> : null;
}
function TripSlot({ reduced }) {
  const t = useView(selTrip);
  const waiting = useView(selWaiting, Object.is);
  return t ? <TripChip t={t} reduced={reduced} /> : <FindChip waiting={waiting} />;
}

export const Strip = memo(function Strip({ reduced, onPause, onMore, moreOpen, badge }) {
  return (
    <header className="aw-strip" aria-label="Status">
      <WalletSlot reduced={reduced} />
      <div className="aw-strip__trip"><TripSlot reduced={reduced} /></div>
      <ClockSlot />
      <button
        type="button"
        className={`aw-more-btn${moreOpen ? ' is-open' : ''}`}
        onClick={onMore}
        aria-expanded={moreOpen}
        aria-controls="aw-more-sheet"
        aria-label={moreOpen ? 'Close more' : 'More: job, mission, weather, rules, radio'}
      >
        <MoreIcon size={22} />
        <span>More</span>
        {badge && <i className={`aw-more-btn__dot is-${badge}`} aria-hidden="true" />}
      </button>
      <button type="button" className="aw-pausebtn aw-pausebtn--c" onClick={onPause} aria-label="Pause" title="Pause (Esc)">
        <PauseIcon size={22} />
      </button>
    </header>
  );
});

/** The live road alerts (`rage` is the raw snap.rage; RageMeter shapes it itself): the signal / camera / police chips, the road-rage meter and the running mission's timer, in one lane. */
export function AlertsLane({ rules, kinds, rage, mission, missionTime }) {
  const rulesPart = filterRules(rules, kinds);
  const showRage = kinds.includes('rage') && rage;
  const showMission = kinds.includes('mission') && mission;
  if (!rulesPart && !showRage && !showMission) return null;
  return (
    <div className="aw-alerts" aria-label="Road alerts">
      {showRage && <RageMeter rage={rage} />}
      {rulesPart && <RulesStrip view={rulesPart} />}
      {showMission && (
        <div className="aw-alert-chip aw-alert-chip--mission" role="status">
          <FlagIcon size={16} />
          <b>{mission}</b>
          {missionTime && <em>{missionTime}</em>}
        </div>
      )}
    </div>
  );
}

/** The alert lane fed from the store: the chips the layout allows (`cap`), with the distances and the mission clock rounded to what they print. */
export function AlertsLaneSlot({ cap }) {
  const select = useMemo(() => alertsSelector(cap), [cap]);
  const v = useView(select);
  if (!v) return null;
  return <AlertsLane rules={v.rules} kinds={v.kinds} rage={v.rage} mission={v.mission ? v.mission.title : ''} missionTime={v.mission && v.mission.left != null ? formatCountdown(v.mission.left) : ''} />;
}
function QuestSummary({ a }) {
  if (!a) return null;
  const idx = Math.min(a.stepIndex || 0, Math.max(0, (a.steps?.length || 1) - 1));
  const cur = a.steps?.[idx];
  const reward = a.reward && Number.isFinite(a.reward.cash) ? a.reward.cash : null;
  return (
    <div className="aw-sheet__quest">
      <b className="aw-sheet__quest-title">
        {a.title} {a.te && <span className="aw-te">{a.te}</span>}
      </b>
      {cur?.label && (
        <p>
          <span className="aw-sheet__step">{idx + 1}/{a.steps.length}</span>
          {cur.label}
        </p>
      )}
      {(a.note || a.progress) && <p className={a.note ? 'is-warn' : ''}>{a.note || a.progress}</p>}
      <div className="aw-sheet__quest-foot">
        {a.timeLeft != null && <span className={`aw-ctrip__timer is-${timerTone(a.timeLeft)}`}><ClockIcon size={14} /><b>{formatCountdown(a.timeLeft)}</b></span>}
        {reward != null && <span className="aw-sheet__reward">Reward <b>Rs {groupIndian(reward)}</b></span>}
      </div>
    </div>
  );
}

// The shortcuts the touch layer used to keep in its own "..." tray (one "More" button on the screen, not two). `onShortcut(input)` taps the
// game input ('map' | 'phone' | 'quests'); 'controls' opens the touch-control settings (TouchControls listens for aw-touch-settings).
export const SHORTCUTS = [
  { id: 'map', label: 'Map', Icon: MapIcon },
  { id: 'quests', label: 'Quests', Icon: QuestIcon },
  { id: 'phone', label: 'Phone', Icon: PhoneIcon },
  { id: 'radio', label: 'Radio', Icon: RadioIcon, needs: 'radio' }, // only when the game has a radio
  { id: 'controls', label: 'Controls', Icon: GearIcon },
];

export function MoreSheet({ open, onClose, game, snap, careerV, rulesV, weather, onShortcut }) {
  const r = Number.isFinite(snap.rating) ? Math.max(0, Math.min(5, snap.rating)) : 0;
  const rides = Math.max(0, Math.round(snap.rides || 0));
  const quest = snap.quest?.active || null;
  const hasRules = !!(rulesV && (rulesV.sign || rulesV.signal || rulesV.camera || rulesV.checkpoint || rulesV.wanted));
  const hasRadio = !!(game?.ctx?.sound?.radio && snap.radio);
  const sheetRef = useRef(null);
  // opening the sheet moves the keyboard focus into it (the first shortcut, else the close button)
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current;
    (el?.querySelector('.aw-sheet__key') || el?.querySelector('.aw-sheet__close'))?.focus({ preventScroll: true });
  }, [open]);
  return (
    <>
      {open && <button type="button" className="aw-sheet-scrim" aria-label="Close more" onClick={onClose} tabIndex={-1} />}
      <aside className="aw-sheet" id="aw-more-sheet" ref={sheetRef} role="dialog" aria-label="More" hidden={!open}>
        <header className="aw-sheet__head">
          <b>More</b>
          <button type="button" className="aw-sheet__close" onClick={onClose} aria-label="Close more">
            <CloseIcon size={22} />
          </button>
        </header>
        {onShortcut && (
          <div className="aw-sheet__keys" role="group" aria-label="Shortcuts">
            {SHORTCUTS.filter((k) => !k.needs || hasRadio).map(({ id, label, Icon }) => (
              <button key={id} type="button" className="aw-sheet__key" onClick={() => onShortcut(id)}>
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="aw-sheet__grid">
          <section className="aw-sheet__sec" data-k="rating" aria-label="Rating">
            <h3>Rating</h3>
            <div className="aw-sheet__rating">
              <span className="aw-stars">
                {[0, 1, 2, 3, 4].map((i) => (
                  <StarShape key={i} id={`sheet-${i}`} size={22} fill={r > 0 ? Math.max(0, Math.min(1, r - i)) : 0} />
                ))}
              </span>
              <b>{r > 0 ? r.toFixed(1) : '-'}</b>
              <span>{rides} {rides === 1 ? 'ride' : 'rides'}</span>
            </div>
          </section>
          {careerV && (
            <section className="aw-sheet__sec" data-k="job" aria-label="Your job">
              <h3>Your job</h3>
              <JobChip game={game} view={careerV} hidden={false} />
            </section>
          )}
          {quest && (
            <section className="aw-sheet__sec" data-k="quest" aria-label="Mission">
              <h3>Mission</h3>
              <QuestSummary a={quest} />
            </section>
          )}
          {weather && (
            <section className="aw-sheet__sec" data-k="weather" aria-label="Weather">
              <h3>Weather</h3>
              <div className={`aw-sheet__wx is-${weather.state}`}>
                <RainIcon size={26} />
                <b>{weather.en}</b>
                <span className="aw-te">{weather.te}</span>
                <span className="aw-sheet__wet" role="meter" aria-label="How wet you are" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weather.wetPct}>
                  <i style={{ transform: `scaleX(${Math.max(0.04, weather.wet).toFixed(3)})` }} />
                </span>
                <small>Soaked {weather.wetPct}%</small>
              </div>
            </section>
          )}
          {hasRules && (
            <section className="aw-sheet__sec" data-k="rules" aria-label="Road rules">
              <h3>Road rules</h3>
              {rulesV.sign && (
                <p className="aw-sheet__limit">
                  Limit <b className={rulesV.sign.speeding ? 'is-over' : ''}>{rulesV.sign.limit}</b> km/h
                  <span> {rulesV.sign.zoneEn}</span>
                </p>
              )}
              <RulesStrip view={rulesV} />
            </section>
          )}
          {hasRadio && (
            <section className="aw-sheet__sec" data-k="radio" aria-label="Radio">
              <h3>Radio</h3>
              <RadioControls game={game} snap={snap} inline />
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

const selMoreClosed = (s) => ({ ...EMPTY_MORE, career: selCareer(s) }); // closed: only the job chip stays mounted (its gamepad poll keeps running)

/** The More sheet fed from the store: while it is closed it holds nothing but the job chip, so ticking numbers cost it nothing. */
export function MoreSheetSlot({ open, onClose, game, onShortcut }) {
  const v = useView(open ? selMore : selMoreClosed);
  if (!v) return null;
  const snap = { rating: v.rating, rides: v.rides, quest: { active: v.quest }, radio: v.radio };
  return <MoreSheet open={open} onClose={onClose} game={game} snap={snap} careerV={v.career} rulesV={v.rules} weather={v.weather} onShortcut={onShortcut} />;
}