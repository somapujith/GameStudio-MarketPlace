// Board themes: which look the LOCAL player's own board wears. Cosmetic only and local: nothing is synced, the rules, tile
// names and map never change. Pure helpers (no React) so the lookup is testable on its own; GameView writes the result on
// the `.hg-game` root as `data-board-theme`, and styles/board-themes.css keys every rule on it.
import { FINISHES, cosmeticById } from '@shared/cosmetics.js';
import { cosmeticsOf } from './turn/room.js';

/** A cosmetic id -> its board finish ('bazaar' | 'lake' | ... | 'goldleaf'), or null for none / unknown / not a board item. */
export function boardThemeFinish(id) {
  if (typeof id !== 'string' || !id) return null;
  const item = cosmeticById(id);
  if (!item || item.kind !== 'board') return null;
  return FINISHES.board.includes(item.finish) ? item.finish : null;
}

/** The finish of the board theme the local player (`session.me`) has equipped at this table, or null. */
export function equippedBoardTheme(session) {
  const me = session?.me;
  if (me == null || me === '') return null;
  return boardThemeFinish(cosmeticsOf(session, me)?.board);
}
