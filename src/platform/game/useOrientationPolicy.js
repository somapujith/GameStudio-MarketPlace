// useOrientationPolicy(policy): is this device in the orientation the game wants? And, on a phone or tablet that wants landscape, do the
// platform's part of making it so: pin the screen sideways (Android: fullscreen + screen.orientation.lock on the first user gesture),
// stop the browser's own gestures (pull-to-refresh, pinch, long-press menu), freeze the page's animation-frame loops while it is upright
// (orientationFreeze.js), and undo all of it when the game screen goes away.
//
//   const o = useOrientationPolicy('landscape');
//   o.gated             true while a touch device is upright: cover the game, stop the loop (o.paused is the same value)
//   o.portrait          the window is portrait right now (hysteresis + keyboard aware, see orientationPolicy.js)
//   o.coarse            a finger is the main pointer (never true on desktop)
//   o.canLock           the browser can pin the orientation: show a "Tap to play in landscape" button
//   o.requestLandscape() call it from a tap: fullscreen + lock. Resolves true when pinned.
//
// <OrientationGate> is the component built on this; use the hook directly only for a custom screen.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { lockGestures } from '@/lib/mobile.js';
import { createOrientationController } from './orientationController.js';
import { frameFreezer, freezeDelayMs } from './orientationFreeze.js';
import { createLandscapeLock } from './orientationLock.js';
import { normalizePolicy } from './orientationPolicy.js';

/** `opts.win` replaces `window` (tests); `opts.lock` / `opts.gestures` / `opts.freezeFrames` = false switch the platform side effects off. */
export function useOrientationPolicy(policy = 'landscape', opts = {}) {
  const win = opts.win !== undefined ? opts.win : typeof window !== 'undefined' ? window : null;
  const pol = normalizePolicy(policy);
  const wantLock = opts.lock !== false;
  const wantGestures = opts.gestures !== false;
  const wantFreeze = opts.freezeFrames !== false;

  const [ctl] = useState(() => createOrientationController({ win, policy: pol }));
  useEffect(() => {
    ctl.setPolicy(pol);
  }, [ctl, pol]);
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);

  // ---- the platform side: only for a touch device and a policy that asks for a particular orientation --------------------------------
  const active = !!win && snap.coarse && pol === 'landscape';
  const lockRef = useRef(null);
  const [canLock, setCanLock] = useState(false);
  useEffect(() => {
    if (!active || !wantLock) {
      setCanLock(false);
      return undefined;
    }
    const lock = createLandscapeLock({ win });
    lockRef.current = lock;
    setCanLock(lock.supported());
    const cancel = lock.armFirstGesture(); // a player who already turned the phone gets it pinned there on their first tap
    return () => {
      cancel();
      lock.release(); // leaving the game: unlock, and exit the fullscreen this module entered
      lockRef.current = null;
    };
  }, [active, wantLock, win]);
  const requestLandscape = useCallback(() => (lockRef.current ? lockRef.current.request() : Promise.resolve(false)), []);

  // no pinch zoom, no double-tap zoom, no pull-to-refresh, no long-press menu on the page while the game screen is up (src/lib/mobile.js)
  useEffect(() => {
    if (!active || !wantGestures || !win || !win.document) return undefined;
    return lockGestures(win.document.documentElement);
  }, [active, wantGestures, win]);

  // While the gate is up, every animation-frame loop of the page stops (a game stops its own loop with useGamePaused(); this catches the
  // rest: minimaps, polls, count-ups). At once when the game has been on screen; after FREEZE_GRACE_MS when it was opened upright, because a
  // game opened upright keeps LOADING behind the screen (its start-up yields through requestAnimationFrame) and should be ready when the phone is turned.
  const seenLive = useRef(false);
  useEffect(() => {
    if (!snap.gated) seenLive.current = true;
  }, [snap.gated]);
  useEffect(() => {
    if (!snap.gated || !wantFreeze || !win) return undefined;
    let freezer = null;
    const engage = () => {
      freezer = frameFreezer(win);
      freezer.freeze();
    };
    const delay = freezeDelayMs(seenLive.current);
    const timer = delay ? setTimeout(engage, delay) : (engage(), 0);
    return () => {
      clearTimeout(timer);
      if (freezer) freezer.thaw(); // landscape again (or the screen is leaving): the queued frames run on the next real frame
    };
  }, [snap.gated, wantFreeze, win]);

  return useMemo(
    () => ({ policy: pol, gated: snap.gated, paused: snap.gated, portrait: snap.portrait, landscape: !snap.portrait, coarse: snap.coarse, keyboardOpen: snap.keyboardOpen, canLock, requestLandscape }),
    [pol, snap, canLock, requestLandscape],
  );
}

export default useOrientationPolicy;
