// Top "flex banner": shift name and level, clock + day part, shift and star bars, money (count-up, +rupee pops), hearts, combo, pause, mute.
import { LEVELS, LIVES } from '@shared/tiffin-centre/catalog.js';
import { formatINR } from '@shared/format.js';
import HudIcon from './HudIcon.jsx';
import { useCountUp } from './hooks.js';
import { booksView, daypartView, formatClock, formatLeft, heartsLabel, hourFromState, shiftFrac, starBar, starTargets } from './hudLogic.js';

export function Hearts({ lives, lostN = 0, lostIdx = -1, reduced }) {
  const n = Math.max(0, Math.min(LIVES, Math.round(Number(lives) || 0)));
  return (
    <div className="tc-hud-hearts" role="img" aria-label={heartsLabel(n)}>
      {Array.from({ length: LIVES }, (_, i) => {
        const full = i < n;
        const hit = !reduced && lostIdx === i && lostN > 0;
        return (
          <span key={hit ? `${i}-${lostN}` : i} className={`tc-hud-heart${full ? ' is-full' : ' is-empty'}${hit ? ' is-lost' : ''}`}>
            <HudIcon name={full ? 'heart' : 'heartCrack'} size={22} />
          </span>
        );
      })}
    </div>
  );
}

/** The star bar: stars are PROFIT (cash minus costs), so `profit` is what is compared with the targets. */
export function StarBar({ profit, targets }) {
  const bar = starBar(profit, targets);
  if (!bar) return null;
  return (
    <div className="tc-hud-stars" role="progressbar" aria-label={`Profit toward ${bar.targets[2]} rupees`} aria-valuemin={0} aria-valuemax={bar.targets[2]} aria-valuenow={Math.max(0, Math.min(profit, bar.targets[2]))} aria-valuetext={`${bar.earned} of 3 stars`}>
      <span className="tc-hud-stars-fill" style={{ width: `${bar.fill * 100}%` }} />
      {bar.ticks.map((t, i) => (
        <span key={i} className={`tc-hud-star-tick${i < bar.earned ? ' is-got' : ''}`} style={{ left: `${t * 100}%` }}>
          <HudIcon name="star" size={14} />
          <span className="tc-hud-sr">{`${i + 1} star at ${bar.targets[i]} rupees profit`}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Props: { state, reduced, pops, lostN, lostIdx, canPause, onPause, onMute, muted, onLeave }. `onLeave` (co-op tables only: a room has no pause) fills the
 * pause button's slot with a Leave button, so the glue needs no floating Leave button over the dock.
 */
export default function TopBar({ state, reduced, pops = [], lostN = 0, lostIdx = -1, canPause, onPause, onMute, muted, onLeave, fullscreen = null, touch = false }) {
  const level = LEVELS[state.level];
  const hour = hourFromState(state);
  const clock = formatClock(hour);
  const part = daypartView(hour);
  const money = useCountUp(state.money || 0, reduced);
  const targets = starTargets(state);
  const books = booksView(state);
  const total = Math.max(1, state.shiftTicks || 1);
  const lead = reduced ? shiftFrac(state, 0) : shiftFrac(state, 1);
  const tutorial = !!state.cfg?.tutorial;
  return (
    <header className="tc-hud-top">
      <div className="tc-hud-banner">
        <span className="tc-hud-grommet is-l" aria-hidden="true" />
        <span className="tc-hud-grommet is-r" aria-hidden="true" />
        <div className="tc-hud-shift">
          <b className="tc-hud-paint">{level?.name || 'Shift'}</b>
          <span className="tc-hud-te">{level?.te}</span>
          {!tutorial && <span className="tc-hud-lvl">{`Shift ${state.level}`}</span>}
        </div>
        <div className="tc-hud-clock" title={`${part.label} ${part.te}`}>
          <HudIcon name={part.icon} size={20} />
          <b>{clock.time}</b>
          <small>{clock.ampm}</small>
          <span className="tc-hud-daypart">{part.label}</span>
        </div>
        <div
          className="tc-hud-shiftbar"
          role="progressbar"
          aria-label="Shift time"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(total, state.tick || 0)}
          aria-valuetext={`${formatLeft(state)} left`}
        >
          <span className="tc-hud-shiftbar-fill" style={{ width: `${lead * 100}%`, transitionDuration: reduced ? '0s' : '1s' }} />
          <span className="tc-hud-shiftbar-left">{formatLeft(state)}</span>
        </div>
      </div>

      <div className="tc-hud-tin">
        <div className="tc-hud-money" aria-label={`Takings ${formatINR(state.money || 0)}`}>
          <span className="tc-hud-rupee" aria-hidden="true">
            <HudIcon name="rupee" size={18} />
          </span>
          <b>{formatINR(money)}</b>
          {pops.map((p) => (
            <span key={p.id} className="tc-hud-pop" aria-hidden="true">{`+${formatINR(p.amount)}`}</span>
          ))}
        </div>
        {books.show && (
          <div className="tc-hud-books" role="group" aria-label={`Cost ${formatINR(books.cost)}, profit ${formatINR(books.profit)}`}>
            <span className="tc-hud-book is-cost">
              <small>Cost</small>
              <b>{formatINR(books.cost)}</b>
            </span>
            <span className={`tc-hud-book is-profit${books.profit < 0 ? ' is-neg' : ''}`}>
              <small>Profit</small>
              <b>{formatINR(books.profit)}</b>
            </span>
          </div>
        )}
        <StarBar profit={books.profit} targets={targets} />
      </div>

      <div className="tc-hud-vitals">
        {!tutorial && <Hearts lives={state.lives} lostN={lostN} lostIdx={lostIdx} reduced={reduced} />}
        {state.combo >= 2 && (
          <span className="tc-hud-combo" aria-label={`Combo times ${state.combo}`}>
            <HudIcon name="flame" size={18} />
            <b>{`x${state.combo}`}</b>
          </span>
        )}
      </div>

      <div className="tc-hud-btns">
        {onMute && (
          <button type="button" className="tc-hud-btn" onClick={() => onMute(!muted)} aria-pressed={!!muted} aria-label={muted ? 'Unmute' : 'Mute'}>
            <HudIcon name={muted ? 'volumeOff' : 'volume'} size={20} />
          </button>
        )}
        {fullscreen?.supported && (
          <button
            type="button"
            className="tc-hud-btn tc-hud-btn--fs"
            aria-pressed={!!fullscreen.active}
            aria-label={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
            title={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={fullscreen.toggle}
          >
            <HudIcon name={fullscreen.active ? 'shrink' : 'expand'} size={20} />
          </button>
        )}
        {canPause && !onLeave && (
          <button type="button" className="tc-hud-btn" onClick={onPause} aria-label={touch ? 'Pause' : 'Pause (Esc)'}>
            <HudIcon name="pause" size={20} />
          </button>
        )}
        {onLeave && (
          <button type="button" className="tc-hud-btn tc-hud-leave" onClick={onLeave} aria-label="Leave the table" title="Leave the table">
            <HudIcon name="exit" size={20} />
            <span>Leave</span>
          </button>
        )}
      </div>
    </header>
  );
}
