// Target helpers for the page tours. A selector string is enough for most steps (the engine picks the first match that is
// on screen); these cover the "this or that, whichever is shown" cases.

/** `[data-tour="name"]` */
export const t = (name) => `[data-tour="${name}"]`;

/** `[data-rule="key"]`: one rule row of the lobby rules editor. */
export const rule = (key) => `[data-rule="${key}"]`;

/** True when the page has an element for `selector` (a `when()` for steps that only exist for some players). */
export const has = (selector) => () => {
  try {
    return typeof document !== 'undefined' && !!document.querySelector(selector);
  } catch {
    return false;
  }
};

/** Gentle first-sentence trim for copy built from rule help text (keeps cards short). */
export const firstSentences = (text, n = 2) => {
  const parts = String(text || '').match(/[^.!?]+[.!?]+(\s|$)/g);
  return parts ? parts.slice(0, n).join('').trim() : String(text || '').trim();
};

let kick = { id: '', n: 0, at: 0 };

/**
 * A target that is `selector`, nudging the page until it is on screen. For a control inside a sticky side panel that is taller
 * than the window (the game page's "Start a table" card on a short laptop screen): the engine's own scroll cannot move a stuck
 * element, so the page is scrolled on in small steps until it lets go. Only the step on screen (`stepId`) scrolls, a few times.
 */
export const reach = (selector, stepId) => {
  const find = () => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const card = document.querySelector('.tour-card');
    if (!card || card.dataset.step !== stepId) return el;
    const now = Date.now();
    if (kick.id !== stepId || now - kick.at > 4000) kick = { id: stepId, n: 0, at: 0 };
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 16);
    if (over > 0 && kick.n < 14 && now - kick.at > 160) {
      kick.n += 1;
      kick.at = now;
      window.scrollBy({ top: Math.min(over + 8, 420), behavior: 'instant' });
    }
    return el;
  };
  find.selector = selector; // for the tests that check every target still exists in the source
  return find;
};
