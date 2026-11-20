// The die must never roll by itself: a ROLL is only sent from a deliberate press that is not the tail of an earlier one.
//
//   noteRollOffer(on)   called every time the action spec changes: is a ROLL on offer right now (Roll, Roll again, Wait it out)?
//   rollAllowed()       may a ROLL leave the client now? false for ROLL_GUARD_MS after the offer APPEARED (a ghost click, a
//                       double tap or a key press aimed at the button that was there a moment ago: "End turn" -> "Roll", "Buy" ->
//                       "Roll again"), and for ROLL_REPEAT_MS after the last ROLL that did leave
//   guardAction(action) one call for every dispatch path (button, Space / Enter, tap on the die, shake, decision card):
//                       true = send it. Only ROLL is ever held back.
//
// One module-level state: there is only one game on screen. The clock is injectable for tests.
export const ROLL_GUARD_MS = 450; // after the Roll button appears (or changes under the finger) nothing rolls for this long
export const ROLL_REPEAT_MS = 1200; // after a roll was sent, the next one waits at least this long (the die takes longer to land)

let offered = false;
let armedAt = Number.NEGATIVE_INFINITY;
let sentAt = Number.NEGATIVE_INFINITY;
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export function noteRollOffer(on, now = nowMs()) {
  const next = !!on;
  if (next && !offered) armedAt = now; // the offer just appeared
  offered = next;
}

export function rollAllowed(now = nowMs()) {
  return now - armedAt >= ROLL_GUARD_MS && now - sentAt >= ROLL_REPEAT_MS;
}

/** true = let this action go out. A ROLL that passes is remembered (so a second one right behind it is dropped). */
export function guardAction(action, now = nowMs()) {
  if (!action || action.type !== 'ROLL') return true;
  if (!rollAllowed(now)) return false;
  sentAt = now;
  return true;
}

/** Does this spec (ActionBar.buildActionSpec) offer a ROLL anywhere (the Roll button or Traffic Jam's "Wait it out")? */
export function specOffersRoll(spec) {
  if (!spec) return false;
  if (spec.primary?.action?.type === 'ROLL') return true;
  return Array.isArray(spec.secondaries) && spec.secondaries.some((s) => s?.action?.type === 'ROLL');
}

/** Test helper: back to "nothing offered, nothing sent". */
export function resetRollGuard() {
  offered = false;
  armedAt = Number.NEGATIVE_INFINITY;
  sentAt = Number.NEGATIVE_INFINITY;
}
