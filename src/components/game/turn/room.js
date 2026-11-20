// Room-level data for the table (presence, pieces, cosmetics) and the game mode labels.
// `session.roomPlayers` = the `{t:'room'}` players: { id, name, connected, piece, cosmetics: { frame?, dice?, title? } }.
import { targetOf, targetRuleText, targetSummary } from './target.js';
export { AvatarFrame, TitleChip } from '@/components/art/cosmetics.jsx';

export function roomPlayer(session, id) {
  const list = session?.roomPlayers;
  if (!Array.isArray(list) || id == null) return null;
  return list.find((p) => String(p.id) === String(id)) || null;
}

/** False only when the room says the player is offline (unknown = online). */
export function isConnected(session, id) {
  const rp = roomPlayer(session, id);
  return !(rp && rp.connected === false);
}

export const cosmeticsOf = (session, id) => session?.cosmetics?.[String(id)] || roomPlayer(session, id)?.cosmetics || {};

export const MODE_LABELS = {
  standard: 'Standard City Hustle',
  quick: 'Quick Chai Break',
  classic: 'Classic Long Game',
};

export const modeLabel = (cfg) => MODE_LABELS[cfg?.mode] || (Number.isFinite(cfg?.maxRounds) ? 'City Hustle' : 'Classic Long Game');

/** One line for the menu / scoreboard: "Standard City Hustle · 20 rounds · First to ₹50L · Lucky die" (the target only when set; classic: "No round limit · First to ₹30L"). */
export function tableSummary(cfg) {
  const c = cfg || {};
  const parts = [modeLabel(c)];
  const goal = targetSummary(c);
  // no round limit (classic): the target ends the game, so say so; without one only the last player standing does
  parts.push(Number.isFinite(c.maxRounds) ? `${c.maxRounds} rounds` : goal ? 'No round limit' : 'Until one is left');
  if (goal) parts.push(goal);
  parts.push((c.dice ?? 'lucky') === 'fair' ? 'Fair die' : 'Lucky die');
  return parts.join(' · ');
}

export const WIN_RULE_TEXT =
  'One round = every player plays once (a six rolls again but stays the same turn). The last player standing wins, or the highest net worth when the last round ends.';

/** WIN_RULE_TEXT plus the net worth target sentence when the table has one. */
export function winRuleText(cfg) {
  const t = targetOf(cfg);
  return t ? `${WIN_RULE_TEXT} ${targetRuleText(t)}` : WIN_RULE_TEXT;
}
