// Which of the engine's allowed actions the UI may show right now (pure, so it is unit-tested in node).
import { blankOptions } from '@/components/online/gameHelpers.js';

/**
 * `real` = getOptions(view, me) computed from the LATEST authoritative state (`session.view`), never from the
 * presenter's delayed `display`.
 *
 *  - offline or no options: everything blank
 *  - while the presenter animates or a request is in flight: everything blank, EXCEPT the Snatch buttons. The snatch
 *    window (view.phase === 'snatch') runs in real time, so the press must never wait for an animation.
 *  - otherwise the real options
 */
export function gateOptions(real, view, { busy = false, awaiting = false, connection = 'open' } = {}) {
  if (!real || connection !== 'open') return blankOptions(real);
  if (busy || awaiting) {
    const blank = blankOptions(real);
    // A trade is a conversation between players, not a move on the animated table: while the presenter is still playing, an
    // offer addressed to me can be answered and the trade sheet can be opened (the server judges the action, not the
    // animation). Only a request of mine still in flight blanks it.
    const trade = busy && !awaiting
      ? { trade: real.trade ?? blank.trade, tradeOffer: real.tradeOffer ?? null, tradeSent: real.tradeSent ?? null }
      : {};
    if (!view || view.phase !== 'snatch') return { ...blank, ...trade };
    return { ...blank, ...trade, snatch: real.snatch ?? null, snatched: real.snatched };
  }
  return real;
}
