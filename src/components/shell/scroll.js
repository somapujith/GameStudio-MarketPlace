// Scroll restoration for the hub: a new page (push / replace) starts at the top, Back and Forward return to where
// you were. Lazy routes render after the location changes, so a restore retries for a moment until the page is tall
// enough. Positions live in sessionStorage per history entry (`location.key`). Mount <ScrollManager /> once in the router.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const KEY = 'hub.scroll.v1';
const MAX_ENTRIES = 60;
const RETRY_MS = 700;

function readAll() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage blocked: Back simply lands at the top */
  }
}

/** Saved scroll offset for a history entry, or null. */
export function getSavedScroll(key) {
  const y = readAll()[key];
  return Number.isFinite(y) ? y : null;
}

export function saveScroll(key, y) {
  if (!key) return;
  const map = readAll();
  delete map[key]; // re-insert last so the oldest entries are trimmed first
  map[key] = Math.max(0, Math.round(y));
  writeAll(map);
}

/** `y` once the page is tall enough (or the time is up). Returns a cancel function. */
export function scrollWhenReady(y, { timeout = RETRY_MS } = {}) {
  if (typeof window === 'undefined') return () => {};
  const t0 = performance.now();
  let raf = 0;
  const step = () => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (room >= y - 1 || performance.now() - t0 > timeout) {
      window.scrollTo(0, Math.min(y, Math.max(0, room)));
      return;
    }
    window.scrollTo(0, Math.max(0, room));
    raf = requestAnimationFrame(step);
  };
  step();
  return () => cancelAnimationFrame(raf);
}

export function ScrollManager() {
  const { key, pathname, search, hash } = useLocation();
  const type = useNavigationType();
  const prev = useRef({ key: null, pathname: null, search: '' });

  useEffect(() => {
    try {
      window.history.scrollRestoration = 'manual';
    } catch {
      /* old engines */
    }
  }, []);

  // remember the offset of the entry we are leaving (and while scrolling, throttled by rAF)
  useEffect(() => {
    let raf = 0;
    const save = () => {
      raf = 0;
      saveScroll(prev.current.key, window.scrollY);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(save);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { key, pathname, search };
    if (before.key === null) {
      // first paint of the app: honour a reload's saved offset, else the top
      let reloaded = false;
      try {
        reloaded = ['reload', 'back_forward'].includes(performance.getEntriesByType('navigation')[0]?.type);
      } catch {
        /* no navigation timing */
      }
      const y = reloaded ? getSavedScroll(key) : null;
      if (y) return scrollWhenReady(y);
      if (!hash) window.scrollTo(0, 0);
      return undefined;
    }
    if (type === 'POP') {
      const y = getSavedScroll(key);
      return scrollWhenReady(y ?? 0);
    }
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return undefined;
      }
    }
    // same page with a new query (filters, search box): keep the offset; a different page, or the same link again, starts at the top
    if (before.pathname === pathname && before.search !== search) return undefined;
    window.scrollTo(0, 0);
    return undefined;
  }, [key, pathname, search, hash, type]);

  return null;
}

export default ScrollManager;
