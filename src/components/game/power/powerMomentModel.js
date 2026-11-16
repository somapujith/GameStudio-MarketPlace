// The pure model of the power-card moments (docs/POWER_CARDS.md 3.3), tested in powerMoment.test.js. `session.power` (the
// presenter's current moment: see usePresenter.js) -> what PowerMoments shows: the words, the card, the tiles to pulse and
// the geometry of a flight. No React, no DOM: the component measures the screen and feeds the numbers in.
import { formatINR } from '@shared/format.js';
import * as PC from '@shared/powerCards.js';
import { playerName, powerName } from '@/lib/messages.js';

export const POWER_KINDS = Object.freeze(['draw', 'play', 'shield', 'double', 'expire']);

/** Card colour per tone (never the only cue: the name and the art say it too). Same family as the guide and the tray. */
export const TONE_COLOR = Object.freeze({ blue: '#4cc9f0', gold: '#ffc857', teal: '#3ddc97', violet: '#b794f6' });

/** One card's metadata + colour, or null for an unknown id (read defensively: the shared file is the engine's). */
export function cardMeta(id) {
  const c = typeof PC.powerCardById === 'function' ? PC.powerCardById(id) : null;
  return c ? { id: c.id, name: c.name, tone: c.tone, short: c.short, color: TONE_COLOR[c.tone] || TONE_COLOR.gold } : null;
}

const isMe = (ctx, id) => id !== null && id !== undefined && id === ctx.me;
const posOf = (ctx, id) => {
  const p = (ctx.players || []).find((x) => x && x.id === id);
  return p && Number.isInteger(p.pos) ? p.pos : null;
};
const possessive = (ctx, id) => (isMe(ctx, id) ? 'Your' : `${playerName(ctx, id)}'s`);

/**
 * The view of one moment, or null when there is none (or it is junk).
 *   { kind, id, player, ms, sr, ... } and per kind:
 *   draw    { faceUp, card, from (tile|null), label, kicker }   faceUp only for my own draw (the engine never names a rival's card)
 *   play    { card, banner: { kicker, title, sub }, tiles }     tiles = the two tiles a swap trades (pulsed), else []
 *   shield  { banner }  double { banner }
 *   expire  { text }
 * `ctx` = { players: [{ id, name, pos }], me }.
 */
export function momentView(m, ctx = {}) {
  if (!m || typeof m !== 'object' || !POWER_KINDS.includes(m.kind)) return null;
  const who = playerName(ctx, m.player);
  const base = { kind: m.kind, id: m.id ?? null, player: m.player ?? null, ms: Math.max(0, Number(m.ms) || 0) };

  if (m.kind === 'draw') {
    const meta = m.card ? cardMeta(m.card.id) : null;
    const faceUp = !!meta && isMe(ctx, m.player);
    return {
      ...base,
      faceUp,
      card: faceUp ? meta : null,
      uid: faceUp && typeof m.card.uid === 'string' ? m.card.uid : null,
      from: Number.isInteger(m.tile) && m.source === 'tile' ? m.tile : null,
      label: faceUp ? meta.name : null,
      kicker: `${who} drew`,
      sr: faceUp ? `You drew ${meta.name}` : `${who} drew a power card`,
    };
  }

  if (m.kind === 'play') {
    const meta = cardMeta(m.card);
    const name = meta ? meta.name : powerName(m.card);
    const target = m.target !== null && m.target !== undefined ? m.target : null;
    const effect = m.card === 'swap' && target !== null ? `Trade places with ${isMe(ctx, target) ? 'you' : playerName(ctx, target)}` : meta ? meta.short : '';
    const a = posOf(ctx, m.player);
    const b = target !== null ? posOf(ctx, target) : null;
    return {
      ...base,
      card: meta,
      banner: { kicker: 'Power card', title: `${who} played ${name}`, sub: effect },
      tiles: m.card === 'swap' && a !== null && b !== null && a !== b ? [a, b] : [],
      sr: effect ? `${who} played ${name}. ${effect}` : `${who} played ${name}`,
    };
  }

  if (m.kind === 'shield' || m.kind === 'double') {
    const amount = Math.max(0, Number(m.amount) || 0);
    const owner = possessive(ctx, m.player);
    const money = amount > 0 ? formatINR(amount) : '';
    const banner = m.kind === 'shield'
      ? { kicker: `${owner} Shield`, title: 'BLOCKED', sub: money ? `Saved ${money}` : 'Payment waived' }
      : { kicker: `${owner} Double Rent`, title: 'x2 RENT', sub: money ? `+${money}` : 'Rent doubled' };
    return {
      ...base,
      banner,
      amount,
      sr: m.kind === 'shield' ? `${owner} Shield blocked ${money || 'a payment'}` : `${owner} Double Rent earned ${money || 'extra rent'}`,
    };
  }

  const n = Math.max(1, Math.floor(Number(m.count)) || 1);
  const text = n === 1 ? 'A power card expired' : `${n} power cards expired`;
  return { ...base, count: n, text, sr: text };
}

/**
 * Where my own drawn card lands, most specific first (the hand tray's hooks): the card itself, the tray, then the pod
 * (`[data-fx-player]`, which the caller always falls back to). A rival's card only ever goes to the pod: [].
 */
export function drawTargetSelectors(v) {
  if (!v || v.kind !== 'draw' || !v.faceUp) return [];
  const uid = typeof v.uid === 'string' ? v.uid.replace(/["\\]/g, '') : '';
  return [...(uid ? [`[data-fx-power-card="${uid}"]`] : []), '[data-fx-power-tray]'];
}

// ---- geometry --------------------------------------------------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const rectCenter = (r) => (r && Number.isFinite(r.left) ? { x: r.left + (r.width || 0) / 2, y: r.top + (r.height || 0) / 2 } : null);

/** A viewport point as fractions of the viewport (Confetti's `origin`). */
export const originFrac = (pt, vw, vh) => (pt && vw > 0 && vh > 0 ? [clamp01(pt.x / vw), clamp01(pt.y / vh)] : [0.5, 0.4]);

/**
 * A card flight from `from` to `to` (viewport points, either may be null) as offsets from the viewport centre, where the
 * moving card sits before it is translated. No start -> the centre; no destination -> the top edge (where the pods live).
 */
export function flightVars(from, to, vw, vh) {
  const cx = vw / 2;
  const cy = vh / 2;
  const a = from || { x: cx, y: cy };
  const b = to || { x: cx, y: Math.max(24, vh * 0.1) };
  const r = (v) => Math.round(v);
  return { x0: r(a.x - cx), y0: r(a.y - cy), x1: r(b.x - cx), y1: r(b.y - cy), tx: r(b.x), ty: r(b.y) };
}

/** How many particles a moment may spend: none under reduced motion or on a slow device; a few for a draw, a burst for a double. */
export function particleBudget(kind, { reduced = false, perfLow = false } = {}) {
  if (reduced || perfLow) return 0;
  if (kind === 'draw') return 14;
  if (kind === 'double') return 36;
  return 0;
}
