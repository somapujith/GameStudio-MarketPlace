import { useEffect } from 'react';

const PREFIX = /^\(\d+\+?\)\s+/;

/** Pure: the title without a "(3) " count prefix. */
export function stripTitleCount(title) {
  return String(title ?? '').replace(PREFIX, '');
}

/** Pure: `title` with a "(n) " prefix while `total > 0` (99+ above the cap); the prefix never doubles up. */
export function titleWithCount(title, total) {
  const base = stripTitleCount(title);
  const n = Math.floor(Number(total));
  if (!Number.isFinite(n) || n <= 0) return base;
  return `(${n > 99 ? '99+' : n}) ${base}`;
}

/**
 * Shows "(2) Friends · Kingpin" in the tab title while `total > 0` and puts the plain title back afterwards.
 * Route changes and pages that set their own `document.title` are handled by watching the <title> element: any
 * new title gets the prefix again (setting an identical title is a no-op, so this cannot loop).
 */
export function useTitleCount(total) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const apply = () => {
      const next = titleWithCount(document.title, total);
      if (next !== document.title) document.title = next;
    };
    apply();
    let observer = null;
    const el = document.querySelector('title');
    if (el && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(apply);
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }
    return () => {
      observer?.disconnect();
      const plain = stripTitleCount(document.title);
      if (plain !== document.title) document.title = plain;
    };
  }, [total]);
}

export default useTitleCount;
