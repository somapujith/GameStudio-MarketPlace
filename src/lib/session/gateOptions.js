// Which of the engine's allowed actions the UI may show right now (pure, so it is unit-tested in node).
import { blankOptions } from '@/components/online/gameHelpers.js';

/**
 * `real` = getOptions(view, me) computed from the LATEST authoritative state (`session.view`), never from the
 * presenter's delayed `display`.
 *
 *  - offline or no options: everything blank
 *  - while the presenter animates or a request is in flight: everything blank (nothing in the Hustle rules runs on a
 *    real-time window any more, so no action is exempt)
 *  - otherwise the real options
 */
// eslint-disable-next-line no-unused-vars
export function gateOptions(real, view, { busy = false, awaiting = false, connection = 'open' } = {}) {
  if (!real || connection !== 'open') return blankOptions(real);
  if (busy || awaiting) return blankOptions(real);
  return real;
}
