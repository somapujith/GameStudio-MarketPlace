// One canvas, one build. React's StrictMode (dev) mounts, unmounts and mounts again, so two builds start on the SAME canvas, i.e. the same GL
// context. The first is thrown away by its owner, but a staged build keeps running: it used to reach the end and call forceContextLoss() on the
// context the second build was drawing with (the "graphics card paused the game" screen, dev only). The newest build now claims the canvas and an
// older one stops at its next stage boundary, having created nothing that outlives it.
const claims = new WeakMap();

/** A fresh claim on `canvas`; any earlier claim on it is cancelled. `cleanup` (set by the build once it owns something) runs when it is abandoned. */
export function claimCanvas(canvas) {
  const older = claims.get(canvas);
  if (older) older.cancelled = true;
  const claim = { cancelled: false, cleanup: null };
  if (canvas && typeof canvas === 'object') claims.set(canvas, claim);
  return claim;
}

/** What an abandoned build resolves to: a game that does nothing (its owner calls dispose() on it, as it would on a real one). */
export const STALE = Object.freeze({ stale: true, start() {}, stop() {}, resize() {}, dispose() {} });

/** Run `gen` (a staged build) but stop at the first stage boundary after `claim` was cancelled: returns STALE then, the build's value otherwise. */
export function* abandonable(gen, claim) {
  let r = gen.next();
  while (!r.done) {
    yield r.value;
    if (claim.cancelled) {
      try {
        gen.return();
      } catch {
        /* nothing to unwind */
      }
      try {
        claim.cleanup?.();
      } catch {
        /* best effort */
      }
      return STALE;
    }
    r = gen.next();
  }
  return r.value;
}
