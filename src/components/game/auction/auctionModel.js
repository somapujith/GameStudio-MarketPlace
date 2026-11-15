// Pure helpers behind the bidding screen (AuctionSheet and src/components/game/auction/*). No React, no DOM: everything
// here is tested in auction.model.test.js.
//
// Wire contract (state.phase 'auction', pending.type 'auction'):
//   pending = { tile, minBid, bids (sealed: other players' amounts read 0), bidIn: id[] (who has SUBMITTED a bid, passes
//               included), eligible: id[] (who may bid), reason 'bazaar'|'snatch' (older games may still carry 'decline'|'unaffordable': shown as a plain auction), snatch?, buyer?, claimants? }
//   session.clock = { deadline, waitingFor }, cfg.auctionSeconds (default 20)
//   auction_end { tile, winner|null, amount, bids {id: amount}, order: id[] (bidders highest first, passers last), tie, saved?, reason, buyer? }
// An older engine omits bidIn / eligible / order / tie: every helper falls back to what the older state carries.
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { wordsOf } from '@/lib/mapWords.js';
import { MUNICIPAL_BASE, collectionOf, groupTiles } from '../ui/helpers.js';

export const BID_UNIT = 1000; // PRICE_UNIT: nice round bids are whole thousands
export const DEFAULT_AUCTION_SECONDS = 20;
export const URGENT_MS = 5000;
/** A bid that leaves less than this is flagged ("Low cash"): about two Municipal Charges bills. */
export const LOW_CASH = 2 * MUNICIPAL_BASE;
/** How long one card takes to flip, and the gap between two flips (ms, at the presenter's normal pace). */
export const FLIP_MS = 420;
export const FLIP_GAP_MS = 450;
export const REVEAL_MS = 3000; // ANIM_MS.auctionEnd: how long the presenter holds the result

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The engine's exact BID error strings (shared/engine.js validate 'BID'). */
export const BID_ERRORS = Object.freeze({
  already: 'You already placed your bid',
  invalid: 'Invalid bid',
  noAuction: 'There is no auction right now',
  tooLow: (min) => `The minimum bid is ${formatINR(min)}`,
  tooHigh: 'You cannot bid more than your cash',
});

/* ------------------------------------------------------------------ my bid */

/** Size of one +/- tap: finer for cheap districts, coarser for the expensive ones. */
export function stepFor(price) {
  const p = Number(price) || 0;
  if (p < 40000) return 1000;
  if (p < 150000) return 5000;
  return 10000;
}

/** `v` rounded to the nearest `unit` (thousands), then clamped into [min, max]. A clamped end may be off the grid: that is fine. */
export function snapBid(v, min, max, unit = BID_UNIT) {
  const n = Math.round((Number(v) || 0) / unit) * unit;
  return clamp(n, min, Math.max(min, max));
}

/**
 * Quick bids for the chips, ascending and without duplicates: Minimum, Price, +10%, +25% (over the district price),
 * Half my cash, Max (all my cash). Amounts below the minimum are lifted to it, amounts above my cash are dropped
 * (Max is always there). [{ key, label, amount }]; empty when I cannot reach the minimum.
 */
export function quickBids({ min, max, price, unit = BID_UNIT }) {
  const lo = Math.max(0, Math.floor(Number(min) || 0));
  const hi = Math.floor(Number(max) || 0);
  if (!(hi >= lo) || hi <= 0) return [];
  const p = Number(price) || 0;
  const raw = [
    { key: 'min', label: 'Minimum', amount: lo },
    ...(p > 0
      ? [
        { key: 'price', label: 'Price', amount: p },
        { key: 'p10', label: '+10%', amount: p * 1.1 },
        { key: 'p25', label: '+25%', amount: p * 1.25 },
      ]
      : []),
    { key: 'half', label: 'Half my cash', amount: hi / 2 },
    { key: 'max', label: 'Max', amount: hi },
  ];
  const out = [];
  for (const c of raw) {
    if (c.key !== 'min' && c.key !== 'max' && Math.round(c.amount / unit) * unit > hi) continue; // beyond my cash
    const amount = c.key === 'min' ? lo : c.key === 'max' ? hi : snapBid(c.amount, lo, hi, unit);
    out.push({ ...c, amount });
  }
  // dedupe on amount; the first label (Minimum before Price before +10% ...) keeps it; Max wins its own amount
  const seen = new Map();
  for (const c of out) {
    if (!seen.has(c.amount) || c.key === 'max') seen.set(c.amount, c);
  }
  return [...seen.values()].sort((a, b) => a.amount - b.amount);
}

