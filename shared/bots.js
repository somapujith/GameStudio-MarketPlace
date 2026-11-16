// Move chooser. Pure functions over the engine state; randomness only through the injected `rnd`.
//
//   nextBotMove(state, rnd = Math.random)     -> action | null   (null = a human must act, or game over)
//   chooseBotAction(state, playerId, rnd)     -> action | null   (works for ANY player id: the server uses it to
//                                                                 auto-play idle humans)
// Bot personality lives on `player.bot = { reserve, greed }` (defaults in engine DEFAULT_BOT).
//
// Auto-play of a human seat (`isBot` false) never rides a transport shortcut, never offers trades and pays its way out
// of a traffic jam only with comfortable cash (otherwise it waits). Simulator bots (`isBot` true) may ride and
// may offer trades to human seats.
//
// Priority inside nextBotMove: a debt to settle, then a trade offer waiting for a bot, then a sealed auction, then
// the turn player.
//
// Auctions: a simulator bot (`isBot`) bids with `auctionBid` (price value, set-completion / rival-blocking premiums, a cash
// safety margin, seeded variation); the auto-play of an idle HUMAN seat passes (BID 0), and the room only plays it when
// the auction window ends (worker/games/hyderabad-tycoon.js idleAction is null in an auction; AUCTION_CLOSE does it).
//
// Snatch: auto-play and the bots' normal chooser NEVER press Snatch (a Snatch window needs a human decision; the room
// server closes it with its own timer). Only the simulator, to exercise the rule, asks `botSnatchAction`.

import { TILES, GROUP_TILES, GROUPS, BOARD_SIZE, rentFor, mortgageValue, MAX_LEVEL } from './board.js';
import { DEFAULT_BOT, MAX_TRADE_TILES, getOptions, previewRent, canUpgrade, netWorth, municipalDue } from './engine.js';

const thousand = (x) => Math.floor(x / 1000) * 1000;

function botParams(player) {
  const b = { ...DEFAULT_BOT, ...(player.bot || {}) };
  return { reserve: Math.max(0, Number(b.reserve) || 0), greed: Math.max(0.1, Number(b.greed) || 1) };
}

/** Would owning `tileId` leave this player holding the whole collection? */
function completesSet(state, playerId, tileId) {
  const tile = TILES[tileId];
  if (tile.type !== 'property') return false;
  return GROUP_TILES[tile.group].every((t) => t === tileId || state.owners[t] === playerId);
}

/** Does `tileId` build on a collection the player already has a piece of (and nobody else blocks)? */
function extendsSet(state, playerId, tileId) {
  const tile = TILES[tileId];
  if (tile.type !== 'property') return false;
  const mates = GROUP_TILES[tile.group].filter((t) => t !== tileId);
  const mine = mates.filter((t) => state.owners[t] === playerId).length;
  const blocked = mates.some((t) => state.owners[t] && state.owners[t] !== playerId);
  return mine >= 1 && !blocked;
}

function wantsToBuy(state, player, tileId) {
  const { reserve, greed } = botParams(player);
  const tile = TILES[tileId];
  const left = player.cash - tile.price;
  if (left < 0) return false;
  const eff = reserve / greed;
  if (completesSet(state, player.id, tileId)) return left >= eff * 0.2;
  if (extendsSet(state, player.id, tileId)) return left >= eff * 0.5;
  return left >= eff;
}

/** Would a rival end up holding the whole collection by winning `tileId`? (they own every other district of it) */
function blocksRival(state, playerId, tileId) {
  const tile = TILES[tileId];
  if (!tile || tile.type !== 'property') return false;
  const mates = GROUP_TILES[tile.group].filter((t) => t !== tileId);
  if (!mates.length) return false;
  const rival = state.owners[mates[0]];
  return !!rival && rival !== playerId && mates.every((t) => state.owners[t] === rival);
}

/** What the bot values a district at, as a multiple of its price (before greed and the seeded variation). */
export const AUCTION_VALUE = Object.freeze({ base: 0.85, extends: 1.1, blocks: 1.2, completes: 1.6 });
/** Seeded variation of a bot's valuation: x(1 - VARIATION) .. x(1 + VARIATION), so bots do not all bid the same number. */
export const AUCTION_VARIATION = 0.15;

