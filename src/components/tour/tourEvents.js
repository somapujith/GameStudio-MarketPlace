// Small glue the page tours share: "start tour X now" from anywhere (a help button, the rules card, a settings row) and the
// checks that keep a first-visit tour from opening on top of something else. Pure DOM / window, no React.

export const START_EVENT = 'gh:tour-start';

/** Ask whichever <TourHost> owns `tourId` to open it now (also when it was seen before). */
export function startTourById(tourId) {
  if (typeof window === 'undefined' || !tourId) return;
  window.dispatchEvent(new CustomEvent(START_EVENT, { detail: { id: tourId } }));
}

/** Listen for `startTourById(tourId)`. Returns the unsubscribe function. */
export function onStartTour(tourId, fn) {
  if (typeof window === 'undefined') return () => {};
  const h = (e) => {
    if (e && e.detail && e.detail.id === tourId) fn();
  };
  window.addEventListener(START_EVENT, h);
  return () => window.removeEventListener(START_EVENT, h);
}

// A sheet / dialog / the command palette / a toast-less login is on screen: a first-run tour waits.
const BLOCKERS = '.hh-modal, .xs-pal, dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"]';

/** Is something modal on screen (not one of the tour's own layers)? */
export function modalOpen() {
  if (typeof document === 'undefined') return false;
  try {
    for (const el of document.querySelectorAll(BLOCKERS)) {
      if (el.closest('.tour-root, [data-tour-id]')) continue;
      if (el.getClientRects().length > 0) return true;
    }
  } catch {
    /* treat as not open */
  }
  return false;
}

