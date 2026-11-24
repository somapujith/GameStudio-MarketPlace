// Server adapter for Tiffin Centre (docs/TIFFIN_CENTRE_PLAN.md sections 3, 4 and 7): a real-time, co-op tiffin stall for 2-4 friends.
// The rules live in shared/tiffin-centre (pure engine); this file is the only place the Worker learns them. The game has no turns:
// the room server ticks the stall once per TICK_MS through `deadlines`, and every player acts at any time.
import * as engine from '../../shared/tiffin-centre/index.js';
import { GAME_ID, TICK_MS, SETTINGS_SPEC, DEFAULT_SETTINGS, PACE, STATIONS, DISHES, levelDef } from '../../shared/tiffin-centre/catalog.js';
import { validTarget } from '../../shared/tiffin-centre/movement.js';
import { query } from '../db.js';

export const ID = GAME_ID;
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

/**
 * Clean an action received from a client: only `cook take serve collect discard move emote` pass, every field is strictly
 * typed and everything else is dropped. `tick`, `spawn`, `tutorial-flags` and unknown types are refused (null); the
 * `playerId` is forced to the sender. Whether the action is legal right now is the engine's job.
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
    return [{ key: `tick-${state.tick}`, afterMs: TICK_MS, anchor: 'apply', playerId: null, action: { type: 'tick' } }];
  },

  isOver: (state) => engine.isOver(state),

  /**
   * Co-op result: the whole team shares rank 1 when the shift earned at least a star (rank = team size otherwise); `winnerId` is the
   * top earner on success, null on failure; `score` = the money that player collected, `stats` = served / collected / earned / tips.
   * `rounds` = ticks played.
   */
  result(state) {
    const res = engine.result(state);
    return {
      winnerId: res.winnerId ?? null,
      reason: res.reason,
      rounds: Number.isFinite(state.tick) ? state.tick : 0,
      stars: res.stars,
      money: res.money,
      level: res.level,
      standings: res.standings.map((row) => ({
        id: row.id,
        rank: row.rank,
        score: Math.max(0, Math.round(row.score) || 0),
        stats: { ...row.stats, finished: true },
      })),
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
