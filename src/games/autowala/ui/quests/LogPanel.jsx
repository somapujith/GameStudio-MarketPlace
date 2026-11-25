// OWNER: quests agent. The quest log (key Q, menu 'quests'): rank and reputation, the active mission (steps, clock, rewards, ABANDON),
// the tutorial, and the missions finished so far. Reads snap.quest; actions go through game.ctx.quests.
import { useEffect, useRef } from 'react';
import { focusFirst, useMenuInput } from '../menus/useMenuInput.js';
import { groupIndian } from '../hud/hudLogic.js';
import { fmtClock } from '../../gameplay/quest-math.js';
import { clockTone, limitText, pct, rankProgress } from './questUi.js';

export default function LogPanel({ game, snap }) {
  const q = snap.quest;
  const root = useRef(null);
  const close = () => game.ctx.closeMenu();
  useMenuInput(root, { active: true, onBack: close, onResume: close });
  useEffect(() => {
    focusFirst(root.current, '[data-autofocus]');
    // Q closes the log again (the game's own key handler never sees keys while a menu is up)
    const onKey = (e) => {
      if (e.key?.toLowerCase() === 'q' && !e.repeat) close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const a = q.active || q.tutorial;
  const quests = game.ctx.quests;
  const done = (quests?.saved?.done && Object.entries(quests.saved.done)) || [];
  const best = quests?.saved?.best || {};
  const names = Object.fromEntries((q.offers || []).map((o) => [o.defId, o.title]));
  const tone = a ? clockTone(a.timeLeft, a.timeTotal) : 'calm';
  const prog = rankProgress(q.rank, q.rep);
  return (
    <div className="aw-menu aw-quest-menu" ref={root} role="dialog" aria-modal="true" aria-label="Quest log">
      <div className="aw-quest-sheet">
        <header className="aw-quest-sheet__head">
          <div>
            <small>JOBS</small>
            <h2>
              QUEST LOG <span className="aw-te">క్వెస్ట్ లాగ్</span>
            </h2>
          </div>
          <div className="aw-quest-rankchip">
            <small>RANK</small>
            <b>{q.rank.title}</b>
            <span className="aw-te">{q.rank.te}</span>
            <em>
              {q.rep}
              {q.rank.next != null ? ` / ${q.rank.next}` : ''} rep
            </em>
            <span className="aw-quest-bar is-rank">
              <i style={{ width: pct(prog) }} />
            </span>
          </div>
        </header>

        <div className="aw-quest-cols">
          <section className="aw-quest-panel">
            <h3>
              ACTIVE MISSION <span className="aw-te">ప్రస్తుత మిషన్</span>
            </h3>
            {a ? (
              <div className="aw-quest-active">
                <p className="aw-quest-active__title">
                  <b>{a.title}</b> <span className="aw-te">{a.te}</span>
                </p>
                <ol className="aw-quest-steps is-log">
                  {a.steps.map((s, i) => (
                    <li key={i} className={s.done ? 'is-done' : s.current ? 'is-now' : ''}>
                      {s.label}
                    </li>
                  ))}
                </ol>
                {a.progress && <p className="aw-quest-progress">{a.progress}</p>}
                {a.timeLeft != null && (
                  <div className={`aw-quest-clock is-${tone}`}>
                    <b>{fmtClock(a.timeLeft)}</b>
                    <span className="aw-quest-bar">
                      <i style={{ width: pct(a.timeTotal ? a.timeLeft / a.timeTotal : 1) }} />
                    </span>
                  </div>
                )}
                {a.meter && (
                  <div className="aw-quest-meter">
                    <small>{a.meter.label}</small>
                    <span className="aw-quest-bar">
                      <i style={{ width: pct(a.meter.value) }} />
                    </span>
                  </div>
                )}
                <p className="aw-quest-active__reward">
                  Reward <b>Rs {groupIndian(a.reward.cash)}</b> <em>+{a.reward.rep} rep</em>
                </p>
                <button type="button" data-nav className="aw-quest-btn is-danger" onClick={() => (game.ctx.closeMenu(), quests.abandon())}>
                  {q.tutorial ? 'SKIP TUTORIAL' : 'ABANDON MISSION'}
                </button>
              </div>
            ) : (
              <div className="aw-quest-none">
                <p>No mission running.</p>
                <p>
                  Drive to <b>Mama&apos;s Garage</b>, pull up beside the <b>JOB BOARD</b> sign and press <kbd className="aw-key">E</kbd>.
                </p>
                {q.tutorialState !== 'done' && (
                  <button type="button" data-nav className="aw-quest-btn" onClick={() => (game.ctx.closeMenu(), quests.startTutorial())}>
                    START MAMA&apos;S FIRST DAY <span className="aw-te">మామా మొదటి రోజు</span>
                  </button>
                )}
                {q.tutorialState === 'done' && (
                  <button type="button" data-nav className="aw-quest-btn" onClick={() => (game.ctx.closeMenu(), quests.startTutorial())}>
                    REPLAY THE TUTORIAL
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="aw-quest-panel">
            <h3>
              DONE <span className="aw-te">పూర్తయినవి</span> <small>{q.completed} total</small>
            </h3>
            {done.length ? (
              <ul className="aw-quest-donelist">
                {done.map(([id, n]) => (
                  <li key={id}>
                    <span>{names[id] || id}</span>
                    <b>x{n}</b>
                    {best[id] ? <em>best {limitText(best[id])}</em> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="aw-quest-none">Nothing finished yet. Take a job from the board.</p>
            )}
            <p className="aw-quest-footnote">
              <kbd className="aw-key">Q</kbd> / <kbd className="aw-key">Esc</kbd> close
            </p>
            <button type="button" data-nav data-autofocus className="aw-quest-btn" onClick={close}>
              CLOSE <span className="aw-te">మూసివేయి</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
