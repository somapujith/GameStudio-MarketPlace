// OWNER: quests agent. The job board at Mama's Garage (menu 'jobs'): the available missions with reward, time limit and difficulty,
// a detail pane for the selected one and an ACCEPT button. Keyboard (arrows + Enter, Esc closes), gamepad and touch (tap to
// select, tap again or ACCEPT to take it). Reads snap.quest.offers (slim copies of ctx.quests.available).
import { useEffect, useRef, useState } from 'react';
import { focusFirst, useMenuInput } from '../menus/useMenuInput.js';
import { groupIndian } from '../hud/hudLogic.js';
import { DIFF_LABEL, DIFF_TE, KIND_LABEL, blockedReason, limitText, pickSelected } from './questUi.js';
import { fmtClock } from '../../gameplay/quest-math.js';

function Pips({ n }) {
  return (
    <span className="aw-quest-diff" aria-label={DIFF_LABEL[n]}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'is-on' : ''} />
      ))}
    </span>
  );
}

function Card({ o, selected, onSelect, onTake }) {
  const state = o.unavailable ? 'unavailable' : o.locked ? 'locked' : o.doneToday ? 'done' : '';
  return (
    <button
      type="button"
      data-nav
      className={`aw-quest-card${selected ? ' is-selected' : ''}${state ? ` is-${state}` : ''}${o.daily ? ' is-daily' : ''}`}
      onFocus={onSelect}
      onClick={() => (selected ? onTake() : onSelect())}
      aria-pressed={selected}
    >
      <span className="aw-quest-card__main">
        <b>{o.title}</b>
        <span className="aw-te">{o.te}</span>
        <em>
          {o.daily && <span className="aw-quest-chip is-gold">DAILY x1.5</span>}
          {o.locked && <span className="aw-quest-chip is-red">NEEDS {o.minRep} REP</span>}
          {o.unavailable && !o.locked && <span className="aw-quest-chip">NOT NOW</span>}
          {o.doneToday && <span className="aw-quest-chip">DONE TODAY</span>}
          {!o.daily && o.done > 0 && <span className="aw-quest-chip is-lime">DONE x{o.done}</span>}
        </em>
      </span>
      <span className="aw-quest-card__side">
        <b>Rs {groupIndian(o.reward.cash)}</b>
        <small>{limitText(o.timeLimit)}</small>
        <Pips n={o.diff} />
      </span>
    </button>
  );
}

export default function JobBoard({ game, snap }) {
  const q = snap.quest;
  const root = useRef(null);
  const [sel, setSel] = useState(null);
  const offers = q.offers || [];
  const offer = pickSelected(offers, sel);
  const quests = game.ctx.quests;
  const close = () => game.ctx.closeMenu();
  useMenuInput(root, { active: true, onBack: close, onResume: close });
  useEffect(() => {
    focusFirst(root.current, '[data-autofocus]');
  }, []);
  const blocked = blockedReason(offer, { canAccept: q.canAccept });
  const take = () => {
    if (offer && !blocked) quests?.accept(offer.id);
  };
  return (
    <div className="aw-menu aw-quest-menu" ref={root} role="dialog" aria-modal="true" aria-label="Job board">
      <div className="aw-quest-sheet">
        <header className="aw-quest-sheet__head">
          <div>
            <small>MAMA&apos;S GARAGE</small>
            <h2>
              JOB BOARD <span className="aw-te">పని బోర్డు</span>
            </h2>
          </div>
          <div className="aw-quest-rankchip">
            <small>RANK</small>
            <b>{q.rank.title}</b>
            <span className="aw-te">{q.rank.te}</span>
            <em>{q.rep} rep</em>
          </div>
        </header>
        <div className="aw-quest-board">
          <ul className="aw-quest-list" role="list">
            {offers.map((o) => (
              <li key={o.id}>
                <Card o={o} selected={offer?.id === o.id} onSelect={() => setSel(o.id)} onTake={take} />
              </li>
            ))}
            {!offers.length && <li className="aw-quest-empty">No jobs on the board. Check back in a minute.</li>}
          </ul>
          {offer && (
            <section className="aw-quest-detail" aria-live="polite">
              <p className="aw-quest-kind">{KIND_LABEL[offer.kind] || offer.kind}</p>
              <h3>
                {offer.title} <span className="aw-te">{offer.te}</span>
              </h3>
              <p className="aw-quest-blurb">{offer.blurb}</p>
              <dl className="aw-quest-facts">
                <div>
                  <dt>Pay</dt>
                  <dd>Rs {groupIndian(offer.reward.cash)}</dd>
                </div>
                <div>
                  <dt>Reputation</dt>
                  <dd>+{offer.reward.rep}</dd>
                </div>
                <div>
                  <dt>Time limit</dt>
                  <dd>{limitText(offer.timeLimit)}</dd>
                </div>
                <div>
                  <dt>Difficulty</dt>
                  <dd>
                    {DIFF_LABEL[offer.diff]} <span className="aw-te">{DIFF_TE[offer.diff]}</span>
                  </dd>
                </div>
                {offer.best > 0 && (
                  <div>
                    <dt>Best time</dt>
                    <dd>{fmtClock(offer.best)}</dd>
                  </div>
                )}
              </dl>
              {offer.stepList?.length > 0 && (
                <ol className="aw-quest-steps">
                  {offer.stepList.map((s, i) => (
                    <li key={i}>{s.label}</li>
                  ))}
                </ol>
              )}
              <div className="aw-quest-actions">
                <button type="button" data-nav className="aw-quest-btn is-primary" disabled={!!blocked} aria-disabled={!!blocked} onClick={take}>
                  {blocked ? blocked.toUpperCase() : 'ACCEPT JOB'} {!blocked && <span className="aw-te">తీసుకో</span>}
                </button>
                <button type="button" data-nav className="aw-quest-btn" onClick={close}>
                  CLOSE <span className="aw-te">మూసివేయి</span>
                </button>
              </div>
            </section>
          )}
        </div>
        <p className="aw-quest-footnote">
          <kbd className="aw-key">Enter</kbd> take the job &nbsp; <kbd className="aw-key">Esc</kbd> close
        </p>
      </div>
    </div>
  );
}
