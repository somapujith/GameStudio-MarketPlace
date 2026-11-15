// The AUTOMATIC board camera: what to look at, decided by pure functions (docs/MOBILE_CAMERA.md has the policy table
// with the reasoning). Nothing here touches the DOM or React.
//
//   situationOf(session, ctx)   the few facts the policy needs, read from what the session already exposes
//   cameraDirective(sit)        one situation -> the shot to take: { kind, tile, scale, reason }
//   createDirector()            the time layer on top: landing holds, the tail after a decision, the 500 ms minimum
//                               zoom-in hold and the 250 ms debounce between shots
//
// kinds: 'overview' (whole board), 'follow' (track the walking pawn), 'pan' (go straight to where a teleport / ride
// ends), 'land' (hold on the tile just landed on), 'decision' (my buy prompt), plus 'none' / 'off' (the automatic
// camera does not act: reduced motion, "pinch only", or the camera is switched off).

import { BOARD_SIZE } from '@shared/board.js';
import { ANIM_MS, LONG_TRIP } from '@shared/timing.js';
import { AUTO_MAX_SCALE } from './cameraMath.js';

export const CAMERA_MODES = Object.freeze(['auto', 'manual', 'off']);
export const cameraModeOf = (v) => (CAMERA_MODES.includes(v) ? v : 'auto');

export const CAMERA = Object.freeze({
  FOLLOW: 1.8, // walking pawn: tiles ~65 px on a phone, names readable
  FOLLOW_LONG: 1.4, // a trip over LONG_TRIP squares: keep some orientation
  LAND: 2.2, // the landed tile: the moment the deed matters
  DECISION: 2.0, // my buy prompt: the name and the price stay readable while deciding
  DEBOUNCE_MS: 250, // at most one shot change per this long
  MIN_HOLD_MS: 500, // a zoomed shot lasts at least this long before the camera goes back out
  GRACE_MS: 220, // a pawn that has just stopped is still followed this long: "land" arrives a beat after "stopped"
  LAND_PAD_MS: 450, // a landing is held for the presenter's `land` beat plus this long (time to read the name)
  QUICK_LAND: 0.7, // the presenter trims other players' landings by this much (usePresenter QUICK.land)
  TAIL_MS: 900, // after a decision (Buy) the frame stays while the purchase stamp plays (ANIM_MS.own is 1100)
  RESUME_MS: 8000, // manual control ends this long after the last touch
  // critically damped smoothing time per shot (seconds, at playback speed 1; ~95% of the way takes 2.4x this)
  SMOOTH_S: Object.freeze({ follow: 0.26, pan: 0.4, land: 0.3, decision: 0.3, overview: 0.4 }),
});

const playbackSpeed = (v) => (Number.isFinite(v) && v > 0 ? Math.min(2, Math.max(0.75, v)) : 1);

const isTile = (v) => Number.isInteger(v) && v >= 0 && v < BOARD_SIZE;

// ---- situation ---------------------------------------------------------------------------------------------------

/** Which overlay the player must be able to see the whole board for, or null. */
function overlayOf(session, d, view, quiet) {
  if (d.phase === 'over' || view?.phase === 'over' || session?.result) return 'over';
  if (session?.card) return 'card';
  if (session?.handoff) return 'turn';
  if (view?.phase === 'auction') return 'auction';
  if (view?.phase === 'debt' || d.debt) return 'debt';
  if (view?.trade || d.trade) return 'trade';
  if (quiet && session?.busy && session?.bubble?.type === 'city_event') return 'event';
  return null;
}

/**
 * The facts the policy decides on. `ctx`: { mode, reduced, speed, moveFrom, decisionCard } where `moveFrom` is the square
 * the pawn stood on before the move that is playing now (the caller tracks it; it only matters for the long-trip check)
 * and `decisionCard` says my buy prompt is shown as a card over the board (the portrait phone table's BuyCard), which
 * already carries the name and the price: zooming the board behind its scrim would only move things the player cannot see.
 */
