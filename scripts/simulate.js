// Bot-only simulation of Hyderabad Tycoon (Hyderabad Hustle rules): checks engine invariants and prints balance stats.
//
//   node scripts/simulate.js [--games 200] [--players 2,4,6] [--modes standard,quick,classic] [--seed 1]
//                            [--set startCash=1200000,passStart=150000] [--bot reserve=150000,greed=1] [--quiet]
//                            [--targets off,2500000,3000000,5000000] [--extremes [name,name,...]]
//
// --set      host-rule overrides to experiment without editing the engine: ANY key of shared/ruleSettings.js (startCash,
//            passStart, targetWorth, rentPercent, trafficFine, turnSeconds, tradeSeconds, maxRounds, dice, auctionOnDecline,
//            requireFullSet, eventEvery, chaiCap, snatches, snatchMs, snatchCardCap), e.g.
//            --set rentPercent=200,requireFullSet=false,dice=fair. `null` switches targetWorth / maxRounds off, true / false are
//            booleans. Out-of-range values are clamped like the engine does (SETTING_LIMITS).
// --extremes the host-rule extremes battery: every preset (see EXTREMES below, or pick by name) is played --games times per
//            (mode, players) on top of --set, printing one line per run. The invariants (including "every rule really
//            changed the game": salary, fines, rent level, events, round limit, upgrades) are checked on every action.
// --bot      default bot params for every seat.
// --targets  sweep: run every (mode, players) once per win target in the list ("off" = no target) and print one line
//            per run: the share of games ending by target / rounds / last standing and the average length.
//
// Reported per (players, mode): game length in rounds and turns, how many districts are owned after round 3 and 5,
// upgrades, rides, auctions, how the games end (win target, round limit, bankruptcy), and the final net-worth spread.

import {
  createGame, applyAction, nextBotMove, botSnatchAction, netWorth, liquidationValue, standings, mulberry32,
  BOARD_SIZE, MAX_LEVEL, TILES, GROUP_TILES, isBuyable, CITY_EVENTS, MODES, ROUND_CAP, SETTING_LIMITS, RULE_KEYS, previewRent, isTargetAmount,
} from '../shared/index.js';

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
const TARGET_SWEEP = arg('targets', null) === null ? null
  : String(arg('targets')).split(',').map((t) => (t.trim() === 'off' || t.trim() === 'null' ? null : Number(t)));
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
  if (s.phase === 'auction' && s.pending?.type !== 'auction') fail('auction phase without pending auction');
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
}