/**
 * The slider works on step INDEXES, so every notch is a round bid and the last notch is exactly my cash:
 * { n, toAmount(i), toIndex(amount) }. Index 0 is the minimum.
 */
export function sliderModel(min, max, unit = BID_UNIT) {
  const lo = Math.floor(Number(min) || 0);
  const hi = Math.max(lo, Math.floor(Number(max) || 0));
  const n = Math.max(0, Math.ceil((hi - lo) / unit));
  return {
    n,
    toAmount: (i) => (i >= n ? hi : clamp(lo + Math.round(i) * unit, lo, hi)),
    toIndex: (v) => clamp(Math.round((clamp(Number(v) || lo, lo, hi) - lo) / unit), 0, n),
  };
}

/** The text of the engine's rejection of `amount` (the exact error string), or null when the bid is fine. 0 is a pass and is always allowed. */
export function bidProblem(amount, { min, cash }) {
  if (!Number.isInteger(amount) || amount < 0) return BID_ERRORS.invalid;
  if (amount === 0) return null;
  if (amount < min) return BID_ERRORS.tooLow(min);
  if (amount > cash) return BID_ERRORS.tooHigh;
  return null;
}

/** Helper lines under the amount: what I keep, what share of the price I pay, a warning when little cash is left. */
export function bidAdvice({ amount, cash, price }) {
  const keep = Math.max(0, (Number(cash) || 0) - (Number(amount) || 0));
  const p = Number(price) || 0;
  const pct = p > 0 ? Math.round(((Number(amount) || 0) / p) * 100) : null;
  const low = keep < LOW_CASH;
  return {
    keep,
    pct,
    low,
    keepText: low ? `This leaves you ${keep === 0 ? 'nothing' : `only ${formatINR(keep)}`}` : `You would keep ${formatINR(keep)}`,
    priceText: p > 0 ? `Price is ${formatINR(p)}: you'd pay ${pct}% of it` : '',
    deal: pct == null ? null : pct < 100 ? 'bargain' : pct === 100 ? 'fair' : 'premium',
  };
}

/**
 * What winning this district does for my collection:
 *   { complete, owned (after winning), total, name, color, blocks: { id, name } | null }  or null (not a district).
 * `blocks`: every other district of the set belongs to one rival, so winning stops that rival from completing it.
 */
export function setImpact({ tileId, owners, me, players = [] }) {
  const tile = TILES[tileId];
  if (!tile || !tile.group) return null;
  const ids = groupTiles(tile.group);
  if (!ids.length) return null;
  const coll = collectionOf(tile);
  const others = ids.filter((t) => t !== tileId);
  const mine = others.filter((t) => owners?.[t] === me).length;
  const owned = mine + 1;
  let blocks = null;
  const rival = others.length ? owners?.[others[0]] : null;
  if (rival && rival !== me && others.every((t) => owners?.[t] === rival)) {
    blocks = { id: rival, name: players.find((p) => p.id === rival)?.name || 'a rival' };
  }
  return { complete: owned === ids.length, owned, total: ids.length, name: coll?.name || 'collection', color: coll?.color || null, blocks };
}

/** The badge text for a set impact ('Completes your Cyberabad', '2 of 3 in Cyberabad', 'Blocks Ravi's Cyberabad'), or null. */
export function setBadge(impact) {
  if (!impact) return null;
  if (impact.complete) return { tone: 'complete', text: `Completes your ${impact.name}` };
  if (impact.blocks) return { tone: 'block', text: `Blocks ${impact.blocks.name}'s ${impact.name}` };
  if (impact.owned > 1) return { tone: 'progress', text: `${impact.owned} of ${impact.total} in ${impact.name}` };
  return null;
}

