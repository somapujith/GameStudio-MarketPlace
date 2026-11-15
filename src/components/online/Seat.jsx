import { Avatar } from '@/components/art/index.js';
import { AvatarFrame, PieceArt, TitleChip } from '@/platform/game/art.jsx';
import SignalBars from '@/components/game/ui/SignalBars.jsx';
import { signalOf } from '@/components/game/ui/signalModel.js';
import { useNetStats } from '@/lib/netStats.js';
import '@/styles/store-rooms.css';

export function CrownIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor" />
    </svg>
  );
}

/**
 * A taken seat at the table. `player` = { id, name, avatar, connected, piece?, cosmetics? { frame?, title? } }.
 * `piece` = the player's piece `{ id, name }` from the game's manifest (null = none picked / the game has none).
 * `canRemove` shows the host's remove button; `leaving` plays the exit (the lobby keeps the seat for a beat).
 */
export default function Seat({ player, piece = null, isHost, isMe, canRemove, onRemove, color, leaving = false }) {
  const { name, avatar, connected } = player;
  const cos = (player.cosmetics && typeof player.cosmetics === 'object' && player.cosmetics) || {};
  const away = connected === false;
  const label = away ? 'Disconnected' : 'Connected';
  // Connection strength: the room's `net` for everybody else, your own live measurement for you ('none' on an older server)
  const sig = signalOf(player, { isMe, local: useNetStats() });
  return (
    <li
      className={`sr-seat${isMe ? ' is-me' : ''}${away ? ' is-away' : ''}${leaving ? ' is-leaving' : ''}`}
      style={color ? { '--sr-seat': color } : undefined}
      aria-hidden={leaving || undefined}
    >
      <span className="sr-seat__avatar">
        <AvatarFrame frame={cos.frame} size={58}>
          <Avatar preset={Number.isInteger(avatar) ? avatar : 0} size={54} />
        </AvatarFrame>
        <span className={`sr-seat__dot ${away ? 'is-off' : 'is-on'}`} role="img" aria-label={label} />
        {piece && (
          <span className="sr-seat__piece" title={piece.name}>
            <PieceArt piece={piece.id} color={color} size={24} />
            <span className="ho-sr">{`Piece: ${piece.name}`}</span>
          </span>
        )}
      </span>
      <span className="sr-seat__name" title={name || 'Player'}>
        {name || 'Player'}
      </span>
      {cos.title && (
        <span className="sr-seat__title">
          <TitleChip title={cos.title} />
        </span>
      )}
      <span className="sr-seat__tags">
        {isHost && (
          <span className="sr-tag sr-tag--host" title="Host">
            <CrownIcon size={13} /> Host
          </span>
        )}
        {isMe && <span className="sr-tag sr-tag--me">You</span>}
        {sig.kind !== 'none' ? <SignalBars {...sig} size="md" className="sr-seat__sig" /> : away && <span className="sr-seat__away">Offline</span>}
      </span>
      {canRemove && (
        <button type="button" className="sr-seat__remove" onClick={onRemove} aria-label={`Remove ${name} from the room`}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      )}
    </li>
  );
}

/** A seat nobody has taken yet: an invitation. With `onInvite` it is a button that takes you to the invite block. */
export function EmptySeat({ onInvite }) {
  const inner = (
    <>
      <span className="sr-seat__avatar sr-seat__avatar--empty" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="sr-seat__name">Open seat</span>
      <span className="sr-seat__wait">Waiting for player...</span>
      {onInvite && <span className="sr-seat__cta">Invite someone</span>}
    </>
  );
  return (
    <li className="sr-seat sr-seat--empty" aria-label="Open seat">
      {onInvite ? (
        <button type="button" className="sr-seat__invite" onClick={onInvite}>
          {inner}
        </button>
      ) : (
        <span className="sr-seat__invite">{inner}</span>
      )}
    </li>
  );
}