export function situationOf(session, { mode = 'auto', reduced = false, speed = 1, moveFrom = null, decisionCard = false } = {}) {
  const view = session?.view || null;
  const d = session?.display || view || {};
  const players = d.players || view?.players || [];
  const turn = Number.isInteger(d.turn) ? d.turn : Number.isInteger(view?.turn) ? view.turn : 0;
  const actor = players[turn] || null;
  const mover = d.moving != null ? players.find((p) => p.id === d.moving) || null : null;
  const focus = mover || actor;
  const moving = !!mover && !mover.bankrupt && isTile(mover.pos);
  const landing = isTile(d.landing) ? d.landing : null;
  const viewMe = view?.players?.find?.((p) => p.id === focus?.id);
  const dest = isTile(viewMe?.pos) ? viewMe.pos : null;
  const tripLen = moving && isTile(moveFrom) && dest !== null ? (((dest - moveFrom) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE : 0;

  const o = session?.options || {};
  const pend = view?.pending;
  const decisionTile = !decisionCard && !session?.busy && (o.buy || (o.skipBuy && pend?.type === 'buy')) && isTile(pend?.tile) ? pend.tile : null;

  return {
    mode: cameraModeOf(mode),
    reduced: !!reduced,
    speed: playbackSpeed(speed),
    actor: actor ? actor.id : null,
    focus: focus ? focus.id : null,
    actorIsMe: !!actor && actor.id === session?.me,
    pos: isTile(focus?.pos) ? focus.pos : null,
    moving,
    motion: moving ? mover.motion || null : null,
    dest,
    tripLen,
    landing,
    busy: !!session?.busy,
    rolling: !!session?.rolling,
    decisionTile,
    overlay: overlayOf(session, d, view, !moving && landing === null),
    quick: !!actor && actor.id !== session?.me, // someone else's routine move: the presenter plays it trimmed
  };
}

/** A string that changes exactly when the policy's answer could change (the effect that runs the policy keys on it). */
export const situationKey = (s) =>
  [s.mode, s.reduced ? 1 : 0, s.speed, s.actor, s.focus, s.pos, s.moving ? 1 : 0, s.motion, s.dest, s.tripLen > LONG_TRIP ? 1 : 0, s.landing, s.busy ? 1 : 0, s.rolling ? 1 : 0, s.decisionTile, s.overlay, s.quick ? 1 : 0].join('|');

// ---- the policy table --------------------------------------------------------------------------------------------

const shot = (kind, tile, scale, reason) => ({ kind, tile, scale: Math.min(scale, AUTO_MAX_SCALE), reason });
const OVERVIEW = (reason) => ({ kind: 'overview', tile: null, scale: 1, reason });

/** One situation -> the shot to take right now (no timing: see createDirector). First matching row wins. */
export function cameraDirective(sit) {
  if (sit.mode === 'off') return { kind: 'off', tile: null, scale: 1, reason: 'setting-off' };
  if (sit.reduced) return { kind: 'none', tile: null, scale: 1, reason: 'reduced-motion' };
  if (sit.mode === 'manual') return { kind: 'none', tile: null, scale: 1, reason: 'manual' };
  if (sit.overlay) return OVERVIEW(`overlay:${sit.overlay}`);
  if (sit.rolling) return OVERVIEW('rolling');
  if (sit.moving && isTile(sit.pos)) {
    const long = sit.tripLen > LONG_TRIP;
    const scale = long ? CAMERA.FOLLOW_LONG : CAMERA.FOLLOW;
    if (sit.motion === 'teleport' || sit.motion === 'ride') return shot('pan', isTile(sit.dest) ? sit.dest : sit.pos, scale, sit.motion);
    return shot('follow', sit.pos, scale, long ? 'moving-long' : 'moving');
  }
  if (isTile(sit.landing)) return shot('land', sit.landing, CAMERA.LAND, 'landing');
  if (isTile(sit.decisionTile)) return shot('decision', sit.decisionTile, CAMERA.DECISION, 'decision');
  return OVERVIEW('idle');
}

const isZoomShot = (d) => d.kind === 'follow' || d.kind === 'pan' || d.kind === 'land' || d.kind === 'decision';

function sameShot(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'follow') return a.scale === b.scale; // the tile changes at every step: that is tracking, not a new shot
  if (!isZoomShot(a)) return true;
  return a.tile === b.tile && a.scale === b.scale;
}

/** How long a landing is held: the presenter's own `land` beat for that kind of move, plus time to read the name. */
export function landHoldMs(sit) {
  const beat = ANIM_MS.land * (sit.quick ? CAMERA.QUICK_LAND : 1);
  return (beat + CAMERA.LAND_PAD_MS) / playbackSpeed(sit.speed);
}

/** Critically damped smoothing time (seconds) for a shot, scaled by the playback speed like the other animations. */
export const smoothFor = (directive, speed = 1) => Math.max(0.1, (CAMERA.SMOOTH_S[directive.kind] ?? CAMERA.SMOOTH_S.overview) / playbackSpeed(speed));

// ---- the time layer ----------------------------------------------------------------------------------------------

/**
 * Stateful director. `update(sit, t)` (t in ms, any monotonic clock) returns `{ directive, recheckIn }`: the shot to be
 * in now and, when a change was deferred, how many ms to wait before asking again.
 *
 *  - a landing is held for `landHoldMs` however long the presenter's landing flag stays up afterwards
 *  - when my decision is made (the prompt goes away without an overlay taking over) the frame stays TAIL_MS
 *  - leaving a zoomed shot for the overview waits until it has lasted MIN_HOLD_MS
 *  - at most one change of shot per DEBOUNCE_MS (tracking a walking pawn is one shot, not a change per step)
 * Mode switches ('off' / 'none') apply at once.
 */
export function createDirector() {
  let cur = OVERVIEW('idle');
  let curSince = Number.NEGATIVE_INFINITY;
  let lastChange = Number.NEGATIVE_INFINITY;
  let landTile = null; // the tile being held
  let landUntil = 0;
  let flagTile = null; // the landing flag as last seen (a hold starts on its rising edge only)
  let tailUntil = 0;
  let tailOn = false;
  let idleSince = null; // when a walking / riding shot first had nothing to follow any more

  function update(sit, t) {
    const speed = playbackSpeed(sit.speed);
    const ms = (v) => v / speed;

    // 1. the landing hold: starts when the landing flag shows a new tile and runs for landHoldMs, whatever the flag
    //    does next (the presenter clears it as soon as its own beat is over: that is earlier than a name can be read)
    if (isTile(sit.landing) && sit.landing !== flagTile) {
      landTile = sit.landing;
      landUntil = t + landHoldMs(sit);
    }
    flagTile = isTile(sit.landing) ? sit.landing : null;
    const holding = landTile !== null && t < landUntil;
    if (!holding) landTile = null;
    let want = cameraDirective({ ...sit, landing: holding ? landTile : null });

    // 2. modes where the automatic camera does not act: no timing, no tail
    if (want.kind === 'off' || want.kind === 'none') {
      tailOn = false;
      cur = want;
      curSince = t;
      return { directive: want, recheckIn: null };
    }

    // 3. the tail after a decision: Buy / skip was pressed, nothing else has taken over yet
    if (cur.kind === 'decision' && want.kind === 'overview' && want.reason === 'idle') {
      if (!tailOn) {
        tailOn = true;
        tailUntil = t + ms(CAMERA.TAIL_MS);
      }
      if (t < tailUntil) want = cur;
      else tailOn = false;
    } else if (want.kind !== 'decision' || cur.kind !== 'decision') {
      tailOn = false;
    }

    // 4. the same shot: just keep tracking (the follow tile moves, the target is refreshed)
    if (sameShot(want, cur) && cur.kind !== 'none' && cur.kind !== 'off') {
      cur = want;
      return { directive: cur, recheckIn: tailOn ? Math.max(1, tailUntil - t) : holding ? Math.max(1, landUntil - t) : null };
    }

    // 5. a new shot: leaving a zoom waits for the minimum hold, every change waits for the debounce
    let at = t;
    if (isZoomShot(cur) && want.kind === 'overview') at = Math.max(at, curSince + ms(CAMERA.MIN_HOLD_MS));
    // the presenter drops "moving" a render before it raises "landing": a pawn that has just stopped is still the shot
    if ((cur.kind === 'follow' || cur.kind === 'pan') && want.kind === 'overview' && want.reason === 'idle') {
      if (idleSince === null) idleSince = t;
      at = Math.max(at, idleSince + ms(CAMERA.GRACE_MS));
    } else idleSince = null;
    at = Math.max(at, lastChange + ms(CAMERA.DEBOUNCE_MS));
    if (at > t) return { directive: cur, recheckIn: Math.ceil(at - t) };
    cur = want;
    curSince = t;
    lastChange = t;
    const next = holding ? landUntil - t : tailOn ? tailUntil - t : null;
    return { directive: cur, recheckIn: next !== null ? Math.max(1, Math.ceil(next)) : null };
  }

  function reset() {
    cur = OVERVIEW('idle');
    curSince = Number.NEGATIVE_INFINITY;
    lastChange = Number.NEGATIVE_INFINITY;
    landTile = null;
    flagTile = null;
    idleSince = null;
    landUntil = 0;
    tailUntil = 0;
    tailOn = false;
  }

  return { update, reset, current: () => cur };
}
