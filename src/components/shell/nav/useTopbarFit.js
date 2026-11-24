import { useLayoutEffect } from 'react';

/** Highest "tightness" level the CSS knows (cine/shell.css: `.cj-nav__row[data-fit]`). */
export const MAX_FIT = 3;

/** The first level at which the bar fits; the last level when none does. `fits(level) -> boolean`. Pure. */
export function chooseFit(fits, max = MAX_FIT) {
  for (let level = 0; level <= max; level += 1) {
    if (fits(level)) return level;
  }
  return max;
}

/**
 * The nav row holds the logo and the glass pill (four destinations, search, code, coins, bells, avatar). Between
 * 900 and ~1100 px a big balance (1,11,50,000) or a second bell leaves too little room, so the pill tightens one level
 * at a time: 1 narrower destination labels, 2 no coin icon, 3 the tightest gaps (cine/shell.css). Phones show
 * only the logo and a small cluster, which always fits at level 0. Re-measured whenever the row or its contents change.
 */
export function useTopbarFit(ref) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const set = (level) => {
        if (level === 0) row.removeAttribute('data-fit');
        else row.setAttribute('data-fit', String(level));
      };
      const level = chooseFit((l) => {
        set(l);
        return row.scrollWidth <= row.clientWidth + 0.5;
      });
      set(level);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(row);
      row.querySelectorAll(':scope > *, .cj-nav__tools > *').forEach((el) => ro.observe(el));
    }
    window.addEventListener('resize', schedule);
    document.fonts?.ready?.then(schedule).catch(() => {});
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
