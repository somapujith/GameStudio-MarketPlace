// The start screen at /play/tiffin-centre: a flex-banner hero over the stall, the tutorial board (until it is done), Invite friends,
// and the practice-shift map: painted signboards grouped by time of day, stars chalked on a board.
import { useState } from 'react';
import { PACE_OPTIONS, levelMapModel, paceOf, totalStars, unlockedLevelOf } from './menuModels.js';
import { ChotuAvatar, DishGlyph, Padlock, SkyGlyph, StallHeroArt, StarRow } from './art.jsx';
import { radioKeys } from './hooks.js';
import { paths } from '@/platform/paths.js';
import { GAME_ID } from '@shared/tiffin-centre/catalog.js';
import './menus.css';

export function PaceSegmented({ value, onChange, label = 'Pace' }) {
  return (
    <div className="tc-menu-pace" role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
      {PACE_OPTIONS.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={`tc-menu-pace__opt${on ? ' is-on' : ''}`} onClick={() => onChange?.(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LevelCard({ c, pace, onStart }) {
  const descId = `tc-lvl-${c.level}-d`;
  return (
    <li className={`tc-menu-lvl tc-menu-sky--${c.sky}${c.locked ? ' is-locked' : ''}${c.current ? ' is-current' : ''}`}>
      <button
        type="button"
        className="tc-menu-lvl__btn"
        aria-disabled={c.locked || undefined}
        aria-describedby={descId}
        aria-label={c.label}
        onClick={() => !c.locked && onStart?.(c.level, pace)}
      >
        <span className="tc-menu-lvl__sky" aria-hidden="true">
          <SkyGlyph sky={c.sky} />
          <span className="tc-menu-lvl__no">{c.level}</span>
          {c.locked && <span className="tc-menu-lvl__lock"><Padlock size={26} /></span>}
        </span>
        <span className="tc-menu-lvl__body">
          <span className="tc-menu-lvl__name">{c.name}</span>
          <span className="tc-menu-lvl__te" lang="te">{c.te}</span>
          <span className="tc-menu-lvl__meta">
            <span className="tc-menu-lvl__hours">{c.hours}</span>
            <span className="tc-menu-lvl__menu"><DishGlyph station="tawa" size={16} /> {c.menuCount} dishes</span>
          </span>
          <span className="tc-menu-lvl__chalk">
            {c.locked ? <span className="tc-menu-lvl__locktext">Locked</span> : <StarRow value={c.stars} size={20} />}
            {!c.locked && c.best > 0 && <span className="tc-menu-lvl__best">Best {'₹'}{c.best.toLocaleString('en-IN')}</span>}
            {!c.locked && c.current && <span className="tc-menu-lvl__start">Play</span>}
          </span>
        </span>
      </button>
      <span id={descId} className="tc-menu-sr">{c.locked ? c.lockNote : `${c.length} shift`}</span>
    </li>
  );
}

/**
 * Props: { progress: { best: { [level]: { stars, earned } }, unlocked }, tutorialDone, unlockedLevel,
 *          onStartTutorial(), onStartLevel(level, pace), onInvite(), onBack(), defaultPace? }
 */
export default function SoloHome({ progress = null, tutorialDone = false, unlockedLevel, onStartTutorial, onStartLevel, onInvite, onBack, defaultPace = 'normal' }) {
  const [pace, setPace] = useState(paceOf(defaultPace));
  const [peek, setPeek] = useState(false);
  const open = Number.isFinite(Number(unlockedLevel)) && unlockedLevel !== undefined ? Number(unlockedLevel) : unlockedLevelOf(progress);
  const groups = levelMapModel({ progress, unlockedLevel: open });
  const showMap = tutorialDone || peek;
  const gamePath = paths.game(GAME_ID);

  return (
    <main className="tc-menu tc-menu-home" aria-labelledby="tc-home-title">
      <div className="tc-menu-home__scroll">
        <a
          className="tc-menu-back"
          href={gamePath}
          onClick={(e) => {
            if (onBack) {
              e.preventDefault();
              onBack();
            }
          }}
        >
          <span aria-hidden="true">{'‹'}</span> Back
        </a>

        <header className="tc-menu-hero">
          <StallHeroArt />
          <h1 id="tc-home-title" className="tc-menu-banner">
            <span className="tc-menu-banner__te" lang="te">టిఫిన్ సెంటర్</span>
            <span className="tc-menu-banner__en">Tiffin Centre</span>
          </h1>
          <p className="tc-menu-hero__tag">Dosa, idly, chai. Cook it hot, collect the cash.</p>
        </header>

        <div className="tc-menu-home__col">
          {!tutorialDone ? (
            <>
              <section className="tc-menu-board tc-menu-tutorial" aria-labelledby="tc-tut-h">
                <ChotuAvatar size={72} className="tc-menu-tutorial__chotu" />
                <div className="tc-menu-tutorial__text">
                  <h2 id="tc-tut-h" className="tc-menu-paint">Start tutorial</h2>
                  <p className="tc-menu-lede">Chotu shows you the stall, one customer at a time. About three minutes.</p>
                  <p className="tc-menu-unlock"><Padlock size={16} /> Unlocks co-op with friends</p>
                </div>
                <button type="button" className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--big" data-autofocus autoFocus onClick={() => onStartTutorial?.()}>
                  Start tutorial
                </button>
              </section>
              <section className="tc-menu-tin tc-menu-coop is-locked" aria-label="Co-op table, locked">
                <Padlock size={26} />
                <div>
                  <h2 className="tc-menu-tin__h">Co-op table <span lang="te">(2 to 4 friends)</span></h2>
                  <p className="tc-menu-lede">Run one stall together in real time. Finish the tutorial and the shutter goes up.</p>
                </div>
              </section>
            </>
          ) : (
            <section className="tc-menu-banner-card tc-menu-invite" aria-labelledby="tc-inv-h">
              <div>
                <h2 id="tc-inv-h" className="tc-menu-paint">Open a table with friends</h2>
                <p className="tc-menu-lede">Two to four of you, one stall, real time. Serve fast, collect faster.</p>
              </div>
              <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big" data-autofocus autoFocus onClick={() => onInvite?.()}>
                Invite friends
              </button>
            </section>
          )}

          <section className="tc-menu-practice" aria-labelledby="tc-prac-h">
            <div className="tc-menu-practice__head">
              <h2 id="tc-prac-h" className="tc-menu-paint tc-menu-paint--sm">Practice shifts</h2>
              {showMap && <span className="tc-menu-chip" title="Stars earned">{totalStars(progress)} / 36 stars</span>}
            </div>
            {showMap ? (
              <>
                <div className="tc-menu-practice__pace">
                  <span id="tc-pace-l">Pace</span>
                  <PaceSegmented value={pace} onChange={setPace} label="Pace" />
                </div>
                {groups.map((g) => (
                  <section key={g.id} className={`tc-menu-group tc-menu-sky--${g.id}`} aria-labelledby={`tc-g-${g.id}`}>
                    <h3 id={`tc-g-${g.id}`} className="tc-menu-group__h">
                      <span>{g.label}</span> <span lang="te" className="tc-menu-group__te">{g.te}</span>
                      <small>{g.hours}</small>
                    </h3>
                    <ol className="tc-menu-lvls">
                      {g.cards.map((c) => <LevelCard key={c.level} c={c} pace={pace} onStart={onStartLevel} />)}
                    </ol>
                  </section>
                ))}
              </>
            ) : (
              <div className="tc-menu-tin tc-menu-practice__lock">
                <Padlock size={22} />
                <p className="tc-menu-lede">Twelve shifts from sunrise dosa to festival night open once you finish the tutorial.</p>
                <button type="button" className="tc-menu-btn tc-menu-btn--ghost" onClick={() => setPeek(true)}>Peek at the shifts</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
