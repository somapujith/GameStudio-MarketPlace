// One requestAnimationFrame loop shared by every per-frame HUD piece (patience rings, cooking bars, world bubbles, the walker).
// Components add a callback; the loop runs only while somebody listens. Callbacks write to refs / style, never to React state.
export function createFrameBus({
  raf = (fn) => requestAnimationFrame(fn),
  caf = (id) => cancelAnimationFrame(id),
  now = () => performance.now(),
} = {}) {
  const subs = new Set();
  let id = 0;
  const loop = () => {
    id = 0;
    const t = now();
    for (const fn of [...subs]) fn(t);
    if (subs.size) id = raf(loop);
  };
  return {
    add(fn) {
      subs.add(fn);
      if (!id) id = raf(loop);
      return () => {
        subs.delete(fn);
        if (!subs.size && id) {
          caf(id);
          id = 0;
        }
      };
    },
    size: () => subs.size,
  };
}