/* ------------------------------------------------------------------ the window (countdown) */

export const auctionSecondsOf = (cfg) => {
  const s = Number(cfg?.auctionSeconds);
  return Number.isFinite(s) && s > 0 ? s : DEFAULT_AUCTION_SECONDS;
};

/** The ring: null without a running clock, else { leftMs, secs, frac (1 -> 0), urgent (last 5 s), total }. */
export function auctionClock(clock, now, cfg, windowMs = null) {
  const deadline = Number(clock?.deadline);
  if (!Number.isFinite(deadline) || deadline <= 0) return null;
  // the window the server opened (pending.ms, shorter for Snatch bidding), else the room rule
  const total = Number(windowMs) > 0 ? Number(windowMs) : auctionSecondsOf(cfg) * 1000;
  const leftMs = Math.max(0, deadline - now);
  return {
    leftMs,
    secs: Math.ceil(leftMs / 1000),
    frac: clamp(leftMs / total, 0, 1),
    urgent: leftMs <= URGENT_MS,
    total,
  };
}

/* ------------------------------------------------------------------ who is in, who has bid */

const alive = (players) => (Array.isArray(players) ? players.filter((p) => !p.bankrupt) : []);

/** Ids that may bid: pending.eligible, else the snatch claimants, else every player still in the game. */
export function eligibleIds(pending, players) {
  if (Array.isArray(pending?.eligible)) return pending.eligible.map(String);
  if (pending?.snatch && Array.isArray(pending.claimants)) return pending.claimants.map(String);
  return alive(players).map((p) => p.id);
}

/** Ids that have submitted a bid (a pass counts): pending.bidIn, else the keys of the (redacted) bids map. */
export function bidInIds(pending) {
  if (Array.isArray(pending?.bidIn)) return pending.bidIn.map(String);
  return pending?.bids ? Object.keys(pending.bids) : [];
}

/**
 * One row per player of the strip: { id, name, mine, status: 'thinking' | 'in' | 'out' }.
 * 'in' is shown for any submitted bid, a pass included (sealed bids are indistinguishable from the outside).
 * Players who may not bid ('out') come last; bankrupt players are left out.
 */
export function bidderRows({ players, pending, me, sent = false }) {
  const eligible = eligibleIds(pending, players);
  const bidIn = new Set(bidInIds(pending));
  if (sent && me) bidIn.add(me);
  const rows = alive(players).map((p) => ({
    id: p.id,
    name: p.name,
    mine: p.id === me,
    status: !eligible.includes(p.id) ? 'out' : bidIn.has(p.id) ? 'in' : 'thinking',
    // 'poor': the engine passed them because they cannot afford the minimum; 'snatch': not one of the snatchers
    outWhy: eligible.includes(p.id) ? null : pending?.snatch && Array.isArray(pending.claimants) && !pending.claimants.includes(p.id) ? 'snatch' : 'poor',
  }));
  const rank = { thinking: 0, in: 1, out: 2 };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank[a.r.status] - rank[b.r.status] || a.i - b.i).map((x) => x.r);
}

/** 'bidder' (I may bid and have not), 'locked' (my bid is in), 'observer' (not in this auction), by the redacted state. */
export function auctionRole({ pending, players, me, sent = false }) {
  const eligible = eligibleIds(pending, players);
  if (!eligible.includes(me)) return 'observer';
  if (sent || bidInIds(pending).includes(me)) return 'locked';
  return 'bidder';
}

/**
 * Why I only watch: 'poor' (I could bid in this auction but cannot afford the minimum, so I was passed), 'snatch' (a Snatch
 * auction I am not in), or 'out'. The engine drops players who cannot afford the minimum from `eligible`.
 */
export function observerReason({ pending, me, cash, min }) {
  const claimants = pending?.snatch && Array.isArray(pending.claimants) ? pending.claimants : null;
  if ((!claimants || claimants.includes(me)) && Number(cash) < Number(min)) return 'poor';
  if (claimants) return 'snatch';
  return 'out';
}