/** What one action's events must respect, checked against the state BEFORE it (the rules really are read from cfg). */
function checkRules(prev, action, res) {
  const fail = (msg) => { throw new Error(`rule: ${msg}`); };
  const cfg = prev.cfg;
  for (const e of res.events) {
    if (e.type === 'cash' && e.reason === 'salary' && e.delta !== cfg.passStart) fail(`salary ${e.delta}, passStart is ${cfg.passStart}`);
    if (e.type === 'cash' && e.reason === 'traffic' && e.delta !== -cfg.trafficFine) fail(`traffic fine ${-e.delta}, trafficFine is ${cfg.trafficFine}`);
    if (e.type === 'city_event' && !(cfg.eventEvery > 0)) fail('a city event although events are off');
    if (e.type === 'level' && e.reason === 'upgrade' && cfg.requireFullSet) {
      const owner = prev.owners[e.tile];
      if (!GROUP_TILES[TILES[e.tile].group].every((t) => prev.owners[t] === owner)) fail(`tile ${e.tile} upgraded without the full collection`);
    }
  }
  if (cfg.passStart === 0 && res.events.some((e) => e.type === 'cash' && e.reason === 'salary')) fail('salary although passStart is 0');
  // a plain landing on somebody's district: the rent paid is the preview of the engine (cfg.rentPercent included), or its chai-halved half
  if (action.type === 'ROLL' && res.events.filter((e) => e.type === 'land').length === 1) {
    const land = res.events.find((e) => e.type === 'land');
    const owner = prev.owners[land.tile];
    if (isBuyable(TILES[land.tile]) && owner && owner !== action.playerId && !prev.players.find((p) => p.id === owner).bankrupt
        && !res.events.some((e) => e.type === 'debt' || e.type === 'bankrupt')) {
      const paid = res.events.filter((e) => e.type === 'cash' && e.reason === 'rent' && e.delta < 0 && e.player === action.playerId).reduce((n, e) => n - e.delta, 0);
      const bill = previewRent(prev, land.tile);
      if (paid !== bill && paid !== bill - Math.floor(bill / 2)) fail(`rent on tile ${land.tile}: paid ${paid}, preview ${bill} (rent level ${cfg.rentPercent}%)`);
    }
  }
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
  { name: 'no-auction', set: { auctionOnDecline: false } },
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
  const wanted = { mode, ...SETTINGS, ...extra };
  let s = createGame({ players, settings: wanted, seed });
  checkConfig(s, wanted);
  const rnd = mulberry32(seed * 31 + 7);
  const c = { upgrades: 0, rides: 0, auctions: 0, bazaar: 0, rents: 0, rentTotal: 0, bankrupt: 0, debts: 0, mortgages: 0, stuck: 0, chaiSaved: 0, cards: 0, windows: 0, snatched: 0, snatchBids: 0, snatchCards: 0, snatchPaid: 0 };
  const owned = {};
  let actions = 0;
  while (s.phase !== 'over') {
    if (++actions > MAX_ACTIONS) throw new Error('too many actions');
    let a;
    if (s.phase === 'snatch') {
      // Everybody who may press decides by the trivial bot policy, then the room's timer closes the window
      // (auto-play and the normal bot chooser never snatch).
      a = s.pending.eligible.filter((id) => !s.pending.claims.includes(id)).map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
    } else a = nextBotMove(s, rnd);
    if (!a) throw new Error(`no bot move in phase ${s.phase}`);
    const res = applyAction(s, a);
    if (res.error) throw new Error(`${a.type}: ${res.error}`);
    checkRules(s, a, res);
    const before = s.round;
    s = res.state;
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
    }
    if (s.round !== before) for (const r of [4, 6]) if (s.round === r && !(r in owned)) owned[r] = s.owners.filter(Boolean).length;
    checkInvariants(s);
  }
  const worths = s.players.filter((p) => !p.bankrupt).map((p) => netWorth(s, p.id));
  const rounds = Math.min(s.round, s.cfg.maxRounds ?? ROUND_CAP);
  return {
    rounds, turns: s.turnCount, reason: s.winReason, c, targetCfg: s.cfg.targetWorth,
    owned3: owned[4] ?? s.owners.filter(Boolean).length, owned5: owned[6] ?? s.owners.filter(Boolean).length,
    spread: worths.length > 1 ? Math.max(...worths) - Math.min(...worths) : 0,
    top: Math.max(...worths),
    levels: s.levels.reduce((a, b) => a + b, 0),
    seatWin: s.players.findIndex((p) => p.id === s.winner),
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
      mode, n, games: rows.length, sweepTarget, targetCfg: rows[0].targetCfg,
      rounds: avg(rows.map((x) => x.rounds)),
      maxRounds: Math.max(...rows.map((x) => x.rounds)),
      turns: avg(rows.map((x) => x.turns)),
      owned3: avg(rows.map((x) => x.owned3)) / DISTRICTS,
      owned5: avg(rows.map((x) => x.owned5)) / DISTRICTS,
      bankruptEnd: rows.filter((x) => x.reason === 'last_standing').length / rows.length,
      targetEnd: rows.filter((x) => x.reason === 'target').length / rows.length,
      roundsEnd: rows.filter((x) => x.reason === 'rounds').length / rows.length,
      bankrupts: avg(rows.map((x) => x.c.bankrupt)),
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
    };
    summary.push(r);
    if (TARGET_SWEEP) {
      console.log(`${mode.padEnd(8)} n=${n} target=${targetName(sweepTarget).padEnd(5)} games=${String(r.games).padStart(4)}  by target ${pct(r.targetEnd).padStart(6)}  by rounds ${pct(r.roundsEnd).padStart(6)}  last standing ${pct(r.bankruptEnd).padStart(6)}  avg ${r.rounds.toFixed(1).padStart(5)} rounds (max ${r.maxRounds})`);
    } else if (EXTREMES_ARG !== null) {
      console.log(`${preset.name.padEnd(22)} ${mode.padEnd(8)} n=${n} ${String(r.games).padStart(4)}/${GAMES} ok  by target ${pct(r.targetEnd).padStart(6)}  by rounds ${pct(r.roundsEnd).padStart(6)}  last standing ${pct(r.bankruptEnd).padStart(6)}  avg ${r.rounds.toFixed(1).padStart(5)} rounds (max ${r.maxRounds})  ${r.rents.toFixed(1)} rents @ ${L(r.rentAvg)}, ${r.upgrades.toFixed(1)} upgrades, ${r.stuck.toFixed(1)} jams`);
    } else if (!QUIET) {
      console.log(`\n=== ${MODES[mode]?.label || mode}, ${n} players: ${r.games}/${GAMES} games ok ===`);
      console.log(`length        : ${r.rounds.toFixed(1)} rounds avg (max ${r.maxRounds}), ${r.turns.toFixed(1)} turns`);
      console.log(`districts     : ${pct(r.owned3)} owned after round 3, ${pct(r.owned5)} after round 5`);
      console.log(`ending        : ${pct(r.targetEnd)} by win target (${r.sweepTarget === undefined ? targetName(r.targetCfg) : targetName(r.sweepTarget)}), ${pct(r.roundsEnd)} by round limit, ${pct(r.bankruptEnd)} by bankruptcy (last standing); ${r.bankrupts.toFixed(2)} bankruptcies/game, ${r.debts.toFixed(1)} debts, ${r.mortgages.toFixed(1)} mortgages`);
      console.log(`net worth     : winner ${L(r.top)} avg, spread (richest - poorest active) ${L(r.spread)} avg`);
      console.log(`per game      : ${r.upgrades.toFixed(1)} upgrades (${r.endLevels.toFixed(1)} levels standing at the end), ${r.rides.toFixed(1)} rides, ${r.auctions.toFixed(1)} auctions won (${r.bazaar.toFixed(1)} bazaar), ${r.stuck.toFixed(1)} traffic jams`);
      console.log(`rent          : ${r.rents.toFixed(1)} payments/game, ${L(r.rentAvg)} avg payment;  seat 1 wins ${pct(r.seat1)}`);
      console.log(`snatch        : ${r.windows.toFixed(1)} windows/game, ${r.snatched.toFixed(2)} snatched + ${r.snatchBids.toFixed(2)} bidding; ${r.snatchCards.toFixed(2)} buttons from cards, ${r.snatchPaid.toFixed(2)} cards paid out at the cap`);
    }
   }
  }
}
}
console.log(`\n${failures === 0 ? 'ALL INVARIANTS HELD' : `${failures} GAME(S) FAILED`} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (QUIET && !TARGET_SWEEP) for (const r of summary) console.log(`${r.mode} n=${r.n} rounds=${r.rounds.toFixed(1)} turns=${r.turns.toFixed(0)} owned5=${pct(r.owned5)} target=${pct(r.targetEnd)} bankr=${pct(r.bankruptEnd)} spread=${L(r.spread)} upg=${r.upgrades.toFixed(1)}`);
if (failures) process.exitCode = 1;
