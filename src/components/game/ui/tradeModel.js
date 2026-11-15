// Pure helpers behind the trade sheet (no React): what a side is worth, how balanced a deal looks, which collections it
// completes or breaks, and the same reasons the engine gives for an invalid offer (shared/engine.js tradeProblem).
// Values are the printed net-worth values (a district at its price, minus its loan when mortgaged, plus half of the
// upgrades paid). They are information for the players, never a rule: an unbalanced offer can always be sent.
import { TILES } from '@shared/board.js';
import { tradeBlock } from '@shared/engine.js';
import { compactINR } from '@shared/format.js';
import { COLLECTIONS, completedGroups, groupTiles, isBuyableTile, mortgageOf, rentLadder, upgradeCostOf } from './helpers.js';

const num = (v) => Number(v) || 0;
const groupOf = (id) => TILES[id]?.group || null;

/* ------------------------------------------------------------------ values */

/** Net-worth value of one district: its price (mortgaged: minus the bank's loan) plus half the upgrades paid. */
export function tileValue(state, id) {
  const tile = TILES[id];
  if (!tile) return 0;
  const base = state?.mortgaged?.[id] ? (tile.price || 0) - mortgageOf(tile) : tile.price || 0;
  return base + Math.round((state?.levels?.[id] || 0) * upgradeCostOf(tile) * 0.5);
}

/** What one side of an offer is made of: { cash, districts (sum of the tiles), total, count }. */
export function sideParts(state, side) {
  const cash = num(side?.cash);
  const tiles = side?.tiles || [];
  let districts = 0;
  for (const t of tiles) districts += tileValue(state, t);
  return { cash, districts, total: cash + districts, count: tiles.filter((t) => TILES[t]).length };
}

/** Net-worth value of one side: cash + districts (+ their upgrades). */
export const sideValue = (state, side) => sideParts(state, side).total;

/** What I give vs what I get -> { key, label, tone, hint }. Informational only. */
export function fairness(giving, getting) {
  if (giving + getting === 0) return { key: 'empty', label: 'Add something to trade', tone: 'neutral', hint: '' };
  if (giving === 0) return { key: 'greedy', label: 'Greedy', tone: 'warn', hint: 'You give nothing. Expect a no.' };
  const r = getting / giving;
  if (r < 0.85) return { key: 'generous', label: 'Generous', tone: 'blue', hint: 'You give more than you get.' };
  if (r <= 1.2) return { key: 'fair', label: 'Looks fair', tone: 'good', hint: 'Values are close.' };
  return { key: 'greedy', label: 'Greedy', tone: 'warn', hint: 'You ask for much more than you give.' };
}

/**
 * The split bar of a deal: the share of the bar that is "what I give" and "what I get" (both 0..1, summing to 1; an
 * empty deal is an empty bar), and the difference I gain (positive) or lose (negative) in printed value.
 */
export function balanceSplit(giving, getting) {
  const g = Math.max(0, num(giving));
  const r = Math.max(0, num(getting));
  const total = g + r;
  return { give: total ? g / total : 0, get: total ? r / total : 0, total, diff: r - g };
}

/** My cash after the deal. */
export const cashAfter = (cash, give, get) => num(cash) - num(give?.cash) + num(get?.cash);

/* ------------------------------------------------------------------ sets */

/** Collections `id` owns completely. */
export function fullSets(owners, id) {
  return COLLECTIONS.filter((c) => c.tiles.length > 0 && c.tiles.every((t) => owners?.[t] === id)).map((c) => c.id);
}

/**
 * What a deal does to the collections of both sides. `giveTiles` leave me for `themId`, `getTiles` leave them for me.
 *   mineCompleted / theirCompleted   collections that end up whole in my / their hands
 *   mineBroken / theirBroken         collections a side owns whole today and would no longer own
 */
export function setImpact(owners, meId, themId, giveTiles = [], getTiles = []) {
  const touches = (tiles, g) => tiles.some((t) => groupOf(t) === g);
  return {
    mineCompleted: completedGroups(owners, meId, getTiles, giveTiles),
    theirCompleted: completedGroups(owners, themId, giveTiles, getTiles),
    mineBroken: fullSets(owners, meId).filter((g) => touches(giveTiles, g)),
    theirBroken: fullSets(owners, themId).filter((g) => touches(getTiles, g)),
  };
}

/** True when the deal moves any collection (so the summary has something to say). */
export const hasImpact = (impact) => !!impact && Object.values(impact).some((list) => list.length > 0);