/** "Ravi", "Ravi and Sana", "Ravi, Sana and Meera"; '' for none. */
export function joinList(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The line under my locked card: who is still thinking. */
export function waitingLine(rows, me) {
  const names = rows.filter((r) => r.status === 'thinking' && r.id !== me).map((r) => r.name);
  if (!names.length) return 'Everyone has bid. Opening the bids...';
  return `Waiting for ${joinList(names)}...`;
}

/* ------------------------------------------------------------------ reasons and wording */

/** Why this auction is running: the engine's `pending.reason`, else inferred from the lander. */
export function auctionReason(view, auction) {
  if (!auction) return null;
  if (auction.reason) return auction.reason;
  const lander = view?.players?.[view.turn];
  const landed = lander ? TILES[lander.pos] : null;
  if (landed?.type === 'auction' && landed.id !== auction.tile) return 'bazaar';
  return 'open'; // passing a district never starts an auction any more; this only covers an older payload without a reason
}

/** One id per auction: the same tile can be auctioned again later and must not inherit the old "I passed". */
export const auctionInstance = (view, auction) =>
  auction ? (auction.id != null ? `#${auction.id}:${auction.tile}` : `${auction.tile}:${view.round}:${view.turnCount ?? view.turn}:${auction.reason || 'a'}`) : null;

export const AUCTION_KICKERS = {
  get bazaar() { return wordsOf().auctionTile; }, // "Bazaar Auction" / "Mirchi Market Auction"
  snatch: 'Snatch bidding',
  open: 'Auction', // anything else (an older game that was saved with a pass auction): plain wording, no excuse text
};

/** The kicker of any reason: an unknown / retired one reads 'Auction'. */
export const kickerOf = (reason) => AUCTION_KICKERS[reason] || AUCTION_KICKERS.open;

/** The plain-words reason line. `who` is "You" or a name (the lander, or the snatch buyer). */
export function reasonLine(reason, who = 'The lander') {
  switch (reason) {
    case 'bazaar':
      return `${wordsOf().auctionTile}: a free district goes under the hammer`;
    case 'snatch':
      return `Snatch bidding: only the snatchers bid. ${who} already paid and ${who === 'You' ? 'keep' : 'keeps'} it if nobody bids`;
    default:
      return 'A free district goes under the hammer';
  }
}

/** The always-visible privacy / rule line under the strip. */
export function privacyLine(role, { snatch = false, tileName = 'this district', poor = false, min = 0 } = {}) {
  if (role === 'observer' && poor) return `You can't afford the minimum bid of ${formatINR(min)}, so you pass. Bidding is private.`;
  if (role === 'observer') {
    return snatch ? `Snatchers are bidding for ${tileName}. Their bids are private.` : 'Bidding is private. Everyone bids in secret and the bids open together.';
  }
  return 'Sealed bids: nobody sees any amount until everyone has chosen. Highest bid wins and pays what it bid.';
}

/* ------------------------------------------------------------------ the reveal */

/**
 * Bidders ranked highest first, passers last. Uses the server's `order`; without one it is rebuilt from `bids`
 * (highest amount first, then the order of `players`).
 */
export function revealOrder(end, players = []) {
  const bids = end?.bids || {};
  if (Array.isArray(end?.order) && end.order.length) {
    const seen = new Set(end.order);
    const rest = Object.keys(bids).filter((id) => !seen.has(id));
    return [...end.order, ...rest];
  }
  const seat = new Map(players.map((p, i) => [p.id, i]));
  const ids = Object.keys(bids);
  return ids.sort((a, b) => (bids[b] || 0) - (bids[a] || 0) || (seat.get(a) ?? 99) - (seat.get(b) ?? 99));
}

/** The district ended in a tie at the top: the server's `tie` flag, else two or more equal top bids. */
export function isTie(end) {
  if (typeof end?.tie === 'boolean') return end.tie;
  const amounts = Object.values(end?.bids || {}).filter((a) => a > 0);
  if (!amounts.length) return false;
  const top = Math.max(...amounts);
  return amounts.filter((a) => a === top).length > 1;
}

/**
 * The flip schedule. Cards flip lowest to highest, ~450 ms apart, the winner last. `ms` is how long the presenter holds
 * the result (3 s at normal pace); everything is scaled to finish inside it. Reduced motion: no flips, all `at` = 0.
 * -> { passers: id[], cards: [{ id, amount, at, winner }], stampAt, flipMs, totalMs }
 */
export function revealPlan(end, players = [], { ms = REVEAL_MS, reduced = false, only = null } = {}) {
  const order = revealOrder(end, players);
  const bids = end?.bids || {};
  const bidders = order.filter((id) => (bids[id] || 0) > 0);
  // `only` = who could bid (pending.eligible): players who could not afford the minimum, or did not snatch, are no "passers"
  const passers = order.filter((id) => !((bids[id] || 0) > 0) && (!Array.isArray(only) || only.includes(id)));
  const winner = end?.winner ?? null;
  const asc = [...bidders].reverse(); // lowest first, the top bid last
  const scale = clamp((Number(ms) || REVEAL_MS) / REVEAL_MS, 0.25, 1.4);
  const lead = 250 * scale;
  const gap0 = FLIP_GAP_MS * scale;
  // many bidders: tighten the gap so the last flip starts by ~1.9 s (the stamp and its beat fit in 3 s)
  const gap = asc.length > 1 ? Math.min(gap0, (1900 * scale - lead) / (asc.length - 1)) : gap0;
  const flipMs = Math.round(FLIP_MS * scale);
  const cards = asc.map((id, i) => ({ id, amount: bids[id] || 0, at: reduced ? 0 : Math.round(lead + i * gap), winner: id === winner }));
  const last = cards.length ? cards[cards.length - 1].at : 0;
  const stampAt = reduced ? 0 : Math.round(last + flipMs + 120 * scale);
  const timedOut = Array.isArray(end?.timedOut) ? end.timedOut : [];
  return { passers, timedOut: passers.filter((id) => timedOut.includes(id)), cards, stampAt, flipMs, totalMs: reduced ? 0 : stampAt + Math.round(500 * scale) };
}

/**
 * The words of the result. `nameOf(id)` -> "You" / a name.
 * -> { kind: 'sold' | 'none' | 'kept', headline, saved, tieNote, line }
 *   sold: 'SOLD to Ravi for ₹2,30,000' (+ 'saved ₹30,000' when saved > 0, + the tie note when it was a tie)
 *   none: 'Nobody bid. The district stays free'  /  kept: a snatch auction nobody bid in: it stays with its buyer
 */
export function resultCaption(end, nameOf, { tileName = 'the district' } = {}) {
  if (!end) return null;
  const hasWinner = end.winner !== null && end.winner !== undefined;
  const tie = isTie(end);
  const rule = String(end.tieRule || end.tieBreak || end.tieText || '');
  if (!hasWinner) {
    if (end.reason === 'snatch' && end.buyer !== null && end.buyer !== undefined) {
      const keeper = nameOf(end.buyer);
      return { kind: 'kept', headline: `Nobody bid. ${tileName} stays with ${keeper === 'You' ? 'you' : keeper}`, saved: 0, tieNote: '', line: '' };
    }
    return { kind: 'none', headline: 'Nobody bid. The district stays free', saved: 0, tieNote: '', line: '' };
  }
  const who = nameOf(end.winner);
  const saved = Number(end.saved) > 0 ? Number(end.saved) : 0;
  const headline = `SOLD to ${who === 'You' ? 'you' : who} for ${formatINR(end.amount)}`;
  const tieNote = tie ? (rule ? `Tie! Decided by ${rule}` : 'Tie! Drawn at random') : '';
  return { kind: 'sold', headline, saved, savedText: saved ? `saved ${formatINR(saved)}` : '', tieNote, line: [headline, saved ? `saved ${formatINR(saved)}` : '', tieNote].filter(Boolean).join('. ') };
}

/** The result id: the presenter's own id, else a key built from the event. */
export const resultKey = (end) => (end ? String(end.id ?? `${end.tile}:${end.winner}:${end.amount}`) : null);