/**
 * The sealed bid of a bot (or 0 = pass) for the open auction. Value: the district price, with a big premium when it
 * completes the bot's own collection, a smaller one when it blocks a rival from completing theirs, a little one when it
 * extends a collection; times the bot's `greed` and a seeded +-15% variation. Never more than cash minus a safety margin
 * (half the bot's reserve), so a bid can not push it into debt; below the minimum bid (or unaffordable) it passes.
 * Pure: the only randomness is `rnd`. Never throws.
 */
export function auctionBid(state, player, rnd = Math.random) {
  try {
    const pend = state && state.pending;
    if (!pend || pend.type !== 'auction' || !player) return 0;
    const tile = TILES[pend.tile];
    if (!tile) return 0;
    const { reserve, greed } = botParams(player);
    const cap = player.cash - reserve / 2;
    if (!(cap >= pend.minBid)) return 0; // cannot afford the minimum and keep the margin
    const factor = completesSet(state, player.id, pend.tile)
      ? AUCTION_VALUE.completes
      : blocksRival(state, player.id, pend.tile)
        ? AUCTION_VALUE.blocks
        : extendsSet(state, player.id, pend.tile)
          ? AUCTION_VALUE.extends
          : AUCTION_VALUE.base;
    const r = typeof rnd === 'function' ? rnd() : 0.5;
    const wiggle = 1 - AUCTION_VARIATION + 2 * AUCTION_VARIATION * (Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5);
    const bid = thousand(Math.min(tile.price * factor * greed * wiggle, cap));
    return bid >= pend.minBid && bid <= player.cash ? bid : 0;
  } catch {
    return 0;
  }
}

function bidFor(state, player, rnd) {
  return auctionBid(state, player, rnd);
}

// ---------------------------------------------------------------------------------------------
// Debt
// ---------------------------------------------------------------------------------------------

/** Mortgage the cheapest district first, sell upgrades when nothing else is left. */
function debtAction(state, player) {
  const debt = state.debt;
  if (!debt || debt.player !== player.id) return null;
  if (player.cash >= debt.amount) return { type: 'PAY_DEBT', playerId: player.id };
  const opts = getOptions(state, player.id);
  if (opts.mortgage.length) {
    const pick = [...opts.mortgage].sort((a, b) => a.value - b.value || a.tile - b.tile)[0];
    return { type: 'MORTGAGE', playerId: player.id, tile: pick.tile };
  }
  if (opts.sellBuilding.length) {
    const pick = [...opts.sellBuilding].sort((a, b) => a.refund - b.refund || a.tile - b.tile)[0];
    return { type: 'SELL_BUILDING', playerId: player.id, tile: pick.tile };
  }
  return { type: 'RESIGN', playerId: player.id }; // cannot happen when the engine opened the debt
}

// ---------------------------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------------------------

/** The collection part of a holding: a whole collection is worth far more than its tiles; two of three is a threat. */
function setBonusOnly(state, playerId, owners) {
  let v = 0;
  for (const g of Object.keys(GROUPS)) {
    const tiles = GROUP_TILES[g];
    const owned = tiles.filter((t) => owners[t] === playerId).length;
    const total = tiles.reduce((n, t) => n + TILES[t].price, 0);
    if (owned === tiles.length) v += 0.8 * total;
    else if (owned === tiles.length - 1) v += 0.25 * total;
  }
  return v;
}

/** How good a holding is: face value plus a bonus for complete collections. */
function holdingValue(state, playerId, owners) {
  let v = setBonusOnly(state, playerId, owners);
  for (let t = 0; t < BOARD_SIZE; t++) {
    if (owners[t] !== playerId) continue;
    v += TILES[t].price - (state.mortgaged && state.mortgaged[t] ? mortgageValue(TILES[t]) : 0);
  }
  return v;
}

