import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { can, canAdminWrite } from '@/lib/adminApi.js';

/**
 * The console's session: `{ me: { role, name, permissions } | null, meError, can(perm), adminWrite, reloadMe }`.
 * `adminWrite` = the admin-only writes (events, seasons, payouts, achievement grants).
 * `me` is null until GET /api/admin/me answers, so every gated action starts hidden.
 */
export const AdminContext = createContext({ me: null, meError: null, can: () => false, adminWrite: false, reloadMe: () => {} });

export const useAdmin = () => useContext(AdminContext);

/** Build the context value from a `me` answer. */
export function adminValue(me, { meError = null, reloadMe = () => {} } = {}) {
  return { me, meError, can: (perm) => can(me, perm), adminWrite: canAdminWrite(me), reloadMe };
}

/**
 * Load data with an aborting fetcher: `const { data, error, loading, reload } = useLoad((signal) => getX({ signal }), [deps])`.
 * `initial` seeds `data` (tests, server render). A reload keeps the old data visible while it runs.
 */
export function useLoad(fetcher, deps, { initial, skip = false } = {}) {
  const [state, setState] = useState(() => ({ data: initial, error: null, loading: !skip && initial === undefined }));
  const [tick, setTick] = useState(0);
  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    if (skip) return undefined;
    const ctrl = new AbortController();
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => ref.current({ signal: ctrl.signal }))
      .then(
        (data) => live && setState({ data, error: null, loading: false }),
        (error) => live && setState((s) => ({ data: s.data, error, loading: false })),
      );
    return () => {
      live = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, skip]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** `value`, settled for `ms` (search boxes). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Calls `fn` every `ms` while the tab is visible; catches up immediately when it becomes visible again. */
export function useVisibleInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ms) return undefined;
    let timer = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (!document.hidden) ref.current?.();
      }, ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        ref.current?.();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
}

/** A ticking "now" so relative times stay fresh (every 30 s). */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
