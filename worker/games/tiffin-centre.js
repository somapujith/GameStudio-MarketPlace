// Server adapter for Tiffin Centre (docs/TIFFIN_CENTRE_PLAN.md sections 3, 4 and 7): a real-time, co-op tiffin stall for 2-4 friends.
// The rules live in shared/tiffin-centre (pure engine); this file is the only place the Worker learns them. The game has no turns:
// the room server ticks the stall once per TICK_MS through `deadlines`, and every player acts at any time.
import * as engine from '../../shared/tiffin-centre/index.js';
import { workOf } from '../../shared/tiffin-centre/scoring.js';
import { GAME_ID, TICK_MS, SETTINGS_SPEC, DEFAULT_SETTINGS, PACE, STATIONS, DISHES, INGREDIENTS, levelDef } from '../../shared/tiffin-centre/catalog.js';
import { validTarget } from '../../shared/tiffin-centre/movement.js';
import { query } from '../db.js';

export const ID = GAME_ID;
export const NOOP_ERROR = 'Already there.';
/** A running stall's room record is written to storage at most this often (GameRoom `persistEveryMs`); see worker/games/index.js. */
export const PERSIST_EVERY_MS = 5000;
/**
 * Co-op rewards are paid for at most this many Tiffin Centre matches per account per IST day (worker/match.js `dailyRewardedMatches`);
 * further matches are still recorded (stats, rating) but pay 0 XP and 0 coins.
 */
export const DAILY_REWARDED_MATCHES = 12;
export const CAN_HOST_ERROR = 'Finish the Tiffin Centre tutorial first to open a table.';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** An own property of a client object (never one inherited through `__proto__`). */
const own = (o, k) => (hasOwn(o, k) ? o[k] : undefined);

// ------------------------------------------------------------------ settings (strict, derived from the shared SETTINGS_SPEC)

const LEVEL = SETTINGS_SPEC.level;
const PACE_IDS = SETTINGS_SPEC.pace.options;
export const LEVEL_ERROR = `Level must be a whole number from ${LEVEL.min} to ${LEVEL.max}.`;
export const PACE_ERROR = `Pace must be one of ${PACE_IDS.join(', ')}.`;

/**
 * Strict check of untrusted host settings `{ level, pace }`. Missing keys take the defaults, unknown keys are dropped.
 * A level must be a real integer (no strings, floats, NaN); a pace must be one of the listed ids.
 */
function validateSettings(raw) {
  const r = raw === undefined || raw === null ? {} : raw;
  if (!isPlain(r)) return { ok: false, error: 'Settings must be an object.' };
  const level = hasOwn(r, 'level') && r.level !== undefined ? r.level : DEFAULT_SETTINGS.level;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < LEVEL.min || level > LEVEL.max) return { ok: false, error: LEVEL_ERROR };
  const pace = hasOwn(r, 'pace') && r.pace !== undefined ? r.pace : DEFAULT_SETTINGS.pace;
  if (typeof pace !== 'string' || !PACE_IDS.includes(pace)) return { ok: false, error: PACE_ERROR };
  return { ok: true, settings: { level, pace } };
}

/** Settings of a stored room, made safe: anything invalid falls back to the default for that key. */
function normalize(settings) {
  const s = isPlain(settings) ? settings : {};
  const level = own(s, 'level');
  const pace = own(s, 'pace');
  return {
    level: Number.isInteger(level) && level >= LEVEL.min && level <= LEVEL.max ? level : DEFAULT_SETTINGS.level,
    pace: typeof pace === 'string' && PACE_IDS.includes(pace) ? pace : DEFAULT_SETTINGS.pace,
  };
}

// ------------------------------------------------------------------ client actions (allow-list)

const SLOT_MAX = 9;
const CUSTOMER_MAX = 1_000_000;
const isSmallInt = (v, max) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const isStation = (v) => typeof v === 'string' && hasOwn(STATIONS, v);
const isDish = (v) => typeof v === 'string' && hasOwn(DISHES, v);
const isIngredient = (v) => typeof v === 'string' && hasOwn(INGREDIENTS, v);
/** The back counter (operations layer): the only station `prep` / `collectPrep` take, with its two job slots. */
const PREP_ID = 'prep1';
const PREP_SLOTS = 2;
const BUY_MAX = 10;
const isPrepSlot = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PREP_SLOTS;
const isPrepStation = (v) => v === PREP_ID;

/**
 * Clean an action received from a client: only `cook take serve collect discard move emote` and the operations actions
 * `prep collectPrep tend swapGas board buy` pass, every field is strictly typed and everything else is dropped. `tick`, `spawn`,
 * `tutorial-flags` and unknown types are refused (null); the `playerId` is forced to the sender. Whether the action is legal right
 * now (level, stock, gas, heat, tutorial) is the engine's job.
 */
