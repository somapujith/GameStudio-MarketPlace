// React glue for the HUD: the shared live-state box + frame bus (context), a per-frame hook, the money count-up and the action runner hook.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createActionRunner } from './actionRunner.js';
import { createFrameBus } from './frameBus.js';
import { easeCount, refineAction, tickFrac } from './hudLogic.js';

/** What the per-frame callbacks read: the latest state/tickAt/status (written by HudLayer on every render) and the tick fraction. */
export function createLive() {
  const live = {
    state: null,
    tickAt: 0,
    status: 'loading',
    meId: null,
    _t: -1,
    _v: 0,
    set(state, tickAt, status, meId) {
      if (live.state !== state) live._v = 0; // a fresh tick restarts the interpolation
      live.state = state;
      live.tickAt = tickAt;
      live.status = status;
      live.meId = meId;
    },
    /** Fraction of the current tick elapsed at `now` (memoised per frame; frozen while paused). */
    frac(now) {
      if (now === live._t) return live._v;
      live._t = now;
      live._v = tickFrac(now, live.tickAt, live.status, live._v);
      return live._v;
    },
  };
  return live;
}

export const HudContext = createContext(null);

/** Run `cb(now, frac, state)` every animation frame through the shared bus. `cb` may change between renders. */
export function useFrame(cb) {
  const ctx = useContext(HudContext);
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!ctx) return undefined;
    return ctx.bus.add((t) => ref.current(t, ctx.live.frac(t), ctx.live.state));
  }, [ctx]);
}

export function useHudBus() {
  return useMemo(() => ({ bus: createFrameBus(), live: createLive() }), []);
}

/** A rupee counter that eases toward `target` (snaps with `instant`, i.e. reduced motion). */
export function useCountUp(target, instant = false) {
  const [shown, setShown] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (instant || !Number.isFinite(target)) {
      cur.current = target;
      setShown(target);
      return undefined;
    }
    let raf = 0;
    let last = performance.now();
    const step = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      cur.current = easeCount(cur.current, target, dt);
      setShown(Math.round(cur.current));
      if (cur.current !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, instant]);
  return shown;
}

/**
 * The action runner of one session: `request(action)` walks the local avatar to where the work is done, then dispatches it.
 * Returns { runner, snap ({ pending, walking, working }), request, walkTo, nudge, cancel }. A rAF loop runs only while a job is live.
 * Options: selectedHandRef (ref to the selected hand index), onRefused(action), onDrop(action), onArrive({at, action}).
 */
export function useActionRunner(session, scene, { selectedHandRef, onRefused, onDrop, onArrive } = {}) {
  const cb = useRef({});
  cb.current = { onRefused, onDrop, onArrive };
  const kickRef = useRef(() => {});
  const runner = useMemo(
    () =>
      createActionRunner({
        now: () => performance.now(),
        getState: () => session?.state ?? null,
        meId: session?.meId,
        dispatch: (a) => (session?.dispatch ? session.dispatch(a) !== false : false),
        refine: (a, s) => refineAction(a, s, session?.meId, selectedHandRef?.current ?? 0),
        onArrive: (info) => {
          cb.current.onArrive?.(info);
          session?.tutorial?.notifyArrive?.(info);
        },
        onDrop: (a) => cb.current.onDrop?.(a),
        onRefused: (a) => cb.current.onRefused?.(a),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );
  const [snap, setSnap] = useState(() => runner.snapshot());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = 0;
      runner.update();
      if (runner.busy()) raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop);
    };
    kickRef.current = kick;
    const offRunner = runner.subscribe((s) => {
      setSnap(s);
      kick();
    });
    const offSession = session?.subscribe?.(() => {
      runner.update();
      if (runner.busy()) kick();
    });
    runner.update();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      offRunner();
      offSession?.();
    };
  }, [runner, session]);
  const wrap = useCallback(
    (fn) =>
      (...args) => {
        const r = fn(...args);
        kickRef.current();
        return r;
      },
    [],
  );
  return useMemo(
    () => ({
      runner,
      snap,
      request: wrap((a) => runner.request(a)),
      walkTo: wrap((to) => runner.walkTo(to)),
      nudge: wrap((d) => runner.nudge(d)),
      cancel: wrap(() => runner.cancel()),
    }),
    [runner, snap, wrap],
  );
}
