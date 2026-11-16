// Hyderabad Hustle rules engine (the "Kingpin" game). Pure + deterministic: runs in the browser AND the
// Cloudflare Worker.
//
//   createGame({ players, settings?, seed? })  -> state
//   applyAction(state, action)                 -> { state, events, error? }   (never mutates `state`)
//
// The rules, state shape, actions and events are described in docs/GAME_RULES.md (contract: docs/HUSTLE_PLAN.md 3).

import {
  BOARD_SIZE, START_TILE, MAX_LEVEL, SELL_RATIO, PASS_START, CHAI_MIN_RENT,
  GROUPS, GROUP_TILES, TILES, PIECE_IDS, isBuyable, rentFor, upgradeCost, sellRefund, setMultiplier,
  mortgageValue, unmortgageCost, nextTransport, municipalFor, auctionMinBid,
} from './board.js';
import { SNATCH_CAP_PAYOUT } from './cards.js';
import { shuffle, seedToUint32, randInt, nextFloat } from './rng.js';
import { EVENT_EVERY } from './events.js';
import { MAP_IDS, DEFAULT_MAP, levelNameOf, groupName, tileName, termsOf, deckCards, cityEventsOf, rushFlavourOf, monsoonTextOf, festivalsOf } from './maps.js';
import { MODES, MODE_IDS, DEFAULT_MODE, ROUND_CAP, TARGET_OPTIONS, isTargetAmount } from './modes.js';
import { ruleDefaults } from './ruleSettings.js';
import { formatINR } from './format.js';
import { rollDice, DICE_RULES } from './dice.js';
import { auctionMsOf, snatchBidMsOf } from './timing.js';
import { POWER, POWER_IDS } from './powerCards.js';

export { MODES, MODE_IDS, DEFAULT_MODE, ROUND_CAP, TARGET_OPTIONS };

// ---------------------------------------------------------------------------------------------
// Constants and settings
// ---------------------------------------------------------------------------------------------

/**
 * The host settings and their defaults for the standard mode: `mode` plus every host rule of shared/ruleSettings.js
 * (money, timers, board rules, Snatch). The mode-bound ones (startCash, maxRounds, targetWorth) follow the chosen mode.
 */
export const DEFAULT_SETTINGS = Object.freeze({ mode: DEFAULT_MODE, ...ruleDefaults(DEFAULT_MODE) });

/**
 * Ranges `normalizeSettings` clamps the numeric overrides to. They are deliberately wider than the host-facing bounds of
 * ruleSettings.js (the room server enforces those): tests and the simulator may use small or extreme values.
 */
export const SETTING_LIMITS = Object.freeze({
  startCash: Object.freeze({ min: 100000, max: 100000000 }),
  passStart: Object.freeze({ min: 0, max: 10000000 }),
  maxRounds: Object.freeze({ min: 1, max: 500 }),
  trafficFine: Object.freeze({ min: 0, max: 10000000 }),
  rentPercent: Object.freeze({ min: 10, max: 500 }),
  chaiCap: Object.freeze({ min: 1, max: 3 }),
  eventEvery: Object.freeze({ min: 0, max: 60 }), // 0 = no city events
  turnSeconds: Object.freeze({ min: 5, max: 600 }),
  tradeSeconds: Object.freeze({ min: 5, max: 600 }),
  snatches: Object.freeze({ min: 0, max: 3 }), // 0 = Snatch is off
  auctionSeconds: Object.freeze({ min: 1, max: 600 }),
  snatchMs: Object.freeze({ min: 500, max: 60000 }),
  snatchCardCap: Object.freeze({ min: 0, max: 2 }),
});

const toInt = (v) => {
  if (typeof v === 'string' && v.trim() === '') return NaN;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : NaN;
};

/**
 * Turns whatever the UI / server hands us into the engine config (`state.cfg`):
 *   `{ mode, startCash, passStart, maxRounds|null, targetWorth|null, dice, trafficFine, chaiCap,
 *      rentPercent, requireFullSet, eventEvery, turnSeconds, tradeSeconds, auctionSeconds, snatches, snatchMs, snatchCardCap }`
 * (the keys of shared/ruleSettings.js plus `mode`). `targetWorth` is the win target (net worth): `null` or any legal
 * amount (see modes.js TARGET_RANGE), anything else (or missing) becomes the mode default. The room server additionally
 * refuses `null` for a mode without a round limit (worker/settings.js); the engine itself accepts it (the ROUND_CAP
 * safety net still ends such a game). Numbers are clamped to SETTING_LIMITS, unknown keys are dropped, a missing key
 * is the mode default. `debug: true` is kept (tests only). The retired `auctionOnDecline` of older rooms is dropped like any
 * unknown key: a district nobody buys is never auctioned (docs/GAME_RULES.md section 6).
 */
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const mode = typeof src.mode === 'string' && MODE_IDS.includes(src.mode) ? src.mode : DEFAULT_MODE;
  const cfg = { mode, ...ruleDefaults(mode) };
  if (src.targetWorth === null || isTargetAmount(src.targetWorth)) cfg.targetWorth = src.targetWorth;
  if (src.dice === 'fair' || src.dice === 'lucky') cfg.dice = src.dice;
  if (typeof src.requireFullSet === 'boolean') cfg.requireFullSet = src.requireFullSet;
  if (typeof src.powerCards === 'boolean') cfg.powerCards = src.powerCards; // Power cards (docs/POWER_CARDS.md): off by default
  const ranged = (key) => {
    if (!(key in src) || src[key] === undefined) return;
    const n = toInt(src[key]);
    if (!Number.isNaN(n)) cfg[key] = Math.min(SETTING_LIMITS[key].max, Math.max(SETTING_LIMITS[key].min, n));
  };
  for (const key of ['startCash', 'passStart', 'trafficFine', 'rentPercent', 'chaiCap', 'eventEvery', 'turnSeconds', 'tradeSeconds', 'auctionSeconds', 'snatches', 'snatchMs', 'snatchCardCap']) ranged(key);
  if ('maxRounds' in src && src.maxRounds !== undefined) {
    if (src.maxRounds === null) cfg.maxRounds = null;
    else ranged('maxRounds');
  }
  // The map is a lobby setting, not a rule. Only a non-default map is stored: no `cfg.map` means the Hyderabad map (docs/CONTRACT.md).
  if (typeof src.map === 'string' && src.map !== DEFAULT_MAP && MAP_IDS.includes(src.map)) cfg.map = src.map;
  if (src.debug === true) cfg.debug = true;
  return cfg;
}

export const PLAYER_COLORS = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b794f6', '#ff9f43'];

/** Bot personality defaults (stored on `player.bot`). */
export const DEFAULT_BOT = { reserve: 150000, greed: 1 };

const MAX_CARD_DEPTH = 2;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const byId = (s, id) => s.players.find((p) => p.id === id);
const activePlayers = (s) => s.players.filter((p) => !p.bankrupt);
const turnPlayer = (s) => s.players[s.turn];
const isMort = (s, t) => !!(s.mortgaged && s.mortgaged[t]);
const roundLimit = (s) => (s.cfg.maxRounds == null ? ROUND_CAP : s.cfg.maxRounds);

function newStats() {
  return { rentPaid: 0, rentEarned: 0, taxPaid: 0, propertiesBought: 0, upgrades: 0, biggestRent: 0, rides: 0, chaiSaved: 0 };
}

function ownedInGroup(s, ownerId, groupId) {
  let n = 0;
  for (const t of GROUP_TILES[groupId]) if (s.owners[t] === ownerId) n++;
  return n;
}

const ownsWholeGroup = (s, ownerId, groupId) => ownedInGroup(s, ownerId, groupId) === GROUP_TILES[groupId].length;

/** Upgrade levels the player owns in total (Municipal Charges, "per upgrade" cards). */
function levelsOwned(s, playerId) {
  let n = 0;
  for (let i = 0; i < BOARD_SIZE; i++) if (s.owners[i] === playerId) n += s.levels[i] || 0;
  return n;
}

const districtsOwned = (s, playerId) => s.owners.filter((o) => o === playerId).length;

// Host rules read straight from `cfg` with the old behaviour as the fallback (a game stored before a rule existed).
const passStartOf = (s) => (Number.isFinite(s.cfg.passStart) ? s.cfg.passStart : PASS_START);
const eventEveryOf = (s) => (Number.isFinite(s.cfg.eventEvery) ? s.cfg.eventEvery : EVENT_EVERY);
const needsFullSet = (s) => s.cfg.requireFullSet !== false;
// Snatch rules read from cfg with the defaults as the fallback (cfg.snatches 1, cfg.snatchMs 5000, cfg.snatchCardCap 2).
const snatchStart = (s) => (Number.isFinite(s.cfg.snatches) ? s.cfg.snatches : 1);
const snatchCardCapOf = (s) => (Number.isFinite(s.cfg.snatchCardCap) ? s.cfg.snatchCardCap : 2);
const snatchMsOf = (s) => (Number.isFinite(s.cfg.snatchMs) ? s.cfg.snatchMs : 5000);
/** Snatch is on when players start with at least one button (`cfg.snatches` 0 turns it off entirely). */
const snatchOn = (s) => snatchStart(s) > 0;
/** Power cards (docs/POWER_CARDS.md): a stored game without `cfg.powerCards` is off. Everything below is inert when off. */
const powerOn = (s) => s.cfg.powerCards === true;
const handOf = (p) => (Array.isArray(p.hand) ? p.hand : []);

/** Multiplier the current city event puts on `tileId`'s rent (1 when none applies). */
function eventMult(s, tileId) {
  const e = s.event;
  if (!e || !e.mult || e.kind !== 'rent') return 1;
  const tile = TILES[tileId];
  const hit = e.group ? e.group === tile.group : Array.isArray(e.groups) && e.groups.includes(tile.group);
  if (!hit) return 1;
  if (e.upgradedOnly && !((s.levels[tileId] || 0) > 0)) return 1;
  return e.mult;
}

/** Rent the district asks right now from a visitor (before the visitor's chai). 0 for a mortgaged or unowned tile. */
function rentOf(s, tileId, ownerId, withDouble = true) {
  const tile = TILES[tileId];
  if (!isBuyable(tile) || !ownerId || isMort(s, tileId)) return 0;
  const level = s.levels[tileId] || 0;
  const full = setMultiplier(ownedInGroup(s, ownerId, tile.group), GROUP_TILES[tile.group].length) > 1;
  let rent = rentFor(tile, level, full) * eventMult(s, tileId);
  const owner = byId(s, ownerId);
  if (owner && owner.rentBoost > 1) rent *= owner.rentBoost;
  if (withDouble && owner && doubleArmed(s, owner)) rent *= 2; // Power card Double Rent: part of the owner's rent, so previews and look-ahead agree
  const pct = s.cfg.rentPercent;
  if (Number.isFinite(pct) && pct !== 100) rent = (rent * pct) / 100; // host rule "rent level": scales every rent
  return Math.round(rent);
}

/** Power cards: is the armed Double Rent / Shield of `p` still live this round? (read with fallbacks: stored games lack them) */
const doubleArmed = (s, p) => powerOn(s) && (p.doubleRent || 0) >= s.round;
const shieldArmed = (s, p) => powerOn(s) && (p.shield || 0) >= s.round;

// ---------------------------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------------------------

/** What `playerId` still owes in the open debt (0 when they owe nothing). */
function unpaidDebt(state, playerId) {
  const d = state.debt;
  if (!d) return 0;
  let owed = d.player === playerId ? d.amount : 0;
  for (const r of d.rest || []) if (r.from === playerId) owed += Math.max(0, Math.round(r.amount) || 0);
  return owed;
}

