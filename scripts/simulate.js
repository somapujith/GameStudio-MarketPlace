// Bot-only simulation of Nawabi Raj (Hyderabad Hustle rules): checks engine invariants and prints balance stats.
//
//   node scripts/simulate.js [--games 200] [--players 2,4,6] [--modes standard,quick,classic] [--seed 1]
//                            [--set startCash=1200000,passStart=150000] [--bot reserve=150000,greed=1] [--quiet]
//                            [--targets off,2500000,3000000,5000000] [--extremes [name,name,...]]
//
// --set      host-rule overrides to experiment without editing the engine: ANY key of shared/ruleSettings.js (startCash,
//            passStart, targetWorth, rentPercent, trafficFine, turnSeconds, tradeSeconds, auctionSeconds, maxRounds, dice,
//            requireFullSet, eventEvery, chaiCap, powerCards, snatches, snatchMs, snatchCardCap), e.g.
//            --set rentPercent=200,requireFullSet=false,dice=fair. `null` switches targetWorth / maxRounds off, true / false are
//            booleans. Out-of-range values are clamped like the engine does (SETTING_LIMITS).
// --extremes the host-rule extremes battery: every preset (see EXTREMES below, or pick by name) is played --games times per
//            (mode, players) on top of --set, printing one line per run. The invariants (including "every rule really
//            changed the game": salary, fines, rent level, events, round limit, upgrades) are checked on every action.
// --map      the board skin to play: hyderabad (default), andhra, a comma list or `all` (shared/maps.js; same board and rules, other
//            names / decks / city-event wording). The decks, city events and names are checked against the map on every action.
// --afk      chance (0-1, default 0.1) that, at any step of a sealed auction, the room's timer runs out (AUCTION_CLOSE: the
//            bidders who have not bid pass). The auction invariants are checked on every action: every auction ends, the
//            winner pays exactly their own (highest) bid, order / tie / saved are consistent, nobody is left with negative cash.
// --resign   chance (0-1, default 0 = off) per action that the debtor (or any active player) resigns: exercises the bankruptcy
//            rule (the bank takes all cash and districts, the creditor is paid only the debt, up to the estate).
// --bot      default bot params for every seat.
// --targets  sweep: run every (mode, players) once per win target in the list ("off" = no target) and print one line
//            per run: the share of games ending by target / rounds / last standing and the average length.
//
// Reported per (players, mode): game length in rounds and turns, how many districts are owned after round 3 and 5,
// upgrades, rides, auctions, how the games end (win target, round limit, bankruptcy), and the final net-worth spread.

import {
  MAP_IDS, mapOf, createGame, applyAction, nextBotMove, botSnatchAction, netWorth, liquidationValue, estateValue, owedPayments, standings, mulberry32,
  BOARD_SIZE, MAX_LEVEL, TILES, GROUP_TILES, isBuyable, CITY_EVENTS, MODES, ROUND_CAP, SETTING_LIMITS, RULE_KEYS, previewRent, isTargetAmount,
} from '../shared/index.js';
import { POWER, POWER_IDS } from '../shared/powerCards.js';

// ---------- CLI ----------
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const parseKV = (str) => {
  const out = {};
  if (typeof str !== 'string') return out;
  for (const part of str.split(',')) {
    const [k, v] = part.split('=');
    if (k) out[k.trim()] = v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
  }
  return out;
};

const GAMES = Number(arg('games', 200));
const PLAYER_COUNTS = String(arg('players', '2,4,6')).split(',').map(Number);
const MODE_LIST = String(arg('modes', 'standard,quick,classic')).split(',').map((m) => m.trim());
const BASE_SEED = Number(arg('seed', 1));
const BASE_SETTINGS = parseKV(arg('set', ''));
let SETTINGS = BASE_SETTINGS; // BASE_SETTINGS plus the preset being played (--extremes)
const BOT = parseKV(arg('bot', ''));
const QUIET = arg('quiet', false) === true;
const BASE_AFK = Math.min(1, Math.max(0, Number(arg('afk', 0.1)) || 0));
const RESIGN = Math.min(1, Math.max(0, Number(arg('resign', 0)) || 0)); // chance per step that someone resigns (default 0: off)
let AFK = BASE_AFK; // the chance per auction step that the window runs out (a preset may raise it)
const TARGET_SWEEP = arg('targets', null) === null ? null
  : String(arg('targets')).split(',').map((t) => (t.trim() === 'off' || t.trim() === 'null' ? null : Number(t)));
const MAP_ARG = String(arg('map', 'hyderabad'));
const RUN_MAPS = MAP_ARG === 'all' ? [...MAP_IDS] : MAP_ARG.split(',').map((m) => m.trim()).filter(Boolean);
for (const m of RUN_MAPS) if (!MAP_IDS.includes(m)) { console.error(`no such map ${m}; choose from ${MAP_IDS.join(', ')}, all`); process.exit(2); }
let MAP = RUN_MAPS[0]; // the map being played
const MAX_ACTIONS = 60000;
const DISTRICTS = TILES.filter(isBuyable).length;

