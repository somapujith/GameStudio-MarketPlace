import { Avatar } from '@/components/art/index.js';
import { AvatarFrame, PieceArt, TitleChip } from '@/platform/game/art.jsx';
import SignalBars from '@/components/game/ui/SignalBars.jsx';
import { signalOf } from '@/components/game/ui/signalModel.js';
import { useNetStats } from '@/lib/netStats.js';
import AddFriendButton from '@/platform/social/AddFriendButton.jsx';
import '@/styles/lobby-seats.css';

export function CrownIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor" />
    </svg>
  );
}

/** CSS custom properties that place a seat on the table ring (see seatLayout.js): { i, cx, cy, delay? (ms) }. */
function slotVars(slot) {
  if (!slot) return null;
  return { '--i': slot.i, '--cx': slot.cx, '--cy': slot.cy, '--lt-d': `${slot.delay || 0}ms` };
}

/**
 * A taken seat at the table. `player` = { id, name, avatar, connected, piece?, guest?, cosmetics? { frame?, title? } }.
 * `piece` = the player's piece `{ id, name }` from the game's manifest (null = none picked / the game has none);
 * `piecesOn` = the game has pieces, so a seat without one says "No piece yet" instead of showing nothing.
 * `canRemove` shows the host's remove button; `leaving` plays the exit (the lobby keeps the seat for a beat).
 * `friendable` = I may add friends (false for guest accounts); `slot` = { i, cx, cy, delay } when the table is a ring.
 */
export default function Seat({ player, piece = null, piecesOn = false, isHost, isMe, canRemove, onRemove, color, leaving = false, friendable = true, slot = null }) {
  const { name, avatar, connected } = player;
  const cos = (player.cosmetics && typeof player.cosmetics === 'object' && player.cosmetics) || {};
  const away = connected === false;
  const label = away ? 'Disconnected' : 'Connected';
  // Connection strength: the room's `net` for everybody else, your own live measurement for you ('none' on an older server)
  const sig = signalOf(player, { isMe, local: useNetStats() });
  const canFriend = friendable && !isMe && !player.guest && !leaving && player.id != null;
  const cls = ['lt-seat', isMe && 'is-me', isHost && 'is-host', away && 'is-away', leaving && 'is-leaving'].filter(Boolean).join(' ');
  return (
    <li className={cls} style={{ ...(color ? { '--lt-seat': color } : null), ...slotVars(slot) }} aria-hidden={leaving || undefined}>
      <span className="lt-seat__avatar">
        <AvatarFrame frame={cos.frame} size={56}>
          <Avatar preset={Number.isInteger(avatar) ? avatar : 0} size={52} />
        </AvatarFrame>
        <span className={`lt-seat__dot ${away ? 'is-off' : 'is-on'}`} role="img" aria-label={label} />
        {piece && (
          <span className="lt-seat__piece" title={piece.name}>
            <PieceArt piece={piece.id} color={color} size={18} />
            <span className="ho-sr">{`Piece: ${piece.name}`}</span>
          </span>
        )}
      </span>
      <span className="lt-seat__body">
        <span className="lt-seat__name" title={name || 'Player'}>
          {name || 'Player'}
        </span>
        {(piece || piecesOn) && (
          <span className={`lt-seat__pieceline${piece ? '' : ' is-none'}`} data-hook="sr-seat__pieceline" aria-hidden="true">
            <span>{piece ? piece.name : 'No piece yet'}</span>
          </span>
        )}
        {cos.title && (
          <span className="lt-seat__title">
            <TitleChip title={cos.title} />
          </span>
        )}
        <span className="lt-seat__tags">
          {isHost && (
            <span className="lt-tag lt-tag--host" title="Host">
              <CrownIcon size={12} /> Host
            </span>
          )}
          {isMe && <span className="lt-tag lt-tag--me">You</span>}
          {sig.kind !== 'none' ? <SignalBars {...sig} size="sm" className="lt-seat__sig" /> : away && <span className="lt-seat__away">Offline</span>}
        </span>
      </span>
      {(canRemove || canFriend) && (
        <span className="lt-seat__acts">
          {canRemove && (
            <button type="button" className="lt-seat__remove" onClick={onRemove} aria-label={`Remove ${name} from the room`}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          )}
          {canFriend && (
            <span className="lt-seat__friend">
              <AddFriendButton userId={player.id} name={name || 'Player'} compact />
            </span>
          )}
        </span>
      )}
    </li>
  );
}

/** A seat nobody has taken yet: an invitation. With `onInvite` it is a button that takes you to the invite block. */
export function EmptySeat({ onInvite, slot = null }) {
  const inner = (
    <>
      <span className="lt-seat__slot" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="lt-seat__body">
        <span className="lt-seat__name lt-seat__name--open">Open seat</span>
        <span className="lt-seat__cta">{onInvite ? 'Invite' : 'Waiting for player...'}</span>
      </span>
    </>
  );
  return (
    <li className="lt-seat lt-seat--empty" style={slotVars(slot) || undefined}>
      {onInvite ? (
        <button type="button" className="lt-seat__invite" onClick={onInvite} aria-label="Invite someone to this open seat">
          {inner}
        </button>
      ) : (
        <span className="lt-seat__invite">{inner}</span>
      )}
    </li>
  );
}
