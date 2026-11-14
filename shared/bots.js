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

import { TILES, GROUP_TILES, GROUPS, BOARD_SIZE, rentFor, mortgageValue, MAX_LEVEL } from './board.js';
import { DEFAULT_BOT, getOptions, previewRent } from './engine.js';

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

function bidFor(state, player, rnd) {
  const { tile: tileId, minBid } = state.pending;
  const { reserve, greed } = botParams(player);
  const price = TILES[tileId].price;
  const factor = completesSet(state, player.id, tileId) ? 1.4 : extendsSet(state, player.id, tileId) ? 1.1 : 0.9;
  let bid = price * factor * greed * (0.7 + 0.4 * rnd());
  bid = Math.min(bid, player.cash - reserve / 2);
  bid = thousand(bid);
  return bid >= minBid ? bid : 0;
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
    give: { cash: best.offer, tiles: [] }, get: { cash: 0, tiles: [best.tile] },
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
// Entry points
// ---------------------------------------------------------------------------------------------

export function chooseBotAction(state, playerId, rnd = Math.random) {
  if (!state || state.phase === 'over') return null;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) return null;
  const { reserve } = botParams(player);

  if (state.phase === 'debt') return debtAction(state, player);

  if (state.trade) {
    if (state.trade.to === playerId) return answerTrade(state, player);
    if (state.trade.from === playerId) return { type: 'TRADE_CANCEL', playerId };
    return null;
  }

  if (state.phase === 'auction') {
    const pend = state.pending;
    if (!pend || playerId in pend.bids) return null;
    return { type: 'BID', playerId, amount: bidFor(state, player, rnd) };
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

  // Upgrade the most lucrative district we can afford while keeping the reserve.
  let best = null;
  for (const u of opts.upgrade) {
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

  if (opts.roll) return { type: 'ROLL', playerId };
  if (opts.endTurn) return { type: 'END_TURN', playerId };
  return null;
}

export function nextBotMove(state, rnd = Math.random) {
  if (!state || state.phase === 'over') return null;
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