/**
 * The set badge of one district card. `side` is 'give' (my district) or 'get' (theirs); `give` / `get` are the tiles
 * picked so far. -> { kind: 'completes' | 'breaks' | 'theirs' | 'theirsBroken', group } | null
 *   completes      taking it would complete one of MY collections
 *   breaks         giving it away breaks a collection I own whole
 *   theirs         giving it would complete one of THEIR collections
 *   theirsBroken   taking it breaks a collection they own whole
 */
export function tileHint(owners, { me, them, give = [], get = [] }, tileId, side) {
  const group = groupOf(tileId);
  if (!group) return null;
  if (side === 'get') {
    const taken = get.includes(tileId) ? get : [...get, tileId];
    if (completedGroups(owners, me, taken, give).includes(group)) return { kind: 'completes', group };
    if (fullSets(owners, them).includes(group)) return { kind: 'theirsBroken', group };
    return null;
  }
  const given = give.includes(tileId) ? give : [...give, tileId];
  if (completedGroups(owners, them, given, get).includes(group)) return { kind: 'theirs', group };
  if (fullSets(owners, me).includes(group)) return { kind: 'breaks', group };
  return null;
}

/**
 * Collections that a trade between two players could complete today: `a` holds some, and every district `a` is missing
 * belongs to `b` (so one swap finishes the set). -> group ids
 */
export function setsToComplete(owners, a, b) {
  const out = [];
  for (const c of COLLECTIONS) {
    const ids = groupTiles(c.id);
    const mine = ids.filter((t) => owners?.[t] === a).length;
    const missing = ids.filter((t) => owners?.[t] !== a);
    if (mine > 0 && missing.length > 0 && missing.every((t) => owners?.[t] === b)) out.push(c.id);
  }
  return out;
}

/** What a partner could do for me and I for them: { completesMine, completesTheirs } (group ids). */
export function partnerHints(owners, me, them) {
  return { completesMine: setsToComplete(owners, me, them), completesTheirs: setsToComplete(owners, them, me) };
}

/** Districts a player owns, in board order. */
export const districtsOf = (owners, id) => TILES.filter((t) => isBuyableTile(t) && owners?.[t.id] === id).map((t) => t.id);

/* ------------------------------------------------------------------ one district as a card */

/** Everything a deed card shows: { id, tile, level, mortgaged, price, rent (what it collects now), value }. */
export function deedFacts(state, id) {
  const tile = TILES[id];
  const level = state?.levels?.[id] || 0;
  const mortgaged = !!state?.mortgaged?.[id];
  const ladder = rentLadder(tile);
  return {
    id, tile, level, mortgaged,
    price: tile?.price || 0,
    rent: mortgaged ? 0 : ladder[Math.min(level, ladder.length - 1)] || 0,
    value: tileValue(state, id),
  };
}

/* ------------------------------------------------------------------ validation (same reasons as the engine) */

export const NO_PARTNER = 'No other active players to trade with.';
export const SAME_DEAL = 'Change something first, or accept the offer as it is';

/** Two sides of a deal are the same cash and the same districts (order does not matter). */
export function sameSide(a, b) {
  const x = [...(a?.tiles || [])].sort((p, q) => p - q);
  const y = [...(b?.tiles || [])].sort((p, q) => p - q);
  return num(a?.cash) === num(b?.cash) && x.length === y.length && x.every((t, i) => t === y[i]);
}

/**
 * Can I propose a trade right now, and if not, exactly why? { can, reason }. The authoritative `view` decides (the engine's
 * own tradeBlock), so an animation that is still playing never blocks it; only an unanswered request or a dead connection
 * does, for a moment, with its own wording.
 */
export function tradeStatus(session) {
  const view = session?.view;
  const me = session?.me;
  if (!view || !me) return { can: false, reason: 'The table is loading' };
  const block = tradeBlock(view, me);
  if (block) return { can: false, reason: block };
  if (session.connection && session.connection !== 'open') return { can: false, reason: 'Reconnecting. Try again in a moment' };
  if (session.options && session.options.trade && session.options.trade.canOffer === false) return { can: false, reason: 'One moment, the table is updating' };
  return { can: true, reason: '' };
}

/**
 * What a counter-offer changed against the offer it replaces, from the point of view of `meId` (the proposer who now answers).
 * `get` is what I receive (their side), `give` what I hand over (mine); each: { added[], removed[], cashFrom, cashTo }.
 * Null when `trade` is not a counter-offer to me.
 */