function answerTrade(state, player) {
  const t = state.trade;
  if (!t || t.to !== player.id) return null;
  const { reserve } = botParams(player);
  const accept = { type: 'TRADE_ACCEPT', playerId: player.id };
  const reject = { type: 'TRADE_REJECT', playerId: player.id };

  // Never break a collection we own in full.
  for (const tile of t.get.tiles) {
    const g = TILES[tile].group;
    if (g && GROUP_TILES[g].every((x) => state.owners[x] === player.id)) return reject;
  }
  const after = state.owners.slice();
  for (const tile of t.give.tiles) after[tile] = player.id;
  for (const tile of t.get.tiles) after[tile] = t.from;

  const mineBefore = holdingValue(state, player.id, state.owners);
  const mineAfter = holdingValue(state, player.id, after);
  const theirGain = setBonusOnly(state, t.from, after) - setBonusOnly(state, t.from, state.owners);
  const net = mineAfter - mineBefore + t.give.cash - t.get.cash - 0.6 * Math.max(0, theirGain);
  const turnover = t.give.cash + t.get.cash + t.give.tiles.concat(t.get.tiles).reduce((n, x) => n + TILES[x].price, 0);
  const cashAfter = player.cash + t.give.cash - t.get.cash;
  if (cashAfter < reserve * 0.5) return reject;
  return net >= 0.12 * turnover ? accept : reject;
}

/** A simulator bot (never an auto-played human) may offer a human seat a fair-plus price for a set-completing district. */
function proposeTrade(state, player, rnd) {
  if (!player.isBot || state.pending || state.trade) return null;
  if (player.lastOfferTurn != null && state.turnCount - player.lastOfferTurn < 20) return null;
  const { reserve } = botParams(player);
  let best = null;
  for (let t = 0; t < BOARD_SIZE; t++) {
    const owner = state.owners[t];
    if (!owner || owner === player.id || TILES[t].type !== 'property') continue;
    const holder = state.players.find((p) => p.id === owner);
    if (!holder || holder.isBot || holder.bankrupt) continue;
    if (state.mortgaged && state.mortgaged[t]) continue;
    if (!completesSet(state, player.id, t)) continue;
    const offer = thousand(TILES[t].price * 1.5);
    if (player.cash - offer < reserve || offer > player.cash) continue;
    if (!best || TILES[t].price > TILES[best.tile].price) best = { tile: t, offer, to: owner };
  }
  if (!best || rnd() >= 0.5) return null;
  return {
    type: 'TRADE_OFFER', playerId: player.id, to: best.to,
    // one district for cash; never more than MAX_TRADE_TILES per side (engine rule, shared with the trade sheet)
    give: { cash: best.offer, tiles: [].slice(0, MAX_TRADE_TILES) }, get: { cash: 0, tiles: [best.tile].slice(0, MAX_TRADE_TILES) },
  };
}

/** Simulator bots ride when the six squares ahead hold expensive opponent rent (or just for fun now and then). */
function wantsRide(state, player, ride, rnd) {
  if (!player.isBot || !ride) return false;
  const { reserve } = botParams(player);
  if (player.cash - ride.fare < reserve) return false;
  let danger = 0;
  for (let k = 1; k <= 6; k++) {
    const t = (player.pos + k) % BOARD_SIZE;
    const owner = state.owners[t];
    if (owner && owner !== player.id) danger += previewRent(state, t);
  }
  return danger / 6 > ride.fare * 0.6 || rnd() < 0.15;
}

// ---------------------------------------------------------------------------------------------
// Power cards (rule on): cheap heuristics so the simulator is meaningful. Never required for validity: the engine's
// getOptions().power says what is playable, a bot only ever picks from it. Only simulator bots (`isBot`) play cards; the
// auto-play of an idle human seat keeps its hand (a card is never spent for someone who is not there).
// ---------------------------------------------------------------------------------------------

/**
 * How good it is to stand on `pos` before a roll, for `player`: the average over the six squares ahead of what landing there
 * costs (a rival's rent, municipal tax, the traffic fine) or offers (a free district they can afford, a tenth of its price).
 */
function spotScore(state, player, pos) {
  let v = 0;
  for (let k = 1; k <= 6; k++) {
    const t = (pos + k) % BOARD_SIZE;
    const tile = TILES[t];
    const owner = state.owners[t];
    if (tile.type === 'property') {
      if (owner && owner !== player.id) v -= previewRent(state, t);
      else if (!owner && player.cash >= tile.price) v += tile.price * 0.1;
    } else if (tile.type === 'municipal') v -= municipalDue(state, player.id);
    else if (tile.type === 'traffic') v -= state.cfg.trafficFine;
  }
  return v / 6;
}

