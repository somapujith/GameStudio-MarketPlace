// Pure helpers for the "whose turn is it" highlight on the board's pawns (Pawn.jsx / PawnBeacon.jsx): the size of the
// active pawn, where its name tag sits (above it, or below it when the pawn is on the top row so the tag never leaves
// the board), what the tag says (YOU / first name / avatar or initial) and which ink reads on the player's colour.

import { cornerOf, sideOf } from '../fx/geometry.js';

/** How much bigger the player whose turn it is gets drawn (the phone discs are ~20px, so they grow more). */
export const HIGHLIGHT_SCALE = { desktop: 1.35, phone: 1.5 };
export const highlightScale = (disc) => (disc ? HIGHLIGHT_SCALE.phone : HIGHLIGHT_SCALE.desktop);

/** The gold-white of "that is you": the ring colour and the YOU tag. */
export const ME_GOLD = '#fff1b0';

/** Stack order of a pawn on the board: the active one above everything, the rest by their place in the crowd. */
export const pawnZ = ({ isTurn = false, slot = 0 } = {}) => (isTurn ? 30 : 10 + Math.max(0, slot | 0));

/**
 * Where the name tag of the pawn on tile `pos` goes. 'below' on the top row (tag above would stick out of the board),
 * otherwise 'above'. `h` shifts a wide tag inwards on the left / right columns so it stays on the board:
 * 'start' (tag grows to the right), 'end' (grows to the left) or 'center'. The tag's pointer keeps pointing at the pawn.
 */
export function tagPlacement(pos) {
  const corner = cornerOf(pos);
  const side = corner ? null : sideOf(pos);
  const top = corner ? corner === 'tl' || corner === 'tr' : side === 'top';
  const left = corner ? corner === 'tl' || corner === 'bl' : side === 'left';
  const right = corner ? corner === 'tr' || corner === 'br' : side === 'right';
  return { v: top ? 'below' : 'above', h: left ? 'start' : right ? 'end' : 'center' };
}

/** Horizontal anchor of the tag for a placement: where the pawn sits along the tag's width (0..1). */
export const TAG_ANCHOR = { start: 0.22, center: 0.5, end: 0.78 };
export const tagAnchor = (h) => TAG_ANCHOR[h] ?? 0.5;

/** The first word of a name, cut with an ellipsis past `max` characters ("Venkata" stays, "Subrahmanyeswara" is cut). */
export function firstName(name, max = 9) {
  const word = String(name ?? '').trim().split(/\s+/)[0] || '';
  const chars = Array.from(word);
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : word;
}

/** The first letter of a name, upper-cased ('?' for none). */
export function initialOf(name) {
  const c = Array.from(String(name ?? '').trim())[0];
  return c ? c.toLocaleUpperCase() : '?';
}

/**
 * What the tag shows. `disc` = the phone table (a small pin: the avatar when the player has one, else the initial).
 * kind: 'you' (it is me: the word YOU on both) | 'name' (desktop pill) | 'avatar' | 'initial'.
 */
export function tagLabel({ name = '', isMe = false, disc = false, hasAvatar = false } = {}) {
  if (isMe) return { kind: 'you', text: 'YOU' };
  if (!disc) return { kind: 'name', text: firstName(name) || 'Player' };
  return hasAvatar ? { kind: 'avatar', text: initialOf(name) } : { kind: 'initial', text: initialOf(name) };
}

const DARK_INK = '#1a1438';

/** '#rgb' / '#rrggbb' -> [r, g, b] (0..255), or null. */
function rgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Text colour that reads on a tag filled with `color`: white on the saturated colours, a dark ink on yellow / lime / cyan. */
export function inkOn(color) {
  const c = rgb(color);
  if (!c) return '#ffffff';
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.32 ? DARK_INK : '#ffffff';
}
