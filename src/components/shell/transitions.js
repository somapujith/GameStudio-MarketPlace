// Route transitions with the View Transitions API (the THEME agent styles ::view-transition-old/new(root)).
//
//   const go = useViewTransitionNavigate();   go(paths.friends());   go(-1);   go(to, { replace, state });
//   <TransitionLink to=...>   (nav/TransitionLink.jsx) a react-router <Link> that navigates through go()
//   <ViewTransitionBridge />  mounted once inside the router (App.jsx): finishes a transition when the new route commits
//
// Robust by design: without `document.startViewTransition`, under reduced motion (OS or in-app setting), or when
// leaving / entering a game screen (/play/**), navigation is plain. A transition never holds a navigation back
// for more than a few hundred ms: if the new route has not committed by then (a slow lazy chunk), it finishes anyway.
import { useCallback, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { loadSettings } from '@/lib/storage.js';
import { isIos } from './install.js';
import { isGameRoute } from './theme.js';

const COMMIT_TIMEOUT_MS = 450; // max time the old snapshot stays frozen while the new route renders
const START_TIMEOUT_MS = 250; // if the browser never runs the update callback, navigate anyway

let pending = null; // resolve() of the transition waiting for the next route commit

function reducedMotion() {
  try {
    if (loadSettings().reducedMotion) return true;
  } catch {
    /* ignore */
  }
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function pathOf(to) {
  if (typeof to === 'string') return to.split(/[?#]/)[0];
  if (to && typeof to === 'object' && typeof to.pathname === 'string') return to.pathname;
  return null;
}

/**
 * Engine gate. iOS / iPadOS stay on plain navigation: the WebKit build available for testing hard-crashed the page
 * during a route view-transition at phone widths (a bare page was fine), and a cross-fade is not worth a crash.
 * Chrome on Android and desktop browsers keep the transition. Safari without the API never gets here anyway.
 */
export function engineAllowsViewTransition(ua, touchPoints) {
  return !isIos(ua, touchPoints);
}

/** True when a view transition should run for a navigation from `fromPath` to `to`. */
export function canViewTransition(fromPath, to) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false;
  if (!engineAllowsViewTransition()) return false;
  if (document.visibilityState === 'hidden') return false;
  if (document.documentElement?.dataset?.perf === 'low') return false; // slow renderer: a full-page snapshot cross-fade only adds a frozen frame
  if (isGameRoute(fromPath)) return false;
  const target = pathOf(to);
  if (target && isGameRoute(target)) return false;
  return !reducedMotion();
}

/** Runs `navigateFn` inside a view transition (or directly when not possible). Never throws, never drops it. */
export function startRouteTransition(navigateFn, { fromPath, to } = {}) {
  if (!canViewTransition(fromPath, to)) {
    navigateFn();
    return;
  }
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    navigateFn();
  };
  const startGuard = setTimeout(run, START_TIMEOUT_MS);
  try {
    pending?.(); // a newer navigation finishes the previous transition right away
    document.startViewTransition(
      () =>
        new Promise((resolve) => {
          clearTimeout(startGuard);
          const finish = () => {
            clearTimeout(t);
            if (pending === finish) pending = null;
            resolve();
          };
          const t = setTimeout(finish, COMMIT_TIMEOUT_MS);
          pending = finish;
          run();
        }),
    );
  } catch {
    clearTimeout(startGuard);
    run();
  }
}

/** Finishes the pending view transition once the new location has committed to the DOM. Render once in the router. */
export function ViewTransitionBridge() {
  const { key } = useLocation();
  useLayoutEffect(() => {
    if (pending) pending();
  }, [key]);
  return null;
}

/** `navigate` with a view transition when it is safe (see the file header). Same arguments as react-router's. */
export function useViewTransitionNavigate() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (to, opts) => {
      if (typeof to === 'number') {
        startRouteTransition(() => navigate(to), { fromPath: pathname, to: null });
        return;
      }
      startRouteTransition(() => navigate(to, opts), { fromPath: pathname, to });
    },
    [navigate, pathname],
  );
}
