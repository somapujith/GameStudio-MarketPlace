// OWNER: career agent. The end-of-day accounts screen (menu 'hisaab'). (The small job chip moved to the HUD: ui/hud/JobChip.jsx.)
// Props: { game, snap }. Data comes from snap.career (gameplay/career.js); the chai / repair / buy actions go through game.ctx.career.
import { useEffect, useRef } from 'react';
import { groupIndian } from './hud/hudLogic.js';
import { StarShape } from './hud/icons.jsx';
import { focusFirst, useMenuInput } from './menus/useMenuInput.js';
import { expenseRows, incomeRows, liveView, sparkBars, verdict } from './career/hisaabModel.js';
import { CloseGlyph } from './menus/glyphs.jsx';
import { useMenuLayout } from './menus/menuLayout.js';
import './menus/sheet.css';
import './career/career.css';

const rs = (n) => `Rs ${groupIndian(n)}`;

function Row({ en, te, amount, sign, tone }) {
  return (
    <li className={`aw-career-line ${tone || ''}`}>
      <span>{en} <span className="aw-te">{te}</span></span>
      <b>{sign}{rs(amount)}</b>
    </li>
  );
}

function Stat({ en, te, children }) {
  return (
    <div className="aw-career-stat">
      <small>{en} <span className="aw-te">{te}</span></small>
      <b>{children}</b>
    </div>
  );
}

