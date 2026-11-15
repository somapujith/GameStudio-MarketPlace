// The auction countdown: a ring that drains over cfg.auctionSeconds and turns red in the last 5 s. Hidden without a clock.
import { useNow } from '../turn/clock.js';
import { auctionClock } from './auctionModel.js';

const R = 19;
const C = 2 * Math.PI * R;

/** `info` is auctionClock(...) (null = nothing to show). Pure view: the parent owns the ticking (see useAuctionClock). */
export function RingView({ info, size = 48 }) {
  if (!info) return null;
  return (
    <span
      className={`hga-ring${info.urgent ? ' is-urgent' : ''}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${info.secs} seconds left to bid`}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="hga-ring-track" cx="24" cy="24" r={R} />
        <circle
          className="hga-ring-arc"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - info.frac)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <b>{info.secs}</b>
    </span>
  );
}

/** Ticks 4x a second while a deadline runs. */
export function useAuctionClock(clock, cfg, on = true, windowMs = null) {
  const running = on && Number(clock?.deadline) > 0;
  const now = useNow(running, 250);
  return running ? auctionClock(clock, now, cfg, windowMs) : null;
}

export default function AuctionRing({ clock, cfg, on = true, size, windowMs = null }) {
  const info = useAuctionClock(clock, cfg, on, windowMs);
  return <RingView info={info} size={size} />;
}