/**
 * Net worth = cash + price of every owned district (price - mortgage value when mortgaged)
 * + 50% of the upgrade costs paid - unpaid debt.
 */
export function netWorth(state, playerId) {
  const p = byId(state, playerId);
  if (!p) return 0;
  let w = p.cash;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (state.owners[i] !== playerId) continue;
    const t = TILES[i];
    w += (isMort(state, i) ? t.price - mortgageValue(t) : t.price) + Math.round((state.levels[i] || 0) * upgradeCost(t) * SELL_RATIO);
  }
  return w - unpaidDebt(state, playerId);
}

/** Cash the player could raise by selling every upgrade and mortgaging every unmortgaged district. */
export function liquidationValue(state, playerId) {
  let v = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (state.owners[i] !== playerId) continue;
    v += (state.levels[i] || 0) * sellRefund(TILES[i]);
    if (!isMort(state, i)) v += mortgageValue(TILES[i]);
  }
  return v;
}

/**
 * The player's estate in a bankruptcy: their cash + liquidationValue (the bank's mortgage value of every unmortgaged
 * district + the sell-back value of every upgrade). The bank takes ALL cash and districts; the estate is the most it
 * will pay out to the people the bankrupt player owes.
 */
export function estateValue(state, playerId) {
  const p = byId(state, playerId);
  return p ? Math.max(0, p.cash) + liquidationValue(state, playerId) : 0;
}

/** Payments `playerId` still owes in the open debt, in order: [{ to, amount, reason }] (`to` null = the bank). */
export function owedPayments(state, playerId) {
  const d = state.debt;
  if (!d) return [];
  const out = [];
  if (d.player === playerId) out.push({ to: d.creditor || null, amount: Math.max(0, Math.round(d.amount) || 0), reason: d.reason });
  for (const r of d.rest || []) if (r.from === playerId) out.push({ to: r.to || null, amount: Math.max(0, Math.round(r.amount) || 0), reason: r.reason });
  return out;
}

/** Walk the owed payments in order and give each a share of the estate: [{ to, amount, reason }] (only real creditors). */
function planPayouts(state, playerId, owed) {
  let left = estateValue(state, playerId);
  const rows = [];
  for (const o of owed) {
    const creditor = o.to ? byId(state, o.to) : null;
    if (!creditor || creditor.bankrupt || creditor.id === playerId) continue; // owed to the bank (or to someone out): the bank keeps it
    const amount = Math.min(Math.max(0, Math.round(o.amount) || 0), left);
    if (amount <= 0) continue;
    left -= amount;
    rows.push({ to: creditor.id, amount, reason: o.reason });
  }
  return rows;
}

/**
 * What each creditor would be paid, by the bank, if `playerId` went bankrupt right now: [{ to, amount }] in the order of
 * the debts, one row per creditor. Each debt is paid in full while the estate (cash + liquidationValue) lasts, the rest
 * is forgiven. `owed` defaults to the player's open debt (a resign without a debt pays nobody).
 */
export function bankruptcyPayouts(state, playerId, owed = owedPayments(state, playerId)) {
  const sums = new Map();
  for (const r of planPayouts(state, playerId, owed)) sums.set(r.to, (sums.get(r.to) || 0) + r.amount);
  return [...sums].map(([to, amount]) => ({ to, amount }));
}

/**
 * The winner order: players still in the game first, by net worth, then cash, then seat; bankrupt players after
 * them, the last to go out first. [{ id, cash, worth, rank, bankrupt }] (rank is 1-based). The rounds / last-standing
 * winner is always rank 1.
 */
export function standings(state) {
  const rows = state.players.map((p, seat) => ({
    id: p.id, cash: p.cash, worth: netWorth(state, p.id), bankrupt: !!p.bankrupt, seat, out: p.outOrder ?? -1,
  }));
  rows.sort((a, b) => {
    if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
    if (a.bankrupt) return (b.out - a.out) || (a.seat - b.seat);
    return (b.worth - a.worth) || (b.cash - a.cash) || (a.seat - b.seat);
  });
  return rows.map((r, i) => ({ id: r.id, cash: r.cash, worth: r.worth, rank: i + 1, bankrupt: r.bankrupt }));
}

/** Rent a visitor would owe right now on `tileId` (0 if unowned / mortgaged / not a district). Chai is not applied. */
export function previewRent(state, tileId) {
  const tile = TILES[tileId];
  const owner = state.owners[tileId];
  if (!tile || !isBuyable(tile) || !owner) return 0;
  return rentOf(state, tileId, owner);
}

/** Municipal Charges `playerId` would pay right now (40,000 + 10,000 per upgrade level they own). */
export function municipalDue(state, playerId) {
  return municipalFor(levelsOwned(state, playerId));
}

/** { ok, reason?, cost } with human-readable reasons (good for tooltips). */
export function canUpgrade(state, playerId, tileId) {
  const tile = TILES[tileId];
  if (!tile || tile.type !== 'property') return { ok: false, reason: 'Only districts can be upgraded', cost: 0 };
  const cost = upgradeCost(tile);
  const no = (reason) => ({ ok: false, reason, cost });
  const p = byId(state, playerId);
  if (!p || p.bankrupt) return no('You are out of the game');
  if (state.phase === 'over') return no('The game is over');
  if (state.owners[tileId] !== playerId) return no('You do not own this district');
  const level = state.levels[tileId] || 0;
  if (level >= MAX_LEVEL) return no(`Already a ${levelNameOf(state, tile, MAX_LEVEL)}`);
  // Hustle rule: you may only upgrade a district once you own EVERY district of its collection (host rule
  // `requireFullSet`, on by default; off = owning the district is enough).
  // Ownership only: a mortgaged sibling still counts. Levels already built stay if the set is later broken.
  const need = GROUP_TILES[tile.group].length;
  const have = ownedInGroup(state, playerId, tile.group);
  if (needsFullSet(state) && have < need) return no(`Own all ${need} districts of ${groupName(state, tile.group)} first (you have ${have})`);
  if (isMort(state, tileId)) return no('Unmortgage this district first');
  if (turnPlayer(state).id !== playerId) return no('Wait for your turn');
  if (state.trade) return no('Answer the trade offer first');
  if (state.phase !== 'roll' && state.phase !== 'manage') return no('Finish the current step first');
  if (p.cash < cost) return no(`Need ${formatINR(cost - p.cash)} more`);
  return { ok: true, cost };
}

// ---- raise-cash checks (mortgage / unmortgage / sell an upgrade) ----

/** Who may mortgage / sell right now: the debtor during a debt, otherwise the turn player in roll/manage. */
function raiseCashGate(s, playerId) {
  if (s.trade) return 'Answer the trade offer first';
  if (s.phase === 'debt') return s.debt && s.debt.player === playerId ? null : 'Wait until the debt is settled';
  if (turnPlayer(s).id !== playerId) return 'Not your turn';
  if (s.phase !== 'roll' && s.phase !== 'manage') return 'Finish the current step first';
  return null;
}

function mortgageCheck(s, playerId, tileId) {
  const tile = TILES[tileId];
  if (!isBuyable(tile)) return { ok: false, reason: 'That tile cannot be mortgaged', value: 0 };
  const value = mortgageValue(tile);
  const no = (reason) => ({ ok: false, reason, value });
  if (s.owners[tileId] !== playerId) return no('You do not own this district');
  if (isMort(s, tileId)) return no('Already mortgaged');
  if ((s.levels[tileId] || 0) > 0) return no('Sell its upgrades first');
  const gate = raiseCashGate(s, playerId);
  if (gate) return no(gate);
  return { ok: true, value };
}

function unmortgageCheck(s, playerId, tileId) {
  const tile = TILES[tileId];
  if (!isBuyable(tile)) return { ok: false, reason: 'That tile cannot be mortgaged', cost: 0 };
  const cost = unmortgageCost(tile);
  const no = (reason) => ({ ok: false, reason, cost });
  const p = byId(s, playerId);
  if (s.owners[tileId] !== playerId) return no('You do not own this district');
  if (!isMort(s, tileId)) return no('This district is not mortgaged');
  if (s.phase === 'debt') return no('Settle the debt first');
  const gate = raiseCashGate(s, playerId);
  if (gate) return no(gate);
  if (p.cash < cost) return no(`Need ${formatINR(cost - p.cash)} more`);
  return { ok: true, cost };
}

function sellCheck(s, playerId, tileId) {
  const tile = TILES[tileId];
  if (!tile || tile.type !== 'property') return { ok: false, reason: 'Only districts have upgrades', refund: 0 };
  const refund = sellRefund(tile);
  const no = (reason) => ({ ok: false, reason, refund });
  if (s.owners[tileId] !== playerId) return no('You do not own this district');
  if (!((s.levels[tileId] || 0) > 0)) return no('Nothing to sell here');
  const gate = raiseCashGate(s, playerId);
  if (gate) return no(gate);
  return { ok: true, refund };
}

function rideCheck(s, playerId) {
  const r = s.ride;
  if (!r || r.player !== playerId) return 'There is no ride to take';
  if (turnPlayer(s).id !== playerId) return 'Not your turn';
  if (s.trade) return 'Answer the trade offer first';
  if (s.phase !== 'manage' || s.pending) return 'Finish the current step first';
  const p = byId(s, playerId);
  if (p.cash < r.fare) return `The fare is ${formatINR(r.fare)}`;
  return null;
}

function setsFor(s, playerId) {
  const out = [];
  for (const g of Object.keys(GROUPS)) {
    const size = GROUP_TILES[g].length;
    const owned = ownedInGroup(s, playerId, g);
    if (owned > 0) out.push({ group: g, owned, size, multiplier: setMultiplier(owned, size) });
  }
  return out;
}

/** Counter-offers one negotiation may go through (the offer, its counter, the counter of the counter ...). */
export const MAX_COUNTERS = 5;

/**
 * null when `playerId` may PROPOSE a trade right now, else the exact reason (the Trade button shows it). One rule for
 * the engine (TRADE_OFFER), getOptions().trade.canOffer and the client: your own turn, in a quiet moment (before the roll,
 * after landing and while deciding about the district, after buying, on an extra roll), nothing else waiting for an answer.
 */
export function tradeBlock(state, playerId) {
  const p = byId(state, playerId);
  if (!p || p.bankrupt) return 'You are out of the game';
  if (state.phase === 'over') return 'The game is over';
  if (state.trade) return state.trade.from === playerId ? 'Your offer is waiting for an answer' : 'Answer the trade offer first';
  if (activePlayers(state).length < 2) return 'No other active players to trade with';
  if (state.phase === 'debt') return 'Settle the debt before trading';
  if (state.phase === 'auction') return 'Trading opens again when the auction ends';
  if (state.phase === 'snatch') return 'Trading opens again when the Snatch window closes';
  if (turnPlayer(state).id !== playerId) return 'You can propose a trade on your own turn';
  if (state.phase === 'buy') return state.pending && state.pending.type === 'buy' ? null : 'Finish the current step before trading';
  if (state.phase !== 'roll' && state.phase !== 'manage') return 'Finish the current step before trading';
  if (state.pending) return 'Finish the current step before trading';
  return null;
}

/**
 * What `playerId` may do right now. Everything false/null/[] when it is not their moment. With the Power cards rule on
 * the result also carries `power` (see powerOptions); with it off the object is exactly what it always was.
 */
export function getOptions(state, playerId) {
  const out = baseOptions(state, playerId);
  if (powerOn(state)) out.power = powerOptions(state, playerId);
  return out;
}