function HisaabPanel({ game, snap }) {
  const root = useRef(null);
  const layout = useMenuLayout();
  const h = snap.career?.hisaab;
  const career = game.ctx.career;
  const next = () => game.ctx.closeMenu();
  const clockOut = () => game.ctx.openMenu('summary');
  useEffect(() => {
    focusFirst(root.current, '[data-autofocus]');
  }, []);
  useMenuInput(root, { active: true, onBack: next });
  if (!h) return null;

  const net = Math.round(h.net);
  const v = verdict(h);
  const bars = sparkBars(h.history);
  const { ladder: lad, repairCost } = liveView(h, snap.career); // live: the record `h` is frozen at the end of the day
  const owedRent = h.rent?.owed || 0;
  const buy = () => career?.buyAuto?.();
  const repair = () => career?.repair?.({ partial: true });
  const stars = h.stars || 0;

  return (
    <div className="aw-career-hisaab" ref={root} data-layout={layout} role="dialog" aria-modal="true" aria-label="End of day accounts">
      <div className="aw-career-bg" />
      <div className="aw-career-card">
        <div className="aw-career-head">
          <button type="button" className="aw-sheet-x" onClick={next} aria-label={h.reason === 'day' ? 'Next day' : 'Keep driving'}>
            <CloseGlyph />
          </button>
          <div className="aw-career-head__text">
            <p className="aw-career-eyebrow">{h.reason === 'day' ? `DAY ${h.lifeDay} · THE DAY IS DONE` : 'CLOCKED OUT FOR NOW'}</p>
            <h1 className="aw-career-title">
              <span>HISAAB</span>
              <span className="aw-te">హిసాబు</span>
            </h1>
          </div>
        </div>

        <div className="aw-career-main">
        <div className="aw-career-grid">
          <section className="aw-career-sheet" aria-label="Money in">
            <h2>Earned <span className="aw-te">సంపాదన</span></h2>
            <ul>
              {incomeRows(h).map((r) => <Row key={r.id} en={r.en} te={r.te} amount={r.amount} sign="+" tone="is-in" />)}
            </ul>
            <p className="aw-career-sum"><span>Total <span className="aw-te">మొత్తం</span></span><b>{rs(h.earned)}</b></p>
          </section>

          <section className="aw-career-sheet" aria-label="Money out">
            <h2>Spent <span className="aw-te">ఖర్చు</span></h2>
            <ul>
              {expenseRows(h).map((r) => <Row key={r.id} en={r.en} te={r.te} amount={r.amount} sign="-" tone="is-out" />)}
            </ul>
            <p className="aw-career-sum"><span>Total <span className="aw-te">మొత్తం</span></span><b>{rs(h.expenseTotal)}</b></p>
          </section>
        </div>

        <div className="aw-career-rest">
        <div className={`aw-career-net ${net < 0 ? 'is-loss' : 'is-gain'}`}>
          <span>{net < 0 ? 'LOSS' : 'NET PROFIT'} <span className="aw-te">{net < 0 ? 'నష్టం' : 'నికర లాభం'}</span></span>
          <b>{net < 0 ? '-' : ''}{rs(Math.abs(net))}</b>
          {h.newBest && <em>BEST DAY!</em>}
        </div>
        <p className="aw-career-verdict">{v.en} <span className="aw-te">{v.te}</span></p>

        <div className="aw-career-stats">
          <Stat en="Rides" te="ట్రిప్పులు">{h.rides}</Stat>
          <Stat en="Best fare" te="గరిష్ట కిరాయి">{h.bestFare ? rs(h.bestFare) : '-'}</Stat>
          <Stat en="Rating" te="రేటింగ్">
            {stars > 0 ? (
              <span className="aw-career-stars">
                {[0, 1, 2, 3, 4].map((i) => <StarShape key={i} id={`hs-${i}`} size={15} fill={Math.max(0, Math.min(1, stars - i))} />)}
                <em>{stars.toFixed(1)}</em>
              </span>
            ) : '-'}
          </Stat>
          <Stat en="Hours" te="గంటలు">{h.hours}</Stat>
        </div>

        <div className="aw-career-lower">
        <div className="aw-career-notes">
          {h.rent && !h.rent.owned && (
            <p>
              {h.rent.owner} <span className="aw-te">{h.rent.ownerTe}</span> took {rs(h.rent.paid)} for the auto.
              {owedRent > 0 && <strong className="is-owed"> You still owe {rs(owedRent)}: it comes off tomorrow.</strong>}
            </p>
          )}
          {h.emi && (
            <p>
              Instalment {rs(h.emi.due)} {h.emi.paid ? 'paid' : 'MISSED'} <span className="aw-te">కిస్తీ</span>, {h.emi.left} to go.
              {h.emi.repossessed && <strong className="is-owed"> The bank took the auto back!</strong>}
              {h.emi.cleared && <strong className="is-ok"> Loan cleared: the auto is all yours!</strong>}
            </p>
          )}
          {repairCost > 0 && (
            <p>
              The auto needs {rs(repairCost)} of work at Mama’s Garage.{' '}
              <button type="button" data-nav className="aw-career-btn is-small" onClick={repair} disabled={snap.wallet < 50}>Quick fix</button>
            </p>
          )}
        </div>

        <div className="aw-career-side">
        {lad && (
          <div className="aw-career-ladder">
            {lad.owned ? (
              <p><b>Your own auto</b> <span className="aw-te">సొంత ఆటో</span>{lad.emi ? `: EMI ${rs(lad.emi.amount)} in ${lad.emi.daysToNext} day${lad.emi.daysToNext === 1 ? '' : 's'}, ${lad.emi.left} left` : ': the loan is cleared'}</p>
            ) : (
              <>
                <p><b>Save for your own auto</b> <span className="aw-te">సొంత ఆటో కోసం పొదుపు</span>: {rs(lad.savings)} of {rs(lad.downPayment)}</p>
                <span className="aw-career-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lad.progress * 100)}><i style={{ width: `${Math.round(lad.progress * 100)}%` }} /></span>
                {lad.canBuy ? (
                  <button type="button" data-nav className="aw-career-btn is-gold" onClick={buy}>BUY YOUR OWN AUTO ({rs(lad.downPayment)})</button>
                ) : (
                  lad.progress >= 1 && <small>{lad.reason}</small>
                )}
              </>
            )}
          </div>
        )}

        {bars.length > 1 && (
          <div className="aw-career-spark" role="img" aria-label="Net profit of recent days">
            {bars.map((b, i) => (
              <span key={`${b.day}-${i}`} className={b.loss ? 'is-loss' : ''} title={`Day ${b.day}: ${rs(b.net)}`}><i style={{ height: `${Math.max(6, Math.round(b.h * 100))}%` }} /></span>
            ))}
          </div>
        )}
        {h.best && <p className="aw-career-best">Best day so far: {rs(h.best.net)} net, {h.best.rides} rides</p>}
        </div>
        </div>
        </div>
        </div>

        <div className="aw-career-acts aw-sheet-bar">
          <button type="button" data-nav data-autofocus className="aw-career-btn is-primary" onClick={next}>{h.reason === 'day' ? 'NEXT DAY' : 'KEEP DRIVING'} <span className="aw-te">{h.reason === 'day' ? 'మరుసటి రోజు' : 'నడపండి'}</span></button>
          <button type="button" data-nav className="aw-career-btn" onClick={clockOut}>CLOCK OUT &amp; SAVE SCORE</button>
        </div>
      </div>
    </div>
  );
}

export default function Hisaab({ game, snap }) {
  if (!game || !snap?.career) return null;
  if (snap.menu === 'hisaab') return <HisaabPanel game={game} snap={snap} />;
  return null; // the always-visible job chip (demand, dents, tiredness + chai) lives in the HUD now: ui/hud/JobChip.jsx
}
