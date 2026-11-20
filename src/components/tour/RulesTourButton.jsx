import { startTourById } from './tourEvents.js';
import { LOBBY_RULES_TOUR_ID } from './steps/lobbySteps.js';

/** In the host's rules card: walks through every rule (LobbyTour owns the tour itself). */
export default function RulesTourButton() {
  return (
    <button type="button" className="xl-rules__toggle tourrules" data-tour="lobby-rules-tour" onClick={() => startTourById(LOBBY_RULES_TOUR_ID)}>
      Explain the rules
    </button>
  );
}
