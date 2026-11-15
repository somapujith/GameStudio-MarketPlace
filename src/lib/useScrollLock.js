import { useEffect } from 'react';
import { lockScroll } from './scrollLock.js';

/** Locks page scroll while `active` (modals, sheets). Reference counted and iOS safe, see scrollLock.js. */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    return lockScroll();
  }, [active]);
}

export default useScrollLock;
