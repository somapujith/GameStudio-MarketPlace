// End of shift: the day's galla (cash box) tally. Chalk stars, the money counting up against star marks, a chit of numbers,
// notes and coins, and (co-op) a stack per player. Failed shifts get the shutter and "Closed for the day".
import { useEffect, useRef } from 'react';
import { ChalkStar, Coin, RupeeNote, ShutterArt } from './art.jsx';
import { useCountUp, useMotionReduced } from './hooks.js';
import { resultViewModel, rupees } from './menuModels.js';
import './menus.css';

const ROWS = [
  ['served', 'Plates served', ''],
  ['tips', 'Tips', 'money'],
  ['lost', 'Customers lost', 'bad'],
  ['unpaid', 'Walked away unpaid', 'bad'],
  ['bestCombo', 'Best combo', 'combo'],
];
// the stall's work behind the cooking (only on shifts that had it)
const OPS_ROWS = [
  ['prepped', 'Batches prepped'],
  ['tended', 'Pans tended'],
  ['gasSwaps', 'Gas swaps'],
  ['bought', 'Market buys'],
];

function Stars({ vm }) {
  if (vm.kind === 'tutorial') return null;
  return (
    <div className="tc-menu-chalk" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`tc-menu-chalk__star${i < vm.stars ? ' is-on' : ''}`} style={{ '--i': i }}>
          <ChalkStar on={i < vm.stars} size={54} />
        </span>
      ))}
    </div>
  );
}

/** The books: what came in, what went out, and what is left (stars are PROFIT). */
function Books({ vm }) {
  const b = vm.books;
  const items = [
    ['Takings', b.revenue, ''],
    ['Tips', b.tips, 'good'],
    ['Cost', b.cost, 'bad'],
    ['Wasted', b.waste, 'bad'],
    ['Fines', b.fines, 'bad'],
  ];
  return (
    <dl className="tc-menu-books" aria-label="The books">
      {items.map(([label, v, tone]) => (
        <div key={label} className={`tc-menu-books__row${tone ? ` is-${tone}` : ''}${tone === 'bad' && v > 0 ? ' is-hot' : ''}`}>
          <dt>{label}</dt>
          <dd>{rupees(v)}</dd>
        </div>
      ))}
      <div className={`tc-menu-books__row is-profit${b.profit < 0 ? ' is-neg' : ''}`}>
        <dt>Profit</dt>
        <dd>{rupees(b.profit)}</dd>
      </div>
    </dl>
  );
}

