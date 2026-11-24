// The host's "how many seats?" control in the lobby: minus / count / plus. It sends the new number and shows it at once;
// the room's own answer (`value`) is the truth, and a refused change (silence or an error) rolls the display back.
// Not rendered for guests, or when the game has a single table size.
import { useEffect, useRef, useState } from 'react';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { seatLimits } from './lobbyModel.js';

const SETTLE = 2500; // ms: no answer from the room -> show what the room says again

export default function SeatStepper({ value, joined, min, max, disabled = false, onChange }) {
  const [pending, setPending] = useState(null);
  const timer = useRef(0);
  useEffect(() => {
    setPending(null); // the room answered (or changed on its own)
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const shown = pending ?? value;
  const { low, high, canLess, canMore, adjustable } = seatLimits({ joined, current: shown, min, max });
  if (!adjustable) return null;

  const set = (n) => {
    if (disabled || n < low || n > high || n === shown) return;
    setPending(n);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending(null), SETTLE);
    onChange(n);
  };

  return (
    <div className="cj-seatstep" role="group" aria-label="Seats at the table" data-tour="lobby-seat-count">
      <span className="cj-seatstep__label">Seats</span>
      <button type="button" className="cj-seatstep__btn" onClick={() => set(shown - 1)} disabled={disabled || !canLess} aria-label="One fewer seat">
        <HubIcon name="minus" size={16} />
      </button>
      <output className="cj-seatstep__val" aria-live="polite" aria-label={`${shown} seats`}>
        {shown}
      </output>
      <button type="button" className="cj-seatstep__btn" onClick={() => set(shown + 1)} disabled={disabled || !canMore} aria-label="One more seat">
        <HubIcon name="plus" size={16} />
      </button>
    </div>
  );
}