// ---------- invariants ----------
function checkInvariants(s) {
  const fail = (msg) => { throw new Error(`invariant: ${msg}`); };
  if (!['roll', 'buy', 'snatch', 'auction', 'manage', 'debt', 'over'].includes(s.phase)) fail(`bad phase ${s.phase}`);
  if (!Number.isInteger(s.round) || s.round < 1) fail(`bad round ${s.round}`);
  if (!Number.isInteger(s.rng)) fail('rng not an integer');
  const ids = new Set(s.players.map((p) => p.id));
  const pieces = new Set(s.players.map((p) => p.piece));
  if (pieces.size !== s.players.length) fail('two players share a piece');
  for (const p of s.players) {
    if (!Number.isInteger(p.cash) || p.cash < 0) fail(`${p.id} bad cash ${p.cash}`);
    if (!Number.isInteger(p.pos) || p.pos < 0 || p.pos >= BOARD_SIZE) fail(`${p.id} bad pos ${p.pos}`);
    if (!Number.isInteger(p.chai) || p.chai < 0 || p.chai > s.cfg.chaiCap) fail(`${p.id} bad chai ${p.chai}`);
    // Snatch buttons: never negative, never more than the start plus what cards may add, none when Snatch is off
    if (!Number.isInteger(p.snatches) || p.snatches < 0) fail(`${p.id} bad Snatch count ${p.snatches}`);
    if (p.snatches > s.cfg.snatches + s.cfg.snatchCardCap) fail(`${p.id} holds ${p.snatches} Snatch buttons (start ${s.cfg.snatches} + at most ${s.cfg.snatchCardCap} from cards)`);
    if (!Number.isInteger(p.snatchCards) || p.snatchCards < 0 || p.snatchCards > s.cfg.snatchCardCap) fail(`${p.id} won ${p.snatchCards} Snatch cards (cap ${s.cfg.snatchCardCap})`);
    if (s.cfg.snatches === 0 && (p.snatches !== 0 || p.snatchCards !== 0)) fail(`${p.id} holds Snatch buttons with Snatch off`);
    if (p.bankrupt && p.snatches !== 0) fail(`${p.id} bankrupt but still holds Snatch buttons`);
    if (p.stuck && p.bankrupt) fail(`${p.id} stuck while bankrupt`);
    if (p.bankrupt && (p.cash !== 0 || s.owners.includes(p.id))) fail(`${p.id} bankrupt but still holds assets`);
    for (const [k, v] of Object.entries(p.stats)) if (!Number.isFinite(v) || v < 0) fail(`${p.id} stat ${k}=${v}`);
    if (!Number.isFinite(netWorth(s, p.id))) fail(`${p.id} worth not finite`);
  }
  checkPower(s);
  if (s.event !== null) {
    if (!CITY_EVENTS.some((d) => d.id === s.event.id)) fail(`unknown city event ${s.event.id}`);
    if (!(s.cfg.eventEvery > 0) || s.event.round !== s.round || s.round % s.cfg.eventEvery !== 0) fail(`city event ${s.event.id} in round ${s.round} (eventEvery ${s.cfg.eventEvery})`);
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    const o = s.owners[i];
    const lv = s.levels[i];
    if (o !== null) {
      if (!ids.has(o)) fail(`tile ${i} owned by unknown ${o}`);
      if (!isBuyable(TILES[i])) fail(`tile ${i} owned but not a district`);
      if (s.players.find((p) => p.id === o).bankrupt) fail(`tile ${i} owned by bankrupt ${o}`);
    }
    if (!Number.isInteger(lv) || lv < 0 || lv > MAX_LEVEL) fail(`tile ${i} bad level ${lv}`);
    if (lv > 0 && o === null) fail(`tile ${i} has a level but no owner`);
    if (s.mortgaged[i] && (o === null || lv > 0)) fail(`tile ${i} mortgaged while unowned or upgraded`);
  }
  if (s.phase === 'buy' && s.pending?.type !== 'buy') fail('buy phase without pending buy');
  if (s.phase === 'auction') {
    const w = s.pending;
    if (w?.type !== 'auction') fail('auction phase without pending auction');
    const active = s.players.filter((p) => !p.bankrupt).map((p) => p.id);
    const expectMs = w.snatch ? Math.min(s.cfg.auctionSeconds * 1000, 15000) : s.cfg.auctionSeconds * 1000;
    if (w.ms !== expectMs) fail(`auction window ${w.ms} ms, cfg.auctionSeconds ${s.cfg.auctionSeconds} says ${expectMs}`);
    if (!Number.isInteger(w.id) || w.id < 1) fail(`bad auction id ${w.id}`);
    if (new Set(w.bidIn).size !== w.bidIn.length || w.bidIn.some((id) => !w.eligible.includes(id) || !(id in w.bids))) fail('bad auction bidIn');
    if (w.eligible.some((id) => id in w.bids && !w.bidIn.includes(id))) fail('an eligible player has a bid but is not in bidIn');
    if (w.snatch && w.eligible.some((id) => !w.claimants.includes(id))) fail('a non-claimant is eligible for the Snatch bidding');
    if (active.every((id) => id in w.bids)) fail('auction still open though everyone has bid');
    for (const [id, amount] of Object.entries(w.bids)) {
      const p = s.players.find((x) => x.id === id);
      if (!Number.isInteger(amount) || amount < 0 || (amount > 0 && (amount < w.minBid || amount > p.cash))) fail(`${id} sealed bid ${amount} (min ${w.minBid}, cash ${p.cash})`);
    }
  }
  if (s.phase === 'snatch') {
    const w = s.pending;
    if (w?.type !== 'snatch') fail('snatch phase without pending snatch');
    if (!w.eligible.length || w.eligible.includes(w.buyer)) fail('bad Snatch eligible list');
    if (![w.buyer, null].includes(s.owners[w.tile])) fail(`snatch tile ${w.tile} is held by ${s.owners[w.tile]}`);
    if (new Set(w.claims).size !== w.claims.length || w.claims.some((id) => !w.eligible.includes(id))) fail('bad Snatch claims');
    if (w.ms !== s.cfg.snatchMs) fail(`snatch window ${w.ms} ms, cfg says ${s.cfg.snatchMs}`);
  }
  if (s.phase !== 'buy' && s.phase !== 'auction' && s.phase !== 'snatch' && s.pending) fail(`pending left over in phase ${s.phase}`);
  if (s.ride && (s.phase === 'over' || s.ride.player !== s.players[s.turn].id)) fail('ride offered to someone else');
  if (s.phase === 'debt') {
    const d = s.debt;
    if (!d) fail('debt phase without a debt');
    const debtor = s.players.find((p) => p.id === d.player);
    if (!debtor || debtor.bankrupt) fail('debtor missing or bankrupt');
    if (debtor.cash + liquidationValue(s, d.player) < d.amount) fail('uncoverable debt should be a bankruptcy');
  } else if (s.debt) fail('debt left over outside the debt phase');
  // The win target: once nothing is in flight nobody may sit at or above it while the game goes on.
  const limit = s.cfg.maxRounds ?? ROUND_CAP;
  if (s.round > limit + 1 || (s.round > limit && s.phase !== 'over')) fail(`round ${s.round} is past the limit ${limit}`);
  if (s.cfg.trafficFine === 0 && s.phase !== 'over' && s.players.some((p) => p.stuck && !p.bankrupt && p.id === s.players[s.turn].id)) fail('a free traffic jam holds a player on their own turn');
  const target = s.cfg.targetWorth;
  if (target != null && s.phase !== 'over' && s.phase !== 'debt' && s.phase !== 'auction' && !s.trade) {
    for (const p of s.players) if (!p.bankrupt && netWorth(s, p.id) >= target) fail(`${p.id} is at the target but the game goes on`);
  }
  if (s.phase !== 'over') {
    if (s.players[s.turn].bankrupt && s.phase !== 'auction' && s.phase !== 'debt' && s.phase !== 'snatch') fail('turn points at a bankrupt player');
    if (s.players.filter((p) => !p.bankrupt).length < 2) fail('game should be over');
  } else {
    if (!['last_standing', 'target', 'rounds'].includes(s.winReason)) fail(`over with winReason ${s.winReason}`);
    const top = standings(s)[0];
    if (s.winner && top.id !== s.winner) fail(`winner ${s.winner} is not rank 1 (${top.id})`);
    if (s.winReason === 'target' && !(target != null && netWorth(s, s.winner) >= target)) fail('target win below the target');
    if (s.winReason === 'rounds' && target != null && s.players.some((p) => !p.bankrupt && netWorth(s, p.id) >= target)) fail('rounds win while someone is at the target');
  }
}

