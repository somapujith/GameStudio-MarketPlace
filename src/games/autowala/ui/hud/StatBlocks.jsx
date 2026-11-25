// Top-left (wallet, rating, rides) and top-right (clock, day, pause) blocks of the HUD.
import { DuskIcon, MoonIcon, PauseIcon, RainIcon, StarShape, SunIcon } from './icons.jsx';
import { dayPhase, formatClock, groupIndian } from './hudLogic.js';
import { useChangeFlash, useCountUp } from './useCountUp.js';

export function WalletBlock({ wallet, rating, rides, reduced, children }) {
  const target = Number.isFinite(wallet) ? wallet : 0;
  const shown = useCountUp(target, reduced);
  const flash = useChangeFlash(target);
  const r = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0;
  return (
    <div className="aw-hud-tl">
      <div key={flash.n} className={`aw-wallet ${flash.dir ? `is-${flash.dir}` : ''}`} aria-label={`Wallet ${groupIndian(target)} rupees`}>
        <span className="aw-wallet__rs">Rs</span>
        <b className="aw-wallet__num">{groupIndian(shown)}</b>
      </div>
      <div className="aw-meta">
        <span className="aw-stars" title={r ? `Rating ${r.toFixed(1)} out of 5` : 'No rides rated yet'}>
          {[0, 1, 2, 3, 4].map((i) => (
            <StarShape key={i} id={`hud-${i}`} size={14} fill={r > 0 ? Math.max(0, Math.min(1, r - i)) : 0} />
          ))}
          <em>{r > 0 ? r.toFixed(1) : '-'}</em>
        </span>
        <span className="aw-rides">
          <b>{Math.max(0, Math.round(rides || 0))}</b> {Math.round(rides || 0) === 1 ? 'ride' : 'rides'}
        </span>
      </div>
      {children}
    </div>
  );
}

const PHASE_ICON = { night: MoonIcon, dawn: SunIcon, day: SunIcon, dusk: DuskIcon };

export function ClockBlock({ hour, day, onPause, weather }) {
  const c = formatClock(hour);
  const phase = dayPhase(hour);
  const Icon = PHASE_ICON[phase] || SunIcon;
  return (
    <div className="aw-hud-tr">
      <div className={`aw-hudclock aw-hudclock--${phase}`}>
        <Icon size={22} className="aw-hudclock__icon" />
        <div className="aw-hudclock__text">
          <span className="aw-hudclock__time">
            <b>{c.time}</b>
            <small>{c.ampm}</small>
          </span>
          <span className="aw-hudclock__day">Day {Math.max(1, Math.floor(day || 1))}</span>
        </div>
        {weather && (
          <div className={`aw-wx is-${weather.state}`} role="status" title={`${weather.en} ${weather.te}. Soaked ${weather.wetPct}%`}>
            <RainIcon size={18} className="aw-wx__icon" />
            <span className="aw-wx__txt">
              <b>{weather.en}</b>
              {weather.showName && <span className="aw-te">{weather.te}</span>}
              <span className="aw-wx__wet" role="meter" aria-label="How wet you are" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weather.wetPct}>
                <i style={{ transform: `scaleX(${Math.max(0.04, weather.wet).toFixed(3)})` }} />
              </span>
            </span>
          </div>
        )}
      </div>
      <button type="button" className="aw-pausebtn" onClick={onPause} aria-label="Pause" title="Pause (Esc)">
        <PauseIcon size={18} />
      </button>
    </div>
  );
}
