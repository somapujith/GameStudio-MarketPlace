// The job chip, top-left under the wallet: how busy the city is (as the fare multiplier customers really pay), today's earnings,
// the rent due, and two small bars: dents (the Garage fixes them) and tiredness with the chai button (Y key, D-pad down, tap).
// Reads snap.career through hudLogic.careerView; the chai itself is ctx.career.drinkChai() (which also owns the Y key).
import { memo, useEffect, useRef } from 'react';
import { ChaiIcon, WrenchIcon } from './icons.jsx';
import { groupIndian } from './hudLogic.js';

const rs = (n) => `Rs ${groupIndian(n)}`;

function Bar({ pct, tone, label }) {
  return (
    <span className={`aw-job__bar is-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <i style={{ transform: `scaleX(${(Math.max(pct, 3) / 100).toFixed(3)})` }} />
    </span>
  );
}

function JobChip({ game, view, hidden }) {
  const chaiNow = useRef(null);
  chaiNow.current = () => {
    const career = game?.ctx?.career;
    if (!career?.drinkChai) return;
    const res = career.drinkChai();
    if (res && !res.ok && res.reason) game.ctx.toast?.(res.reason, { tone: 'bad', ms: 2200 });
  };
  // gamepad: D-pad down (the pad's other buttons are taken by the input layer); polled at 10 Hz, only while the chip is visible
  useEffect(() => {
    if (hidden || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return undefined;
    let was = false;
    const id = setInterval(() => {
      const pads = navigator.getGamepads();
      let on = false;
      for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].buttons[13]?.pressed) on = true;
      if (on && !was) chaiNow.current();
      was = on;
    }, 100);
    return () => clearInterval(id);
  }, [hidden]);

  if (!view || hidden) return null;
  const { demand, chai, damage, fatigue } = view;
  return (
    <div className="aw-job" aria-label="Your job">
      {(demand.label || demand.show) && (
        <div className={`aw-job__row aw-job__demand${demand.peak ? ' is-peak' : ''}`} title="How busy the city is. Peak hours raise fares, up to x1.3">
          <b>{demand.label || 'Fares'}</b>
          {demand.te && <span className="aw-te">{demand.te}</span>}
          {demand.show && <em>x{demand.mult.toFixed(2).replace(/0$/, '')}</em>}
        </div>
      )}
      <div className="aw-job__row aw-job__money">
        <span>Today <b>{rs(view.earned)}</b></span>
        <span className={view.rent.due > 0 ? 'is-due' : ''}>
          {view.rent.owned ? 'EMI' : 'Rent'} <b>{view.rent.due > 0 ? rs(view.rent.due) : 'paid'}</b>
        </span>
      </div>
      <div className="aw-job__row aw-job__bars">
        {damage.show && (
          <span className={`aw-job__gauge is-${damage.tone}`} title={damage.repair > 0 ? `Dents. Mama's Garage repairs them for ${rs(damage.repair)}` : 'Dents'}>
            <WrenchIcon size={14} />
            <Bar pct={damage.pct} tone={damage.tone} label="Dents" />
          </span>
        )}
        <span className={`aw-job__gauge is-${fatigue.tone}`} title={fatigue.name ? `${fatigue.name} ${fatigue.te}` : 'Rested'}>
          <ChaiIcon size={14} />
          <Bar pct={fatigue.pct} tone={fatigue.tone} label="Tiredness" />
        </span>
        <button
          type="button"
          className={`aw-job__chai${chai.urgent ? ' is-urgent' : ''}`}
          disabled={!chai.canBuy}
          onClick={() => chaiNow.current()}
          aria-label={`Drink chai, ${rs(chai.price)}${chai.cooldown > 0 ? `, ready in ${chai.cooldown} seconds` : ''}`}
          title="Chai wakes you up (Y)"
        >
          <kbd>Y</kbd>
          <span>Chai</span>
          <small>{chai.cooldown > 0 ? `${chai.cooldown}s` : rs(chai.price)}</small>
        </button>
      </div>
    </div>
  );
}

export default memo(JobChip);