export function counterDiff(trade, meId) {
  if (!trade || !trade.replaces || trade.to !== meId) return null;
  const cmp = (before, after) => {
    const b = before?.tiles || [];
    const a = after?.tiles || [];
    return {
      added: a.filter((t) => !b.includes(t)),
      removed: b.filter((t) => !a.includes(t)),
      cashFrom: num(before?.cash),
      cashTo: num(after?.cash),
    };
  };
  return { get: cmp(trade.replaces.get, trade.give), give: cmp(trade.replaces.give, trade.get) };
}

/** True when the diff of one side changes anything. */
export const sideChanged = (d) => !!d && (d.added.length > 0 || d.removed.length > 0 || d.cashFrom !== d.cashTo);
export const NOT_YOUR_TURN = 'You can only offer a trade on your own turn, before rolling or after.';

/**
 * Why this offer cannot be sent, or null. Mirrors shared/engine.js tradeProblem (empty offer, cash on either side), plus
 * the turn rule from `options.trade.canOffer`. The deal's fairness never blocks it.
 */
export function offerProblem({ me, partner, give, get, canOffer = true, reason = '', original = null }) {
  if (!partner) return NO_PARTNER;
  if (canOffer === false) return reason || NOT_YOUR_TURN;
  const g = { cash: num(give?.cash), tiles: give?.tiles || [] };
  const r = { cash: num(get?.cash), tiles: get?.tiles || [] };
  if (g.cash + r.cash + g.tiles.length + r.tiles.length === 0) return 'The offer is empty';
  if (original && sameSide(give, original.give) && sameSide(get, original.get)) return SAME_DEAL;
  if (g.cash > num(me?.cash)) return 'You do not have that much cash';
  if (r.cash > num(partner.cash)) return `${partner.name} does not have that much cash`;
  return null;
}

/* ------------------------------------------------------------------ cash module */

export const CASH_STEP = 10000;

/** `v` clamped into 0..max and snapped to whole rupees. */
export const clampCash = (v, max) => Math.min(Math.max(0, Math.floor(num(max))), Math.max(0, Math.round(num(v))));

/** Digits typed into the cash field ("1,50,000", "₹ 90000") -> a number (0 when there are none). */
export const parseCash = (text) => Number(String(text ?? '').replace(/[^0-9]/g, '')) || 0;

/** The quick chips of a cash field: signed deltas, with their labels and spoken form. */
export const CASH_CHIPS = [
  { id: 'm50', delta: -50000, label: '−₹50k', say: 'minus 50,000' },
  { id: 'p50', delta: 50000, label: '+₹50k', say: 'plus 50,000' },
  { id: 'p1l', delta: 100000, label: '+₹1L', say: 'plus 1,00,000' },
];

/* ------------------------------------------------------------------ presentation helpers */

/** Districts grouped by collection, in board order: [{ coll, ids }] (`ids` are tile ids). */
export function byCollection(ids = []) {
  const rows = [];
  for (const c of COLLECTIONS) {
    const mine = c.tiles.filter((t) => ids.includes(t));
    if (mine.length) rows.push({ coll: c, ids: mine });
  }
  const loose = ids.filter((t) => !groupOf(t) || !COLLECTIONS.some((c) => c.id === groupOf(t)));
  if (loose.length) rows.push({ coll: { id: 'other', name: 'Other', color: '#94a3b8', tiles: loose }, ids: loose });
  return rows;
}

/** "2 districts + ₹50k" / "₹50k" / "1 district" / "nothing": one side of an offer in a few words. */
export function sideBrief(side) {
  const n = side?.tiles?.length || 0;
  const cash = num(side?.cash);
  const parts = [];
  if (n) parts.push(`${n} district${n === 1 ? '' : 's'}`);
  if (cash) parts.push(compactINR(cash));
  return parts.length ? parts.join(' + ') : 'nothing';
}

/**
 * The summary lines for a deal's set impact, in reading order: [{ key, tone: 'good' | 'warn' | 'info', who: 'me' | 'them',
 * kind: 'complete' | 'break', group }]. The sheet words them ("You complete Cyberabad", "Ravi completes Old City Icons").
 */
export function impactRows(impact) {
  if (!impact) return [];
  const rows = [];
  for (const g of impact.mineCompleted || []) rows.push({ key: `mc${g}`, tone: 'good', who: 'me', kind: 'complete', group: g });
  for (const g of impact.theirCompleted || []) rows.push({ key: `tc${g}`, tone: 'warn', who: 'them', kind: 'complete', group: g });
  for (const g of impact.mineBroken || []) rows.push({ key: `mb${g}`, tone: 'warn', who: 'me', kind: 'break', group: g });
  for (const g of impact.theirBroken || []) rows.push({ key: `tb${g}`, tone: 'info', who: 'them', kind: 'break', group: g });
  return rows;
}
