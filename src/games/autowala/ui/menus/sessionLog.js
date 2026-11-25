// A small log of what happened this visit (not saved): the last customers for the pause menu's BRIEF page, and the counters the
// STATS page shows that the economy does not keep (customers missed, fines). Listens to the event bus; duck-typed for tests.
import { wholeNumber } from '../../gameplay/runApi.js';

export const MAX_HISTORY = 8;

export function createSessionLog(game) {
  const log = { history: [], missed: 0, abandoned: 0, finesTotal: 0, fines: 0, escapes: 0, hits: 0, workshopBuys: 0 };

  const off = game.on((e) => {
    switch (e.type) {
      case 'fare:dropoff': {
        const t = e.trip && typeof e.trip === 'object' ? e.trip : {};
        log.history.unshift({
          name: String(t.name || 'Passenger').slice(0, 40),
          te: String(t.te || '').slice(0, 40),
          dest: String((t.dest && t.dest.name) || '').slice(0, 44),
          fare: wholeNumber(e.fare),
          tip: wholeNumber(e.tip),
          rating: Number.isFinite(Number(e.rating)) ? Math.max(0, Math.min(5, Number(e.rating))) : 0,
        });
        if (log.history.length > MAX_HISTORY) log.history.length = MAX_HISTORY;
        break;
      }
      case 'fare:missed':
        log.missed += 1;
        break;
      case 'fare:abandon':
        log.abandoned += 1;
        break;
      case 'rage:caught':
        log.fines += 1;
        log.finesTotal += wholeNumber(e.fine);
        break;
      case 'rage:escaped':
        log.escapes += 1;
        break;
      case 'traffic:hit':
        log.hits += 1;
        break;
      case 'workshop:buy':
        log.workshopBuys += 1;
        break;
      default:
    }
  });
  return { log, dispose: off };
}