/**
 * Power cards (docs/POWER_CARDS.md): with the rule OFF no new state exists at all (byte-identical games); with it ON the
 * stream, hands (at most POWER.HAND_MAX, legal ids, unique uids, not expired) and armed effects are all legal.
 */
function checkPower(s) {
  const fail = (msg) => { throw new Error(`invariant: power: ${msg}`); };
  if (s.cfg.powerCards !== true) {
    if ('prng' in s || 'powerPlayed' in s) fail('power state exists with the rule off');
    for (const p of s.players) if ('hand' in p || 'shield' in p || 'doubleRent' in p) fail(`${p.id} has power fields with the rule off`);
    return;
  }
  if (!Number.isInteger(s.prng) || s.prng < 0 || s.prng > 0xffffffff) fail(`bad prng ${s.prng}`);
  if (typeof s.powerPlayed !== 'boolean') fail('powerPlayed is not a boolean');
  for (const p of s.players) {
    if (!Array.isArray(p.hand) || p.hand.length > POWER.HAND_MAX) fail(`${p.id} hand ${JSON.stringify(p.hand)}`);
    if (new Set(p.hand.map((c) => c.uid)).size !== p.hand.length) fail(`${p.id} duplicate card uid`);
    for (const c of p.hand) {
      if (typeof c.uid !== 'string' || !POWER_IDS.includes(c.id) || !Number.isInteger(c.exp)) fail(`${p.id} bad card ${JSON.stringify(c)}`);
      if (c.exp < s.round && s.round <= (s.cfg.maxRounds ?? ROUND_CAP)) fail(`${p.id} holds an expired card (exp ${c.exp}, round ${s.round})`);
      if (c.exp > s.round + POWER.LIFE_ROUNDS) fail(`${p.id} card lives too long (exp ${c.exp}, round ${s.round})`);
    }
    for (const k of ['shield', 'doubleRent']) {
      if (!Number.isInteger(p[k]) || p[k] < 0 || p[k] > s.round + POWER.ARMED_ROUNDS) fail(`${p.id} bad ${k} ${p[k]}`);
    }
    if (p.bankrupt && (p.hand.length || p.shield || p.doubleRent)) fail(`${p.id} is out but still holds power cards or armed effects`);
  }
  if (s.phase === 'roll' && s.extraRoll && !s.powerPlayed) fail('an extra roll in the roll phase without a played Steal a Roll');
}

/** Every rule asked for really is in cfg (clamped like the engine does), and every rule key is there; everybody starts with startCash. */
function checkConfig(s, wanted) {
  const fail = (msg) => { throw new Error(`config: ${msg}`); };
  for (const k of RULE_KEYS) if (!(k in s.cfg)) fail(`cfg.${k} is missing`);
  for (const [k, v] of Object.entries(wanted)) {
    if (!RULE_KEYS.includes(k) || v === undefined) continue;
    if (k === 'targetWorth' && v !== null && !isTargetAmount(v)) continue; // not a legal target: the engine takes the mode default
    const lim = SETTING_LIMITS[k];
    const want = lim && typeof v === 'number' ? Math.min(lim.max, Math.max(lim.min, Math.floor(v))) : v;
    if (s.cfg[k] !== want) fail(`cfg.${k} is ${s.cfg[k]}, asked for ${want}`);
  }
  for (const p of s.players) if (p.cash !== s.cfg.startCash) fail(`${p.id} starts with ${p.cash}, cfg.startCash is ${s.cfg.startCash}`);
  if (mapOf(s).id !== MAP) fail(`the game plays on ${mapOf(s).id}, asked for ${MAP}`);
  if ((MAP === 'hyderabad') !== !('map' in s.cfg)) fail(`cfg.map is ${s.cfg.map} on the ${MAP} map (only a non-default map is stored)`);
}

/** What one action's events must respect, checked against the state BEFORE it (the rules really are read from cfg). */
function checkRules(prev, action, res) {
  const fail = (msg) => { throw new Error(`rule: ${msg}`); };
  const cfg = prev.cfg;
  for (const e of res.events) {
    if (e.type === 'cash' && e.reason === 'salary' && e.delta !== cfg.passStart) fail(`salary ${e.delta}, passStart is ${cfg.passStart}`);
    if (e.type === 'cash' && e.reason === 'traffic' && e.delta !== -cfg.trafficFine) fail(`traffic fine ${-e.delta}, trafficFine is ${cfg.trafficFine}`);
    if (e.type === 'city_event' && !(cfg.eventEvery > 0)) fail('a city event although events are off');
    if (e.type === 'city_event' && !mapOf(cfg).events.list.some((d) => d.id === e.id && d.kind === e.kind)) fail(`city event ${e.id} is not an event of the ${mapOf(cfg).id} map`);
    if (e.type === 'card') {
      const deck = mapOf(cfg).decks[e.deck];
      const card = deck && deck.cards.find((c) => c.id === e.cardId);
      if (!card || card.title !== e.title) fail(`card ${e.cardId} (${e.title}) is not in the ${mapOf(cfg).id} ${e.deck} deck`);
    }
    if (e.type === 'level' && e.reason === 'upgrade' && cfg.requireFullSet) {
      const owner = prev.owners[e.tile];
      if (!GROUP_TILES[TILES[e.tile].group].every((t) => prev.owners[t] === owner)) fail(`tile ${e.tile} upgraded without the full collection`);
    }
  }
  checkPowerEvents(prev, action, res);
  if (cfg.passStart === 0 && res.events.some((e) => e.type === 'cash' && e.reason === 'salary')) fail('salary although passStart is 0');
  // a plain landing on somebody's district: the rent paid is the preview of the engine (cfg.rentPercent included), or its chai-halved half
  if (action.type === 'ROLL' && res.events.filter((e) => e.type === 'land').length === 1) {
    const land = res.events.find((e) => e.type === 'land');
    const owner = prev.owners[land.tile];
    if (isBuyable(TILES[land.tile]) && owner && owner !== action.playerId && !prev.players.find((p) => p.id === owner).bankrupt
        && !res.events.some((e) => e.type === 'debt' || e.type === 'bankrupt')) {
      const paid = res.events.filter((e) => e.type === 'cash' && e.reason === 'rent' && e.delta < 0 && e.player === action.playerId).reduce((n, e) => n - e.delta, 0);
      const bill = previewRent(prev, land.tile);
      const shielded = res.events.some((e) => e.type === 'power_trigger' && e.card === 'shield' && e.player === action.playerId);
      if (shielded) { if (paid !== 0) fail(`a Shield waived the rent on tile ${land.tile} but ${paid} was paid`); }
      else if (paid !== bill && paid !== bill - Math.floor(bill / 2)) fail(`rent on tile ${land.tile}: paid ${paid}, preview ${bill} (rent level ${cfg.rentPercent}%)`);
    }
  }
}

