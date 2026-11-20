// What the camera HUD says: the turn player and one short line, because the die and the status text in the middle of
// the board scroll out of view when the board is zoomed. Pure; the HUD itself is CameraHud.jsx.

import { TILES } from '@shared/board.js';

const firstName = (name) => String(name || 'Someone').trim().split(/\s+/)[0] || 'Someone';

/** A tile's printed name, short enough for a pill. */
export const tileLabelOf = (tile) => (Number.isInteger(tile) && TILES[tile] ? TILES[tile].name || TILES[tile].short || '' : '');

/**
 * -> { player, text, tile } for the HUD pill.
 *   "Sana is moving…" · "You are moving…" · "Landed on Madhapur" · "Buy Madhapur?" · "Sana is rolling…" · "Your turn" · "Sana's turn"
 * `player` is the display player the pill shows (the mover, else the turn player).
 */
export function hudModel(session) {
  const view = session?.view || null;
  const d = session?.display || view || {};
  const players = d.players || view?.players || [];
  const turn = Number.isInteger(d.turn) ? d.turn : Number.isInteger(view?.turn) ? view.turn : 0;
  const actor = players[turn] || null;
  const mover = d.moving != null ? players.find((p) => p.id === d.moving) || null : null;
  const player = mover || actor;
  if (!player) return { player: null, text: '', tile: null };

  const mine = player.id === session?.me;
  const who = mine ? 'You' : firstName(player.name);
  const landing = Number.isInteger(d.landing) ? d.landing : null;
  const o = session?.options || {};
  const pend = view?.pending;
  const buying = !session?.busy && (o.buy || (o.skipBuy && pend?.type === 'buy')) && Number.isInteger(pend?.tile) ? pend.tile : null;

  if (mover) return { player, text: `${who} ${mine ? 'are' : 'is'} moving…`, tile: null };
  if (landing !== null) return { player, text: `Landed on ${tileLabelOf(landing)}`, tile: landing };
  if (buying !== null) return { player, text: `Buy ${tileLabelOf(buying)}?`, tile: buying };
  if (session?.rolling) return { player, text: `${who} ${mine ? 'are' : 'is'} rolling…`, tile: null };
  return { player, text: mine ? 'Your turn' : `${who}${who.endsWith('s') ? "'" : "'s"} turn`, tile: null };
}

/** The line a screen reader hears when the camera zooms in or out ("Zoomed in on Madhapur" / "Board overview"). */
export const announceFor = (zoomed, tile) => (zoomed ? (tileLabelOf(tile) ? `Zoomed in on ${tileLabelOf(tile)}` : 'Zoomed in') : 'Board overview');