function baseOptions(state, playerId) {
  const none = {
    roll: false, payTraffic: false, useChai: false, buy: false, skipBuy: false, ride: null, endTurn: false,
    upgrade: [], bid: null, mortgage: [], unmortgage: [], sellBuilding: [], debt: null, payDebt: false,
    trade: { canOffer: false }, tradeOffer: null, tradeSent: null, sets: [], resign: false, snatch: null,
  };
  const p = byId(state, playerId);
  if (!p || p.bankrupt || state.phase === 'over') return none;
  const out = { ...none, resign: true, sets: setsFor(state, playerId) };

  if (state.trade) {
    const t = state.trade;
    if (t.to === playerId) {
      out.tradeOffer = { id: t.id, from: t.from, give: t.give, get: t.get, counters: t.counters || 0, canCounter: (t.counters || 0) < MAX_COUNTERS };
    }
    if (t.from === playerId) out.tradeSent = { id: t.id, to: t.to, give: t.give, get: t.get };
    return out;
  }

  if (state.phase === 'snatch') {
    // Snatch window: an eligible player who has not pressed gets `snatch`, one who has pressed gets `snatched`
    // (their own press, from the authoritative state; other viewers' presses are redacted away by the server).
    const pend = state.pending;
    if (pend && pend.type === 'snatch' && pend.eligible.includes(playerId)) {
      if (pend.claims.includes(playerId)) out.snatched = true;
      else out.snatch = { tile: pend.tile, ms: pend.ms };
    }
    return out;
  }

  const raiseCash = () => {
    for (let t = 0; t < BOARD_SIZE; t++) {
      if (state.owners[t] !== playerId) continue;
      const m = mortgageCheck(state, playerId, t);
      if (m.ok) out.mortgage.push({ tile: t, value: m.value });
      const s = sellCheck(state, playerId, t);
      if (s.ok) out.sellBuilding.push({ tile: t, refund: s.refund });
    }
  };

  if (state.phase === 'debt') {
    if (state.debt && state.debt.player === playerId) {
      out.debt = { amount: state.debt.amount, creditor: state.debt.creditor, shortfall: Math.max(0, state.debt.amount - p.cash) };
      out.payDebt = p.cash >= state.debt.amount;
      raiseCash();
    }
    return out;
  }

  if (state.phase === 'auction') {
    const pend = state.pending;
    if (pend && pend.type === 'auction' && !(playerId in pend.bids)) out.bid = { tile: pend.tile, min: pend.minBid, max: p.cash };
    return out;
  }

  if (turnPlayer(state).id !== playerId) return out;
  if (state.phase === 'roll') {
    out.roll = true; // while stuck in traffic this means "wait": no move, the turn ends
    if (p.stuck) {
      out.payTraffic = p.cash >= state.cfg.trafficFine ? state.cfg.trafficFine : false;
      out.useChai = (p.chai || 0) > 0;
    }
  } else if (state.phase === 'buy') {
    out.skipBuy = true;
    out.buy = !!state.pending && p.cash >= state.pending.price;
    out.trade = { canOffer: !tradeBlock(state, playerId) }; // you may trade while you make up your mind about the district
  } else if (state.phase === 'manage') {
    if (state.extraRoll) out.roll = true;
    else out.endTurn = true;
    if (!rideCheck(state, playerId)) out.ride = { to: state.ride.to, fare: state.ride.fare };
  }
  if (state.phase === 'roll' || state.phase === 'manage') {
    for (let t = 0; t < BOARD_SIZE; t++) {
      if (state.owners[t] !== playerId) continue;
      const c = canUpgrade(state, playerId, t);
      if (c.ok) out.upgrade.push({ tile: t, cost: c.cost, level: state.levels[t] || 0 });
      const u = unmortgageCheck(state, playerId, t);
      if (u.ok) out.unmortgage.push({ tile: t, cost: u.cost });
    }
    raiseCash();
    out.trade = { canOffer: !tradeBlock(state, playerId) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------------------------

/** Requested free pieces are kept (first come, first served in seat order); everyone else gets the first free one. */
function assignPieces(players) {
  const taken = new Set();
  const out = players.map((p) => {
    const want = typeof p.piece === 'string' && PIECE_IDS.includes(p.piece) && !taken.has(p.piece) ? p.piece : null;
    if (want) taken.add(want);
    return want;
  });
  return out.map((piece) => {
    if (piece) return piece;
    const free = PIECE_IDS.find((id) => !taken.has(id)) || PIECE_IDS[0];
    taken.add(free);
    return free;
  });
}

/** Fixed constant the Power cards stream is derived from the game seed with (docs/POWER_CARDS.md). */
const POWER_SEED_XOR = 0x9e3779b1;

export function createGame({ players, settings = {}, seed } = {}) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 6) {
    throw new RangeError('createGame needs 2 to 6 players');
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Player ids must be unique');

  const cfg = normalizeSettings(settings);
  const pieces = assignPieces(players);
  const seed32 = seedToUint32(seed);

  const state = {
    cfg,
    rng: seed32,
    round: 1,
    event: null, // the city event of this round, or null
    turn: 0,
    turnCount: 0,
    phase: 'roll',
    extraRoll: false,
    dice: [0], // the one die; zero means no roll has happened yet
    owners: Array(BOARD_SIZE).fill(null),
    levels: Array(BOARD_SIZE).fill(0),
    mortgaged: Array(BOARD_SIZE).fill(false),
    pending: null,
    ride: null, // { player, from, to, fare } while a transport ride is on offer
    trade: null,
    debt: null,
    tradeSeq: 0,
    outCount: 0,
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name ?? `Player ${i + 1}`,
      avatar: p.avatar ?? i,
      color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
      piece: pieces[i],
      isBot: !!p.isBot,
      bot: p.isBot || p.bot ? { ...DEFAULT_BOT, ...(p.bot || {}) } : null,
      cash: cfg.startCash,
      pos: START_TILE,
      stuck: false, // stuck in traffic: next turn pay, spend chai, or wait
      chai: 0, // chai tokens (max cfg.chaiCap)
      snatches: cfg.snatches, // Snatch buttons left (public): cfg.snatches at the start, +1 per Snatch card, -1 per snatch won
      snatchCards: 0, // Snatch buttons gained from cards so far (public; at most cfg.snatchCardCap per game)
      laps: 0, // times START was passed or landed on
      bankrupt: false,
      outOrder: null, // 1 for the first player to go bankrupt, 2 for the next, ...
      sixes: 0, // sixes rolled so far in the current turn
      rollsSinceSix: 0,
      rentStreak: 0,
      rentThisTurn: 0,
      rentBoost: 0, // > 1 while a "your rents x2" card is active (until the player's next turn)
      lastOfferTurn: null,
      stats: newStats(),
      ...(cfg.powerCards ? { hand: [], shield: 0, doubleRent: 0 } : null), // Power cards: hand, armed Shield / Double Rent (round they last to)
    })),
    deck: { luck: [], drama: [] }, // shuffled card order per deck (server secret)
    deckPos: { luck: 0, drama: 0 },
    winner: null,
    winReason: null,
  };
  // Power cards draw from their OWN stream (never `rng`), created only when the rule is on: a game with the rule off makes
  // no extra draw and carries no new state, so every seeded game stays byte-identical.
  if (cfg.powerCards) {
    state.prng = (seed32 ^ POWER_SEED_XOR) >>> 0;
    state.powerPlayed = false;
  }
  state.deck.luck = shuffle(state, deckOrder(state, 'luck'));
  state.deck.drama = shuffle(state, deckOrder(state, 'drama'));
  return state;
}

// ---------------------------------------------------------------------------------------------
// Ownership + sets
// ---------------------------------------------------------------------------------------------

/** Emit `set_complete` for every collection the player now holds in full among `tiles`. */
function emitSets(s, ev, playerId, tiles) {
  const seen = new Set();
  for (const t of tiles) {
    const tile = TILES[t];
    if (!isBuyable(tile) || seen.has(tile.group)) continue;
    seen.add(tile.group);
    if (ownsWholeGroup(s, playerId, tile.group)) ev.push({ type: 'set_complete', player: playerId, group: tile.group });
  }
}

// ---------------------------------------------------------------------------------------------
// Money: payments, debt, bankruptcy
// ---------------------------------------------------------------------------------------------

function gain(s, ev, p, amount, reason, other) {
  if (amount <= 0) return;
  p.cash += amount;
  const e = { type: 'cash', player: p.id, delta: amount, reason };
  if (other) e.other = other;
  ev.push(e);
}

/** Move `amount` from p to the creditor (or the bank). The caller guarantees p can afford it. */
function transfer(s, ev, p, creditor, amount, reason) {
  if (amount <= 0) return;
  p.cash -= amount;
  const e = { type: 'cash', player: p.id, delta: -amount, reason };
  if (creditor) e.other = creditor.id;
  ev.push(e);
  if (creditor) {
    creditor.cash += amount;
    ev.push({ type: 'cash', player: creditor.id, delta: amount, reason, other: p.id });
  }
  if (reason === 'rent') {
    p.stats.rentPaid += amount;
    p.rentThisTurn = (p.rentThisTurn || 0) + amount;
    if (creditor) {
      creditor.stats.rentEarned += amount;
      creditor.stats.biggestRent = Math.max(creditor.stats.biggestRent, amount);
    }
  } else if (reason === 'tax') {
    p.stats.taxPaid += amount;
  }
}

function cancelTradeOf(s, ev, playerId, reason) {
  const t = s.trade;
  if (t && (t.from === playerId || t.to === playerId)) {
    ev.push({ type: 'trade_rejected', id: t.id, from: t.from, to: t.to, reason });
    s.trade = null;
  }
}

/** Remove (and return) the payments `playerId` still has queued in `list`. */
function takeOwnPayments(list, playerId) {
  const mine = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].from !== playerId) continue;
    mine.unshift({ to: list[i].to || null, amount: list[i].amount, reason: list[i].reason });
    list.splice(i, 1);
  }
  return mine;
}

/**
 * Bankruptcy: the BANK takes ALL the player's cash and districts (every upgrade is sold off, mortgages are cleared, the
 * districts are free again). The people the player owes get ONLY what is owed, paid by the bank, and never more than the
 * estate (cash + liquidationValue) was worth: `owed` = [{ to, amount, reason }] in order, each paid in full while the
 * estate lasts, the rest forgiven. Debts to the bank (`to` null) or to someone already out pay nobody.
 */
function bankruptPlayer(s, ev, p, owed, how = null) {
  const payouts = planPayouts(s, p.id, owed || []); // before anything is sold: it prices the estate as it stands
  for (let t = 0; t < BOARD_SIZE; t++) {
    if (s.owners[t] !== p.id || !(s.levels[t] > 0)) continue;
    s.levels[t] = 0;
    ev.push({ type: 'level', tile: t, level: 0, reason: 'bankrupt' });
  }
  for (let t = 0; t < BOARD_SIZE; t++) {
    if (s.owners[t] !== p.id) continue;
    s.owners[t] = null;
    s.mortgaged[t] = false;
    ev.push({ type: 'own', tile: t, owner: null, reason: 'bankrupt' });
  }
  const paid = new Map();
  for (const r of payouts) {
    const creditor = byId(s, r.to);
    creditor.cash += r.amount;
    paid.set(r.to, (paid.get(r.to) || 0) + r.amount);
    if (r.reason === 'rent') {
      p.stats.rentPaid += r.amount;
      creditor.stats.rentEarned += r.amount;
      creditor.stats.biggestRent = Math.max(creditor.stats.biggestRent, r.amount);
    }
  }
  for (const [to, amount] of paid) ev.push({ type: 'cash', player: to, delta: amount, reason: 'bankrupt', other: p.id });
  p.bankrupt = true;
  s.outCount = (s.outCount || 0) + 1;
  p.outOrder = s.outCount;
  p.cash = 0;
  p.stuck = false;
  p.chai = 0;
  p.snatches = 0;
  p.sixes = 0;
  p.rentBoost = 0;
  if (powerOn(s)) {
    p.hand = []; // power cards of a player who is out are discarded
    p.shield = 0;
    p.doubleRent = 0;
  }
  if (s.ride && s.ride.player === p.id) s.ride = null;
  cancelTradeOf(s, ev, p.id, 'bankrupt');
  // reason 'resign' = left by choice; `paid` (only when a creditor was paid) tells who the bank paid, for the log
  ev.push({
    type: 'bankrupt', player: p.id, ...(how ? { reason: how } : null),
    ...(paid.size ? { paid: [...paid].map(([to, amount]) => ({ to, amount })) } : null),
  });
}

