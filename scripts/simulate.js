// Bot-only simulation of Hyderabad Tycoon (Hyderabad Hustle rules): checks engine invariants and prints balance stats.
//
//   node scripts/simulate.js [--games 200] [--players 2,4,6] [--modes standard,quick,classic] [--seed 1]
//                            [--set startCash=1200000,passStart=150000] [--bot reserve=150000,greed=1] [--quiet]
//                            [--targets off,2500000,3000000,5000000]
//
// --set      engine overrides (startCash, passStart, maxRounds, trafficFine, targetWorth) to experiment without
//            editing the engine. `targetWorth=null` switches the win target off (the old rules).
// --bot      default bot params for every seat.
// --targets  sweep: run every (mode, players) once per win target in the list ("off" = no target) and print one line
//            per run: the share of games ending by target / rounds / last standing and the average length.
//
// Reported per (players, mode): game length in rounds and turns, how many districts are owned after round 3 and 5,
// upgrades, rides, auctions, how the games end (win target, round limit, bankruptcy), and the final net-worth spread.

import {
  createGame, applyAction, nextBotMove, netWorth, liquidationValue, standings, mulberry32,
  BOARD_SIZE, MAX_LEVEL, TILES, isBuyable, CITY_EVENTS, EVENT_EVERY, MODES, ROUND_CAP,
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
    if (k) out[k.trim()] = v === 'null' ? null : Number.isNaN(Number(v)) ? v : Number(v);
  }
  return out;
};

const GAMES = Number(arg('games', 200));
const PLAYER_COUNTS = String(arg('players', '2,4,6')).split(',').map(Number);
const MODE_LIST = String(arg('modes', 'standard,quick,classic')).split(',').map((m) => m.trim());
const BASE_SEED = Number(arg('seed', 1));
const SETTINGS = parseKV(arg('set', ''));
const BOT = parseKV(arg('bot', ''));
const QUIET = arg('quiet', false) === true;
const TARGET_SWEEP = arg('targets', null) === null ? null
  : String(arg('targets')).split(',').map((t) => (t.trim() === 'off' || t.trim() === 'null' ? null : Number(t)));
const MAX_ACTIONS = 60000;
const DISTRICTS = TILES.filter(isBuyable).length;

