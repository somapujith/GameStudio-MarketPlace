import { Avatar } from '@/components/art/index.js';
import { AvatarFrame, PieceArt, TitleChip } from '@/platform/game/art.jsx';
import '@/styles/online.css';

export function CrownIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor" />
    </svg>
  );
}

/**
 * A taken seat in the lobby. `player` = { id, name, avatar, connected, piece?, cosmetics? { frame?, title? } }.
 * `piece` = the player's piece `{ id, name }` from the game's manifest (null = none picked / the game has none).
 * `canRemove` shows the host's remove button.
 */
export default function Seat({ player, piece = null, isHost, isMe, canRemove, onRemove, color }) {
  const { name, avatar, connected } = player;
  const cos = (player.cosmetics && typeof player.cosmetics === 'object' && player.cosmetics) || {};
  const away = connected === false;
  const label = away ? 'Disconnected' : 'Connected';
  return (
    <li className={`ho-seat xl-seat${isMe ? ' is-me' : ''}${away ? ' is-away' : ''}`} style={color ? { '--ho-seat': color } : undefined}>
      <span className="ho-seat__avatar">
        <AvatarFrame frame={cos.frame} size={50}>
          <Avatar preset={Number.isInteger(avatar) ? avatar : 0} size={46} />
        </AvatarFrame>
        <span className={`ho-dot ho-seat__dot ${away ? 'is-off' : 'is-on'}`} role="img" aria-label={label} />
        {piece && (
          <span className="xl-seat__piece" title={piece.name}>
            <PieceArt piece={piece.id} color={color} size={24} />
            <span className="ho-sr">{`Piece: ${piece.name}`}</span>
          </span>
        )}
      </span>
      <span className="ho-seat__name" title={name || 'Player'}>
        {name || 'Player'}
      </span>
      {cos.title && (
        <span className="xl-seat__title">
          <TitleChip title={cos.title} />
        </span>
      )}
      <span className="ho-seat__tags">
        {isHost && (
          <span className="ho-tag ho-tag--host" title="Host">
            <CrownIcon size={13} /> Host
          </span>
        )}
        {isMe && <span className="ho-tag ho-tag--me">You</span>}
        {away && <span className="ho-seat__away">Reconnecting...</span>}
      </span>
      {canRemove && (
        <button type="button" className="ho-iconbtn ho-seat__remove" onClick={onRemove} aria-label={`Remove ${name} from the room`}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      )}
    </li>
  );
}

/** A seat nobody has taken yet. */
export function EmptySeat() {
  return (
    <li className="ho-seat ho-seat--empty" aria-label="Open seat">
      <span className="ho-seat__avatar ho-seat__avatar--empty" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="ho-seat__name ho-muted">Waiting for player...</span>
    </li>
  );
}