/**
 * Settle one payment. Returns true when it is done (paid, skipped or the payer went bankrupt) and
 * false when the game paused in the `debt` phase (the remaining payments in `rest` are kept on the debt).
 */
function settlePayment(s, ev, pay, rest) {
  const p = byId(s, pay.from);
  if (!p || p.bankrupt) return true;
  let creditor = pay.to ? byId(s, pay.to) : null;
  if (creditor && creditor.bankrupt) creditor = null;
  let amount = Math.max(0, Math.round(pay.amount));
  if (amount === 0) return true;
  // Power card Shield: the next rent or municipal tax is waived in full (consumed). Before chai, so chai is kept.
  // A waived rent never reaches the owner, so their armed Double Rent stays armed.
  if (powerOn(s) && (pay.reason === 'rent' || pay.reason === 'tax') && shieldArmed(s, p)) {
    p.shield = 0;
    ev.push({ type: 'power_trigger', player: p.id, card: 'shield', amount, ...(creditor ? { other: creditor.id } : null) });
    return true;
  }
  const billed = amount;
  // Irani chai: the first rent payment of at least CHAI_MIN_RENT is halved automatically.
  if (pay.reason === 'rent' && (p.chai || 0) > 0 && amount >= CHAI_MIN_RENT) {
    const saved = Math.floor(amount / 2);
    amount -= saved;
    p.chai -= 1;
    p.stats.chaiSaved += saved;
    ev.push({ type: 'chai', player: p.id, chai: p.chai, change: -1, reason: 'rent', saved });
  }
  // Power card Double Rent: the rent that carried the doubling is paid (or owed): the owner's card is spent.
  if (pay.reason === 'rent' && pay.extra > 0 && creditor && doubleArmed(s, creditor)) {
    creditor.doubleRent = 0;
    ev.push({ type: 'power_trigger', player: creditor.id, card: 'double', amount: billed === amount ? pay.extra : Math.round((pay.extra * amount) / billed), other: p.id });
  }
  if (p.cash >= amount) {
    transfer(s, ev, p, creditor, amount, pay.reason);
    return true;
  }
  if (p.cash + liquidationValue(s, p.id) >= amount) {
    s.debt = {
      player: p.id,
      amount,
      creditor: creditor ? creditor.id : null,
      reason: pay.reason,
      returnPhase: s.phase === 'debt' ? 'manage' : s.phase,
      rest: rest.slice(),
    };
    rest.length = 0;
    s.phase = 'debt';
    ev.push({ type: 'debt', player: p.id, amount, creditor: s.debt.creditor });
    return false;
  }
  // too deep in debt even after selling everything: the bank takes all; the creditor is paid up to the estate, then the
  // player's other queued payments (same cause) in order
  bankruptPlayer(s, ev, p, [{ to: creditor ? creditor.id : null, amount, reason: pay.reason }, ...takeOwnPayments(rest, p.id)]);
  return true;
}

