import HubIcon from '@/platform/game/HubIcon.jsx';
import { waitingText } from './lobbyModel.js';
import '@/styles/lobby-shell.css';

/**
 * The lobby's one primary action. The host sees "Start game" with the line that says what is still missing (or that
 * everybody is here); everyone else sees a calm "Waiting for <host>..." status. On phones it is a sticky bar at the
 * bottom of the screen (safe-area aware); from 960px it is the last card of the table zone.
 *
 * Props (supplied by pages/Lobby.jsx, state comes from lobbyModel.startState / startReason):
 *  isHost, canStart, starting, full, open  booleans (open = the socket is connected)
 *  reason      why Start is off right now ('' when it is on); help = the neutral line shown otherwise
 *  need        players still missing (guests' waiting text), hostName
 *  onStart()   host pressed Start
 *  onInvite()  optional: shows a secondary "Invite" button (host and guests) that opens the share sheet. Phones only:
 *              from 960px the invite panel is in view beside the table, so the button is hidden there.
 * Keeps the tour hook lobby-start.
 */
function InviteButton({ onInvite }) {
  return (
    <button type="button" className="ho-btn ho-btn--ghost ls-start__invite" onClick={onInvite} aria-label="Invite players">
      <HubIcon name="share" size={18} /> <span>Invite</span>
    </button>
  );
}

export default function StartBar({ isHost, canStart, starting, full, open, reason, help, need, hostName, onStart, onInvite }) {
  const ready = isHost && canStart;
  const cls = ['ls-start', ready ? 'is-ready' : '', full ? 'is-full' : '', starting ? 'is-starting' : '', isHost ? 'is-host' : 'is-guest'].filter(Boolean).join(' ');
  return (
    <section className={cls} aria-label="Start" data-tour="lobby-start">
      {isHost ? (
        <>
          <p id="ls-start-note" className={`ls-start__note${reason ? ' is-reason' : ''}`} aria-live="polite">
            {reason || help}
          </p>
          {onInvite && <InviteButton onInvite={onInvite} />}
          <button type="button" className="ho-btn ho-btn--primary ho-btn--lg ls-start__btn" onClick={onStart} disabled={!canStart} aria-describedby="ls-start-note">
            {ready && <span className="ls-start__ring" aria-hidden="true" />}
            {starting ? <span className="ho-spinner" aria-hidden="true" /> : <HubIcon name="play" size={18} />} {starting ? 'Starting...' : 'Start game'}
          </button>
        </>
      ) : (
        <>
          <p className="ls-start__wait" role="status" aria-live="polite">
            {open ? <i className="st-live" aria-hidden="true" /> : <span className="ho-spinner" aria-hidden="true" />}
            <span>{open ? waitingText({ need, hostName }) : 'Reconnecting to the room...'}</span>
          </p>
          {onInvite && <InviteButton onInvite={onInvite} />}
        </>
      )}
    </section>
  );
}
