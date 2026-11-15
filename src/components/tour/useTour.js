// Open / close / remember state of one tour.
//
//   const tour = useTour('game', { autoStart: !tour.seen && ready });   // autoStart is read live: flip it to true when the screen is ready
//   <Tour tourId="game" steps={steps} open={tour.open} onClose={tour.close} onFinish={tour.finish} />
//   <TourHelpButton onClick={tour.start} />
//
// Finishing or skipping remembers the tour (markSeen). `close('later')` / `close('empty')` close without remembering
// ("Not now", or a tour that had nothing to show on this screen). Auto-start waits one frame so the targets exist.
import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSeen, markSeen } from './tourState.js';

const NO_PERSIST = new Set(['later', 'empty']);

export function useTour(tourId, { autoStart = false } = {}) {
  const [seen, setSeen] = useState(() => hasSeen(tourId));
  const [open, setOpen] = useState(false);
  const tried = useRef(false); // auto-start fires at most once per mount / tourId

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
      tried.current = true;
      setOpen(true);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStart, seen, open, tourId]);

  return { seen, open, start, close, finish };
}
