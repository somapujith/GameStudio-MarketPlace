// My bid: a big amount, - / + steppers (hold to repeat), a slider from the minimum to all my cash, quick chips, live advice
// (what I keep, what share of the price I pay, the collection I would complete), Place bid / Pass.
// Controlled by AuctionSheet: it owns `value`. No text input on purpose (a stepper + slider + chips never needs a keyboard).
import { useEffect, useRef } from 'react';
import { sfx } from '@/lib/sfx.js';
import { formatINR } from '@shared/format.js';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { bidAdvice, bidProblem, quickBids, setBadge, sliderModel, snapBid, stepFor } from './auctionModel.js';

/** A button that repeats `fn` while it is held (after a short delay); a keyboard activation fires once. */
function Stepper({ onStep, label, disabled, children }) {
  const timers = useRef({ delay: 0, tick: 0 });
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.tick);
  };
  useEffect(() => stop, []);
  const start = (e) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    onStep();
    stop();
    timers.current.delay = setTimeout(() => {
      timers.current.tick = setInterval(onStep, 90);
    }, 380);
  };
  return (
    <button
      type="button"
      className="hga-step"
      aria-label={label}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(e) => { if (e.detail === 0) onStep(); }}
    >
      {children}
    </button>
  );
}

/** Can I reach the minimum at all? (An older engine still lists a player who cannot afford it.) */
export const canBidAt = (min, cash) => cash >= min && cash > 0;

/** Place bid / Pass: lives in the sheet's footer so the primary action never scrolls away. */
export function BidActions({ min, cash, value, onBid, onPass, busy = false }) {
  const problem = bidProblem(value, { min, cash });
  if (!canBidAt(min, cash)) {
    return (
      <div className="hga-actions is-solo">
        <Button variant="dark" size="lg" disabled={busy} onClick={() => onPass()}>Pass</Button>
      </div>
    );
  }
  return (
    <div className="hga-actions">
      <Button variant="dark" size="lg" disabled={busy} onClick={() => onPass()}>Pass</Button>
      <Button variant="gold" size="lg" disabled={busy || !!problem} onClick={() => onBid(value)}>
        Place bid &middot; {formatINR(value)}
      </Button>
    </div>
  );
}

export default function BidControls({ min, cash, price, value, onValue, impact = null, error = '' }) {
  if (!canBidAt(min, cash)) {
    return (
      <div className="hga-form">
        <p className="hga-poor" role="status">
          <Icon name="info" size={18} />
          <span>You can&apos;t afford the minimum bid of {formatINR(min)}. You&apos;ll pass.</span>
        </p>
      </div>
    );
  }

  const step = stepFor(price);
  const slider = sliderModel(min, cash);
  const chips = quickBids({ min, max: cash, price });
  const advice = bidAdvice({ amount: value, cash, price });
  const problem = bidProblem(value, { min, cash });
  const badge = setBadge(impact);
  const idx = slider.toIndex(value);
  const pct = slider.n > 0 ? (idx / slider.n) * 100 : 100;
  const move = (delta) => onValue(snapBid(value + delta, min, cash, 1)); // exact steps; chips and the slider carry the round numbers

  return (
    <div className="hga-form">
      <div className="hga-amount" aria-live="polite">
        <span className="hga-amount-k">Your sealed bid</span>
        <output className="hga-amount-v">{formatINR(value)}</output>
        <span className="hga-amount-cash">of {formatINR(cash)} cash</span>
      </div>

      <div className="hga-row" role="group" aria-label="Adjust bid">
        <Stepper label={`Decrease by ${formatINR(step)}`} disabled={value <= min} onStep={() => move(-step)}>
          <Icon name="minus" size={22} />
        </Stepper>
        <input
          className="hg-range hga-range"
          type="range"
          min={0}
          max={slider.n}
          step={1}
          value={idx}
          disabled={slider.n === 0}
          onChange={(e) => onValue(slider.toAmount(Number(e.target.value)))}
          aria-label="Bid amount"
          aria-valuetext={formatINR(value)}
          style={{ '--pct': `${pct}%` }}
        />
        <Stepper label={`Increase by ${formatINR(step)}`} disabled={value >= cash} onStep={() => move(step)}>
          <Icon name="plus" size={22} />
        </Stepper>
      </div>

      <div className="hga-chips" role="group" aria-label="Quick bids">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`hga-qchip${c.amount === value ? ' is-on' : ''}`}
            onClick={() => {
              try { sfx.play('click'); } catch { /* optional */ }
              onValue(c.amount);
            }}
          >
            <span>{c.label}</span>
            <b>{formatINR(c.amount)}</b>
          </button>
        ))}
      </div>

      <div className="hga-advice">
        <p className={`hga-keep${advice.low ? ' is-low' : ''}`}>
          <Icon name={advice.low ? 'warn' : 'coin'} size={16} />
          <span>{advice.keepText}</span>
        </p>
        {advice.priceText ? <p className={`hga-price is-${advice.deal}`}>{advice.priceText}</p> : null}
        {badge ? (
          <p className={`hga-badge is-${badge.tone}`} style={impact?.color ? { '--set': impact.color } : undefined}>
            <Icon name={badge.tone === 'complete' ? 'spark' : badge.tone === 'block' ? 'flag' : 'check'} size={15} />
            <span>{badge.text}</span>
          </p>
        ) : null}
      </div>

      {problem || error ? <p className="hga-error" role="alert" aria-live="assertive">{problem || error}</p> : null}
    </div>
  );
}
