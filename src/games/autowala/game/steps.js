// Staged setup: the game is built by generators that `yield` between pieces of work, so the browser can paint, take input and stay responsive.
//   yield 'name'      a stage the loading bar shows: the page gets a full frame (paint) before the next piece
//   yield SLICE       a short break inside a stage (a macrotask, no frame wait): keeps every piece of main-thread work under ~50 ms
//   yield <promise>   wait for a long async job (the shader warm-up); the page stays responsive meanwhile
// `drain` runs a generator to the end synchronously (tests, scripts), `drainAsync` with breaks.

/** Yield this from a build function between two chunks of work (about every 20-40 ms): `yield SLICE;`. */
export const SLICE = Symbol('slice');

/** Run a staged generator to the end, synchronously. */
export function drain(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/** A paint-then-continue pause: lets the browser draw the progress bar between heavy stages. */
export const nextFrame = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

/** A short break: a new task (input and timers can run) without waiting for a frame. */
export const microBreak = () =>
  new Promise((resolve) => {
    if (typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });

/** Run a staged generator giving the browser a frame between stages: onStep(stageName, doneCount) is called before each stage. */
export async function drainAsync(gen, onStep, pause = nextFrame, micro = microBreak) {
  let n = 0;
  let r = gen.next();
  while (!r.done) {
    if (r.value === SLICE) {
      await micro();
    } else if (r.value && typeof r.value.then === 'function') {
      await r.value; // a long async job (the shader compile): the page stays responsive meanwhile
    } else {
      onStep?.(r.value, n++);
      await pause();
    }
    r = gen.next();
  }
  return r.value;
}

/**
 * Forward a stage's steps and record how long its pieces of synchronous work took (not the breaks between them):
 * `record.total` ms and `record.longest` ms (the longest single piece, i.e. the longest stall the stage causes).
 */
export function* timedSteps(gen, record = {}, now = () => performance.now()) {
  record.total = 0;
  record.longest = 0;
  for (;;) {
    const t = now();
    const r = gen.next();
    const d = now() - t;
    record.total += d;
    if (d > record.longest) record.longest = d;
    if (r.done) return r.value;
    yield r.value;
  }
}