/** What one action's power events must respect (docs/POWER_CARDS.md): public events never name a card that was not played. */
function checkPowerEvents(prev, action, res) {
  const fail = (msg) => { throw new Error(`power: ${msg}`); };
  const cards = res.events.filter((e) => e.type.startsWith('power_'));
  if (prev.cfg.powerCards !== true) { if (cards.length) fail('power events with the rule off'); return; }
  for (const e of cards) {
    if (e.type === 'power_draw' && (!['tile', 'turn'].includes(e.source) || 'id' in e || 'card' in e || 'uid' in e)) fail(`bad power_draw ${JSON.stringify(e)}`);
    if (e.type === 'power_expire' && (!(e.count > 0) || 'id' in e || 'card' in e || 'cards' in e)) fail(`bad power_expire ${JSON.stringify(e)}`);
    if (e.type === 'power_play' && !POWER_IDS.includes(e.card)) fail(`bad power_play ${JSON.stringify(e)}`);
    if (e.type === 'power_trigger' && (!['shield', 'double'].includes(e.card) || !(e.amount > 0))) fail(`bad power_trigger ${JSON.stringify(e)}`);
  }
  const plays = cards.filter((e) => e.type === 'power_play');
  if (plays.length !== (action.type === 'PLAY_POWER' ? 1 : 0)) fail(`${plays.length} power_play events for ${action.type}`);
  if (action.type === 'PLAY_POWER') {
    const e = plays[0];
    const was = prev.players.find((p) => p.id === action.playerId).hand.find((c) => c.uid === action.card);
    const now = res.state.players.find((p) => p.id === action.playerId);
    if (!was || was.id !== e.card || now.hand.some((c) => c.uid === action.card)) fail('the played card is not spent');
    if (!res.state.powerPlayed) fail('powerPlayed not set');
    const moves = res.events.filter((x) => x.type === 'move');
    if (e.card === 'swap') {
      if (moves.length !== 2 || moves.some((m) => !m.teleport || m.passedStart) || res.events.some((x) => x.type === 'land')) fail('a swap is two teleports with no landing');
      const them = res.state.players.find((p) => p.id === e.target);
      const before = prev.players.find((p) => p.id === e.target);
      if (now.pos !== before.pos || them.pos !== prev.players.find((p) => p.id === action.playerId).pos) fail('a swap did not exchange positions');
    } else if (moves.length) fail(`${e.card} moved a pawn`);
    if (e.card === 'steal' && (!res.state.extraRoll || res.events.some((x) => x.type === 'dice'))) fail('Steal a Roll: extraRoll not set, or a dice event');
  }
  for (const e of cards) {
    if (e.type !== 'power_trigger') continue;
    const owner = res.state.players.find((p) => p.id === e.player);
    if (e.card === 'shield' && owner.shield !== 0) fail('a triggered Shield was not consumed');
    if (e.card === 'double' && owner.doubleRent !== 0) fail('a triggered Double Rent was not consumed');
  }
  // shield beats double: a waived rent never spends the owner's Double Rent
  for (const sh of cards.filter((e) => e.type === 'power_trigger' && e.card === 'shield' && e.other)) {
    if (cards.some((e) => e.type === 'power_trigger' && e.card === 'double' && e.player === sh.other)) fail('Shield and Double Rent both triggered on the same rent');
  }
}

/** The auction that ends in this action (if any): first price, highest bid, a fair order, the event tells the truth. */
function checkAuctionEnd(prev, action, res) {
  const fail = (msg) => { throw new Error(`auction: ${msg}`); };
  const end = res.events.find((e) => e.type === 'auction_end');
  if (!end) return null;
  let pend = prev.pending && prev.pending.type === 'auction' ? prev.pending : null;
  if (!pend) {
    // Opened and closed in the same action: nobody was able to bid (everyone is passed at once), so it can only end unsold.
    const start = res.events.find((e) => e.type === 'auction_start');
    if (!start || res.events.indexOf(start) > res.events.indexOf(end)) fail('auction_end without an open auction (it can only end in a BID / AUCTION_CLOSE / RESIGN)');
    if (start.eligible.length || end.winner !== null) fail('an auction with bidders ended in the action that opened it');
    pend = { tile: start.tile, reason: start.reason, minBid: start.minBid, eligible: start.eligible, bids: {} };
  }
  if (end.tile !== pend.tile || end.reason !== pend.reason) fail('auction_end names another district or reason');
  const ranked = Object.entries(end.bids).filter(([id, a]) => pend.eligible.includes(id) && a >= pend.minBid);
  const top = Math.max(0, ...ranked.map(([, a]) => a));
  const tied = ranked.filter(([, a]) => a === top).map(([id]) => id);
  if (end.winner === null) {
    if (end.amount !== 0 || ranked.length) fail(`no winner although ${ranked.length} valid bids`);
    if (res.state.owners[end.tile] !== prev.owners[end.tile]) fail('an unsold district changed hands');
  } else {
    if (end.amount !== end.bids[end.winner] || end.amount !== top || end.amount < pend.minBid) fail(`winner ${end.winner} pays ${end.amount}, top bid ${top}, own bid ${end.bids[end.winner]}`);
    if (!tied.includes(end.winner)) fail('the winner is not among the top bidders');
    if (res.state.owners[end.tile] !== end.winner) fail('the winner does not own the district');
    const before = prev.players.find((p) => p.id === end.winner).cash;
    const after = res.state.players.find((p) => p.id === end.winner).cash;
    if (before - after !== end.amount) fail(`winner paid ${before - after}, not their bid ${end.amount}`);
    const price = TILES[end.tile].price;
    if (price > end.amount ? end.saved !== price - end.amount : 'saved' in end) fail(`saved ${end.saved} (price ${price}, paid ${end.amount})`);
    if (end.order[0] !== end.winner) fail('the winner is not first in order');
  }
  if ((end.winner !== null && end.tie !== tied.length > 1) || (end.winner === null && end.tie)) fail(`tie flag ${end.tie}, ${tied.length} players share the top bid`);
  if (new Set(end.order).size !== end.order.length || end.order.length !== pend.eligible.length || end.order.some((id) => !pend.eligible.includes(id))) fail('order is not the eligible players exactly once');
  for (let i = 1; i < end.order.length; i++) if (end.bids[end.order[i - 1]] < end.bids[end.order[i]] && end.bids[end.order[i]] >= pend.minBid) fail('order is not highest bid first');
  if (end.order.slice(ranked.length).some((id) => end.bids[id] >= pend.minBid)) fail('a bidder is ranked below a passer');
  if (action.type === 'AUCTION_CLOSE') {
    const open = prev.players.filter((p) => !p.bankrupt && !(p.id in pend.bids)).map((p) => p.id);
    if (JSON.stringify(end.timedOut || []) !== JSON.stringify(open)) fail(`timedOut ${JSON.stringify(end.timedOut)}, the non-bidders were ${JSON.stringify(open)}`);
  } else if (end.timedOut) fail('timedOut without a timer');
  // money: only the winner's bid leaves the table (to the bank); nothing else moves in a BID / AUCTION_CLOSE
  if (action.type === 'BID' || action.type === 'AUCTION_CLOSE') {
    const was = prev.players.reduce((n, p) => n + p.cash, 0);
    const now = res.state.players.reduce((n, p) => n + p.cash, 0);
    if (was - now !== end.amount) fail(`the table lost ${was - now} in the auction, the winning bid is ${end.amount}`);
  }
  return end;
}

