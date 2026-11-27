// A tier change that never stalls. The governor (platform/gfx) decides WHEN; this decides how the change reaches the screen:
//   1. the new tier's shader programs (its light set: lamp count, shadows) are built in the background first (`warm`),
//   2. the swap itself (`apply`: renderer tier, world quality, draw distance) happens on a frame boundary, all at once,
//   3. the governor is told to ignore frames while it waits and for a moment after, so the warm-up's own slow frames are not read as load.
// Pure: the clock, the warm-up and the apply step are injected (switch.test.js drives it with fakes).

/**
 * @param {object} o
 * @param {(tier: string) => Promise<string>} o.warm   resolves 'done' | 'cached' | 'cancelled' (a newer request cancels the older one's warm-up)
 * @param {(tier: string, scale: number) => void} o.apply   swap to the tier at this governor scale (called from frame())
 * @param {(ms: number) => void} o.hold   governor.hold: ignore the next ms of frames
 * @param {() => string} o.getTier   the tier that is applied right now
 * @param {number} [o.maxWaitMs]   apply anyway after this long (a warm-up that never finishes must not strand the tier)
 * @param {number} [o.settleMs]   how long the governor ignores frames after a swap
 * @param {() => number} [o.now]
 */
export function createTierSwitch({ warm, apply, hold, getTier, maxWaitMs = 25000, settleMs = 1800, now = () => performance.now() }) {
  let pending = null; // { tier, scale, ready, since, id }
  let seq = 0;
  const stats = { requested: 0, applied: 0, cancelled: 0, forced: 0, waitedMs: 0, lastWaitMs: 0 };

  const start = (tier, scale) => {
    const id = ++seq;
    pending = { tier, scale, ready: false, since: now(), id };
    stats.requested++;
    let p;
    try {
      p = warm(tier);
    } catch {
      p = Promise.reject(new Error('warm failed'));
    }
    Promise.resolve(p).then(
      (r) => {
        if (pending && pending.id === id && r !== 'cancelled') pending.ready = true;
      },
      () => {
        if (pending && pending.id === id) pending.ready = true; // a failed warm-up: swap anyway, the programs build on first use (a hitch, not a stuck tier)
      },
    );
  };

  return {
    /** The governor changed its mind about the tier (or the scale that goes with it). */
    request(tier, scale = 1) {
      if (pending && pending.tier === tier) {
        pending.scale = scale; // same destination: only the scale moved
        return;
      }
      if (tier === getTier()) {
        // back to where we are: forget the trip. (The scale, if it differs, is applied by the caller through the ordinary scale path.)
        if (pending) {
          pending = null;
          stats.cancelled++;
        }
        apply(tier, scale);
        return;
      }
      if (pending) stats.cancelled++;
      start(tier, scale);
    },
    /** Call once at the top of every frame. Applies a finished swap; while one is pending keeps the governor quiet. Returns true on the frame it swapped. */
    frame() {
      if (!pending) return false;
      const waited = now() - pending.since;
      if (!pending.ready && waited < maxWaitMs) {
        hold(400);
        return false;
      }
      const { tier, scale } = pending;
      if (!pending.ready) stats.forced++;
      stats.lastWaitMs = waited;
      stats.waitedMs += waited;
      pending = null;
      apply(tier, scale);
      stats.applied++;
      hold(settleMs);
      return true;
    },
    /** Drop a pending swap (the game is leaving, or the player took over the tier). */
    cancel() {
      if (pending) stats.cancelled++;
      pending = null;
      seq++;
    },
    get pending() {
      return pending ? { tier: pending.tier, scale: pending.scale, ready: pending.ready } : null;
    },
    stats,
  };
}