function Tally({ vm, shown, shownProfit }) {
  return (
    <section className="tc-menu-galla" aria-label="Money earned">
      <div className="tc-menu-galla__top">
        <span className="tc-menu-galla__label">Galla</span>
        <b className="tc-menu-galla__money" aria-hidden="true">{rupees(shown)}</b>
        <span className="tc-menu-sr">{`Money earned: ${rupees(vm.money)}`}</span>
        {vm.books.show && <span className="tc-menu-sr">{`Profit: ${rupees(vm.profit)}`}</span>}
        <span className="tc-menu-galla__pile" aria-hidden="true">
          <RupeeNote tilt={-8} /><RupeeNote tilt={5} tone="orange" /><Coin size={20} /><Coin size={20} /><Coin size={20} />
        </span>
      </div>
      {vm.books.show && <Books vm={vm} />}
      {vm.hasBar && (
        <div className="tc-menu-tape">
          <div className="tc-menu-tape__track" role="img" aria-label={`${rupees(vm.profit)} profit. Star targets ${vm.thresholds.map(rupees).join(', ')}.`}>
            <span className="tc-menu-tape__fill" style={{ width: `${Math.max(0, Math.min(100, vm.bar.max ? (shownProfit / vm.bar.max) * 100 : 0))}%` }} />
            {vm.bar.marks.map((m) => (
              <span key={m.star} className={`tc-menu-tape__mark${m.reached ? ' is-reached' : ''}`} style={{ left: `${m.at * 100}%` }}>
                <ChalkStar on={m.reached} size={18} />
                <small>{rupees(m.value)}</small>
              </span>
            ))}
          </div>
          <p className="tc-menu-tape__note">
            {vm.nextStar ? `${rupees(vm.nextStar.need)} more profit for star ${vm.nextStar.star}` : 'Every star chalked up. Full galla!'}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Props: { result, level, pace, mode: 'tutorial'|'practice'|'online', onRetry, onNext, onExit, onInvite, players: [{id,name}],
 *          newUnlock?: number | null (the level this shift just opened; undefined = assume level + 1 when it was cleared) }
 */
export default function Results({ result, level, pace = 'normal', mode = 'practice', onRetry, onNext, onExit, onInvite, players = [], newUnlock }) {
  const vm = resultViewModel(result, level, pace, { players, mode });
  const reduced = useMotionReduced();
  const shown = useCountUp(vm.money, { instant: reduced, ms: 1300, delay: 900 });
  const shownProfit = useCountUp(vm.profit, { instant: reduced, ms: 1300, delay: 900 });
  const root = useRef(null);
  useEffect(() => {
    root.current?.querySelector('[data-autofocus]')?.focus?.({ preventScroll: true });
  }, []);

  const tutorial = vm.kind === 'tutorial';
  const closed = vm.kind === 'closed';
  const online = mode === 'online';
  const unlocked = tutorial ? null : newUnlock === undefined ? (vm.kind === 'cleared' && !online ? vm.nextLevel : null) : newUnlock;
  const canNext = !online && !tutorial && vm.nextLevel && !closed && !!onNext;

  return (
    <main ref={root} className={`tc-menu tc-menu-results is-${vm.kind}`} aria-labelledby="tc-res-h" tabIndex={-1}>
      <div className="tc-menu-results__scroll">
        <header className="tc-menu-results__head">
          {closed && <ShutterArt />}
          <p className="tc-menu-eyebrow">
            {tutorial ? 'Training Morning' : `Level ${vm.level}`}
            {!tutorial && <> <span aria-hidden="true">{'·'}</span> {vm.levelName} <span lang="te" className="tc-menu-te">{vm.levelTe}</span></>}
          </p>
          <h1 id="tc-res-h" className={`tc-menu-banner tc-menu-banner--result${closed ? ' is-closed' : ''}`}>
            <span className="tc-menu-banner__en">{vm.headline}</span>
          </h1>
          <p className="tc-menu-results__sub" role="status" aria-live="polite">
            {vm.sub}
            {!tutorial && !closed && <span className="tc-menu-sr">{`. ${vm.stars} of 3 stars.`}</span>}
          </p>
          <Stars vm={vm} />
        </header>

        {tutorial && (
          <section className="tc-menu-banner-card tc-menu-invite tc-menu-invite--result" aria-labelledby="tc-res-inv">
            <div>
              <h2 id="tc-res-inv" className="tc-menu-paint">Co-op with friends unlocked</h2>
              <p className="tc-menu-lede">Chotu says: ready hai, anna! Call your friends and run the stall together.</p>
            </div>
            {onInvite && (
              <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big" data-autofocus onClick={onInvite}>
                Invite friends
              </button>
            )}
          </section>
        )}

        {!tutorial && <Tally vm={vm} shown={shown} shownProfit={shownProfit} />}

        {!tutorial && (!closed || vm.stats.served > 0) ? (
          <section className="tc-menu-chit" aria-label="Shift numbers">
            <h2 className="tc-menu-chit__h">Today's chit</h2>
            <dl className="tc-menu-chit__rows">
              {ROWS.filter(([k]) => !(k === 'tips' && vm.books.show)).map(([k, label, tone]) => (
                <div key={k} className={`tc-menu-chit__row${tone ? ` is-${tone}` : ''}${(tone === 'bad' && vm.stats[k] > 0) ? ' is-hot' : ''}`}>
                  <dt>{label}</dt>
                  <dd>{tone === 'money' ? rupees(vm.stats[k]) : k === 'bestCombo' ? `x${vm.stats[k]}` : vm.stats[k]}</dd>
                </div>
              ))}
              {vm.ops.show && OPS_ROWS.map(([k, label]) => (
                <div key={k} className="tc-menu-chit__row is-ops">
                  <dt>{label}</dt>
                  <dd>{vm.ops[k]}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {vm.coop && (
          <section className="tc-menu-crew" aria-label="Who collected what">
            <h2 className="tc-menu-chit__h">Who brought in the cash</h2>
            <ul className="tc-menu-crew__list">
              {vm.rows.map((r) => (
                <li key={r.id} className={`tc-menu-crew__row${r.mvp ? ' is-mvp' : ''}`}>
                  <span className="tc-menu-crew__name">
                    {r.name}
                    {r.mvp && <span className="tc-menu-mvp">MVP</span>}
                  </span>
                  <span className="tc-menu-crew__bar" role="img" aria-label={`${r.name} collected ${rupees(r.collected)}, ${r.pct} percent`}>
                    <i style={{ width: `${Math.max(4, r.share * 100)}%` }} />
                  </span>
                  <span className="tc-menu-crew__amt">{rupees(r.collected)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unlocked ? (
          <p className="tc-menu-unlocked" role="status">
            <span className="tc-menu-unlocked__tag">NEW</span> Level {unlocked} opened: {vm.nextLevelName}
          </p>
        ) : null}

        <div className="tc-menu-actions">
          {tutorial ? (
            <>
              {!onInvite && onNext && <button type="button" className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--big" data-autofocus onClick={onNext}>Start practice shifts</button>}
              {onInvite && onNext && <button type="button" className="tc-menu-btn tc-menu-btn--plank" onClick={onNext}>Practice shifts</button>}
              {onExit && <button type="button" className="tc-menu-btn tc-menu-btn--ghost" onClick={onExit}>Back</button>}
            </>
          ) : (
            <>
              {canNext && <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big" data-autofocus onClick={onNext}>Next level</button>}
              {onRetry && (
                <button type="button" className={`tc-menu-btn ${canNext ? 'tc-menu-btn--plank' : 'tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big'}`} data-autofocus={canNext ? undefined : true} onClick={onRetry}>
                  {online ? 'Play again' : closed ? 'Open the shutters again' : 'Retry shift'}
                </button>
              )}
              {onInvite && !online && <button type="button" className="tc-menu-btn tc-menu-btn--plank" onClick={onInvite}>Invite friends</button>}
              {onExit && <button type="button" className="tc-menu-btn tc-menu-btn--ghost" onClick={onExit}>Back</button>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