/**
 * Bankruptcy (docs/GAME_RULES.md 7.2): the BANK takes all the cash and districts; the creditor is paid only what is owed, by the
 * bank, never more than the estate (cash + liquidationValue) was worth. Money is NOT conserved here on purpose: the bank
 * absorbs the bankrupt player's cash and pays the creditor, so the table's total may rise by at most the sum paid.
 */
function checkBankruptcy(prev, action, res) {
  const fail = (msg) => { throw new Error(`bankruptcy: ${msg}`); };
  const out = res.events.filter((e) => e.type === 'bankrupt');
  let paidTotal = 0;
  for (const b of out) {
    const x = res.state.players.find((p) => p.id === b.player);
    if (x.cash !== 0 || res.state.owners.includes(b.player)) fail(`${b.player} is out but still holds assets`);
    const paid = (b.paid || []).reduce((n, r) => n + r.amount, 0);
    const cash = res.events.filter((e) => e.type === 'cash' && e.reason === 'bankrupt' && e.other === b.player);
    if (JSON.stringify(cash.map((e) => [e.player, e.delta])) !== JSON.stringify((b.paid || []).map((r) => [r.to, r.amount]))) fail('the cash events and the bankrupt event disagree');
    for (const r of b.paid || []) {
      if (r.to === b.player || !(r.amount > 0)) fail(`bad payout ${JSON.stringify(r)}`);
      if (res.state.players.find((p) => p.id === r.to).bankrupt) fail(`${r.to} was paid but is out`);
    }
    if (action.type === 'RESIGN' && action.playerId === b.player) {
      if (paid > estateValue(prev, b.player)) fail(`${b.player} resigned: paid ${paid}, the estate was worth ${estateValue(prev, b.player)}`);
      const owed = owedPayments(prev, b.player).filter((o) => o.to).reduce((n, o) => n + o.amount, 0);
      if (paid > owed) fail(`${b.player} resigned: paid ${paid}, only ${owed} was owed`);
      if (!res.state.players.find((p) => p.id === b.player).resigned) fail('resigned flag missing');
    }
    paidTotal += paid;
  }
  if (action.type === 'ROLL' && out.length === 1 && paidTotal > 0 && res.events.filter((e) => e.type === 'land').length === 1) {
    const land = res.events.find((e) => e.type === 'land');
    const bill = isBuyable(TILES[land.tile]) && prev.owners[land.tile] ? previewRent(prev, land.tile) : null;
    if (bill !== null && paidTotal > bill) fail(`a rent of ${bill} paid out ${paidTotal}`);
  }
  return paidTotal;
}

// The extremes the host can pick: every one must still give games that end and keep every invariant.
const EXTREMES = [
  { name: 'stock', set: {} },
  { name: 'startCash-min', set: { startCash: 500000 } },
  { name: 'startCash-max', set: { startCash: 100000000 } },
  { name: 'passStart-0', set: { passStart: 0 } },
  { name: 'passStart-10L', set: { passStart: 1000000 } },
  { name: 'rent-50', set: { rentPercent: 50 } },
  { name: 'rent-200', set: { rentPercent: 200 } },
  { name: 'turn-15s', set: { turnSeconds: 15, tradeSeconds: 15 } }, // the sim has no clocks: this only checks the setting flows into cfg
  { name: 'turn-180s', set: { turnSeconds: 180, tradeSeconds: 120 } },
  { name: 'auction-10s', set: { auctionSeconds: 10 }, afk: 0.4 }, // the timer cuts a lot of auctions short
  { name: 'auction-90s', set: { auctionSeconds: 90 }, afk: 0 },
  { name: 'auction-afk', set: {}, afk: 0.9 }, // nearly every auction ends by the timer
  { name: 'events-off', set: { eventEvery: 0 } },
  { name: 'events-every-2', set: { eventEvery: 2 } },
  { name: 'no-full-set', set: { requireFullSet: false } },
  { name: 'fine-0', set: { trafficFine: 0 } },
  { name: 'fine-1L', set: { trafficFine: 100000 } },
  { name: 'chai-3', set: { chaiCap: 3 } },
  { name: 'rounds-10', set: { maxRounds: 10 } },
  { name: 'rounds-60', set: { maxRounds: 60 } },
  { name: 'rounds-none-no-target', set: { maxRounds: null, targetWorth: null } },
  { name: 'target-custom', set: { targetWorth: 12500000 } },
  { name: 'target-low', set: { targetWorth: 1000000, startCash: 500000 } },
  { name: 'fair-dice', set: { dice: 'fair' } },
  { name: 'legacy-auction-key', set: { auctionOnDecline: true } }, // the retired rule: ignored, passing still never starts an auction
  { name: 'snatch-off', set: { snatches: 0 } },
  { name: 'everything-hard', set: { rentPercent: 200, passStart: 0, trafficFine: 100000, startCash: 500000, requireFullSet: true, eventEvery: 2, chaiCap: 1 } },
  { name: 'everything-soft', set: { rentPercent: 50, passStart: 1000000, trafficFine: 0, startCash: 100000000, requireFullSet: false, eventEvery: 0, chaiCap: 3, targetWorth: null, maxRounds: 15 } },
];
const EXTREMES_ARG = arg('extremes', null);
const PRESETS = EXTREMES_ARG === null ? [{ name: null, set: {} }]
  : EXTREMES.filter((x) => EXTREMES_ARG === true || String(EXTREMES_ARG).split(',').includes(x.name));
