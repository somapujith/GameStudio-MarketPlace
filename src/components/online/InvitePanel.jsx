import { useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import InviteFriends from '@/components/online/InviteFriends.jsx';
import { InviteTicket } from '@/components/online/ShareCard.jsx';
import ShareSheet from '@/components/online/ShareSheet.jsx';
import '@/styles/lobby-invite.css';

/**
 * The lobby's "Fill the table" panel. One obvious place, one obvious action:
 *   1. the invite ticket (always visible): the room code in large letters, Share invite, Copy code, WhatsApp
 *   2. below it, "Invite friends": the friends list (members) or a sign-in note (guests)
 *
 * Props: { code, gameName, isGuest, onNotify(message, tone), openSeats?, id, onShare?, hostName?, highlight? }
 *  - `id` is the DOM id the lobby scrolls to (default 'sr-invite').
 *  - `openSeats` (optional number) shows "N seats open" in the header.
 *  - `onShare()` opens the lobby's share sheet; without it the panel brings its own (hostName names the table in it).
 *  - `highlight` (a counter) plays the ticket's calm outline pulse.
 * Tour hooks: lobby-invite (the ticket) and lobby-friends (friends list or guest note).
 * Renders one root element so the page shell can place it in a sticky column.
 */
export default function InvitePanel({ code, gameName, isGuest, onNotify, openSeats, id = 'sr-invite', onShare, hostName, highlight = 0 }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const seatsLabel = Number.isFinite(openSeats) && openSeats > 0 ? `${openSeats} ${openSeats === 1 ? 'seat' : 'seats'} open` : null;

  return (
    <aside className="lp" id={id} aria-label="Fill the table" tabIndex={-1}>
      <header className="lp__head">
        <div className="lp__titles">
          <span className="st-eyebrow">Invite</span>
          <h2 className="lp__title">Fill the table</h2>
        </div>
        {seatsLabel && <span className="lp__seats">{seatsLabel}</span>}
      </header>

      <InviteTicket code={code} gameName={gameName} onNotify={onNotify} onShare={onShare || (() => setOwnOpen(true))} highlight={highlight} />

      <section className="lp-friendsec" data-tour="lobby-friends" aria-labelledby={`${id}-friends`}>
        <h3 className="lp-sub" id={`${id}-friends`}>
          Invite friends
        </h3>
        {isGuest ? (
          <p className="lp-note">
            Friends need an account. <Link to={paths.login(paths.lobby(code))}>Sign in with Google</Link> to invite them in one tap, or share the code above.
          </p>
        ) : (
          <InviteFriends code={code} gameName={gameName} onNotify={onNotify} />
        )}
      </section>

      {!onShare && <ShareSheet open={ownOpen} onClose={() => setOwnOpen(false)} code={code} gameName={gameName} hostName={hostName} onNotify={onNotify} />}
    </aside>
  );
}
