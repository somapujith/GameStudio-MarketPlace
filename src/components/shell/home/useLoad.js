// Data hook for the home blocks that use the typed api.js calls (getMyRooms, getOpenRooms, getGamesLive).
// Never throws, never logs. Waits for the auth bootstrap and skips the request entirely when the Worker is
// unreachable (static dev), so an offline page makes no failing requests. Keeps a short per-user cache so
// coming back Home shows the last rows at once (revalidated in the background), and can poll while visible.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth.jsx';

const cache = new Map(); // `${uid}|${key}` -> { at, data }
const STALE_MS = 60_000;

function kindOf(e) {
  const s = Number(e?.status);
  if (s === 401 || s === 403) return 'auth';
  if (s === 0 || !Number.isFinite(s)) return 'offline';
  return 'error';
}

/**
 * `useLoad(key, fetcher, { enabled, pollMs })` -> { status: 'loading'|'ok'|'offline'|'auth'|'error'|'off', data, reload }.
 * 'off' = not enabled (e.g. signed out). `fetcher({ signal })` returns a promise (an api.js call).
 */
export function useLoad(key, fetcher, { enabled = true, pollMs = 0 } = {}) {
  const auth = useAuth() || {};
  const booting = !!auth.loading;
  const reachable = auth.reachable !== false;
  const uid = auth.user?.id ?? 'anon';
  const ck = `${uid}|${key}`;
  const run = enabled && !booting && reachable;

  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(() => {
    const hit = cache.get(ck);
    return hit && Date.now() - hit.at < STALE_MS ? { ck, status: 'ok', data: hit.data } : { ck, status: 'loading', data: null };
  });

  useEffect(() => {
    if (!run) return undefined;
    let alive = true;
    let ctrl = null;
    let timer = null;
    let seq = 0;

    const load = () => {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      const mine = ++seq;
      let p;
      try {
        p = Promise.resolve(fetchRef.current({ signal: ctrl.signal, timeout: 10_000 }));
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (data) => {
          if (mine !== seq) return;
          cache.set(ck, { at: Date.now(), data });
          if (alive) setState({ ck, status: 'ok', data });
        },
        (e) => {
          // An aborted request (superseded poll, unmount) rejects as "Offline": ignore it.
          if (!alive || mine !== seq) return;
          setState((s) => (s.ck === ck && s.status === 'ok' && kindOf(e) === 'error' ? s : { ck, status: kindOf(e), data: null }));
        },
      );
    };

    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < STALE_MS) setState((s) => (s.ck === ck && s.status === 'ok' ? s : { ck, status: 'ok', data: hit.data }));
    else setState((s) => (s.ck === ck && s.status === 'ok' ? s : { ck, status: 'loading', data: null }));
    load();

    const visible = () => typeof document === 'undefined' || !document.hidden;
    if (pollMs > 0) {
      timer = setInterval(() => {
        if (visible()) load();
      }, pollMs);
    }
    const onVis = () => {
      if (pollMs > 0 && visible()) load();
    };
    if (pollMs > 0 && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

    return () => {
      alive = false;
      if (ctrl) ctrl.abort();
      if (timer) clearInterval(timer);
      if (pollMs > 0 && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [run, ck, pollMs, nonce]);

  const reload = useCallback(() => {
    cache.delete(ck);
    setNonce((n) => n + 1);
  }, [ck]);

  if (!enabled) return { status: 'off', data: null, reload };
  if (booting) return { status: 'loading', data: null, reload };
  if (!reachable) return { status: 'offline', data: null, reload };
  if (state.ck !== ck) return { status: 'loading', data: null, reload };
  return { status: state.status, data: state.data, reload };
}

/** Drop cached rows (e.g. after joining / leaving a room). */
export function invalidateLoad(key) {
  for (const k of cache.keys()) if (k.endsWith(`|${key}`)) cache.delete(k);
}
