// One page's tour, wired: remembers if it was seen, opens by itself on the first visit (once the screen is ready and nothing
// modal is open), opens on demand from the "?" button or from `startTourById(tourId)`, and renders the <Tour> layer.
//
//   <TourHost tourId="home" steps={homeSteps} ready={!loading} />
//
// props: `ready` (the screen has its content: no spinner, no error panel), `delay` (ms to let entrance animations settle),
// `auto` (false = only on demand), `help` (false = no "?" button), `slot` ('topbar' puts the button in the hub top bar's
// #tour-help-slot, 'inline' keeps it where the host sits, 'corner' floats it at the top right of the page), `label` (button text / aria label), `before()` (runs just before it opens).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tour } from './Tour.jsx';
import { TourHelpButton } from './TourHelpButton.jsx';
import { useTour } from './useTour.js';
import { modalOpen, onStartTour } from './tourEvents.js';
import '@/styles/tour-pages.css';

const RETRY_MS = 900; // a sheet or dialog is open: look again shortly
const MAX_RETRIES = 8;

export default function TourHost({ tourId, steps, ready = true, delay = 1200, auto = true, help = true, slot = 'inline', label = 'Take the tour', before }) {
  const [armed, setArmed] = useState(false);
  const [bar, setBar] = useState(null); // the top bar's slot element (slot='topbar')
  const tour = useTour(tourId, { autoStart: armed });
  const beforeRef = useRef(before);
  beforeRef.current = before;

  useLayoutEffect(() => {
    if (slot === 'topbar') setBar(document.getElementById('tour-help-slot'));
  }, [slot]);

  // arm the first-visit start: the screen is ready, the entrance has settled, nothing modal is on top
  useEffect(() => {
    if (!auto || !ready || tour.seen || tour.open) {
      setArmed(false);
      return undefined;
    }
    let tries = 0;
    let timer = setTimeout(function check() {
      if (document.visibilityState === 'hidden' || modalOpen()) {
        tries += 1;
        if (tries <= MAX_RETRIES) timer = setTimeout(check, RETRY_MS);
        return;
      }
      if (beforeRef.current) beforeRef.current();
      setArmed(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [auto, ready, delay, tour.seen, tour.open]);

  // "Take the tour" and startTourById(): also when it was seen before
  const { start } = tour;
  const begin = useCallback(() => {
    if (beforeRef.current) {
      beforeRef.current();
      setTimeout(start, 90); // let what `before` opened render first
    } else start();
  }, [start]);
  useEffect(() => onStartTour(tourId, begin), [tourId, begin]);

  const button = (
    <div className={`tourslot tourslot--${slot}`}>
      <TourHelpButton onClick={begin} label={label} />
    </div>
  );
  return (
    <>
      {help && ready && (slot === 'topbar' ? bar && createPortal(button, bar) : button)}
      <Tour tourId={tourId} steps={steps} open={tour.open} onClose={tour.close} onFinish={tour.finish} />
    </>
  );
}
