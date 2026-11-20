// Open / close / remember state of one tour.
//
//   const tour = useTour('game', { autoStart: !tour.seen && ready });   // autoStart is read live: flip it to true when the screen is ready
//   <Tour tourId="game" steps={steps} open={tour.open} onClose={tour.close} onFinish={tour.finish} />
//   <TourHelpButton onClick={tour.start} />
//
// Finishing or skipping remembers the tour (markSeen). `close('later')` / `close('empty')` close without remembering
// ("Not now", or a tour that had nothing to show on this screen). Auto-start waits one frame so the targets exist.
//
// Who gets a tour BY ITSELF: only new players (see `canAutoStart` in tourState.js), and at most one per page load.
// `start()` is the explicit path (the "?" button, Menu, startTourById): it never asks.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '@/lib/auth.jsx';
import { canAutoStart, claimAuto, hasSeen, markSeen } from './tourState.js';

const NO_PERSIST = new Set(['later', 'empty']);

/** The user for the new-player check: `undefined` until the session has loaded (never auto-start on a guess). */
function useGateUser() {
  const auth = useContext(AuthContext);
  if (auth && auth.loading) return undefined;
  return (auth && auth.user) || null;
}

export function useTour(tourId, { autoStart = false } = {}) {
  const [seen, setSeen] = useState(() => hasSeen(tourId));
  const [open, setOpen] = useState(false);
  const tried = useRef(false); // auto-start fires at most once per mount / tourId
  const user = useGateUser();

  useEffect(() => { setSeen(hasSeen(tourId)); tried.current = false; }, [tourId]);

  const start = useCallback(() => { tried.current = true; setOpen(true); }, []);

  const close = useCallback((reason) => {
    setOpen(false);
    if (typeof reason === 'string' && NO_PERSIST.has(reason)) return;
    markSeen(tourId);
    setSeen(true);
  }, [tourId]);

  const finish = useCallback(() => {
    setOpen(false);
    markSeen(tourId);
    setSeen(true);
  }, [tourId]);

  useEffect(() => {
    if (!autoStart || seen || open || tried.current) return undefined;
    if (typeof requestAnimationFrame !== 'function') return undefined;
    const id = requestAnimationFrame(() => {
      if (tried.current || hasSeen(tourId)) return;
      if (!canAutoStart(user)) return; // a returning player is never toured by itself
      if (!claimAuto('page')) return; // one auto tour per page load
      tried.current = true;
      setOpen(true);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStart, seen, open, tourId, user]);

  return { seen, open, start, close, finish };
}
