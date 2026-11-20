// A player's face in the sheets: their game piece (ART's PieceArt) when they have one, else their avatar, inside
// their equipped cosmetic frame (AvatarFrame) when one is known.
// Art parts are looked up by name at render time, so a build without them (or a strict test mock) still works.
import * as Art from '@/components/art/index.js';
import { pieceName } from './helpers.js';

const part = (name) => {
  try {
    return Art[name] || null;
  } catch {
    return null; // a strict test mock throws on unknown exports
  }
};

/**
 * Equipped cosmetics of a player ({ frame?, dice?, title? }) or null. Looked up in, in order:
 * `session.cosmetics[id]`, `session.room.players[i].cosmetics` (GameRoom `room` message), `player.cosmetics`.
 */
export function cosmeticsOf(session, player) {
  if (!player) return null;
  const id = String(player.id);
  const fromMap = session?.cosmetics?.[player.id] ?? session?.cosmetics?.[id];
  if (fromMap) return fromMap;
  const seat = session?.room?.players?.find?.((p) => String(p.id) === id);
  return seat?.cosmetics || player.cosmetics || null;
}

/** Ringed piece / avatar in the player's colour (`frame` = an equipped frame cosmetic id). */
export default function PlayerToken({ player, size = 32, ring = true, frame = null, className = '' }) {
  if (!player) return null;
  const PieceArt = player.piece ? part('PieceArt') : null;
  const Avatar = part('Avatar');
  const AvatarFrame = frame ? part('AvatarFrame') : null;
  const face = (s) => (PieceArt
    ? <PieceArt piece={player.piece} color={player.color} size={s} />
    : Avatar ? <Avatar preset={player.avatar} size={s} /> : null);
  return (
    <span
      className={`${ring && !AvatarFrame ? 'hg-pc-ring ' : ''}hg-token ${className}`}
      style={{ '--pc': player.color }}
      title={player.piece ? pieceName(player.piece) : undefined}
    >
      {AvatarFrame ? <AvatarFrame frame={frame} size={size}>{(inner) => face(inner)}</AvatarFrame> : face(size)}
    </span>
  );
}

/** The ART helper itself, for callers that need another art part (BuildingArt, CardBack, TitleChip ...). */
export const artPart = part;
