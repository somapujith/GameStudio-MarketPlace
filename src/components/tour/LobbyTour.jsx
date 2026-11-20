import TourHost from './TourHost.jsx';
import {
  LOBBY_GUEST_TOUR_ID,
  LOBBY_HOST_TOUR_ID,
  LOBBY_RULES_TOUR_ID,
  lobbyGuestSteps,
  lobbyHostSteps,
  lobbyRulesSteps,
} from './steps/lobbySteps.js';

/** The rule groups start collapsed on a phone: open them all so the rules tour can point at every row. */
function expandRuleGroups() {
  try {
    const btn = document.querySelector('.xl-rules__toggle:not([data-tour])');
    if (btn && /expand/i.test(btn.textContent || '')) btn.click();
  } catch {
    /* the tour then skips the rows it cannot find */
  }
}

/**
 * The lobby's tours. The host gets the table-setup tour (plus the optional "every rule, explained" walk-through, started from
 * the rules card); everyone else gets the shorter joiner tour. `ready` = the room payload is here and the socket is open.
 * The "?" button sits in the lobby's top bar (render this inside it).
 */
export default function LobbyTour({ isHost, ready }) {
  return (
    <>
      {isHost ? (
        <TourHost key="host" tourId={LOBBY_HOST_TOUR_ID} steps={lobbyHostSteps} ready={ready} slot="inline" label="Tour of the lobby" />
      ) : (
        <TourHost key="guest" tourId={LOBBY_GUEST_TOUR_ID} steps={lobbyGuestSteps} ready={ready} slot="inline" label="Tour of the lobby" />
      )}
      {isHost && <TourHost tourId={LOBBY_RULES_TOUR_ID} steps={lobbyRulesSteps} auto={false} help={false} before={expandRuleGroups} />}
    </>
  );
}
