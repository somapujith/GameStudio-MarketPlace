// One scene.project() pass per frame, shared by the head bubbles, the speech bubbles and the edge arrows. The first reader in a frame
// does the work (callbacks of one bus tick all get the same `t`), the rest read the cache.
import { customerTarget } from './hudLogic.js';
import { edgePlacement, fallbackSideFor, isOnScreen } from './offscreen.js';

/**
 * createProjector() -> { size: {w,h}, frame(t, scene, customers, { cookX, spotXOf }) -> Map, map, inView }
 * map: customer id -> { p: the raw projection, on: boolean, edge: { side, x, y } | null }.
 */
export function createProjector() {
  let lastT = Number.NaN;
  const map = new Map();
  const inView = new Set();
  const size = { w: 0, h: 0 };
  const pool = new Map(); // reusable `out` objects so a frame allocates nothing per customer
  return {
    size,
    map,
    inView,
    frame(t, scene, customers, { cookX = 0, spotXOf = () => 0 } = {}) {
      if (t === lastT) return map;
      lastT = t;
      map.clear();
      inView.clear();
      const w = size.w || (typeof window !== 'undefined' ? window.innerWidth : 0);
      const h = size.h || (typeof window !== 'undefined' ? window.innerHeight : 0);
      if (!scene?.project) return map;
      for (const c of customers || []) {
        let out = pool.get(c.id);
        if (!out) {
          out = { x: 0, y: 0, visible: false };
          pool.set(c.id, out);
        }
        let p = null;
        try {
          p = scene.project(customerTarget(c.id), out) || out;
        } catch {
          p = null;
        }
        const on = !!w && isOnScreen(p, w, h);
        if (on) inView.add(c.id);
        map.set(c.id, { p, on, edge: on ? null : edgePlacement(p, w, h, fallbackSideFor(spotXOf(c), cookX)) });
      }
      return map;
    },
  };
}
