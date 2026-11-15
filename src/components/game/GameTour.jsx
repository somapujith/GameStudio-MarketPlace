// The guided tour of the game table, and the safety rules around it (the server's decision timer never waits for a tour):
//   - the tour offers itself ONCE, as a small non-blocking card, while it is NOT my decision ("New here? Take a quick tour")
//   - while it runs and a decision becomes mine (my roll / buy / bid / Snatch / debt / trade answer), it shrinks to a
//     "Tour paused" pill at the top and the table is fully playable; Resume only works once my decision is done
//   - an auction / debt / Snatch window / trade of someone else's pauses it for as long as that lasts
//   - replay any time: the "?" button in the top bar (wide screens) or Menu > Take the tour
// const gameTour = useGameTour({ session, ready, phone });  ...  gameTour.start()  ...  {gameTour.node}
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tour, TourInvite, TourPausedPill } from '../tour/Tour.jsx';
import { useTour } from '../tour/useTour.js';
import { hasSeen, markSeen } from '../tour/tourState.js';
import {
  GAME_INVITE_ID, GAME_TOUR_ID, buildGameSteps, owesDecision, pauseState, tableBusy,
} from './gameTour.js';

const INVITE_MS = 20000; // the invite stays this long, then folds away (still offered by the ? button and the Menu)

export function useGameTour({ session, ready = true, phone = false }) {
  const cfg = session?.display?.cfg || session?.view?.cfg;
  const cfgKey = JSON.stringify(cfg || {});
  const me = session?.me;
  const steps = useMemo(() => buildGameSteps({ cfg: cfg || {}, me }), [cfgKey, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const tour = useTour(GAME_TOUR_ID);
  const [minimised, setMinimised] = useState(false);
  const [inviteDone, setInviteDone] = useState(() => hasSeen(GAME_INVITE_ID));

  const owes = !!ready && owesDecision(session);
  const busy = !!ready && tableBusy(session);
  const over = !!(session?.result || session?.view?.phase === 'over');
  const ps = pauseState({ open: tour.open, owes, busy, minimised });

  /* a decision became mine: step aside (sticky: I press Resume when I am done) */
  useEffect(() => { if (tour.open && owes) setMinimised(true); }, [tour.open, owes]);
  useEffect(() => { if (!tour.open) setMinimised(false); }, [tour.open]);
  /* the game ended: the tour has nothing left to say */
  useEffect(() => { if (over && tour.open) tour.close('later'); }, [over, tour.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const showInvite = !!ready && !over && !tour.open && !tour.seen && !inviteDone && !owes && !busy;
  const answerInvite = useCallback(() => { markSeen(GAME_INVITE_ID); setInviteDone(true); }, []);
  useEffect(() => {
    if (!showInvite) return undefined;
    const t = setTimeout(answerInvite, INVITE_MS);
    return () => clearTimeout(t);
  }, [showInvite, answerInvite]);

  const start = useCallback(() => { setMinimised(false); answerInvite(); tour.start(); }, [answerInvite, tour.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const node = (
    <>
      {showInvite ? (
        <TourInvite
          title="New here?"
          text="Take a quick tour of the table. It never stops your turn."
          onStart={start}
          onLater={answerInvite}
        />
      ) : null}
      {tour.open ? (
        <Tour
          tourId={GAME_TOUR_ID}
          steps={steps}
          open
          paused={ps.paused}
          phone={phone}
          onClose={tour.close}
          onFinish={tour.finish}
        />
      ) : null}
      {tour.open && ps.paused ? (
        <TourPausedPill
          text={ps.text}
          canResume={ps.canResume}
          onResume={() => setMinimised(false)}
          onSkip={() => tour.close('skip')}
        />
      ) : null}
    </>
  );

  return { start, node, open: tour.open };
}

export default useGameTour;
