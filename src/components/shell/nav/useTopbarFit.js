import { useLayoutEffect } from 'react';

/** Highest "tightness" level the CSS knows (hub.css: `.hub-topbar__inner[data-fit]`). */
export const MAX_FIT = 3;

/** The first level at which the bar fits; the last level when none does. `fits(level) -> boolean`. Pure. */
export function chooseFit(fits, max = MAX_FIT) {
  for (let level = 0; level <= max; level += 1) {
    if (fits(level)) return level;
  }
  return max;
}

/**
 * The top bar holds a logo, the code button, the coin balance and the profile chip on one row. A big balance
 * (1,11,50,000) or a narrow phone leaves too little room, so the bar sheds the least useful bits one level at a time:
 * 1 wordmark, 2 the "Code" label, 3 the coin icon. Re-measured whenever the row's contents or width change.
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
      row.querySelectorAll(':scope > *').forEach((el) => ro.observe(el));
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