function runPayments(s, ev, list) {
  while (list.length) {
    const pay = list.shift();
    if (!settlePayment(s, ev, pay, list)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Movement, landing, cards, auctions
// ---------------------------------------------------------------------------------------------

function moveForward(s, ev, p, steps, extra = null) {
  const from = p.pos;
  const path = [];
  for (let i = 1; i <= steps; i++) path.push((from + i) % BOARD_SIZE);
  if (path.length === 0) return;
  const passedStart = path.includes(START_TILE);
  p.pos = path[path.length - 1];
  ev.push({ type: 'move', player: p.id, from, to: p.pos, path, passedStart, ...(extra || {}) });
  if (passedStart) {
    gain(s, ev, p, passStartOf(s), 'salary');
    p.laps = (p.laps || 0) + 1;
  }
}

function moveBackward(s, ev, p, steps) {
  const from = p.pos;
  const path = [];
  for (let i = 1; i <= steps; i++) path.push((from - i + BOARD_SIZE * 4) % BOARD_SIZE);
  if (path.length === 0) return;
  p.pos = path[path.length - 1];
  ev.push({ type: 'move', player: p.id, from, to: p.pos, path, passedStart: false });
}

/** Stuck in traffic where you stand: the extra roll is lost and the turn ends (the caller ends it). */
function getStuck(s, ev, p, reason) {
  p.stuck = true;
  p.sixes = 0;
  s.extraRoll = false;
  s.pending = null;
  if (s.ride && s.ride.player === p.id) s.ride = null;
  ev.push({ type: 'traffic', player: p.id, stuck: true, reason });
}

function gainChai(s, ev, p, reason) {
  if ((p.chai || 0) >= s.cfg.chaiCap) return false; // at the cap nothing happens
  p.chai = (p.chai || 0) + 1;
  ev.push({ type: 'chai', player: p.id, chai: p.chai, change: 1, reason });
  return true;
}

function land(s, ev, p, depth = 0) {
  const tileId = p.pos;
  const tile = TILES[tileId];
  ev.push({ type: 'land', player: p.id, tile: tileId });
  switch (tile.type) {
    case 'property': {
      const ownerId = s.owners[tileId];
      if (ownerId === null || ownerId === undefined) {
        if (p.cash >= tile.price) {
          s.pending = { type: 'buy', tile: tileId, price: tile.price };
          s.phase = 'buy';
        }
        // Cannot afford it: nothing is offered and nothing is auctioned; the district stays free (no way around Snatch).
      } else if (ownerId !== p.id) {
        const owner = byId(s, ownerId);
        if (owner && !owner.bankrupt) {
          const rent = rentOf(s, tileId, ownerId);
          // an armed Double Rent is inside `rent`; `extra` is what it added (so settlePayment can report and consume it)
          const extra = doubleArmed(s, owner) ? rent - rentOf(s, tileId, ownerId, false) : 0;
          runPayments(s, ev, [{ from: p.id, to: ownerId, amount: rent, reason: 'rent', ...(extra > 0 ? { extra } : null) }]);
        }
      }
      break;
    }
    case 'transport':
      s.ride = { player: p.id, from: tileId, to: nextTransport(tileId), fare: tile.fare };
      break;
    case 'traffic':
      getStuck(s, ev, p, 'tile');
      break;
    case 'chai':
      gainChai(s, ev, p, 'adda');
      break;
    case 'municipal':
      runPayments(s, ev, [{ from: p.id, to: null, amount: municipalDue(s, p.id), reason: 'tax' }]);
      break;
    case 'auction': {
      const free = [];
      for (let i = 0; i < BOARD_SIZE; i++) if (isBuyable(TILES[i]) && !s.owners[i]) free.push(i);
      if (free.length) openAuction(s, ev, free[randInt(s, free.length)], 'bazaar');
      break;
    }
    case 'card':
      if (depth < MAX_CARD_DEPTH) {
        drawCard(s, ev, p, depth, tile.deck);
        drawPower(s, ev, p, 'tile', tileId); // a power card too, when the rule is on and the hand has room
      }
      break;
    default:
      break; // START: the salary came with the move
  }
}

/**
 * Card indices a deck is shuffled from. The Snatch cards are only in the Nawabi Luck deck while they can do something:
 * the game has Snatch (`cfg.snatches` > 0) and lets players win buttons from cards (`cfg.snatchCardCap` > 0).
 */
function deckOrder(s, deckId) {
  const canSnatch = snatchOn(s) && snatchCardCapOf(s) > 0;
  const order = [];
  deckCards(s, deckId).forEach((c, i) => {
    if (c.effect.type !== 'snatch' || canSnatch) order.push(i);
  });
  return order;
}

/** Can `p` gain a Snatch button from a card right now (Snatch on, and fewer than cfg.snatchCardCap won from cards)? */
const canWinSnatchCard = (s, p) => snatchOn(s) && (p.snatchCards || 0) < snatchCardCapOf(s);

function drawCard(s, ev, p, depth, deckId) {
  const cards = deckCards(s, deckId);
  if (!s.deck || typeof s.deck !== 'object' || Array.isArray(s.deck)) s.deck = { luck: [], drama: [] };
  if (!s.deckPos || typeof s.deckPos !== 'object') s.deckPos = { luck: 0, drama: 0 };
  if (!Array.isArray(s.deck[deckId]) || (s.deckPos[deckId] || 0) >= s.deck[deckId].length) {
    s.deck[deckId] = shuffle(s, deckOrder(s, deckId)); // exhausted: reshuffle the whole deck
    s.deckPos[deckId] = 0;
  }
  const card = cards[s.deck[deckId][s.deckPos[deckId]]];
  s.deckPos[deckId] += 1;
  // A Snatch card for a player who cannot win another button pays SNATCH_CAP_PAYOUT instead, and says so.
  const capped = card.effect.type === 'snatch' && !canWinSnatchCard(s, p);
  ev.push({
    type: 'card', player: p.id, cardId: card.id, kind: card.kind, deck: deckId, title: card.title,
    text: capped && card.capText ? card.capText : card.text, ...(capped ? { capped: true } : null),
  });
  const fx = card.effect;
  const others = () => activePlayers(s).filter((q) => q.id !== p.id);
  switch (fx.type) {
    case 'cash':
      if (fx.amount >= 0) gain(s, ev, p, fx.amount, 'card');
      else runPayments(s, ev, [{ from: p.id, to: null, amount: -fx.amount, reason: 'card' }]);
      break;
    case 'moveTo': {
      const steps = (fx.tile - p.pos + BOARD_SIZE) % BOARD_SIZE;
      if (steps === 0) break;
      moveForward(s, ev, p, steps);
      land(s, ev, p, depth + 1);
      break;
    }
    case 'nextTransport': {
      const steps = (nextTransport(p.pos) - p.pos + BOARD_SIZE) % BOARD_SIZE;
      moveForward(s, ev, p, steps);
      land(s, ev, p, depth + 1);
      break;
    }
    case 'moveBy':
      if (fx.n >= 0) moveForward(s, ev, p, fx.n);
      else moveBackward(s, ev, p, -fx.n);
      land(s, ev, p, depth + 1);
      break;
    case 'stuck':
      getStuck(s, ev, p, 'card');
      break;
    case 'rentBoost':
      p.rentBoost = Math.max(p.rentBoost || 0, fx.mult);
      break;
    case 'chai':
      gainChai(s, ev, p, 'card');
      break;
    case 'snatch':
      if (capped) {
        gain(s, ev, p, SNATCH_CAP_PAYOUT, 'card');
      } else {
        const add = Math.min(Math.max(1, fx.amount | 0), snatchCardCapOf(s) - (p.snatchCards || 0));
        p.snatches = (p.snatches || 0) + add;
        p.snatchCards = (p.snatchCards || 0) + add;
        ev.push({ type: 'token_earned', player: p.id, reason: 'card', snatches: p.snatches });
      }
      break;
    case 'collectFromAll':
      runPayments(s, ev, others().map((q) => ({ from: q.id, to: p.id, amount: fx.amount, reason: 'card' })));
      break;
    case 'payAll':
      runPayments(s, ev, others().map((q) => ({ from: p.id, to: q.id, amount: fx.amount, reason: 'card' })));
      break;
    case 'perLevel':
      runPayments(s, ev, [{ from: p.id, to: null, amount: fx.amount * levelsOwned(s, p.id), reason: 'card' }]);
      break;
    case 'perProperty':
      runPayments(s, ev, [{ from: p.id, to: null, amount: fx.amount * districtsOwned(s, p.id), reason: 'card' }]);
      break;
    default:
      break;
  }
}

/**
 * Open a sealed auction for `tile` (docs/GAME_RULES.md section 6). `pending`:
 *   { type:'auction', id, tile, minBid, bids:{ id: amount }, bidIn:[ids who submitted a bid], eligible:[ids who may bid],
 *     ms (the bidding window, the server's timer), reason, returnPhase, snatch?, buyer?, claimants? }
 * `eligible` = the active players who can afford `minBid` (for Snatch bidding: the claimants who can). The others are
 * passed at once (`bids[id] = 0`, not in `bidIn`). Nobody able to bid: the auction ends in this very call.
 */
function beginAuction(s, ev, tile, reason, extra = {}) {
  const minBid = auctionMinBid(tile, reason);
  const ms = extra.snatch ? snatchBidMsOf(s.cfg) : auctionMsOf(s.cfg);
  s.auctionSeq = (s.auctionSeq || 0) + 1;
  const bids = {};
  const eligible = [];
  for (const q of s.players) {
    if (q.bankrupt) continue;
    if (extra.claimants && !extra.claimants.includes(q.id)) bids[q.id] = 0; // non-claimants auto-pass
    else if (q.cash < minBid) bids[q.id] = 0; // so do the broke
    else eligible.push(q.id);
  }
  s.pending = { type: 'auction', id: s.auctionSeq, tile, minBid, bids, bidIn: [], eligible, ms, reason, ...extra, returnPhase: extra.returnPhase || 'manage' };
  s.phase = 'auction';
  ev.push({ type: 'auction_start', tile, minBid, reason, eligible: [...eligible], ms });
  maybeResolveAuction(s, ev);
}

function openAuction(s, ev, tile, reason) {
  beginAuction(s, ev, tile, reason);
}

/** Record that `id` has submitted a bid (or passed): the public `pending.bidIn`. Amounts stay in `bids` (sealed on the wire). */
function markBidIn(pend, id) {
  if (!Array.isArray(pend.bidIn)) pend.bidIn = [];
  if (!pend.bidIn.includes(id) && (!Array.isArray(pend.eligible) || pend.eligible.includes(id))) pend.bidIn.push(id);
}

function maybeResolveAuction(s, ev) {
  const pend = s.pending;
  if (s.phase !== 'auction' || !pend) return;
  if (!activePlayers(s).every((p) => p.id in pend.bids)) return;
  resolveAuction(s, ev, []);
}

/**
 * Close the sealed auction: highest valid bid wins and pays its own bid (first price). A tie for the top bid is drawn
 * with the game's seeded rng among the tied bidders (seats counted from the turn player, so the draw is reproducible).
 * `timedOut` = the players the server passed because the window ran out.
 */
function resolveAuction(s, ev, timedOut) {
  const pend = s.pending;
  const n = s.players.length;
  const seats = [];
  for (let k = 0; k < n; k++) seats.push(s.players[(s.turn + k) % n]);
  const eligible = Array.isArray(pend.eligible) ? pend.eligible : seats.filter((p) => p.id in pend.bids).map((p) => p.id);
  const valid = seats.filter((p) => {
    const bid = pend.bids[p.id] || 0;
    return !p.bankrupt && eligible.includes(p.id) && bid >= pend.minBid && bid <= p.cash;
  });
  let best = 0;
  for (const p of valid) best = Math.max(best, pend.bids[p.id]);
  const tied = valid.filter((p) => pend.bids[p.id] === best);
  const tie = tied.length > 1;
  const winner = tied.length ? (tie ? tied[randInt(s, tied.length)] : tied[0]) : null;
  // Ranked highest bid first (the winner leads its tie), then the players who passed, in seat order.
  const ranked = valid.filter((p) => p !== winner).sort((a, b) => pend.bids[b.id] - pend.bids[a.id]);
  const order = [...(winner ? [winner.id] : []), ...ranked.map((p) => p.id)];
  for (const p of seats) if (eligible.includes(p.id) && !order.includes(p.id)) order.push(p.id);
  const bids = {};
  for (const p of s.players) bids[p.id] = pend.bids[p.id] || 0;
  const end = { type: 'auction_end', tile: pend.tile, winner: winner ? winner.id : null, amount: winner ? best : 0, bids, order, tie, reason: pend.reason };
  if (pend.snatch) end.buyer = pend.buyer; // the bidding that follows two or more Snatch presses
  const price = TILES[pend.tile] ? TILES[pend.tile].price : 0;
  if (winner && price > best) end.saved = price - best; // what the winner saved against the district price
  if (timedOut && timedOut.length) end.timedOut = [...timedOut]; // passed by the server when the window ran out
  ev.push(end);
  s.pending = null;
  s.phase = pend.returnPhase || 'manage';
  if (winner) {
    winner.cash -= best;
    ev.push({ type: 'cash', player: winner.id, delta: -best, reason: 'auction' });
    s.owners[pend.tile] = winner.id;
    ev.push({ type: 'own', tile: pend.tile, owner: winner.id, reason: 'auction' });
    winner.stats.propertiesBought += 1;
    if (pend.snatch) spendToken(s, ev, winner); // only whoever ends up with the tile spends the button
    emitSets(s, ev, winner.id, [pend.tile]);
  } else if (pend.snatch) {
    keepWithBuyer(s, ev, pend.tile, pend.buyer);
  }
}

// ---------------------------------------------------------------------------------------------
// Snatch (docs/GAME_RULES.md section 9): after a successful BUY of a free district on landing, every OTHER player who
// still holds a Snatch button gets a short real-time window (`cfg.snatchMs`) to press it. Nobody pressing: the buyer
// keeps the district. One presser: the district is theirs for free (the buyer is NOT refunded) and they spend one
// button. Several pressers: sealed bidding among them (the auction machinery above). Presses are sealed: no event.
// ---------------------------------------------------------------------------------------------

function spendToken(s, ev, p) {
  p.snatches = Math.max(0, (p.snatches || 0) - 1);
  ev.push({ type: 'snatch_token', player: p.id, snatches: p.snatches });
}

/** The set celebration the buyer was denied while the district was contested. */
function keepWithBuyer(s, ev, tile, buyerId) {
  const buyer = byId(s, buyerId);
  if (buyer && !buyer.bankrupt && s.owners[tile] === buyerId) emitSets(s, ev, buyerId, [tile]);
}

/** Players who can still act in the open window: eligible and not bankrupt. */
const snatchVoters = (s) => s.pending.eligible.filter((id) => !byId(s, id)?.bankrupt);

/** Opens the window after `buyer` paid `price` for `tile`; false (and nothing changes) when nobody else holds a button. */
function openSnatch(s, ev, buyer, tile, price) {
  const eligible = activePlayers(s).filter((q) => q.id !== buyer.id && (q.snatches || 0) > 0).map((q) => q.id);
  if (!eligible.length) return false;
  const ms = snatchMsOf(s);
  s.pending = { type: 'snatch', tile, buyer: buyer.id, price, eligible, claims: [], ms, returnPhase: 'manage' };
  s.phase = 'snatch';
  ev.push({ type: 'snatch_open', tile, buyer: buyer.id, price, eligible: [...eligible], ms });
  return true;
}

/** Close the window: nothing, a free transfer to the single presser, or sealed bidding among two or more pressers. */
function resolveSnatch(s, ev) {
  const pend = s.pending;
  const { tile, buyer, price } = pend;
  // A buyer who resigned mid-window already handed the district to the bank: a district that is still the buyer's, or
  // free, can be snatched; one that somebody else holds now (never happens today) cannot.
  const holder = s.owners[tile];
  const contestable = holder === buyer || holder === null || holder === undefined;
  const claimants = contestable ? pend.claims.filter((id) => !byId(s, id)?.bankrupt) : [];
  s.pending = null;
  s.phase = pend.returnPhase || 'manage';
  if (claimants.length === 0) {
    ev.push({ type: 'snatch_end', tile, buyer, outcome: 'none' });
    keepWithBuyer(s, ev, tile, buyer);
    return;
  }
  if (claimants.length === 1) {
    const taker = byId(s, claimants[0]);
    s.owners[tile] = taker.id;
    taker.stats.propertiesBought += 1;
    ev.push({ type: 'snatch_end', tile, buyer, outcome: 'snatched', winner: taker.id, claimants: [taker.id] });
    ev.push({ type: 'own', tile, owner: taker.id, reason: 'snatch' });
    spendToken(s, ev, taker);
    emitSets(s, ev, taker.id, [tile]);
    return;
  }
  ev.push({ type: 'snatch_end', tile, buyer, outcome: 'bidding', claimants: [...claimants] });
  // Non-claimants (and the claimants who cannot afford the minimum) auto-pass; the bidding has its own, shorter window.
  beginAuction(s, ev, tile, 'snatch', { snatch: true, buyer, claimants: [...claimants], returnPhase: pend.returnPhase || 'manage' });
}

/** Resolve at once when every player who could still press has pressed. */
function maybeCloseSnatch(s, ev) {
  if (s.phase !== 'snatch' || !s.pending) return;
  if (snatchVoters(s).every((id) => s.pending.claims.includes(id))) resolveSnatch(s, ev);
}

// ---------------------------------------------------------------------------------------------
// Power cards (docs/POWER_CARDS.md). An optional rule (`cfg.powerCards`, off by default): every player holds up to POWER.HAND_MAX
// short-lived cards, drawn from card tiles and as a turn-start bonus, played in the roll phase before the roll. They draw
// from their own stream `state.prng` (never `rng`), so the rule never shifts a board outcome and a game with it off is untouched.
// Hooks: draw = land() on a card tile + endTurn() (turn start); expiry = startRound(); play = PLAY_POWER (phase roll);
// effects = settlePayment() (Shield, Double Rent), rentOf() (Double Rent), doRoll() (Steal a Roll), doPlayPower() (Swap Tiles).
// ---------------------------------------------------------------------------------------------

/** Next float in [0,1) from the Power cards stream. Advances `s.prng` (derived from `s.rng` when a stored game lacks it). */
function powerFloat(s) {
  const h = { rng: Number.isInteger(s.prng) ? s.prng : (s.rng ^ POWER_SEED_XOR) >>> 0 };
  const f = nextFloat(h);
  s.prng = h.rng;
  return f;
}

/**
 * Weighted pick of a card id from POWER.WEIGHTS (one draw on the Power stream). With the drawing player `p` the weights favour
 * variety: a type a rival already holds counts VARIETY_OTHER x per rival, a type `p` already holds VARIETY_OWN x, so the table
 * is not dealt the same card over and over. Only the weights change: still exactly one draw, still deterministic.
 */
export function pickPowerId(s, p) {
  const weights = POWER_IDS.map((id) => {
    let w = Math.max(0, Number(POWER.WEIGHTS[id]) || 0);
    if (p) {
      for (const q of s.players) {
        if (q.bankrupt || !Array.isArray(q.hand)) continue;
        const n = q.hand.filter((c) => c && c.id === id).length;
        if (n) w *= q === p ? Math.pow(POWER.VARIETY_OWN, n) : Math.pow(POWER.VARIETY_OTHER, n);
      }
    }
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = powerFloat(s) * total;
  for (let i = 0; i < POWER_IDS.length; i++) {
    if (r < weights[i]) return POWER_IDS[i];
    r -= weights[i];
  }
  return POWER_IDS[0];
}

/**
 * Give `p` a power card when the rule is on, they are in the game and the hand has room (a full hand gets nothing, no
 * prompt). `source` 'tile' (a card tile, `tile` = its index) or 'turn'. The `power_draw` event never names the card.
 */
function drawPower(s, ev, p, source, tile) {
  if (!powerOn(s) || p.bankrupt) return false;
  if (!Array.isArray(p.hand)) p.hand = [];
  if (p.hand.length >= POWER.HAND_MAX) return false;
  const id = pickPowerId(s, p);
  const seat = s.players.indexOf(p);
  let uid;
  do uid = `p${seat}-${s.round}-${Math.floor(powerFloat(s) * 4096).toString(36)}`;
  while (p.hand.some((c) => c.uid === uid));
  p.hand.push({ uid, id, exp: s.round + POWER.LIFE_ROUNDS });
  ev.push({ type: 'power_draw', player: p.id, source, ...(tile !== undefined && tile !== null ? { tile } : null) });
  return true;
}

/** Is `p` trailing: net worth below POWER.TRAILING_RATIO x the average of the active players? */
function isTrailing(s, p) {
  const active = activePlayers(s);
  if (active.length < 2) return false;
  const avg = active.reduce((n, q) => n + netWorth(s, q.id), 0) / active.length;
  return netWorth(s, p.id) < POWER.TRAILING_RATIO * avg;
}

/** The turn-start bonus: when the turn begins (phase roll) and the hand has room, a chance of a card (higher when trailing). */
function turnStartDraw(s, ev, p) {
  if (!p || p.bankrupt || !Array.isArray(p.hand) || p.hand.length >= POWER.HAND_MAX) return;
  const chance = isTrailing(s, p) ? POWER.TRAILING_CHANCE : POWER.TURN_START_CHANCE;
  if (powerFloat(s) < chance) drawPower(s, ev, p, 'turn');
}

/**
 * A new round begins: cards past their `exp` leave every hand (one `power_expire { player, count }` per player who lost
 * some; identities are never named) and armed Shield / Double Rent past their round lapse silently.
 */
function expirePower(s, ev) {
  if (!powerOn(s)) return;
  for (const q of s.players) {
    if (q.bankrupt) continue;
    const hand = handOf(q);
    const keep = hand.filter((c) => c.exp >= s.round);
    if (keep.length !== hand.length) {
      q.hand = keep;
      ev.push({ type: 'power_expire', player: q.id, count: hand.length - keep.length });
    }
    if ((q.shield || 0) > 0 && q.shield < s.round) q.shield = 0;
    if ((q.doubleRent || 0) > 0 && q.doubleRent < s.round) q.doubleRent = 0;
  }
}

/** null when `p` may play a card right now (turn player, phase roll, nothing open, not yet played this turn), else the reason. */
function powerGate(s, p) {
  if (!powerOn(s)) return 'Power cards are not enabled';
  if (s.phase === 'over') return 'The game is over';
  if (p.bankrupt) return 'You are out of the game';
  if (turnPlayer(s).id !== p.id) return 'Not your turn';
  if (s.trade) return 'Answer the trade offer first';
  if (s.phase === 'debt') return 'Settle the debt first';
  if (s.phase !== 'roll') return 'Play a card before you roll';
  if (s.powerPlayed) return 'Already played a card this turn';
  return null;
}

/** Why `target` cannot be swapped with by `p` (null = fine). Stuck pawns, bankrupt players, yourself and the same tile are out. */
function swapTargetProblem(s, p, target) {
  if (!target || target.bankrupt || target.id === p.id) return 'Pick an active rival to swap with';
  if (p.stuck) return 'You are stuck in traffic';
  if (target.stuck) return `${target.name} is stuck in traffic`;
  if (target.pos === p.pos) return `You are already on the same tile as ${target.name}`;
  return null;
}

const swapTargetsOf = (s, p) => s.players.filter((q) => !swapTargetProblem(s, p, q)).map((q) => q.id);

/** null when `card` (a hand entry) may be played by `p` now with `target`, else the reason. The gate is checked by the caller. */
function powerCardProblem(s, p, card, target) {
  if (card.exp < s.round) return 'That card has expired';
  if (card.id === 'swap') {
    if (p.stuck) return 'You are stuck in traffic';
    if (target === undefined || target === null) return swapTargetsOf(s, p).length ? 'Pick a rival to swap with' : 'No rival can swap right now';
    return swapTargetProblem(s, p, byId(s, target));
  }
  if (target !== undefined && target !== null) return 'This card has no target';
  if (card.id === 'steal') {
    if (p.stuck) return 'Get out of the traffic jam first'; // the roll would only wait the jam out and the extra roll would be lost
    if (s.extraRoll) return 'You already have an extra roll';
  }
  return null;
}

/**
 * `getOptions(...).power` (rule on): `{ canPlay, reason?, cards: [{ uid, id, exp, ok, reason?, targets? }] }`. `cards` is the
 * viewer's own hand; every card carries `ok` and, when not playable, the user-facing `reason`; a swap lists its legal `targets`.
 */
function powerOptions(s, playerId) {
  const p = byId(s, playerId);
  if (!p) return { canPlay: false, reason: 'Unknown player', cards: [] };
  const gate = powerGate(s, p);
  const cards = handOf(p).map((c) => {
    const row = { uid: c.uid, id: c.id, exp: c.exp, ok: false };
    if (c.id === 'swap') row.targets = gate ? [] : swapTargetsOf(s, p);
    const why = gate || powerCardProblem(s, p, c, c.id === 'swap' ? row.targets[0] : undefined);
    if (why) row.reason = why;
    else row.ok = true;
    return row;
  });
  if (cards.some((c) => c.ok)) return { canPlay: true, cards };
  return { canPlay: false, reason: gate || (cards.length ? cards[0].reason : 'You hold no power cards'), cards };
}

/** PLAY_POWER: spend the card, announce it (public), apply its effect. Validated by `validate`. */
function doPlayPower(s, ev, p, action) {
  const hand = handOf(p);
  const idx = hand.findIndex((c) => c.uid === action.card);
  const [card] = hand.splice(idx, 1);
  s.powerPlayed = true;
  const target = card.id === 'swap' ? byId(s, action.target) : null;
  ev.push({ type: 'power_play', player: p.id, card: card.id, ...(target ? { target: target.id } : null) });
  switch (card.id) {
    case 'shield':
      p.shield = s.round + POWER.ARMED_ROUNDS;
      break;
    case 'double':
      p.doubleRent = s.round + POWER.ARMED_ROUNDS;
      break;
    case 'steal':
      s.extraRoll = true; // the same state as a six, without a dice event (doRoll keeps it through the first roll)
      break;
    case 'swap': {
      // Two teleports, no landing, nobody passes START.
      const a = p.pos;
      const b = target.pos;
      p.pos = b;
      target.pos = a;
      ev.push({ type: 'move', player: p.id, from: a, to: b, path: [b], passedStart: false, teleport: true });
      ev.push({ type: 'move', player: target.id, from: b, to: a, path: [a], passedStart: false, teleport: true });
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Turn flow, city events and the win check
// ---------------------------------------------------------------------------------------------

/** A new round begins: last round's city event ends, and every `cfg.eventEvery`-th round (default 3) draws a new one (seeded rng). */
function startRound(s, ev) {
  s.event = null;
  if (s.round > roundLimit(s)) return; // the round limit just ended the game: no event
  expirePower(s, ev); // power cards past their round go, armed effects lapse
  const every = eventEveryOf(s);
  if (every <= 0 || s.round % every !== 0) return; // host rule `eventEvery`: 0 = no city events
  const defs = cityEventsOf(s);
  const def = defs[randInt(s, defs.length)];
  const event = { id: def.id, title: def.title, text: def.text, kind: def.kind, round: s.round };
  if (def.pick === 'owned') {
    const all = Object.keys(GROUPS);
    const owned = all.filter((g) => GROUP_TILES[g].some((t) => s.owners[t]));
    const pool = owned.length ? owned : all;
    event.group = pool[randInt(s, pool.length)];
    if (def.id === 'rush_hour') Object.assign(event, rushFlavourOf(s)[event.group]);
    if (def.id === 'monsoon') event.text = monsoonTextOf(s, groupName(s, event.group));
  }
  if (def.groups) event.groups = [...def.groups];
  if (def.mult) event.mult = def.mult;
  if (def.upgradedOnly) event.upgradedOnly = true;
  if (def.amount) event.amount = def.amount;
  if (def.bonus) event.bonus = def.bonus;
  if (def.id === 'festival') {
    const fests = festivalsOf(s);
    Object.assign(event, fests[randInt(s, fests.length)]);
  }
  s.event = event;
  ev.push({ type: 'city_event', ...event });

  if (def.id === 'festival') {
    for (const q of activePlayers(s)) gain(s, ev, q, def.amount, 'event');
  } else if (def.id === 'wedding_season') {
    // Venue owners first (an upgraded, unmortgaged Lake & Leisure or Luxury district earns the bonus), then everyone pays.
    for (const q of activePlayers(s)) {
      let venues = 0;
      for (const g of def.groups) for (const t of GROUP_TILES[g]) if (s.owners[t] === q.id && s.levels[t] > 0 && !isMort(s, t)) venues++;
      gain(s, ev, q, venues * def.bonus, 'event');
    }
    runPayments(s, ev, activePlayers(s).map((q) => ({ from: q.id, to: null, amount: -def.amount, reason: 'event' })));
  }
}

function endTurn(s, ev) {
  const n = s.players.length;
  const cur = s.turn;
  const me = s.players[cur];
  me.sixes = 0;
  me.rentStreak = (me.rentThisTurn || 0) >= DICE_RULES.mercy.minRent ? (me.rentStreak || 0) + 1 : 0;
  me.rentThisTurn = 0;
  s.extraRoll = false;
  s.pending = null;
  s.ride = null;
  let next = cur;
  for (let k = 1; k <= n; k++) {
    next = (cur + k) % n;
    if (!s.players[next].bankrupt) break;
  }
  s.turn = next;
  s.phase = 'roll';
  s.turnCount += 1;
  s.players[next].rentBoost = 0; // "your rents x2 until your next turn" ends now
  if (powerOn(s)) s.powerPlayed = false; // a new turn: one power card may be played again
  if (next <= cur) {
    s.round += 1;
    startRound(s, ev);
  }
  // past the round limit the game is over (checkWin runs next): no turn hand-off for a round that never starts
  if (s.round <= roundLimit(s)) ev.push({ type: 'turn', player: s.players[next].id, round: s.round });
  // Host rule `trafficFine` 0: leaving the jam is free, so a jammed player is simply let out when their turn comes
  // (otherwise they would be offered a "pay nothing" button; `payTraffic: 0` is falsy for every client and bot).
  if (s.players[next].stuck && s.cfg.trafficFine === 0 && !s.players[next].bankrupt) {
    s.players[next].stuck = false;
    ev.push({ type: 'traffic', player: s.players[next].id, stuck: false, reason: 'free' });
  }
  // Power cards, turn-start bonus: drawn as the turn begins (phase roll), after the round start (expiry) and the turn event
  if (powerOn(s) && s.round <= roundLimit(s)) turnStartDraw(s, ev, s.players[next]);
}

/** The richest active player: highest net worth, then most cash, then the earliest seat (same order as standings). */
function richest(s) {
  let best = null;
  for (const p of activePlayers(s)) {
    const w = netWorth(s, p.id);
    if (!best || w > best.w || (w === best.w && p.cash > best.p.cash)) best = { p, w };
  }
  return best ? best.p : null;
}

/**
 * The win target: the player whose net worth has reached `cfg.targetWorth` (richest first, then most cash, then the
 * earliest seat), or null. It is only looked at once nothing is in flight: no debt, auction, Snatch window or open trade, so a worth
 * that is only high in the middle of a payment or a deal never decides the game.
 */
function targetWinner(s) {
  const target = s.cfg.targetWorth;
  if (target == null) return null;
  if (s.phase === 'debt' || s.phase === 'auction' || s.phase === 'snatch' || s.debt || s.trade) return null;
  let best = null;
  for (const p of activePlayers(s)) {
    const w = netWorth(s, p.id);
    if (w < target) continue;
    if (!best || w > best.w || (w === best.w && p.cash > best.p.cash)) best = { p, w };
  }
  return best ? best.p : null;
}

function checkWin(s, ev) {
  if (s.phase === 'over') return;
  const active = activePlayers(s);
  let winner = null;
  let reason = null;
  if (active.length <= 1) {
    winner = active[0] || null;
    reason = 'last_standing';
  } else if ((winner = targetWinner(s))) {
    reason = 'target';
  } else if (s.round > roundLimit(s) && s.phase !== 'debt' && s.phase !== 'auction') {
    winner = richest(s);
    reason = 'rounds';
  }
  if (!reason) return;
  s.phase = 'over';
  s.pending = null;
  s.trade = null;
  s.debt = null;
  s.ride = null;
  s.extraRoll = false;
  s.winner = winner ? winner.id : null;
  s.winReason = reason;
  ev.push({ type: 'win', player: s.winner, reason, worth: winner ? netWorth(s, winner.id) : 0 });
}

/** Runs after every action: auto-ends the turn of a bankrupt player, then checks for a winner. */
function settle(s, ev) {
  if (s.phase !== 'over' && activePlayers(s).length >= 2) {
    const tp = turnPlayer(s);
    if (tp.bankrupt && s.phase !== 'auction' && s.phase !== 'debt' && s.phase !== 'snatch') endTurn(s, ev);
  }
  checkWin(s, ev);
}

// ---------------------------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------------------------

function normSide(side) {
  const src = side && typeof side === 'object' ? side : {};
  const cash = src.cash === undefined || src.cash === null ? 0 : src.cash;
  const tiles = src.tiles === undefined || src.tiles === null ? [] : src.tiles;
  if (!Number.isInteger(cash) || cash < 0) return null;
  if (!Array.isArray(tiles) || !tiles.every((t) => Number.isInteger(t) && t >= 0 && t < BOARD_SIZE)) return null;
  if (new Set(tiles).size !== tiles.length) return null;
  return { cash, tiles: [...tiles] };
}

/** null when the trade is valid, else the reason. `give` leaves `from`, `get` leaves `to`. Upgrades travel with the district. */
function tradeProblem(s, from, to, give, get) {
  if (!from || !to || from.bankrupt || to.bankrupt || from.id === to.id) return 'Pick another active player to trade with';
  if (!give || !get) return 'Invalid offer';
  if (give.cash + get.cash + give.tiles.length + get.tiles.length === 0) return 'The offer is empty';
  if (give.cash > from.cash) return 'You do not have that much cash';
  if (get.cash > to.cash) return `${to.name} does not have that much cash`;
  const check = (tiles, owner) => {
    for (const t of tiles) {
      const tile = TILES[t];
      if (!isBuyable(tile)) return 'Only districts can be traded';
      if (s.owners[t] !== owner.id) return owner === from ? `You do not own ${tileName(s, t)}` : `${owner.name} does not own ${tileName(s, t)}`;
    }
    return null;
  };
  return check(give.tiles, from) || check(get.tiles, to);
}

function doTradeDone(s, ev) {
  const t = s.trade;
  const from = byId(s, t.from);
  const to = byId(s, t.to);
  s.trade = null;
  ev.push({ type: 'trade_done', id: t.id, from: t.from, to: t.to, give: t.give, get: t.get });
  const pay = (a, b, amount) => {
    if (amount <= 0) return;
    a.cash -= amount;
    b.cash += amount;
    ev.push({ type: 'cash', player: a.id, delta: -amount, reason: 'trade', other: b.id });
    ev.push({ type: 'cash', player: b.id, delta: amount, reason: 'trade', other: a.id });
  };
  pay(from, to, t.give.cash);
  pay(to, from, t.get.cash);
  for (const tile of t.give.tiles) {
    s.owners[tile] = to.id;
    ev.push({ type: 'own', tile, owner: to.id, reason: 'trade' });
  }
  for (const tile of t.get.tiles) {
    s.owners[tile] = from.id;
    ev.push({ type: 'own', tile, owner: from.id, reason: 'trade' });
  }
  emitSets(s, ev, to.id, t.give.tiles);
  emitSets(s, ev, from.id, t.get.tiles);
}

// ---------------------------------------------------------------------------------------------
// Action handlers (operate on the cloned state)
// ---------------------------------------------------------------------------------------------

function doRoll(s, ev, action) {
  const p = turnPlayer(s);
  s.ride = null; // an unused ride offer ends with the next roll

  if (p.stuck) {
    // Waiting out the jam: no move, the jam clears, the turn ends.
    p.stuck = false;
    ev.push({ type: 'traffic', player: p.id, stuck: false, reason: 'waited' });
    endTurn(s, ev);
    return;
  }

  let rolled;
  if (s.cfg.debug === true && Array.isArray(action.dice)) rolled = { values: [...action.dice], assist: null, active: [] };
  else rolled = rollDice(s, p.id, { previewRent });
  const dice = rolled.values; // one element
  s.dice = [...dice];
  ev.push({ type: 'dice', player: p.id, values: [...dice], assist: rolled.assist ?? null });
  const total = dice[0];
  const isSix = total === 6;
  // Steal a Roll (docs/POWER_CARDS.md): played before the roll it sets `extraRoll` in phase `roll`. This first roll must not
  // clear it; the extra roll after it is then spent like any other. A six on the same roll does not add a second one.
  const stolen = s.phase === 'roll' && s.extraRoll === true;
  p.rollsSinceSix = isSix ? 0 : (p.rollsSinceSix || 0) + 1;
  if ((rolled.active || []).includes('mercy')) p.rentStreak = 0; // mercy lasts one roll
  if (isSix) {
    p.sixes += 1; // a six rolls again; three sixes in a row are not special
    s.extraRoll = true;
  } else {
    p.sixes = 0;
    s.extraRoll = stolen;
  }
  s.phase = 'manage';
  moveForward(s, ev, p, total);
  land(s, ev, p, 0);
  if (p.bankrupt || p.stuck) endTurn(s, ev); // stuck in traffic, or out of the game
}

function doRide(s, ev, p) {
  const r = s.ride;
  s.ride = null;
  p.cash -= r.fare;
  ev.push({ type: 'cash', player: p.id, delta: -r.fare, reason: 'fare' });
  ev.push({ type: 'ride', player: p.id, from: r.from, to: r.to, fare: r.fare });
  p.stats.rides += 1;
  moveForward(s, ev, p, (r.to - r.from + BOARD_SIZE) % BOARD_SIZE, { ride: true }); // arriving has no further effect
}

function doBuy(s, ev) {
  const p = turnPlayer(s);
  const { tile, price } = s.pending;
  p.cash -= price;
  ev.push({ type: 'cash', player: p.id, delta: -price, reason: 'buy' });
  s.owners[tile] = p.id;
  ev.push({ type: 'own', tile, owner: p.id, reason: 'buy' });
  p.stats.propertiesBought += 1;
  s.pending = null;
  s.phase = 'manage';
  // The set celebration waits for the Snatch window, when there is one: the district may still change hands.
  if (!openSnatch(s, ev, p, tile, price)) emitSets(s, ev, p.id, [tile]);
}

/** Pass on a district: it stays free, there is never an auction (it would let a buyer dodge the Snatch window). */
function doSkipBuy(s, ev) {
  const { tile } = s.pending;
  s.pending = null;
  s.phase = 'manage';
  ev.push({ type: 'skip', player: turnPlayer(s).id, tile });
}

function doUpgrade(s, ev, tile) {
  const p = turnPlayer(s);
  const cost = upgradeCost(TILES[tile]);
  p.cash -= cost;
  s.levels[tile] += 1;
  p.stats.upgrades += 1;
  ev.push({ type: 'cash', player: p.id, delta: -cost, reason: 'upgrade' });
  ev.push({ type: 'level', tile, level: s.levels[tile], reason: 'upgrade' });
}

function doResign(s, ev, p) {
  p.resigned = true; // left by choice (public): the UI says "Forfeit" instead of "Bankrupt"
  const debt = s.debt && s.debt.player === p.id ? s.debt : null;
  // What they owe: the open debt, then their other queued payments (a debt of someone else may hold some in its `rest`).
  // The bank takes everything either way; only these creditors are paid, up to the estate. No debt: nobody is paid.
  const owed = [];
  if (debt) owed.push({ to: debt.creditor || null, amount: debt.amount, reason: debt.reason });
  if (s.debt) {
    if (!Array.isArray(s.debt.rest)) s.debt.rest = [];
    owed.push(...takeOwnPayments(s.debt.rest, p.id));
  }
  bankruptPlayer(s, ev, p, owed, 'resign');
  if (debt) {
    s.debt = null;
    s.phase = debt.returnPhase || 'manage';
    runPayments(s, ev, (debt.rest || []).slice());
  }
  if (s.phase === 'auction' && s.pending) {
    s.pending.bids[p.id] = 0; // a resigned bidder passes; the others still get their window
    markBidIn(s.pending, p.id);
    maybeResolveAuction(s, ev);
  }
  if (s.phase === 'snatch' && s.pending) {
    // A resigning presser drops out; the window itself keeps running (a resigning buyer's district went back to the
    // bank, so it can still be snatched for free when the window closes).
    s.pending.claims = s.pending.claims.filter((id) => id !== p.id);
    maybeCloseSnatch(s, ev);
  }
}

function doPayDebt(s, ev) {
  const d = s.debt;
  const p = byId(s, d.player);
  const creditor = d.creditor ? byId(s, d.creditor) : null;
  s.debt = null;
  s.phase = d.returnPhase || 'manage';
  transfer(s, ev, p, creditor && !creditor.bankrupt ? creditor : null, d.amount, d.reason);
  runPayments(s, ev, (d.rest || []).slice());
}

// ---------------------------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------------------------

const TRADE_ANSWERS = ['TRADE_ACCEPT', 'TRADE_REJECT', 'TRADE_CANCEL', 'TRADE_COUNTER'];
const DEBT_ACTIONS = ['MORTGAGE', 'SELL_BUILDING', 'PAY_DEBT'];

function validate(prev, action) {
  if (!action || typeof action.type !== 'string') return 'Invalid action';
  if (prev.phase === 'over') return 'The game is over';
  // Server-only: the room fires it when the Snatch timer ends. It carries no player (the buyer may have resigned).
  if (action.type === 'SNATCH_CLOSE') return prev.phase === 'snatch' && prev.pending?.type === 'snatch' ? null : 'There is nothing to snatch';
  // Server-only too: the auction window ran out. Every player who has not bid passes and the auction resolves.
  if (action.type === 'AUCTION_CLOSE') return prev.phase === 'auction' && prev.pending?.type === 'auction' ? null : 'There is no auction right now';
  const p = byId(prev, action.playerId);
  if (!p) return 'Unknown player';
  if (p.bankrupt) return 'You are out of the game';
  const isTurn = turnPlayer(prev).id === p.id;
  const type = action.type;

  if (prev.trade && !TRADE_ANSWERS.includes(type) && type !== 'RESIGN') return 'A trade offer is waiting for an answer';
  if (prev.phase === 'debt' && !DEBT_ACTIONS.includes(type) && type !== 'RESIGN') return 'Raise cash and settle the debt first';
  if (prev.phase === 'snatch' && type !== 'SNATCH' && type !== 'RESIGN') return 'Wait for the snatch window';

  switch (type) {
    case 'ROLL': {
      if (!isTurn) return 'Not your turn';
      if (prev.phase === 'buy') return 'Decide about the district first';
      if (prev.phase === 'auction') return 'An auction is in progress';
      if (prev.phase === 'manage' && !prev.extraRoll) return 'You already rolled. End your turn';
      if (prev.cfg.debug === true && action.dice !== undefined) {
        const d = action.dice;
        if (!Array.isArray(d) || d.length !== 1 || !d.every((x) => Number.isInteger(x) && x >= 1 && x <= 6)) return 'Invalid dice';
      }
      return null;
    }
    case 'PAY_TRAFFIC':
      if (!isTurn) return 'Not your turn';
      if (!p.stuck) return 'You are not stuck in traffic';
      if (prev.phase !== 'roll') return 'You can only pay before rolling';
      if (p.cash < prev.cfg.trafficFine) return `Getting out costs ${formatINR(prev.cfg.trafficFine)}`;
      return null;
    case 'USE_CHAI':
      if (!isTurn) return 'Not your turn';
      if (!p.stuck) return 'You are not stuck in traffic';
      if (prev.phase !== 'roll') return `You can only use ${termsOf(prev).chaiUse} before rolling`;
      if (!((p.chai || 0) > 0)) return `You have no ${termsOf(prev).chaiToken}`;
      return null;
    case 'BUY':
      if (!isTurn) return 'Not your turn';
      if (prev.phase !== 'buy' || !prev.pending) return 'Nothing to buy right now';
      if (p.cash < prev.pending.price) return 'Not enough cash';
      return null;
    case 'SKIP_BUY':
      if (!isTurn) return 'Not your turn';
      if (prev.phase !== 'buy' || !prev.pending) return 'Nothing to skip right now';
      return null;
    case 'RIDE':
      return rideCheck(prev, p.id);
    case 'UPGRADE': {
      if (!isTurn) return 'Not your turn';
      const c = canUpgrade(prev, p.id, action.tile);
      return c.ok ? null : c.reason;
    }
    case 'MORTGAGE': {
      const c = mortgageCheck(prev, p.id, action.tile);
      return c.ok ? null : c.reason;
    }
    case 'UNMORTGAGE': {
      const c = unmortgageCheck(prev, p.id, action.tile);
      return c.ok ? null : c.reason;
    }
    case 'SELL_BUILDING': {
      const c = sellCheck(prev, p.id, action.tile);
      return c.ok ? null : c.reason;
    }
    case 'PAY_DEBT':
      if (prev.phase !== 'debt' || !prev.debt) return 'You do not owe anything right now';
      if (prev.debt.player !== p.id) return 'This is not your debt';
      if (p.cash < prev.debt.amount) return `Raise ${formatINR(prev.debt.amount - p.cash)} more first`;
      return null;
    case 'END_TURN':
      if (!isTurn) return 'Not your turn';
      if (prev.phase !== 'manage') return 'You cannot end your turn yet';
      if (prev.extraRoll) return 'You rolled a six. Roll again';
      return null;
    case 'BID': {
      if (prev.phase !== 'auction' || !prev.pending) return 'There is no auction right now';
      if (p.id in prev.pending.bids) return 'You already placed your bid';
      const a = action.amount;
      if (!Number.isInteger(a) || a < 0) return 'Invalid bid';
      if (a === 0) return null;
      if (a < prev.pending.minBid) return `The minimum bid is ${formatINR(prev.pending.minBid)}`;
      if (a > p.cash) return 'You cannot bid more than your cash';
      return null;
    }
    case 'TRADE_OFFER': {
      if (!isTurn) return 'Not your turn';
      const block = tradeBlock(prev, p.id);
      if (block) return block;
      const to = byId(prev, action.to);
      const give = normSide(action.give);
      const get = normSide(action.get);
      if (!give || !get) return 'Invalid offer';
      return tradeProblem(prev, p, to, give, get);
    }
    case 'TRADE_ACCEPT':
    case 'TRADE_REJECT':
      if (!prev.trade) return 'There is no trade offer';
      if (prev.trade.to !== p.id) return 'This offer is not for you';
      return null;
    case 'TRADE_CANCEL':
      if (!prev.trade) return 'There is no trade offer';
      if (prev.trade.from !== p.id) return 'Only the player who made the offer can cancel it';
      return null;
    case 'TRADE_COUNTER': {
      // The recipient answers with a changed deal (same rules as an offer, seen from their chair): give leaves me, get leaves the proposer.
      const t = prev.trade;
      if (!t) return 'There is no trade offer';
      if (t.to !== p.id) return 'This offer is not for you';
      if ((t.counters || 0) >= MAX_COUNTERS) return `Counter-offers are used up (${MAX_COUNTERS}). Accept or reject`;
      const give = normSide(action.give);
      const get = normSide(action.get);
      if (!give || !get) return 'Invalid offer';
      return tradeProblem(prev, p, byId(prev, t.from), give, get);
    }
    case 'SNATCH': {
      const pend = prev.pending;
      if (prev.phase !== 'snatch' || !pend || pend.type !== 'snatch') return 'There is nothing to snatch';
      if (!pend.eligible.includes(p.id)) return 'You cannot snatch this one';
      if (pend.claims.includes(p.id)) return 'You already pressed Snatch';
      return null;
    }
    case 'PLAY_POWER': {
      const gate = powerGate(prev, p);
      if (gate) return gate;
      if (typeof action.card !== 'string') return 'Invalid card';
      if (action.target !== undefined && action.target !== null && typeof action.target !== 'string') return 'Invalid target';
      const card = handOf(p).find((c) => c.uid === action.card);
      if (!card) return 'You do not hold that card';
      return powerCardProblem(prev, p, card, action.target);
    }
    case 'RESIGN':
      return null;
    default:
      return `Unknown action ${type}`;
  }
}

export function applyAction(prev, action) {
  const error = validate(prev, action);
  if (error) return { state: prev, events: [], error };

  const s = structuredClone(prev);
  const ev = [];
  const p = byId(s, action.playerId); // undefined for the server-only SNATCH_CLOSE

  switch (action.type) {
    case 'ROLL':
      doRoll(s, ev, action);
      break;
    case 'PAY_TRAFFIC':
      p.cash -= s.cfg.trafficFine;
      p.stuck = false;
      ev.push({ type: 'cash', player: p.id, delta: -s.cfg.trafficFine, reason: 'traffic' });
      ev.push({ type: 'traffic', player: p.id, stuck: false, reason: 'paid', amount: s.cfg.trafficFine }); // the log says what was paid
      break;
    case 'USE_CHAI':
      p.chai -= 1;
      p.stuck = false;
      ev.push({ type: 'chai', player: p.id, chai: p.chai, change: -1, reason: 'traffic' });
      ev.push({ type: 'traffic', player: p.id, stuck: false, reason: 'chai' });
      break;
    case 'BUY':
      doBuy(s, ev);
      break;
    case 'SKIP_BUY':
      doSkipBuy(s, ev);
      break;
    case 'RIDE':
      doRide(s, ev, p);
      break;
    case 'UPGRADE':
      doUpgrade(s, ev, action.tile);
      break;
    case 'MORTGAGE': {
      const value = mortgageValue(TILES[action.tile]);
      s.mortgaged[action.tile] = true;
      p.cash += value;
      ev.push({ type: 'mortgage', player: p.id, tile: action.tile, value });
      ev.push({ type: 'cash', player: p.id, delta: value, reason: 'mortgage' });
      break;
    }
    case 'UNMORTGAGE': {
      const cost = unmortgageCost(TILES[action.tile]);
      s.mortgaged[action.tile] = false;
      p.cash -= cost;
      ev.push({ type: 'unmortgage', player: p.id, tile: action.tile, cost });
      ev.push({ type: 'cash', player: p.id, delta: -cost, reason: 'unmortgage' });
      break;
    }
    case 'SELL_BUILDING': {
      const refund = sellRefund(TILES[action.tile]);
      s.levels[action.tile] -= 1;
      p.cash += refund;
      ev.push({ type: 'level', tile: action.tile, level: s.levels[action.tile], reason: 'sell' });
      ev.push({ type: 'cash', player: p.id, delta: refund, reason: 'sell' });
      break;
    }
    case 'PAY_DEBT':
      doPayDebt(s, ev);
      break;
    case 'END_TURN':
      endTurn(s, ev);
      break;
    case 'BID':
      s.pending.bids[p.id] = action.amount;
      markBidIn(s.pending, p.id);
      maybeResolveAuction(s, ev);
      break;
    case 'AUCTION_CLOSE': {
      // The window ran out: everyone who has not bid passes (bid 0), then the auction resolves.
      const timedOut = [];
      for (const q of activePlayers(s)) {
        if (q.id in s.pending.bids) continue;
        s.pending.bids[q.id] = 0;
        timedOut.push(q.id);
      }
      resolveAuction(s, ev, timedOut);
      break;
    }
    case 'TRADE_OFFER': {
      s.tradeSeq = (s.tradeSeq || 0) + 1;
      s.trade = { id: s.tradeSeq, from: p.id, to: action.to, give: normSide(action.give), get: normSide(action.get) };
      p.lastOfferTurn = s.turnCount;
      ev.push({ type: 'trade_offer', id: s.trade.id, from: s.trade.from, to: s.trade.to, give: s.trade.give, get: s.trade.get });
      break;
    }
    case 'TRADE_ACCEPT': {
      const t = s.trade;
      const problem = tradeProblem(s, byId(s, t.from), byId(s, t.to), t.give, t.get);
      if (problem) {
        ev.push({ type: 'trade_rejected', id: t.id, from: t.from, to: t.to, reason: 'invalid' });
        s.trade = null;
      } else {
        doTradeDone(s, ev);
      }
      break;
    }
    case 'TRADE_COUNTER': {
      // Atomic swap: the old offer is marked countered and the new one (recipient -> proposer) takes its place in the same
      // step, with a fresh id (so a fresh timer). `replaces` keeps the old deal for the "what changed" view.
      const old = s.trade;
      s.tradeSeq = (s.tradeSeq || 0) + 1;
      s.trade = {
        id: s.tradeSeq, from: p.id, to: old.from, give: normSide(action.give), get: normSide(action.get),
        counters: (old.counters || 0) + 1, replaces: { id: old.id, give: old.give, get: old.get },
      };
      ev.push({ type: 'trade_countered', id: old.id, from: old.from, to: old.to, by: p.id, newId: s.trade.id, counters: s.trade.counters });
      ev.push({ type: 'trade_offer', id: s.trade.id, from: s.trade.from, to: s.trade.to, give: s.trade.give, get: s.trade.get, counter: true, counters: s.trade.counters });
      break;
    }
    case 'TRADE_REJECT':
    case 'TRADE_CANCEL': {
      const t = s.trade;
      ev.push({ type: 'trade_rejected', id: t.id, from: t.from, to: t.to, reason: action.type === 'TRADE_CANCEL' ? 'cancelled' : 'rejected' });
      s.trade = null;
      break;
    }
    case 'SNATCH':
      s.pending.claims.push(p.id); // sealed: no event
      maybeCloseSnatch(s, ev);
      break;
    case 'SNATCH_CLOSE':
      resolveSnatch(s, ev);
      break;
    case 'PLAY_POWER':
      doPlayPower(s, ev, p, action);
      break;
    case 'RESIGN':
      doResign(s, ev, p);
      break;
    default:
      break;
  }

  settle(s, ev);
  return { state: s, events: ev };
}

/** The context dice.js needs (`rollDice`, `diceOdds`, `landingOdds`): pass it as the third argument. */
export const diceCtx = { previewRent };