export function sanitizeAction(input, playerId) {
  if (!isPlain(input) || typeof playerId !== 'string' || !playerId) return null;
  const type = own(input, 'type');
  if (typeof type !== 'string') return null;
  const f = (k) => own(input, k);
  switch (type) {
    case 'cook':
      return isStation(f('station')) && isSmallInt(f('slot'), SLOT_MAX) && isDish(f('dish'))
        ? { type, station: f('station'), slot: f('slot'), dish: f('dish'), playerId }
        : null;
    case 'take':
      return isStation(f('station')) && isSmallInt(f('slot'), SLOT_MAX) ? { type, station: f('station'), slot: f('slot'), playerId } : null;
    case 'serve':
      return isSmallInt(f('customer'), CUSTOMER_MAX) && isSmallInt(f('hand'), SLOT_MAX)
        ? { type, customer: f('customer'), hand: f('hand'), playerId }
        : null;
    case 'collect':
      return isSmallInt(f('customer'), CUSTOMER_MAX) ? { type, customer: f('customer'), playerId } : null;
    case 'discard':
      return isSmallInt(f('hand'), SLOT_MAX) ? { type, hand: f('hand'), playerId } : null;
    case 'move': {
      const to = f('to');
      if (to === undefined || to === null) return { type, to: null, playerId };
      return validTarget(to) ? { type, to, playerId } : null; // a station id, `spot:N` (N < 6) or 'bin'; the engine checks the level
    }
    case 'prep':
      return isPrepStation(f('station')) && isPrepSlot(f('slot')) && isIngredient(f('item'))
        ? { type, station: PREP_ID, slot: f('slot'), item: f('item'), playerId }
        : null;
    case 'collectPrep':
      return isPrepStation(f('station')) && isPrepSlot(f('slot')) ? { type, station: PREP_ID, slot: f('slot'), playerId } : null;
    case 'tend':
      return isStation(f('station')) ? { type, station: f('station'), playerId } : null; // the engine says whether it is a pan / steamer
    case 'swapGas':
      return { type, playerId };
    case 'board':
      return isDish(f('dish')) && typeof f('on') === 'boolean' ? { type, dish: f('dish'), on: f('on'), playerId } : null;
    case 'buy': {
      const n = f('n');
      return isIngredient(f('item')) && typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= BUY_MAX
        ? { type, item: f('item'), n, playerId }
        : null;
    }
    case 'emote':
      return typeof f('e') === 'string' && engine.EMOTES.includes(f('e')) ? { type, e: f('e'), playerId } : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ the adapter

const adapter = {
  id: ID,
  name: 'Tiffin Centre',
  minPlayers: 2,
  maxPlayers: 4,
  defaultMaxPlayers: 4,
  defaultSettings: { ...DEFAULT_SETTINGS },
  /** No intro animation: the first tick is due TICK_MS after the game starts. */
  startAnimMs: 0,

  /**
   * A real-time room changes on every tick and every action; persisting the whole record each time would burn the Durable Object
   * storage row quota (rows written). The room keeps the authoritative state in memory and writes it at most once per this interval
   * while the shift runs (always at once on start / game over / join / leave / settings). A restart loses at most this much play.
   */
  persistEveryMs: () => PERSIST_EVERY_MS,

  /** Rewards are capped per account per IST day (match.js): an opt-in number of rewarded matches. */
  dailyRewardedMatches: DAILY_REWARDED_MATCHES,

  validateSettings,

  /** A host's patch over the current settings: only the two known keys can change. */
  mergeSettings(current, patch) {
    const out = { ...normalize(current) };
    if (isPlain(patch)) {
      for (const k of ['level', 'pace']) if (hasOwn(patch, k) && patch[k] !== undefined) out[k] = patch[k];
    }
    return out;
  },

  /** Settings as the lobby shows them: exactly what createGame runs with. */
  lobbySettings: (settings) => normalize(settings),

  /** One line for open-table cards and the lobby, e.g. "Level 3 - Poori Morning, Rush hour pace". */
  summarize(settings) {
    const s = normalize(settings);
    return `Level ${s.level} - ${levelDef(s.level).name}, ${PACE[s.pace].label} pace`;
  },

  createGame({ players, settings, seed }) {
    return engine.createGame({
      players: (Array.isArray(players) ? players : []).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
      settings: normalize(settings),
      seed,
    });
  },

  sanitizeAction,

  /** Engine step. Never throws: a failure is an ordinary refusal (same state, no events, an error text). */
  applyAction(state, action) {
    try {
      const res = engine.applyAction(state, action);
      // A well-formed action that changes nothing (a `move` to where the player already stands) must not look like a state change:
      // the room would bump seq, save and broadcast it. Refuse it instead (the client never shows this one, see roomCore QUIET_ERRORS).
      if (res && typeof res === 'object' && res.state === state && !res.error && !(res.events && res.events.length)) {
        return { state, events: [], error: NOOP_ERROR };
      }
      if (res && typeof res === 'object' && res.state) return res;
    } catch {
      /* fall through to the refusal below */
    }
    return { state, events: [], error: 'That did not work.' };
  },

  // Nobody is "on turn": the stall runs in real time, so the room never waits for a decision or plays for an idle seat.
  turnPlayerId: () => null,
  pendingPlayerIds: () => [],
  idleAction: () => null,

  /**
   * The server clock: one `tick` per TICK_MS while the shift runs. The key carries the tick number, so a player's action between
   * ticks (same key) never restarts the timer, and `anchor: 'apply'` counts from the moment the last state was sent.
   */
  deadlines(state) {
    if (!state || state.status !== 'playing') return [];
    return [{ key: `tick-${state.tick}`, afterMs: TICK_MS, anchor: 'apply', playerId: null, action: { type: 'tick', tick: state.tick } }];
  },

  isOver: (state) => engine.isOver(state),

  /**
   * Co-op result: the whole team shares rank 1 when the shift earned at least a star (rank = team size otherwise); `winnerId` is the
   * top earner on success, null on failure (the headline, and the match row's winner_id); `winners` lists EVERY seat that did real work
   * on a cleared shift (scoring.js `winnersOf`; match.js credits each one with the win, so a cook or a prep hand who never collected a
   * rupee is a winner too); `score` = the money that player collected. Stars and rank come from the team's PROFIT (the engine decides).
   * `stats` per player = served / collected / cooked / earned / tips / prepped / tended / gasSwaps / bought (their own work) plus the team's
   * books (revenue cost waste fines profit lost unpaid bestCombo, the same on every row). The books also sit once at the top level, with
   * `team` (small flat integers only). `rounds` = ticks played. `stats.idle` = true on a seat that did no work (scoring.js `workOf`:
   * served + collected + cooked + prepped + tended + gasSwaps + bought = 0; `cooked` counts dishes that reached a pair of hands) and on every
   * seat when no customer paid: match.js pays those seats nothing.
   */
  result(state) {
    const res = engine.result(state);
    const num = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
    const books = {
      revenue: num(res.revenue),
      tips: num(res.tips),
      cost: num(res.cost),
      waste: num(res.waste),
      fines: num(res.fines),
      profit: num(res.profit),
      served: num(res.served),
      lost: num(res.lost),
      unpaid: num(res.unpaid),
      bestCombo: num(res.bestCombo),
    };
    const t = res.team && typeof res.team === 'object' ? res.team : {};
    const paidCustomers = num(t.paid);
    const team = { ...books, prepped: num(t.prepped), tended: num(t.tended), gasSwaps: num(t.gasSwaps), bought: num(t.bought) };
    const teamBooks = { revenue: books.revenue, cost: books.cost, waste: books.waste, fines: books.fines, profit: books.profit, lost: books.lost, unpaid: books.unpaid, bestCombo: books.bestCombo };
    const idle = new Set();
    const standings = res.standings.map((row) => {
      const stats = { ...teamBooks, ...row.stats, finished: true }; // a player's own served / tips / prepped ... win over the team's
      // Idle guard (match.js pays nothing to `stats.idle`): a seat that did no work at all, and EVERY seat of a stall that never
      // got a customer to pay, earned nothing from this shift (an untouched table cannot be farmed for XP and coins).
      if (workOf(row.stats) === 0 || paidCustomers === 0) {
        stats.idle = true;
        idle.add(row.id);
      }
      return { id: row.id, rank: row.rank, score: Math.max(0, Math.round(row.score) || 0), stats };
    });
    return {
      winnerId: res.winnerId ?? null,
      winners: (Array.isArray(res.winners) ? res.winners : []).filter((id) => !idle.has(id)),
      reason: res.reason,
      rounds: Number.isFinite(state.tick) ? state.tick : 0,
      stars: res.stars,
      money: res.money,
      level: res.level,
      ...books,
      team,
      standings,
    };
  },

  /** Nothing is hidden: the whole stall is shared. */
  redact: (state) => state,

  /**
   * Optional hook of the room-creation route: only a player who finished the tutorial may OPEN a table (joiners are not asked).
   * The flag is `user_game_stats.extra ->> 'tutorial'`, written by POST /api/games/tiffin-centre/tutorial/complete.
   */
  async canHost({ env, user }) {
    if (!user || !user.id) return { ok: false, error: CAN_HOST_ERROR };
    const rows = await query(
      env,
      "SELECT 1 AS ok FROM user_game_stats WHERE user_id = $1::uuid AND game_id = $2::text AND extra ->> 'tutorial' = 'true' LIMIT 1",
      [user.id, ID],
    );
    return rows.length ? { ok: true } : { ok: false, error: CAN_HOST_ERROR };
  },
};

export default adapter;
