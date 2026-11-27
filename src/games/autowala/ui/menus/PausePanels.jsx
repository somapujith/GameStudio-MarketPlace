// The right-hand content of the pause menu: the wallet / time / day card, BRIEF, STATS and the controls reference.
import { GAMEPAD, KEYBOARD, TOUCH } from './controls.js';
import { StarShape } from '../hud/icons.jsx';
import { formatClock, formatDistance, groupIndian, normalizeTrip } from '../hud/hudLogic.js';
import { summaryDistance, summaryTime } from './sitting.js';

export function SideCard({ snap }) {
  const c = formatClock(snap.hour);
  return (
    <div className="aw-side">
      <div className="aw-side__cell">
        <small>WALLET</small>
        <b>
          <span>Rs</span> {groupIndian(snap.wallet)}
        </b>
      </div>
      <div className="aw-side__cell">
        <small>TIME</small>
        <b>
          {c.time} <span>{c.ampm}</span>
        </b>
      </div>
      <div className="aw-side__cell">
        <small>DAY</small>
        <b>{Math.max(1, Math.floor(snap.day || 1))}</b>
      </div>
    </div>
  );
}

function Stars({ value, id }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <span className="aw-stars" aria-label={`${v.toFixed(1)} stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <StarShape key={i} id={`${id}-${i}`} size={13} fill={Math.max(0, Math.min(1, v - i))} />
      ))}
    </span>
  );
}

/** The mission block of the BRIEF panel (the quests agent's): the live mission or tutorial, else a pointer to the job board; plus the rank. */
function MissionBrief({ q }) {
  const m = q?.active || q?.tutorial;
  const cur = m ? m.steps[Math.min(m.stepIndex, m.steps.length - 1)] : null;
  return (
    <div className="aw-quest-brief">
      {m ? (
        <>
          <b>{m.title}</b> {m.te && <span className="aw-te">{m.te}</span>}
          <p className="aw-quest-now">
            <span className="aw-quest-step">{Math.min(m.stepIndex + 1, m.steps.length)}/{m.steps.length}</span>
            {cur?.label}
          </p>
          {m.progress && <p className="aw-quest-progress">{m.progress}</p>}
          {m.timeLeft != null && <p className="aw-quest-progress">Time left {Math.floor(m.timeLeft / 60)}:{String(Math.ceil(m.timeLeft) % 60).padStart(2, '0')}</p>}
          <p className="aw-quest-brief__rank">Pays <b>Rs {groupIndian(m.reward.cash)}</b> <span>+{m.reward.rep} rep</span></p>
        </>
      ) : (
        <p className="aw-panel__empty">No mission running. Pull up at the JOB BOARD beside Mama&apos;s Garage and press E, or press Q for the quest log.</p>
      )}
      {q?.rank && (
        <p className="aw-quest-brief__rank">
          Rank <b>{q.rank.title}</b> <span className="aw-te">{q.rank.te}</span> <span>{q.rep} rep</span>
        </p>
      )}
    </div>
  );
}

export function BriefPanel({ snap, log }) {
  const t = normalizeTrip(snap.trip, snap.route);
  return (
    <div className="aw-panel">
      <h2>MISSION <span className="aw-te">మిషన్</span></h2>
      <MissionBrief q={snap.quest} />
      <h2>CURRENT JOB <span className="aw-te">ప్రస్తుత పని</span></h2>
      {t ? (
        <div className="aw-job">
          <div className="aw-job__who">
            <b>{t.name}</b>
            {t.te && <span className="aw-te">{t.te}</span>}
            <em>{t.kind.label}</em>
          </div>
          <div className="aw-job__line">
            To <b>{t.destName}</b>
            {t.destTe && <span className="aw-te"> {t.destTe}</span>}
          </div>
          <div className="aw-job__nums">
            <span>Fare so far <b>Rs {groupIndian(t.fare)}</b></span>
            {t.distance != null && <span>Left <b>{formatDistance(t.distance)}</b></span>}
          </div>
        </div>
      ) : (
        <p className="aw-panel__empty">No passenger on board. Follow the pink markers to find one.</p>
      )}
      <h2>LAST CUSTOMERS <span className="aw-te">చివరి కస్టమర్లు</span></h2>
      {log.history.length ? (
        <ul className="aw-hist">
          {log.history.slice(0, 6).map((h, i) => (
            <li key={i}>
              <span className="aw-hist__who">
                <b>{h.name}</b>
                {h.dest && <em>to {h.dest}</em>}
              </span>
              <Stars value={h.rating} id={`h${i}`} />
              <span className="aw-hist__pay">
                <b>Rs {groupIndian(h.fare)}</b>
                {h.tip > 0 && <em>+{groupIndian(h.tip)} tip</em>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aw-panel__empty">No rides yet this visit.</p>
      )}
    </div>
  );
}

function Stat({ label, te, value, sub }) {
  return (
    <div className="aw-stat">
      <small>
        {label} <span className="aw-te">{te}</span>
      </small>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

export function StatsPanel({ game, sitting, log }) {
  const p = game.ctx.profile.data;
  const s = sitting.stats();
  const rating = typeof game.ctx.profile.rating === 'function' ? game.ctx.profile.rating() : 0;
  return (
    <div className="aw-panel">
      <h2>STATS <span className="aw-te">గణాంకాలు</span></h2>
      <div className="aw-stats">
        <Stat label="Money earned" te="సంపాదన" value={`Rs ${groupIndian(p.totalEarned)}`} sub={`this shift Rs ${groupIndian(s.earned)}`} />
        <Stat label="Rides" te="రైడ్లు" value={groupIndian(p.rides)} sub={`this shift ${s.fares}`} />
        <Stat label="Best fare" te="గరిష్ట ఛార్జీ" value={`Rs ${groupIndian(p.bestFare)}`} />
        <Stat label="Tips" te="టిప్పులు" value={`Rs ${groupIndian(s.tips)}`} sub="this shift" />
        <Stat label="Distance" te="దూరం" value={summaryDistance(p.distance)} sub={`this shift ${summaryDistance(s.distance)}`} />
        <Stat label="Rating" te="రేటింగ్" value={rating > 0 ? rating.toFixed(1) : '-'} sub={rating > 0 ? <Stars value={rating} id="stat" /> : 'no rides yet'} />
        <Stat label="Time played" te="ఆడిన సమయం" value={summaryTime(game.ctx.clock.time)} sub="this visit" />
        <Stat label="Customers missed" te="మిస్ అయిన" value={log.missed} sub="this visit" />
        <Stat label="Challans / fines" te="చలానాలు" value={`Rs ${groupIndian(log.finesTotal)}`} sub={`${log.fines} caught`} />
        <Stat label="Workshop spend" te="వర్క్‌షాప్" value={`Rs ${groupIndian(game.ctx.economy.session.workshop)}`} sub="this visit" />
      </div>
    </div>
  );
}

function Legend({ title, rows }) {
  return (
    <div className="aw-legend">
      <h3>{title}</h3>
      {rows.map((r) => (
        <div key={r.what} className="aw-legend__row">
          <span>
            {r.keys.map((k, i) => (
              <span key={k}>
                {i > 0 && <i> / </i>}
                <kbd className="aw-key">{k}</kbd>
              </span>
            ))}
          </span>
          <em>{r.what}</em>
        </div>
      ))}
    </div>
  );
}

export function ControlsPanel({ touch = false }) {
  return (
    <div className={`aw-panel aw-panel--controls${touch ? ' is-touch' : ''}`}>
      <h2>CONTROLS <span className="aw-te">నియంత్రణలు</span></h2>
      {touch && (
        <p className="aw-controls-lead">
          Wheel on the left, pedals on the right. The small buttons around them do the rest.
        </p>
      )}
      <div className="aw-legends">
        {touch && <Legend title="TOUCH" rows={TOUCH} />}
        <Legend title="KEYBOARD" rows={KEYBOARD} />
        <Legend title="GAMEPAD" rows={GAMEPAD} />
        {!touch && <Legend title="TOUCH" rows={TOUCH} />}
      </div>
    </div>
  );
}

export function NotePanel({ title, te, children }) {
  return (
    <div className="aw-panel">
      <h2>
        {title} {te && <span className="aw-te">{te}</span>}
      </h2>
      <div className="aw-note">{children}</div>
    </div>
  );
}
