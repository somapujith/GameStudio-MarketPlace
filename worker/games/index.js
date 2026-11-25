// Registry of server game adapters (docs/MARKETPLACE.md section 5).
//
// An adapter is the only place that knows the rules of a game: GameRoom, the persistence code and
// the HTTP routes talk to games exclusively through it. To add a game, write worker/games/<id>.js
// (default export = adapter) and add it to GAME_ADAPTERS below; the id must equal the frontend
// manifest id (src/games/<id>/manifest.js).
//
// Adapter interface (see hyderabad-tycoon.js for a complete implementation):
//
//   required:  id, name, minPlayers, maxPlayers, defaultSettings,
//              validateSettings(raw) -> { ok:true, settings } | { ok:false, error }   (strict, untrusted input)
//              createGame({ players:[{id,name,avatar,piece?}], settings, seed }) -> state
//                                  (`piece` is only passed when the adapter has `pieces`; keep it if it is free)
//              applyAction(state, action) -> { state, events, error? }                (pure; invalid -> same state + error)
//              turnPlayerId(state) -> playerId | null          (who the idle timer waits for)
//              deadlines(state) -> [{ key, afterMs, playerId, action }]   (game timers besides the turn timer;
//                                  `key` identifies one timer instance, it runs afterMs after it first appears)
//              idleAction(state, playerId) -> action | null    (auto-play for an AFK / disconnected player)
//              isOver(state) -> boolean
//              result(state, meta) -> { winnerId, reason, rounds?, standings:[{ id, rank, score, stats? }], legacy? }
//              redact(state, viewerId) -> state                (hide secrets; return `state` itself when nothing is hidden)
//
//   optional (all have a harmless default):
//              defaultMaxPlayers            seats of a new room (default min(4, maxPlayers))
//              turnMs(state)                how long a connected human has per decision, in ms (default: GameRoom's
//                                           TURN_MS, 60 s). Tycoon returns the host rule `turnSeconds` of the running game.
//              pendingPlayerIds(state)      every player the game waits for (default [turnPlayerId])
//              sanitizeAction(raw, playerId)  allow-list for client actions (default: any {type} object, playerId forced)
//              mergeSettings(current, patch)  what a host's patch makes of the current settings before validateSettings
//                                           (default: { ...current, ...patch })
//              lobbySettings(settings)      settings as the lobby shows them (default: the settings)
//              summarize(settings)          one-line summary for open-table cards
//              customRules(settings)        how many host rules differ from the game's stock rules (open tables carry it as
//                                           `customRules`, default 0)
//              animationMs(events)          client animation time of an action (the next move waits for it)
//              startAnimMs                  client animation time when the game starts
//              resignAction(state, playerId)  what leaving a running game does (default: nothing)
//              track(meta, events, state)   fold events into an opaque per-match `meta` kept in the room record
//              emotes                       whitelist for `{t:'chat', emote}` (default: none)
//              pieces                       string[] of piece ids a player can pick in the lobby (`{t:'piece', piece}`).
//                                           The room auto-assigns the first free one on join, refuses unknown or taken
//                                           ones, shows it as room.players[i].piece and passes it to createGame as
//                                           players[i].piece. Without it, pieces are off (`piece` is null, `{t:'piece'}` errors).
//
//              canHost({ env, user })       async gate on OPENING a table (POST /api/rooms, after the settings are validated; joiners are
//                                           not asked): -> { ok:true } | { ok:false, error }. A refusal is a 403 with `error`.
//                                           `user` is the signed-in users row, `env` the Worker env (so it may query the database).
//                                           Tiffin Centre requires the finished tutorial (user_game_stats.extra ->> 'tutorial').
//
//              persistEveryMs(state)        for real-time games that change the room record on every tick / action: a positive
//                                           number of ms = GameRoom writes the record to storage at most once per that interval while
//                                           the game is running (the in-memory room stays authoritative; start, game over and every
//                                           lobby / join / leave / settings change still write at once, and the next step or alarm
//                                           flushes a pending one). After a restart `seq` is bumped by RESTORE_SEQ_MARGIN so clients
//                                           accept the restored state, and up to one interval of play may be replayed. Absent (or
//                                           returning a non-positive number) = write on every step, as Nawabi Raj does.
//              dailyRewardedMatches         positive integer: at most this many matches of this game per account and IST day pay XP and
//                                           coins (match.js; later ones are still recorded and rated). Absent = no limit.
//
//   `result().standings[i].stats.idle === true` (opt-in, any game) marks a seat that earned nothing from the match: match.js pays it
//   0 XP, 0 coins, no win and no rating change. Tiffin Centre sets it on seats that did no work and on every seat of a stall that
//   served no paying customer.
//
//   `result().legacy` is only for Nawabi Raj: when present, the old users.games / wins /
//   best_worth / rent_earned columns and the matches goal / max_rounds / dice_mode columns are
//   kept up to date for the previous version of the app.
import hyderabadTycoon from './hyderabad-tycoon.js';
import tiffinCentre from './tiffin-centre.js';

/** The game of rooms created before the marketplace existed (and of requests without `gameId`). */
export const DEFAULT_GAME_ID = hyderabadTycoon.id;

// A plain object on purpose: tests register extra adapters here (and remove them again).
export const GAME_ADAPTERS = {
  [hyderabadTycoon.id]: hyderabadTycoon,
  [tiffinCentre.id]: tiffinCentre,
};

/** The adapter for a game id, or null for anything unknown (including non-strings). */
export function getAdapter(id) {
  return typeof id === 'string' && Object.hasOwn(GAME_ADAPTERS, id) ? GAME_ADAPTERS[id] : null;
}

/** Public description of every registered game (no functions): `GET /api/games` adds `openTables`. */
export function listGames() {
  return Object.values(GAME_ADAPTERS).map((a) => ({
    id: a.id,
    name: a.name,
    minPlayers: a.minPlayers,
    maxPlayers: a.maxPlayers,
  }));
}

export const REQUIRED_METHODS = [
  'validateSettings',
  'createGame',
  'applyAction',
  'turnPlayerId',
  'deadlines',
  'idleAction',
  'isOver',
  'result',
  'redact',
];

/** Names of everything an adapter is missing from the required interface ([] = conformant). */
export function missingFromAdapter(adapter) {
  const missing = [];
  if (!adapter || typeof adapter !== 'object') return ['adapter'];
  if (typeof adapter.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(adapter.id)) missing.push('id');
  if (typeof adapter.name !== 'string' || !adapter.name) missing.push('name');
  if (!Number.isInteger(adapter.minPlayers) || adapter.minPlayers < 1) missing.push('minPlayers');
  if (!Number.isInteger(adapter.maxPlayers) || adapter.maxPlayers < (adapter.minPlayers || 1)) missing.push('maxPlayers');
  if (!adapter.defaultSettings || typeof adapter.defaultSettings !== 'object') missing.push('defaultSettings');
  for (const m of REQUIRED_METHODS) if (typeof adapter[m] !== 'function') missing.push(m);
  return missing;
}
