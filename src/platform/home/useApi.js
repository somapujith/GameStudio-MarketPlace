// Small data hook for the hub screens. Never throws, never logs: a network failure becomes a status the
// UI renders ('offline' | 'auth' | 'error'). Results are cached briefly per user so going Home -> Rank ->
// Home does not flash skeletons.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';

const TTL_MS = 45_000;
const cache = new Map(); // `${uid}|${path}` -> { at, data }

function kindOf(e) {
  const s = Number(e?.status);
  if (s === 401 || s === 403) return 'auth';
  if (s === 0 || !Number.isFinite(s)) return 'offline';
  return 'error';
}

/**
 * True once the auth bootstrap finished and the Worker answered at least once. Public fetches wait for
 * this so a static dev server (no API) produces no extra failing requests.
 */
export function useApiReady() {
  const a = useAuth() || {};
  return !a.loading && a.reachable !== false;
}

/**
 * `{ status: 'idle'|'loading'|'ok'|'auth'|'offline'|'error', data, reload }`.
 * `enabled:false` -> 'idle'. Switching `path` resets to 'loading' (no stale rows under a new tab).
 * `fetcher(opts)` replaces the default `api.get(path, opts)` (e.g. a named helper from lib/api.js); `path` is then
 * only the cache key.
 */
export function useApi(path, { enabled = true, fetcher } = {}) {
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const auth = useAuth() || {};
  const uid = auth.user?.id ?? 'anon';
  const cacheKey = `${uid}|${path}`;
  const [state, setState] = useState(() => {
    const hit = cache.get(cacheKey);
    return hit && Date.now() - hit.at < TTL_MS ? { key: cacheKey, status: 'ok', data: hit.data } : { key: cacheKey, status: 'idle', data: null };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !path) return undefined;
    const hit = cache.get(cacheKey);
    const fresh = hit && Date.now() - hit.at < TTL_MS && nonce === 0;
    if (fresh) setState({ key: cacheKey, status: 'ok', data: hit.data });
    else setState((s) => (s.key === cacheKey && s.status === 'ok' ? s : { key: cacheKey, status: 'loading', data: null }));
    const ctrl = new AbortController();
    let alive = true;
    const opts = { signal: ctrl.signal, timeout: 10_000 };
    let p;
    try {
      p = Promise.resolve(fetchRef.current ? fetchRef.current(opts) : api.get(path, opts));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (data) => {
        cache.set(cacheKey, { at: Date.now(), data });
        if (alive) setState({ key: cacheKey, status: 'ok', data });
      },
      (e) => {
        if (alive) setState({ key: cacheKey, status: kindOf(e), data: null });
      },
    );
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [path, cacheKey, enabled, nonce]);

  const reload = useCallback(() => {
    cache.delete(cacheKey);
    setNonce((n) => n + 1);
  }, [cacheKey]);

  if (!enabled || !path) return { status: 'idle', data: null, reload };
  if (state.key !== cacheKey) return { status: 'loading', data: null, reload };
  return { status: state.status === 'idle' ? 'loading' : state.status, data: state.data, reload };
}

/**
 * `{ booting, ready, retry }`: `booting` while the auth bootstrap runs; `ready` once the Worker is known to answer;
 * `retry()` asks the auth layer to probe the Worker again (flips `ready` on when it answers).
 */
export function useApiGate() {
  const a = useAuth() || {};
  const booting = !!a.loading;
  const refresh = a.refresh;
  const retry = useCallback(() => {
    try {
      Promise.resolve(refresh && refresh()).catch(() => {});
    } catch {
      /* offline */
    }
  }, [refresh]);
  return { booting, ready: !booting && a.reachable !== false, retry };
}

/** Drop cached responses whose path starts with `prefix` (e.g. after a purchase changes `/api/shop`). */
export function invalidateApi(prefix) {
  for (const k of [...cache.keys()]) if (k.slice(k.indexOf('|') + 1).startsWith(prefix)) cache.delete(k);
}

function prefersReduced() {
  try {
    if (document.documentElement.dataset.motion === 'reduced') return true;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/**
 * A number that rolls from its previous value to `value` (ease-out, `ms` long). The first render shows the
 * value as is (no roll-up on page load unless `fromZero`); reduced motion jumps straight to the new value.
 */
export function useCountUp(value, { ms = 700, fromZero = false } = {}) {
  const target = Math.round(Number(value) || 0);
  const [shown, setShown] = useState(fromZero ? 0 : target);
  const cur = useRef(fromZero ? 0 : target);
  useEffect(() => {
    const from = cur.current;
    if (from === target || prefersReduced() || typeof requestAnimationFrame !== 'function') {
      cur.current = target;
      setShown(target);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
