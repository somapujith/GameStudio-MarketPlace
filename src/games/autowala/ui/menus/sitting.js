// "This sitting": what the player did since they pressed START SHIFT (or since the last saved clock-out). It reads the live game
// (ctx.economy.session, ctx.clock, the profile's distance, the `fare:dropoff` events) and turns it into the numbers for the
// clock-out summary and the run API. Duck-typed on `game`, so it is unit-tested with a fake (sitting.test.js).
import { MAX_SECONDS, wholeNumber } from '../../gameplay/runApi.js';

export function createSitting(game, runs, { now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
  let base = null;
  let fares = 0;
  let bestFare = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  let tipsSeen = 0;

  const ctx = () => game.ctx;
  const capture = () => {
    const c = ctx();
    return {
      clock: Number(c.clock.time) || 0,
      wall: now(),
      earned: Number(c.economy.session.earned) || 0,
      tips: Number(c.economy.session.tips) || 0,
      distance: Number(c.profile.data.distance) || 0,
    };
  };

  const off = game.on((e) => {
    if (!base || e.type !== 'fare:dropoff') return;
    fares += 1;
    bestFare = Math.max(bestFare, wholeNumber(e.fare));
    tipsSeen += wholeNumber(e.tip);
    const r = Number(e.rating);
    if (Number.isFinite(r) && r > 0) {
      ratingSum += r;
      ratingCount += 1;
    }
  });

  return {
    /** Start counting from now and ask the server for a run token (never blocks, never throws). */
    begin({ signedIn = true } = {}) {
      base = capture();
      fares = 0;
      bestFare = 0;
      ratingSum = 0;
      ratingCount = 0;
      tipsSeen = 0;
      return signedIn ? runs.start() : Promise.resolve(runs.skipStart());
    },
    get started() {
      return !!base;
    },
    /** The sitting so far. `seconds` is whichever is smaller of the game clock and the real clock, capped at the server maximum. */
    stats() {
      const b = base || capture();
      const c = ctx();
      const cur = capture();
      const simSec = Math.max(0, cur.clock - b.clock);
      const wallSec = Math.max(0, (cur.wall - b.wall) / 1000);
      const profile = c.profile;
      return {
        earned: wholeNumber(cur.earned - b.earned),
        tips: wholeNumber(Math.max(cur.tips - b.tips, tipsSeen)),
        fares,
        distance: wholeNumber(cur.distance - b.distance),
        seconds: wholeNumber(Math.min(simSec, wallSec), MAX_SECONDS),
        bestFare,
        rating: ratingCount ? ratingSum / ratingCount : 0,
        lifetimeRating: typeof profile.rating === 'function' ? profile.rating() : 0,
        rides: wholeNumber(profile.data.rides),
        wallet: wholeNumber(profile.data.wallet),
      };
    },
    dispose() {
      off();
    },
  };
}

/** The numbers sent to the server from a stats object (quests / style are not used by Autowala yet). */
export const runStatsFrom = (s) => ({ earned: s.earned, seconds: s.seconds, distance: s.distance, fares: s.fares, quests: 0, style: 0 });

/** Metres -> '3.4 km' / '420 m' for the summary grid. */
export function summaryDistance(m) {
  const v = Math.max(0, Number(m) || 0);
  return v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`;
}

/** Seconds -> '12:05' / '1:02:09' play time. */
export function summaryTime(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = String(v % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
