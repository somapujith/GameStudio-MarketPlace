// The action runner: nobody teleports. Every interaction (cook / take / serve / collect / discard, and the operations layer's prep / collectPrep / tend /
// swapGas) is "walk, then work" (board and buy have no place to walk to: they act at once):
//   1. target = workTarget(action, state); `move {to}` is sent at once so teammates see the walk (coalesced: at most one per second,
//      the latest wish wins, so a burst of taps cannot eat the room's 40 messages / 5 s);
//   2. the local avatar's x is tracked with the SAME stepWalker the scene uses (from standX of the previous `at`), so the HUD knows
//      the moment the avatar arrives without any extra message;
//   3. on arrival the real action is dispatched (re-checked by `refine` first); the scene plays the work pose for WORK_MS, during
//      which a new walk may not start.
// One job at a time: a new tap REPLACES the pending one and the walk continues from the current x. Pure: time, dispatch and state
// come in as functions, so this is tested with a fake clock (actionRunner.test.js).
import { WORK_MS, standX, stepWalker, validTarget, workTarget } from '@shared/tiffin-centre/movement.js';
import { nextStop, pendingKeys, pendingLabel } from './hudLogic.js';

const MAX_DT = 0.25; // a hidden tab must not teleport the walker

export function createActionRunner({ now, dispatch, getState, meId, refine = (a) => a, minMoveMs = 1000, onArrive, onDrop, onRefused }) {
  let x = null; // metres along the line; null until first sync
  let expectedAt; // where we believe the engine has us (`at`)
  let seenAt; // the last `at` read from state
  let job = null; // { action|null, to }
  let workUntil = 0;
  let lastMoveAt = -Infinity;
  let lastMoveTo; // the last `to` actually sent
  let queuedMove; // a wish that was coalesced
  let lastT = null;
  const sent = []; // recent move targets we sent (to tell our own echoes from external changes)
  const listeners = new Set();
  let snap = { pending: null, walking: false, working: false };

  const me = () => getState()?.players?.[meId] || null;
  const valid = (to) => {
    const s = getState();
    // 'gas' (the LPG stand) is a legal place only on levels that have a cylinder
    return validTarget(to, s?.cfg?.stations, s?.cfg?.spots, !!s?.cfg?.gas);
  };

  function publish() {
    const state = getState();
    const pending = job && job.action ? { action: job.action, to: job.to, label: pendingLabel(job.action, job.to, state), keys: pendingKeys(job.action, job.to) } : null;
    const walking = !!job && x !== null && Math.abs(standX(job.to) - x) > 1e-6;
    const working = now() < workUntil;
    const same =
      snap.walking === walking && snap.working === working && ((snap.pending === null && pending === null) || (snap.pending && pending && snap.pending.action === pending.action && snap.pending.to === pending.to));
    if (same) return;
    snap = { pending, walking, working };
    listeners.forEach((fn) => fn(snap));
  }

  function sync() {
    const p = me();
    if (!p) return;
    const at = p.at ?? null;
    if (x === null) {
      x = standX(at);
      expectedAt = at;
      seenAt = at;
      return;
    }
    if (at !== seenAt) {
      seenAt = at;
      if (at !== expectedAt && !sent.includes(at) && !job) {
        x = standX(at); // an outside change (restart, a server correction): follow it
        expectedAt = at;
      }
    }
  }

  function sendMove(to) {
    const cur = lastMoveTo !== undefined ? lastMoveTo : me()?.at ?? null;
    if (to === cur && queuedMove === undefined) return;
    if (now() - lastMoveAt >= minMoveMs) {
      lastMoveAt = now();
      lastMoveTo = to;
      queuedMove = undefined;
      sent.push(to);
      if (sent.length > 6) sent.shift();
      dispatch({ type: 'move', to });
    } else {
      queuedMove = to;
    }
  }

  function flushMove() {
    if (queuedMove !== undefined && now() - lastMoveAt >= minMoveMs) {
      const to = queuedMove;
      queuedMove = undefined;
      if (to !== lastMoveTo) {
        lastMoveAt = now();
        lastMoveTo = to;
        sent.push(to);
        if (sent.length > 6) sent.shift();
        dispatch({ type: 'move', to });
      }
    }
  }

  function begin(action, to) {
    sync();
    job = { action, to };
    expectedAt = to;
    sendMove(to);
    publish();
  }

  function run(action) {
    const out = refine(action, getState());
    if (!out) {
      onDrop?.(action);
      return;
    }
    workUntil = now() + WORK_MS;
    if (dispatch(out) === false) onRefused?.(out);
  }

  const api = {
    /** Queue an action: walk to where it is done, then do it. Replaces whatever was queued. */
    request(action) {
      const state = getState();
      const to = workTarget(action, state);
      if (to === null || !valid(to)) {
        job = null;
        run(action);
        publish();
        return false;
      }
      begin(action, to);
      return true;
    },
    /** Just walk (keyboard). Replaces a queued action. */
    walkTo(to) {
      if (!valid(to)) return false;
      begin(null, to);
      return true;
    },
    /** Step to the next stop left (-1) or right (1). Holding the key keeps walking; it does not run far ahead of the avatar. */
    nudge(dir) {
      sync();
      if (x === null) return false;
      const state = getState();
      const base = job ? standX(job.to) : x;
      if (job && !job.action && Math.sign(base - x) === dir && Math.abs(base - x) > 0.8) return false;
      const stop = nextStop(state, base, dir);
      if (!stop) return false;
      return api.walkTo(stop.to);
    },
    /** Drop the queued ACTION but finish the walk already under way. */
    cancel() {
      if (job && job.action) {
        job = { action: null, to: job.to };
        publish();
      }
    },
    /** Advance the walker; call every frame while `busy()`, and on every state change. */
    update() {
      const t = now();
      const dt = lastT === null ? 0 : Math.min(MAX_DT, Math.max(0, (t - lastT) / 1000));
      lastT = t;
      sync();
      flushMove();
      if (job && t >= workUntil) {
        const r = stepWalker(x, standX(job.to), dt);
        x = r.x;
        if (r.arrived) {
          const j = job;
          job = null;
          if (j.action) run(j.action);
          onArrive?.({ at: j.to, action: j.action });
        }
      }
      publish();
    },
    busy: () => !!job || queuedMove !== undefined || now() < workUntil,
    x: () => {
      if (x === null) sync();
      return x ?? 0;
    },
    at: () => expectedAt ?? null,
    snapshot: () => snap,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}
