// The clock-out summary: this shift's totals, then the score is saved with the run API (gameplay/runApi.js) and the result shown.
// If the server cannot be reached (or you are not signed in) the player is told, calmly, that it is saved on this device only.
import { useEffect, useRef, useState } from 'react';
import { StarShape } from '../hud/icons.jsx';
import { groupIndian } from '../hud/hudLogic.js';
import { runStatsFrom, summaryDistance, summaryTime } from './sitting.js';
import { focusFirst, useMenuInput } from './useMenuInput.js';
import { MIN_SECONDS } from '../../gameplay/runApi.js';
import { useMenuLayout } from './menuLayout.js';
import './sheet.css';

function Tile({ label, te, value, accent }) {
  return (
    <div className={`aw-stat ${accent ? 'is-accent' : ''}`}>
      <small>
        {label} <span className="aw-te">{te}</span>
      </small>
      <b>{value}</b>
    </div>
  );
}

function SaveBox({ phase, result, onRetry, onSignIn }) {
  if (phase === 'saving') {
    return (
      <div className="aw-save is-wait" role="status">
        <i className="aw-spin" aria-hidden="true" />
        <span>Saving your score...</span>
      </div>
    );
  }
  if (!result) return null;
  if (result.status === 'saved') {
    const o = result.outcome;
    return (
      <div className="aw-save is-ok" role="status">
        {o.newBest && <b className="aw-newbest">NEW BEST!</b>}
        <div className="aw-save__chips">
          <span className="aw-reward"><b>+{groupIndian(o.xp)}</b> XP</span>
          <span className="aw-reward is-coin"><b>+{groupIndian(o.coins)}</b> coins</span>
          {o.level > 0 && <span className="aw-reward is-lvl">Level <b>{o.level}</b></span>}
        </div>
        <p>
          {o.duplicate ? 'This shift was already saved. ' : ''}Best score <b>Rs {groupIndian(o.bestScore)}</b> &middot; {o.games} {o.games === 1 ? 'shift' : 'shifts'} on the leaderboard
        </p>
      </div>
    );
  }
  if (result.status === 'too-short') {
    return (
      <div className="aw-save is-local" role="status">
        <p>
          Drive a little longer to save a score online: a shift needs at least {MIN_SECONDS} seconds ({result.need} to go). Your progress is saved on this device.
        </p>
      </div>
    );
  }
  return (
    <div className="aw-save is-local" role="status">
      <p>{result.message}</p>
      <div className="aw-save__acts">
        {result.reason === 'signin' ? (
          <button type="button" data-nav className="aw-btn is-ghost" onClick={onSignIn}>Sign in</button>
        ) : (
          result.reason !== 'rejected' && <button type="button" data-nav className="aw-btn is-ghost" onClick={onRetry}>Try again</button>
        )}
      </div>
    </div>
  );
}

export default function SummaryScreen({ game, sitting, runs, onKeepDriving, onHub, onSignIn }) {
  const root = useRef(null);
  const layout = useMenuLayout();
  const [stats] = useState(() => sitting.stats()); // frozen: the numbers at the moment you clocked out
  const [phase, setPhase] = useState('saving');
  const [result, setResult] = useState(null);
  const alive = useRef(true);
  const once = useRef(false);

  const save = async () => {
    setPhase('saving');
    const r = await runs.finish(runStatsFrom(stats));
    if (!alive.current) return;
    if (r.status === 'saved') game.ctx.profile.flush();
    setResult(r);
    setPhase('done');
  };
  useEffect(() => {
    alive.current = true;
    if (!once.current) {
      once.current = true; // React's dev double-mount must not post the same run twice
      save();
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    focusFirst(root.current, '[data-autofocus]');
  }, []);
  useMenuInput(root, { active: true, onBack: onKeepDriving });

  const rating = stats.rating || stats.lifetimeRating;
  return (
    <div className="aw-menu aw-sum" ref={root} data-layout={layout} role="dialog" aria-modal="true" aria-label="Shift summary">
      <div className="aw-sum__bg" />
      <div className="aw-sum__card">
        <div className="aw-sum__head">
          <p className="aw-start__eyebrow">CLOCKED OUT</p>
          <h1 className="aw-title aw-title--sm">
            <span className="aw-title__en">SHIFT OVER</span>
            <span className="aw-title__te aw-te">షిఫ్ట్ ముగిసింది</span>
          </h1>
        </div>
        <div className="aw-sum__main">
        <div className="aw-stats aw-stats--sum">
          <Tile accent label="Earned" te="సంపాదన" value={`Rs ${groupIndian(stats.earned)}`} />
          <Tile label="Fares" te="రైడ్లు" value={stats.fares} />
          <Tile label="Tips" te="టిప్పులు" value={`Rs ${groupIndian(stats.tips)}`} />
          <Tile label="Distance" te="దూరం" value={summaryDistance(stats.distance)} />
          <Tile label="Best fare" te="గరిష్ట" value={stats.bestFare ? `Rs ${groupIndian(stats.bestFare)}` : '-'} />
          <Tile
            label="Rating"
            te="రేటింగ్"
            value={
              rating > 0 ? (
                <span className="aw-stars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <StarShape key={i} id={`sum-${i}`} size={16} fill={Math.max(0, Math.min(1, rating - i))} />
                  ))}
                  <em>{rating.toFixed(1)}</em>
                </span>
              ) : (
                '-'
              )
            }
          />
          <Tile label="Time" te="సమయం" value={summaryTime(stats.seconds)} />
        </div>
        <SaveBox phase={phase} result={result} onRetry={save} onSignIn={onSignIn} />
        </div>
        <div className="aw-sum__acts aw-sheet-bar">
          <button type="button" data-nav data-autofocus className="aw-btn is-primary" onClick={onKeepDriving}>
            KEEP DRIVING
          </button>
          <button type="button" data-nav className="aw-btn" onClick={onHub}>
            BACK TO HUB
          </button>
        </div>
      </div>
    </div>
  );
}