// ---------- invariants ----------
function checkInvariants(s) {
  const fail = (msg) => { throw new Error(`invariant: ${msg}`); };
  if (!['roll', 'buy', 'auction', 'manage', 'debt', 'over'].includes(s.phase)) fail(`bad phase ${s.phase}`);
  if (!Number.isInteger(s.round) || s.round < 1) fail(`bad round ${s.round}`);
  if (!Number.isInteger(s.rng)) fail('rng not an integer');
  const ids = new Set(s.players.map((p) => p.id));
  const pieces = new Set(s.players.map((p) => p.piece));
  if (pieces.size !== s.players.length) fail('two players share a piece');
  for (const p of s.players) {
    if (!Number.isInteger(p.cash) || p.cash < 0) fail(`${p.id} bad cash ${p.cash}`);
    if (!Number.isInteger(p.pos) || p.pos < 0 || p.pos >= BOARD_SIZE) fail(`${p.id} bad pos ${p.pos}`);
    if (!Number.isInteger(p.chai) || p.chai < 0 || p.chai > s.cfg.chaiCap) fail(`${p.id} bad chai ${p.chai}`);
    if (p.stuck && p.bankrupt) fail(`${p.id} stuck while bankrupt`);
    if (p.bankrupt && (p.cash !== 0 || s.owners.includes(p.id))) fail(`${p.id} bankrupt but still holds assets`);
    for (const [k, v] of Object.entries(p.stats)) if (!Number.isFinite(v) || v < 0) fail(`${p.id} stat ${k}=${v}`);
    if (!Number.isFinite(netWorth(s, p.id))) fail(`${p.id} worth not finite`);
  }
  if (s.event !== null) {
    if (!CITY_EVENTS.some((d) => d.id === s.event.id)) fail(`unknown city event ${s.event.id}`);
    if (s.event.round !== s.round || s.round % EVENT_EVERY !== 0) fail(`city event ${s.event.id} in round ${s.round}`);
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
  if (s.phase !== 'buy' && s.phase !== 'auction' && s.pending) fail(`pending left over in phase ${s.phase}`);
  if (s.ride && (s.phase === 'over' || s.ride.player !== s.players[s.turn].id)) fail('ride offered to someone else');
  if (s.phase === 'debt') {
    const d = s.debt;
    if (!d) fail('debt phase without a debt');
    const debtor = s.players.find((p) => p.id === d.player);
    if (!debtor || debtor.bankrupt) fail('debtor missing or bankrupt');
    if (debtor.cash + liquidationValue(s, d.player) < d.amount) fail('uncoverable debt should be a bankruptcy');
  } else if (s.debt) fail('debt left over outside the debt phase');
  // The win target: once nothing is in flight nobody may sit at or above it while the game goes on.
  const target = s.cfg.targetWorth;
  if (target != null && s.phase !== 'over' && s.phase !== 'debt' && s.phase !== 'auction' && !s.trade) {
    for (const p of s.players) if (!p.bankrupt && netWorth(s, p.id) >= target) fail(`${p.id} is at the target but the game goes on`);
  }
  if (s.phase !== 'over') {
    if (s.players[s.turn].bankrupt && s.phase !== 'auction' && s.phase !== 'debt') fail('turn points at a bankrupt player');
    if (s.players.filter((p) => !p.bankrupt).length < 2) fail('game should be over');
  } else {
    if (!['last_standing', 'target', 'rounds'].includes(s.winReason)) fail(`over with winReason ${s.winReason}`);
    const top = standings(s)[0];
    if (s.winner && top.id !== s.winner) fail(`winner ${s.winner} is not rank 1 (${top.id})`);
    if (s.winReason === 'target' && !(target != null && netWorth(s, s.winner) >= target)) fail('target win below the target');
    if (s.winReason === 'rounds' && target != null && s.players.some((p) => !p.bankrupt && netWorth(s, p.id) >= target)) fail('rounds win while someone is at the target');
  }
}

// ---------- one game ----------
function playGame(n, mode, seed, extra = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot ${i + 1}`, isBot: true, bot: { ...BOT } }));
  let s = createGame({ players, settings: { mode, ...SETTINGS, ...extra }, seed });
  const rnd = mulberry32(seed * 31 + 7);
  const c = { upgrades: 0, rides: 0, auctions: 0, bazaar: 0, rents: 0, rentTotal: 0, bankrupt: 0, debts: 0, mortgages: 0, stuck: 0, chaiSaved: 0, cards: 0 };
  const owned = {};
  let actions = 0;
  while (s.phase !== 'over') {
    if (++actions > MAX_ACTIONS) throw new Error('too many actions');
    const a = nextBotMove(s, rnd);
    if (!a) throw new Error(`no bot move in phase ${s.phase}`);
    const res = applyAction(s, a);
    if (res.error) throw new Error(`${a.type}: ${res.error}`);
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
      else if (e.type === 'card') c.cards++;
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
    };
    summary.push(r);
    if (TARGET_SWEEP) {
      console.log(`${mode.padEnd(8)} n=${n} target=${targetName(sweepTarget).padEnd(5)} games=${String(r.games).padStart(4)}  by target ${pct(r.targetEnd).padStart(6)}  by rounds ${pct(r.roundsEnd).padStart(6)}  last standing ${pct(r.bankruptEnd).padStart(6)}  avg ${r.rounds.toFixed(1).padStart(5)} rounds (max ${r.maxRounds})`);
    } else if (!QUIET) {
      console.log(`\n=== ${MODES[mode]?.label || mode}, ${n} players: ${r.games}/${GAMES} games ok ===`);
      console.log(`length        : ${r.rounds.toFixed(1)} rounds avg (max ${r.maxRounds}), ${r.turns.toFixed(1)} turns`);
      console.log(`districts     : ${pct(r.owned3)} owned after round 3, ${pct(r.owned5)} after round 5`);
      console.log(`ending        : ${pct(r.targetEnd)} by win target (${r.sweepTarget === undefined ? targetName(r.targetCfg) : targetName(r.sweepTarget)}), ${pct(r.roundsEnd)} by round limit, ${pct(r.bankruptEnd)} by bankruptcy (last standing); ${r.bankrupts.toFixed(2)} bankruptcies/game, ${r.debts.toFixed(1)} debts, ${r.mortgages.toFixed(1)} mortgages`);
      console.log(`net worth     : winner ${L(r.top)} avg, spread (richest - poorest active) ${L(r.spread)} avg`);
      console.log(`per game      : ${r.upgrades.toFixed(1)} upgrades (${r.endLevels.toFixed(1)} levels standing at the end), ${r.rides.toFixed(1)} rides, ${r.auctions.toFixed(1)} auctions won (${r.bazaar.toFixed(1)} bazaar), ${r.stuck.toFixed(1)} traffic jams`);
      console.log(`rent          : ${r.rents.toFixed(1)} payments/game, ${L(r.rentAvg)} avg payment;  seat 1 wins ${pct(r.seat1)}`);
    }
   }
  }
}
console.log(`\n${failures === 0 ? 'ALL INVARIANTS HELD' : `${failures} GAME(S) FAILED`} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (QUIET && !TARGET_SWEEP) for (const r of summary) console.log(`${r.mode} n=${r.n} rounds=${r.rounds.toFixed(1)} turns=${r.turns.toFixed(0)} owned5=${pct(r.owned5)} target=${pct(r.targetEnd)} bankr=${pct(r.bankruptEnd)} spread=${L(r.spread)} upg=${r.upgrades.toFixed(1)}`);
if (failures) process.exitCode = 1;
