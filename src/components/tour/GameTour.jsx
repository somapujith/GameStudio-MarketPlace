import { useMemo } from 'react';
import TourHost from './TourHost.jsx';
import { GAME_TOUR_ID, gameSteps } from './steps/gameSteps.js';

/** A live game's store page tour (one tour for every live game: the page is the same). */
export default function GameTour({ game }) {
  const steps = useMemo(() => gameSteps(game), [game]);
  return <TourHost tourId={GAME_TOUR_ID} steps={steps} slot="topbar" label="Tour of this page" />;
}