/** Rent a rival is likely to owe the player in the next few squares: the player's districts within 12 squares ahead of a rival pawn. */
function rentLikelyToCollect(state, player) {
  let hits = 0;
  for (const q of state.players) {
    if (q.bankrupt || q.id === player.id) continue;
    for (let k = 1; k <= 12; k++) {
      const t = (q.pos + k) % BOARD_SIZE;
      if (state.owners[t] === player.id && !(state.mortgaged && state.mortgaged[t])) hits++;
    }
  }
  return hits;
}

/** The card (and swap target) a bot plays before rolling, or null to hold. */
function powerPlay(state, player) {
  const opts = getOptions(state, player.id);
  const pw = opts.power;
  if (!pw || !pw.canPlay) return null;
  const { reserve } = botParams(player);
  const cards = pw.cards.filter((c) => c.ok);
  const lastRound = (c) => c.exp <= state.round; // about to expire: nothing to lose by using it
  const rivals = state.players.filter((q) => !q.bankrupt && q.id !== player.id);
  const avg = rivals.length ? (rivals.reduce((n, q) => n + netWorth(state, q.id), netWorth(state, player.id))) / (rivals.length + 1) : 0;
  const behind = netWorth(state, player.id) < avg * 0.9;

  // Swap: only when it clearly moves the bot onto a better spot (and does not hand the rival a much better one)
  const swap = cards.find((c) => c.id === 'swap');
  if (swap && swap.targets && swap.targets.length) {
    const mine = spotScore(state, player, player.pos);
    let best = null;
    for (const id of swap.targets) {
      const q = state.players.find((x) => x.id === id);
      const gain = (spotScore(state, player, q.pos) - mine) - 0.5 * (spotScore(state, q, player.pos) - spotScore(state, q, q.pos));
      if (!best || gain > best.gain || (gain === best.gain && id < best.id)) best = { id, gain };
    }
    if (best && best.gain > Math.max(30000, reserve * 0.2)) return { type: 'PLAY_POWER', playerId: player.id, card: swap.uid, target: best.id };
  }
  const steal = cards.find((c) => c.id === 'steal');
  if (steal) return { type: 'PLAY_POWER', playerId: player.id, card: steal.uid };
  const double = cards.find((c) => c.id === 'double');
  if (double && !((player.doubleRent || 0) >= state.round) && (rentLikelyToCollect(state, player) > 0 || (lastRound(double) && state.owners.some((o) => o === player.id)))) {
    return { type: 'PLAY_POWER', playerId: player.id, card: double.uid };
  }
  const shield = cards.find((c) => c.id === 'shield');
  if (shield && !((player.shield || 0) >= state.round)) {
    const owns = state.owners.some((o) => o === player.id);
    const exposed = spotScore(state, player, player.pos) < -reserve * 0.1;
    if (exposed || behind || lastRound(shield) || (owns && player.cash < 3 * reserve)) return { type: 'PLAY_POWER', playerId: player.id, card: shield.uid };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export function chooseBotAction(state, playerId, rnd = Math.random) {
  if (!state || state.phase === 'over') return null;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) return null;
  const { reserve } = botParams(player);

  if (state.phase === 'snatch') return null; // auto-play never snatches (see botSnatchAction for the simulator)
  if (state.phase === 'debt') return debtAction(state, player);

  if (state.trade) {
    if (state.trade.to === playerId) return answerTrade(state, player);
    if (state.trade.from === playerId) return { type: 'TRADE_CANCEL', playerId };
    return null;
  }

  if (state.phase === 'auction') {
    const pend = state.pending;
    if (!pend || playerId in pend.bids) return null;
    // Auto-play of a human seat (an idle or disconnected player) just passes; simulator bots really bid.
    return { type: 'BID', playerId, amount: player.isBot ? bidFor(state, player, rnd) : 0 };
  }

  if (state.players[state.turn].id !== playerId) return null;
  const opts = getOptions(state, playerId);

  if (state.phase === 'buy') {
    if (opts.buy && wantsToBuy(state, player, state.pending.tile)) return { type: 'BUY', playerId };
    return { type: 'SKIP_BUY', playerId };
  }

  // Stuck in traffic: pay only with comfortable cash, otherwise wait (ROLL). Chai is kept for a big rent.
  if (state.phase === 'roll' && player.stuck) {
    if (opts.payTraffic && player.cash - opts.payTraffic >= 3 * reserve) return { type: 'PAY_TRAFFIC', playerId };
    return { type: 'ROLL', playerId };
  }

  // Lift mortgages once there is plenty of cash again.
  const lift = [...opts.unmortgage]
    .filter((u) => player.cash - u.cost >= 2 * reserve)
    .sort((a, b) => TILES[b.tile].price - TILES[a.tile].price)[0];
  if (lift) return { type: 'UNMORTGAGE', playerId, tile: lift.tile };

  // Upgrade the most lucrative district we can afford while keeping the reserve. Upgrading needs the WHOLE collection
  // (engine canUpgrade; getOptions already filters on it, the explicit check keeps the bot honest). That is why
  // completing a collection is worth so much to a bot: see completesSet in wantsToBuy / bidFor / proposeTrade.
  let best = null;
  for (const u of opts.upgrade) {
    if (!canUpgrade(state, playerId, u.tile).ok) continue;
    if (player.cash - u.cost < reserve) continue;
    const tile = TILES[u.tile];
    const gain = rentFor(tile, Math.min(MAX_LEVEL, u.level + 1)) - rentFor(tile, u.level);
    const score = gain / u.cost;
    if (!best || score > best.score) best = { tile: u.tile, score };
  }
  if (best) return { type: 'UPGRADE', playerId, tile: best.tile };

  if (opts.ride && wantsRide(state, player, opts.ride, rnd)) return { type: 'RIDE', playerId };

  if (state.phase === 'manage' && !state.extraRoll && opts.trade.canOffer) {
    const offer = proposeTrade(state, player, rnd);
    if (offer) return offer;
  }

  if (state.phase === 'roll' && player.isBot && opts.power && opts.power.canPlay) {
    const play = powerPlay(state, player);
    if (play) return play;
  }

  if (opts.roll) return { type: 'ROLL', playerId };
  if (opts.endTurn) return { type: 'END_TURN', playerId };
  return null;
}

/** Price from which the simulator's bots press Snatch even when the district does not help a collection. */
export const SNATCH_MIN_PRICE = 200000;

/**
 * The simulator's trivial Snatch policy: press when the district would complete or extend the player's collection, or
 * costs at least SNATCH_MIN_PRICE. Not used by the server's auto-play, which never snatches.
 */
export function botSnatchAction(state, playerId) {
  const pend = state && state.phase === 'snatch' && state.pending;
  if (!pend || pend.type !== 'snatch') return null;
  if (!getOptions(state, playerId).snatch) return null;
  if (!(completesSet(state, playerId, pend.tile) || extendsSet(state, playerId, pend.tile) || pend.price >= SNATCH_MIN_PRICE)) return null;
  return { type: 'SNATCH', playerId };
}

export function nextBotMove(state, rnd = Math.random) {
  if (!state || state.phase === 'over' || state.phase === 'snatch') return null; // a Snatch window is closed by the room's timer
  const bot = (id) => {
    const p = state.players.find((x) => x.id === id);
    return p && p.isBot && !p.bankrupt ? p : null;
  };
  if (state.phase === 'debt') {
    const d = state.debt && bot(state.debt.player);
    return d ? chooseBotAction(state, d.id, rnd) : null;
  }
  if (state.trade) {
    const responder = bot(state.trade.to);
    return responder ? chooseBotAction(state, responder.id, rnd) : null;
  }
  if (state.phase === 'auction') {
    const pend = state.pending;
    if (!pend) return null;
    for (const p of state.players) {
      if (p.isBot && !p.bankrupt && !(p.id in pend.bids)) return chooseBotAction(state, p.id, rnd);
    }
    return null;
  }
  const tp = state.players[state.turn];
  if (!tp || !tp.isBot || tp.bankrupt) return null;
  return chooseBotAction(state, tp.id, rnd);
}