if (EXTREMES_ARG !== null && !PRESETS.length) { console.error(`no such preset; choose from ${EXTREMES.map((x) => x.name).join(', ')}`); process.exit(2); }

// ---------- one game ----------
function playGame(n, mode, seed, extra = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot ${i + 1}`, isBot: true, bot: { ...BOT } }));
  const wanted = { mode, ...SETTINGS, ...extra, map: MAP };
  let s = createGame({ players, settings: wanted, seed });
  checkConfig(s, wanted);
  const rnd = mulberry32(seed * 31 + 7);
  const c = { bankPaid: 0, upgrades: 0, rides: 0, auctions: 0, bazaar: 0, rents: 0, rentTotal: 0, bankrupt: 0, debts: 0, mortgages: 0, stuck: 0, chaiSaved: 0, cards: 0, windows: 0, snatched: 0, snatchBids: 0, snatchCards: 0, snatchPaid: 0, auctionsStarted: 0, auctionsEnded: 0, auctionsTimedOut: 0, auctionTies: 0, auctionsUnsold: 0, auctionSteps: 0, pDraw: 0, pTile: 0, pPlay: 0, pTrig: 0, pExpired: 0, pPlays: {}, pTrigs: {} };
  const PW_ROUND = 6; // "trailing at round N wins": who led / trailed when round N began
  let atRound = null;
  const owned = {};
  let actions = 0;
  let auctionSteps = 0; // actions since the open auction started (every auction ends within one bid per player)
  while (s.phase !== 'over') {
    if (++actions > MAX_ACTIONS) throw new Error('too many actions');
    let a;
    if (s.phase === 'snatch') {
      // Everybody who may press decides by the trivial bot policy, then the room's timer closes the window
      // (auto-play and the normal bot chooser never snatch).
      a = s.pending.eligible.filter((id) => !s.pending.claims.includes(id)).map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
    } else if (s.phase === 'auction' && AFK > 0 && rnd() < AFK) {
      a = { type: 'AUCTION_CLOSE' }; // the room's timer: whoever has not bid passes
    } else a = nextBotMove(s, rnd);
    if (!a) throw new Error(`no bot move in phase ${s.phase}`);
    // --resign: the debtor presses "Bankrupt" in the debt sheet (or somebody leaves at random): the same rule as a real bankruptcy
    if (RESIGN > 0 && s.phase !== 'snatch' && rnd() < (s.phase === 'debt' ? Math.max(RESIGN, 0.5) : RESIGN)) {
      const live = s.players.filter((p) => !p.bankrupt);
      if (live.length > 2) a = { type: 'RESIGN', playerId: s.phase === 'debt' ? s.debt.player : live[Math.floor(rnd() * live.length)].id };
    }
    const res = applyAction(s, a);
    if (res.error) throw new Error(`${a.type}: ${res.error}`);
    c.bankPaid += checkBankruptcy(s, a, res);
    checkRules(s, a, res);
    const auctionEnd = checkAuctionEnd(s, a, res);
    for (const e of res.events) {
      // Passing never starts an auction (it would let a buyer dodge Snatch): only the Bazaar Auction corner and Snatch bidding do
      if (e.type === 'auction_start' && e.reason !== 'bazaar' && e.reason !== 'snatch') throw new Error(`auction: reason '${e.reason}' (a pass or an unaffordable district never opens one)`);
      if (e.type === 'auction_start' && e.reason === 'bazaar' && TILES[res.state.players[res.state.turn]?.pos]?.type !== 'auction') throw new Error('auction: a Bazaar Auction opened off the Bazaar tile');
      if (a.type === 'SKIP_BUY' && e.type === 'auction_start') throw new Error('auction: SKIP_BUY opened an auction');
    }
    if (a.type === 'SKIP_BUY' && (!['manage', 'over'].includes(res.state.phase) || res.state.pending || res.state.turn !== s.turn)) throw new Error(`pass: expected manage on the same turn, got ${res.state.phase}`);
    const before = s.round;
    s = res.state;
    if (auctionEnd) {
      c.auctionsEnded++;
      if (auctionEnd.timedOut) c.auctionsTimedOut++;
      if (auctionEnd.tie) c.auctionTies++;
      if (auctionEnd.winner === null) c.auctionsUnsold++;
      c.auctionSteps = Math.max(c.auctionSteps, auctionSteps);
    }
    if (res.events.some((e) => e.type === 'auction_start')) { c.auctionsStarted++; auctionSteps = 0; }
    if (s.phase === 'auction' && !res.events.some((e) => e.type === 'auction_start')) {
      auctionSteps++;
      if (auctionSteps > n + 1) throw new Error(`auction: still open after ${auctionSteps} steps with ${n} players`);
    }
    for (const e of res.events) {
      if (e.type === 'level' && e.reason === 'upgrade') c.upgrades++;
      else if (e.type === 'ride') c.rides++;
      else if (e.type === 'auction_end' && e.winner) { c.auctions++; if (e.reason === 'bazaar') c.bazaar++; }
      else if (e.type === 'cash' && e.reason === 'rent' && e.delta < 0) { c.rents++; c.rentTotal -= e.delta; }
      else if (e.type === 'bankrupt') c.bankrupt++;
      else if (e.type === 'debt') c.debts++;
      else if (e.type === 'mortgage') c.mortgages++;
      else if (e.type === 'traffic' && e.stuck) c.stuck++;
      else if (e.type === 'chai' && e.saved) c.chaiSaved += e.saved;
      else if (e.type === 'card') { c.cards++; if (e.capped) c.snatchPaid++; }
      else if (e.type === 'snatch_open') c.windows++;
      else if (e.type === 'snatch_end' && e.outcome === 'snatched') c.snatched++;
      else if (e.type === 'snatch_end' && e.outcome === 'bidding') c.snatchBids++;
      else if (e.type === 'token_earned') c.snatchCards++;
      else if (e.type === 'power_draw') { c.pDraw++; if (e.source === 'tile') c.pTile++; }
      else if (e.type === 'power_play') { c.pPlay++; c.pPlays[e.card] = (c.pPlays[e.card] || 0) + 1; }
      else if (e.type === 'power_trigger') { c.pTrig++; c.pTrigs[e.card] = (c.pTrigs[e.card] || 0) + e.amount; }
      else if (e.type === 'power_expire') c.pExpired += e.count;
    }
    if (s.round !== before && s.round === PW_ROUND && !atRound && s.phase !== 'over') {
      const st = standings(s).filter((r) => !r.bankrupt);
      const avgWorth = avg(st.map((r) => r.worth));
      atRound = Object.fromEntries(st.map((r) => [r.id, { rank: r.rank, below: r.worth < POWER.TRAILING_RATIO * avgWorth }]));
    }
    if (s.round !== before) for (const r of [4, 6]) if (s.round === r && !(r in owned)) owned[r] = s.owners.filter(Boolean).length;
    checkInvariants(s);
  }
  if (c.auctionsStarted !== c.auctionsEnded) throw new Error(`auction: ${c.auctionsStarted} started, ${c.auctionsEnded} ended`);
  const worths = s.players.filter((p) => !p.bankrupt).map((p) => netWorth(s, p.id));
  const rounds = Math.min(s.round, s.cfg.maxRounds ?? ROUND_CAP);
  return {
    rounds, turns: s.turnCount, reason: s.winReason, c, targetCfg: s.cfg.targetWorth,
    owned3: owned[4] ?? s.owners.filter(Boolean).length, owned5: owned[6] ?? s.owners.filter(Boolean).length,
    spread: worths.length > 1 ? Math.max(...worths) - Math.min(...worths) : 0,
    top: Math.max(...worths),
    levels: s.levels.reduce((a, b) => a + b, 0),
    seatWin: s.players.findIndex((p) => p.id === s.winner),
    // winner's standing when round PW_ROUND began (null = the game ended earlier or the winner was already out)
    winnerAt: atRound && atRound[s.winner] ? atRound[s.winner] : null,
  };
}

// ---------- runner ----------
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const L = (x) => `₹${(x / 100000).toFixed(2)}L`;
const t0 = Date.now();
let failures = 0;
const summary = [];
const targetName = (t) => (t === null ? 'off' : `${t / 100000}L`);
for (const preset of PRESETS) {
SETTINGS = { ...BASE_SETTINGS, ...preset.set };
AFK = preset.afk ?? BASE_AFK;
for (const mapId of RUN_MAPS) {
MAP = mapId;
if (RUN_MAPS.length > 1 && !QUIET) console.log(`\n######## map: ${mapOf(MAP).name} (${MAP}) ########`);
for (const mode of MODE_LIST) {
  for (const n of PLAYER_COUNTS) {
   for (const sweepTarget of TARGET_SWEEP ?? [undefined]) {
    const extra = sweepTarget === undefined ? {} : { targetWorth: sweepTarget };
    const rows = [];
    for (let g = 0; g < GAMES; g++) {
      const seed = BASE_SEED * 100003 + n * 1009 + g * 7 + mode.length;
      try {
        rows.push(playGame(n, mode, seed, extra));
      } catch (err) {
        failures++;
        if (failures <= 5) console.error(`FAIL mode=${mode} players=${n} seed=${seed}: ${err.message}`);
      }
    }
    if (!rows.length) continue;
    const r = {
      map: MAP, mode, n, games: rows.length, sweepTarget, targetCfg: rows[0].targetCfg,
      rounds: avg(rows.map((x) => x.rounds)),
      maxRounds: Math.max(...rows.map((x) => x.rounds)),
      turns: avg(rows.map((x) => x.turns)),
      owned3: avg(rows.map((x) => x.owned3)) / DISTRICTS,
      owned5: avg(rows.map((x) => x.owned5)) / DISTRICTS,
      bankruptEnd: rows.filter((x) => x.reason === 'last_standing').length / rows.length,
      targetEnd: rows.filter((x) => x.reason === 'target').length / rows.length,
      roundsEnd: rows.filter((x) => x.reason === 'rounds').length / rows.length,
      bankrupts: avg(rows.map((x) => x.c.bankrupt)),
      bankPaid: avg(rows.map((x) => x.c.bankPaid)),
      spread: avg(rows.map((x) => x.spread)),
      top: avg(rows.map((x) => x.top)),
      upgrades: avg(rows.map((x) => x.c.upgrades)),
      endLevels: avg(rows.map((x) => x.levels)),
      rides: avg(rows.map((x) => x.c.rides)),
      auctions: avg(rows.map((x) => x.c.auctions)),
      bazaar: avg(rows.map((x) => x.c.bazaar)),
      rentAvg: avg(rows.map((x) => (x.c.rents ? x.c.rentTotal / x.c.rents : 0))),
      rents: avg(rows.map((x) => x.c.rents)),
      debts: avg(rows.map((x) => x.c.debts)),
      mortgages: avg(rows.map((x) => x.c.mortgages)),
      stuck: avg(rows.map((x) => x.c.stuck)),
      seat1: rows.filter((x) => x.seatWin === 0).length / rows.length,
      windows: avg(rows.map((x) => x.c.windows)),
      snatched: avg(rows.map((x) => x.c.snatched)),
      snatchBids: avg(rows.map((x) => x.c.snatchBids)),
      snatchCards: avg(rows.map((x) => x.c.snatchCards)),
      snatchPaid: avg(rows.map((x) => x.c.snatchPaid)),
      auctionsEnded: avg(rows.map((x) => x.c.auctionsEnded)),
      auctionsTimedOut: avg(rows.map((x) => x.c.auctionsTimedOut)),
      auctionTies: avg(rows.map((x) => x.c.auctionTies)),
      auctionsUnsold: avg(rows.map((x) => x.c.auctionsUnsold)),
      auctionSteps: Math.max(...rows.map((x) => x.c.auctionSteps)),
      pDraw: avg(rows.map((x) => x.c.pDraw)),
      pTile: avg(rows.map((x) => x.c.pTile)),
      pPlay: avg(rows.map((x) => x.c.pPlay)),
      pTrig: avg(rows.map((x) => x.c.pTrig)),
      pExpired: avg(rows.map((x) => x.c.pExpired)),
      pPerPlayer10: avg(rows.map((x) => (x.c.pDraw / (n * Math.max(1, x.rounds))) * 10)),
      pPlays: Object.fromEntries(POWER_IDS.map((id) => [id, avg(rows.map((x) => x.c.pPlays[id] || 0))])),
      pTrigs: Object.fromEntries(['shield', 'double'].map((id) => [id, avg(rows.map((x) => x.c.pTrigs[id] || 0))])),
      comeback: rows.filter((x) => x.winnerAt).length ? rows.filter((x) => x.winnerAt && x.winnerAt.rank > 1).length / rows.filter((x) => x.winnerAt).length : null,
      comebackBelow: rows.filter((x) => x.winnerAt).length ? rows.filter((x) => x.winnerAt && x.winnerAt.below).length / rows.filter((x) => x.winnerAt).length : null,
    };
    summary.push(r);
    if (TARGET_SWEEP) {
      console.log(`${mode.padEnd(8)} n=${n} target=${targetName(sweepTarget).padEnd(5)} games=${String(r.games).padStart(4)}  by target ${pct(r.targetEnd).padStart(6)}  by rounds ${pct(r.roundsEnd).padStart(6)}  last standing ${pct(r.bankruptEnd).padStart(6)}  avg ${r.rounds.toFixed(1).padStart(5)} rounds (max ${r.maxRounds})`);
    } else if (EXTREMES_ARG !== null) {
      console.log(`${preset.name.padEnd(22)} ${mode.padEnd(8)} n=${n} ${String(r.games).padStart(4)}/${GAMES} ok  by target ${pct(r.targetEnd).padStart(6)}  by rounds ${pct(r.roundsEnd).padStart(6)}  last standing ${pct(r.bankruptEnd).padStart(6)}  avg ${r.rounds.toFixed(1).padStart(5)} rounds (max ${r.maxRounds})  ${r.rents.toFixed(1)} rents @ ${L(r.rentAvg)}, ${r.upgrades.toFixed(1)} upgrades, ${r.stuck.toFixed(1)} jams, ${r.auctionsEnded.toFixed(1)} auctions (${r.auctionsTimedOut.toFixed(1)} by timer, ${r.auctionTies.toFixed(2)} ties)`);
    } else if (!QUIET) {
      console.log(`\n=== ${MODES[mode]?.label || mode}, ${n} players: ${r.games}/${GAMES} games ok ===`);
      console.log(`length        : ${r.rounds.toFixed(1)} rounds avg (max ${r.maxRounds}), ${r.turns.toFixed(1)} turns`);
      console.log(`districts     : ${pct(r.owned3)} owned after round 3, ${pct(r.owned5)} after round 5`);
      console.log(`ending        : ${pct(r.targetEnd)} by win target (${r.sweepTarget === undefined ? targetName(r.targetCfg) : targetName(r.sweepTarget)}), ${pct(r.roundsEnd)} by round limit, ${pct(r.bankruptEnd)} by bankruptcy (last standing); ${r.bankrupts.toFixed(2)} bankruptcies/game (the bank took everything, creditors were paid ${L(r.bankPaid)} per game), ${r.debts.toFixed(1)} debts, ${r.mortgages.toFixed(1)} mortgages`);
      console.log(`net worth     : winner ${L(r.top)} avg, spread (richest - poorest active) ${L(r.spread)} avg`);
      console.log(`per game      : ${r.upgrades.toFixed(1)} upgrades (${r.endLevels.toFixed(1)} levels standing at the end), ${r.rides.toFixed(1)} rides, ${r.auctions.toFixed(1)} auctions won (${r.bazaar.toFixed(1)} bazaar), ${r.stuck.toFixed(1)} traffic jams`);
      console.log(`rent          : ${r.rents.toFixed(1)} payments/game, ${L(r.rentAvg)} avg payment;  seat 1 wins ${pct(r.seat1)}`);
      console.log(`auctions      : ${r.auctionsEnded.toFixed(1)} ended/game, ${r.auctionsTimedOut.toFixed(1)} by the timer, ${r.auctionsUnsold.toFixed(1)} unsold, ${r.auctionTies.toFixed(2)} ties; longest ${r.auctionSteps} actions`);
      if (SETTINGS.powerCards === true) console.log(`power cards   : ${r.pDraw.toFixed(1)} drawn/game (${r.pTile.toFixed(1)} from tiles; ${r.pPerPlayer10.toFixed(2)} per player per 10 rounds), ${r.pPlay.toFixed(1)} played (${POWER_IDS.map((id) => `${id} ${r.pPlays[id].toFixed(2)}`).join(', ')}), ${r.pExpired.toFixed(1)} expired; triggers: shield saved ${L(r.pTrigs.shield)}, double earned ${L(r.pTrigs.double)} per game`);
      if (SETTINGS.powerCards === true && r.comeback !== null) console.log(`comeback      : the winner was NOT leading at round ${6} in ${pct(r.comeback)} of games, below ${POWER.TRAILING_RATIO} x the average in ${pct(r.comebackBelow)}`);
      console.log(`snatch        : ${r.windows.toFixed(1)} windows/game, ${r.snatched.toFixed(2)} snatched + ${r.snatchBids.toFixed(2)} bidding; ${r.snatchCards.toFixed(2)} buttons from cards, ${r.snatchPaid.toFixed(2)} cards paid out at the cap`);
    }
   }
  }
}
}
}
console.log(`\n${failures === 0 ? `ALL INVARIANTS HELD (${RUN_MAPS.join(', ')})` : `${failures} GAME(S) FAILED`} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (QUIET && !TARGET_SWEEP) for (const r of summary) console.log(`${r.map} ${r.mode} n=${r.n} rounds=${r.rounds.toFixed(1)} turns=${r.turns.toFixed(0)} owned5=${pct(r.owned5)} target=${pct(r.targetEnd)} bankr=${pct(r.bankruptEnd)} spread=${L(r.spread)} upg=${r.upgrades.toFixed(1)} seat1=${pct(r.seat1)}${r.comeback === null ? '' : ` comeback=${pct(r.comeback)}`}${SETTINGS.powerCards === true ? ` cards=${r.pDraw.toFixed(1)}/${r.pPlay.toFixed(1)} (${r.pPerPlayer10.toFixed(2)}/player/10r) trig=${r.pTrig.toFixed(1)} exp=${r.pExpired.toFixed(1)}` : ''}`);
if (failures) process.exitCode = 1;
