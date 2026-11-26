// The HUD snapshot (~10 Hz) is handed to React, and every new object re-renders everything that receives it. This keeps the objects
// the same when nothing changed:
//   - a part of the snapshot (the trip, the route, the rules...) that is equal to the previous one is the SAME object again, so a memoised
//     component given that part skips its render;
//   - when nothing the UI shows changed, nothing is published at all (a parked auto, a menu, the pause screen: React stays idle);
//   - the position keys (x, z, heading) change every frame while driving but no component reads them (the minimap reads game.ctx in its
//     own frame loop, see ARCHITECTURE.md), so on their own they never trigger a publish.

const QUIET = ['x', 'z', 'heading'];

/** Deep equality for the plain data of a snapshot (numbers, strings, booleans, null, arrays, objects). */
export function same(a, b, depth = 0) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || depth > 8) return false;
  const arr = Array.isArray(a);
  if (arr !== Array.isArray(b)) return false;
  if (arr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], depth + 1)) return false;
    return true;
  }
  let n = 0;
  for (const k in a) {
    if (!(k in b) || !same(a[k], b[k], depth + 1)) return false;
    n++;
  }
  let m = 0;
  for (const k in b) m++; // eslint-disable-line no-unused-vars
  return n === m;
}

/** `next` with every part that equals the same key of `prev` replaced by `prev`'s object (mutates and returns `next`). */
export function reuse(prev, next) {
  if (!prev) return next;
  for (const k of Object.keys(next)) if (same(prev[k], next[k])) next[k] = prev[k];
  return next;
}

/**
 * @param publish  called with the snapshot to render
 * @param quiet    keys whose changes alone are not worth a publish
 * @returns { push(snapshot): boolean (published?), last }
 */
export function createSnapshotPublisher(publish, { quiet = QUIET } = {}) {
  const skip = new Set(quiet);
  let last = null;
  return {
    push(next) {
      if (last) {
        let relevant = Object.keys(next).length !== Object.keys(last).length;
        if (!relevant) {
          for (const k of Object.keys(next)) {
            if (!skip.has(k) && !same(last[k], next[k])) {
              relevant = true;
              break;
            }
          }
        }
        if (!relevant) return false;
      }
      last = reuse(last, next);
      publish(last);
      return true;
    },
    get last() {
      return last;
    },
  };
}
