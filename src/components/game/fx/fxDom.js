// DOM plumbing for the effects overlay: finding where things are on screen, a node pool (effects reuse their elements
// instead of churning the DOM), and a follower that keeps a tile effect glued to its tile while the board camera
// moves. Nothing here touches React.

export const BANK = 'bank';

const esc = (v) => {
  const s = String(v);
  try {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  } catch {
    return s;
  }
};

/**
 * An endpoint that lives inside the zoomed board (the bank in the middle, a pawn) is only visible where the board
 * camera's viewport shows it: clip its box to that, or put it on the nearest visible spot, so coins never fly to a point
 * outside the board. Elements outside the camera (the pods) come back unchanged.
 */
export function visibleRect(r, view) {
  if (!view) return r;
  const left = Math.max(r.left, view.left);
  const top = Math.max(r.top, view.top);
  const right = Math.min(r.right ?? r.left + r.width, view.right ?? view.left + view.width);
  const bottom = Math.min(r.bottom ?? r.top + r.height, view.bottom ?? view.top + view.height);
  if (right - left >= 1 && bottom - top >= 1) return { left, top, width: right - left, height: bottom - top };
  const cx = Math.min(Math.max(r.left + r.width / 2, view.left + 4), (view.right ?? view.left + view.width) - 4);
  const cy = Math.min(Math.max(r.top + r.height / 2, view.top + 4), (view.bottom ?? view.top + view.height) - 4);
  return { left: cx - 4, top: cy - 4, width: 8, height: 8 };
}

/** True when two boxes (left/top/width/height) overlap by at least a pixel. */
export function overlaps(a, b) {
  return a.left < b.left + b.width - 1 && a.left + a.width > b.left + 1 && a.top < b.top + b.height - 1 && a.top + a.height > b.top + 1;
}

const boxOf = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** The camera viewport rect when the board is zoomed (its `data-lens` clip is on), else null. */
export function lensOf(el) {
  const vp = el && el.closest ? el.closest('[data-bc-viewport][data-lens]') : null;
  return vp ? boxOf(vp.getBoundingClientRect()) : null;
}

/** The first visible element for a player id / 'bank' -> { el, rect } or null. Rects are clipped to the camera lens. */
export function findEndpoint(who) {
  if (typeof document === 'undefined' || who === undefined || who === null) return null;
  const sels = who === BANK ? ['[data-fx-bank]'] : [`[data-fx-player="${esc(who)}"]`, `[data-fx-pawn="${esc(who)}"]`];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const lens = lensOf(el);
        return { el, rect: lens ? visibleRect(r, lens) : r };
      }
    }
  }
  return null;
}

/** A board tile's box on screen: { box, lens } (`lens` = the camera clip when zoomed), or null when it is not visible. */
export function tileBox(tile) {
  if (typeof document === 'undefined' || !Number.isInteger(tile)) return null;
  for (const el of document.querySelectorAll(`[data-fx-tile="${tile}"]`)) {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    const box = boxOf(r);
    const lens = lensOf(el);
    if (lens && !overlaps(box, lens)) return null; // scrolled out of the camera: nothing to show
    return { box, lens };
  }
  return null;
}

/** Keep an effect at least `pad` px inside the viewport. */
export function clampX(x, vw, pad = 8) {
  return Math.min(Math.max(x, pad), Math.max(pad, vw - pad));
}

// ---- node pool ---------------------------------------------------------------------------------------------------

/** Reset a pooled node so it can be reused: no animations, no inline style, no children, no leftover text. */
export function resetNode(el) {
  try {
    for (const a of el.getAnimations ? el.getAnimations() : []) a.cancel();
  } catch {
    /* ignore */
  }
  el.removeAttribute('style');
  if (el.firstChild) el.textContent = '';
}

/** A pool of span elements by class name: `acquire(cls)` hands out a reset node, `release(el)` takes it back. */
export function createPool(max = 64) {
  const free = new Map();
  let count = 0;
  return {
    acquire(cls, doc = document) {
      const list = free.get(cls);
      const el = list && list.pop();
      if (el) {
        count -= 1;
        return el;
      }
      const n = doc.createElement('span');
      n.className = cls;
      return n;
    },
    release(el) {
      if (!el) return;
      resetNode(el);
      el.remove();
      if (count >= max) return;
      const cls = el.className;
      const list = free.get(cls) || [];
      list.push(el);
      free.set(cls, list);
      count += 1;
    },
    size: () => count,
  };
}

// ---- follower ----------------------------------------------------------------------------------------------------

/**
 * One rAF loop that runs only while something is registered. `add(fn)` registers a measure function that is called
 * every frame and returns false when it is finished; the loop stops itself (and unregisters from rAF) when empty.
 */
export function createFollower(raf = (f) => requestAnimationFrame(f), caf = (id) => cancelAnimationFrame(id)) {
  const items = new Set();
  let id = 0;
  const tick = () => {
    id = 0;
    for (const fn of [...items]) {
      let keep = false;
      try {
        keep = fn() !== false;
      } catch {
        keep = false;
      }
      if (!keep) items.delete(fn);
    }
    if (items.size) id = raf(tick);
  };
  return {
    add(fn) {
      items.add(fn);
      if (!id) id = raf(tick);
    },
    stop() {
      items.clear();
      if (id) caf(id);
      id = 0;
    },
    size: () => items.size,
  };
}
