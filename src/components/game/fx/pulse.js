// A tiny bus for "look at this tile": the activity feed (and anything else) calls `pulseTile(id)`, the FxLayer
// draws a pulse ring on that tile of the board. No React state, nothing re-renders.

export const PULSE_EVENT = 'hg-fx-pulse';

/** Ask the board effects layer to pulse a ring on tile `tile`. Safe to call anywhere (no layer = nothing happens). */
export function pulseTile(tile, detail = null) {
  if (typeof window === 'undefined' || !Number.isInteger(tile)) return;
  try {
    window.dispatchEvent(new CustomEvent(PULSE_EVENT, { detail: { ...(detail || {}), tile } }));
  } catch {
    /* ignore */
  }
}

/** Subscribe to pulse requests; returns the unsubscribe function. */
export function onPulse(fn) {
  if (typeof window === 'undefined') return () => {};
  const h = (e) => fn(e.detail || {});
  window.addEventListener(PULSE_EVENT, h);
  return () => window.removeEventListener(PULSE_EVENT, h);
}
