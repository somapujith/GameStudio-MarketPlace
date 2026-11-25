// OWNER: quests agent. The mission tracker on the HUD (left side, under the career chips): title, current objective, progress text,
// the clock and the meter (heat / mood), the reward. Reads snap.quest.active (10 Hz); nothing per frame.
import { fmtClock } from '../../gameplay/quest-math.js';
import { groupIndian } from '../hud/hudLogic.js';
import { clockTone, pct } from './questUi.js';

export default function Tracker({ q }) {
  const a = q.active;
  if (!a) return null;
  const idx = Math.min(a.stepIndex, a.steps.length - 1);
  const cur = a.steps[idx];
  const tone = clockTone(a.timeLeft, a.timeTotal);
  return (
    <aside className="aw-quest-tracker" aria-label="Current mission" data-kind={a.kind}>
      <header className="aw-quest-tracker__head">
        <span className="aw-quest-tag">MISSION</span>
        <b className="aw-quest-reward">Rs {groupIndian(a.reward.cash)}</b>
        <span className="aw-quest-diff" aria-label={`Difficulty ${a.diff} of 3`}>
          {[1, 2, 3].map((i) => (
            <i key={i} className={i <= a.diff ? 'is-on' : ''} />
          ))}
        </span>
      </header>
      <h3 className="aw-quest-tracker__title">
        {a.title} {a.te && <span className="aw-te">{a.te}</span>}
      </h3>
      <p className="aw-quest-now" aria-live="polite">
        <span className="aw-quest-step">
          {idx + 1}/{a.steps.length}
        </span>
        {cur?.label}
      </p>
      {(a.progress || a.note) && (
        <p className={`aw-quest-progress${a.note ? ' is-warn' : ''}`}>{a.note || a.progress}</p>
      )}
      {a.hint && !a.note && a.timeLeft == null && !a.meter && <p className="aw-quest-hint">{a.hint}</p>}
      {a.timeLeft != null && (
        <div className={`aw-quest-clock is-${tone}`} role="timer" aria-label={`${fmtClock(a.timeLeft)} left`}>
          <b>{fmtClock(a.timeLeft)}</b>
          <span className="aw-quest-bar">
            <i style={{ width: pct(a.timeTotal ? a.timeLeft / a.timeTotal : 1) }} />
          </span>
        </div>
      )}
      {a.meter && (
        <div className={`aw-quest-meter${a.meter.value < 0.3 ? ' is-low' : ''}`}>
          <small>
            {a.meter.label} {a.meter.te && <span className="aw-te">{a.meter.te}</span>}
          </small>
          <span className="aw-quest-bar">
            <i style={{ width: pct(a.meter.value) }} />
          </span>
        </div>
      )}
    </aside>
  );
}
