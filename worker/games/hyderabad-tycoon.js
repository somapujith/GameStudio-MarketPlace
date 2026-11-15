// Server adapter for Hyderabad Tycoon (Hyderabad Hustle rules; docs/MARKETPLACE.md section 5, docs/GAME_RULES.md).
// Everything the generic GameRoom / persistence code needs to know about this game lives here: it wraps the rules
// engine (shared/index.js) and the Tycoon-only helpers worker/{mask,settings,validate}.js.
import * as engine from '../../shared/index.js';
import { MAX_LEVEL, BOARD_SIZE, PIECES } from '../../shared/board.js';
import { ANIM_MS, LONG_TRIP, MAX_ANIM_MS, TRADE_MS, AUTO_MOVE_MS, BID_MOVE_MS, START_ANIM_MS, cardMs, eventMs } from '../../shared/timing.js';
import { maskStateFor } from '../mask.js';
import { sanitizeSettings, normalizeSettings, ROOM_DEFAULTS, MAX_PLAYERS_MIN, MAX_PLAYERS_MAX } from '../settings.js';
import { sanitizeAction, EMOTES } from '../validate.js';

export const ID = 'hyderabad-tycoon';
export { TRADE_MS }; // an unanswered trade offer is auto-rejected after this (shared/timing.js)
const TRADE_VOID_MS = 900; // an offer to a player who is out of the game is cancelled right away

// ------------------------------------------------------------------ pure helpers (also used by tests)

/** Did this `turn` event start a new round? Needs the state (the first active seat opens every round). */
function roundChange(ev, state) {
  if (!state || !Array.isArray(state.players)) return true; // unknown: assume the longer pause
  const first = state.players.find((p) => !p.bankrupt);
  return !!first && first.id === ev.player;
}

/**
 * Client animation time of an action's events at playback speed 1 (the next automated move and the decision timer
 * wait for it). Mirrors the presenter (src/lib/session/usePresenter.js), both read shared/timing.js ANIM_MS.
 * `state` (the state after the action) is optional: with it, round changes and the final round are told apart.
 */
export function estimateAnimMs(events, state = null) {
  const A = ANIM_MS;
  let ms = 0;
  for (const ev of events || []) {
    switch (ev.type) {
      case 'dice':
        ms += A.dice + A.afterDice;
        break;
      case 'move': {
        const len = Array.isArray(ev.path) ? ev.path.length : 0;
        if (ev.teleport || len === 0) ms += A.teleportPre + A.teleport;
        else ms += A.step * Math.max(0.3, Math.min(1, LONG_TRIP / len)) * len;
        break;
      }
      case 'land':
        ms += A.land;
        break;
      case 'cash':
        if (ev.reason === 'rent') ms += ev.delta < 0 ? A.rentOut : A.rentIn;
        else if (['salary', 'tax', 'event', 'fare', 'traffic', 'liquidate'].includes(ev.reason)) ms += A.cash;
        else ms += A.quiet;
        break;
      case 'own':
        ms += ev.reason === 'buy' || ev.reason === 'auction' ? A.own : A.quiet;
        break;
      case 'level':
        if (ev.reason === 'upgrade') ms += ev.level >= MAX_LEVEL ? A.level * 1.5 : A.level;
        else if (ev.reason === 'sell') ms += A.cash;
        else ms += A.quiet;
        break;
      case 'set_complete':
        ms += A.setComplete;
        break;
      case 'mortgage':
      case 'unmortgage':
        ms += A.mortgage;
        break;
      case 'trade_offer':
      case 'trade_done':
      case 'trade_rejected':
        ms += A.trade;
        break;
      case 'debt':
        ms += A.debt;
        break;
      case 'card':
        ms += cardMs(ev);
        break;
      case 'auction_start':
        ms += A.auctionStart;
        break;
      case 'auction_end':
        ms += A.auctionEnd;
        break;
      case 'city_event':
        ms += eventMs(ev);
        break;
      case 'ride':
        ms += A.ride;
        break;
      case 'chai':
        ms += A.chai;
        break;
      case 'traffic':
        ms += ev.stuck ? A.jail : ev.reason === 'waited' ? A.jailStay : A.quiet;
        break;
      case 'bankrupt':
        ms += A.bankrupt;
        break;
      case 'turn': {
        if (!roundChange(ev, state)) ms += A.turn;
        else {
          const max = Number(state?.cfg?.maxRounds);
          const final = Number.isFinite(max) && max > 0 && ev.round === max;
          ms += final ? A.finalRound : Math.max(A.round, A.turn);
        }
        break;
      }
      case 'win':
        ms += A.win;
        break;
      default:
        break;
    }
  }
  return Math.min(Math.round(ms), MAX_ANIM_MS);
}

/**
 * Ids of the (non-bankrupt) players the game is currently waiting for.
 * - pending trade: the player who must answer it (`trade.to`);
 * - debt phase: the debtor (even when it is not their turn);
 * - auction: everyone who has not bid yet;
 * - otherwise the turn player.
 */
export function pendingActors(state) {
  if (!state || state.phase === 'over') return [];
  if (state.trade) {
    const to = state.players.find((p) => p.id === state.trade.to);
    return to && !to.bankrupt ? [to.id] : [];
  }
  if (state.phase === 'debt' && state.debt) {
    const debtor = state.players.find((p) => p.id === state.debt.player);
    return debtor && !debtor.bankrupt ? [debtor.id] : [];
  }
  if (state.phase === 'auction' && state.pending && state.pending.type === 'auction') {
    return state.players.filter((p) => !p.bankrupt && !(p.id in state.pending.bids)).map((p) => p.id);
  }
  const tp = state.players[state.turn];
  return tp && !tp.bankrupt ? [tp.id] : [];
}

/**
 * The move an automated player (an idle or disconnected human, played on their behalf) should make right now.
 * The engine's chooser never rides a shortcut and never offers a trade for a human seat, and pays a traffic fine
 * only with comfortable cash (otherwise it waits the jam out).
 */
export function autoMove(state, playerId, rnd = Math.random) {
  let action = engine.chooseBotAction(state, playerId, rnd);
  if (action && (action.type === 'RIDE' || action.type === 'TRADE_OFFER')) {
    action = { type: state.extraRoll ? 'ROLL' : 'END_TURN', playerId }; // belt and braces: never for a human seat
  }
  // Safety net for a phase the brain declines to act in: a debtor tries to pay (the engine rejects it if they
  // cannot, and repeated rejections end in RESIGN).
  if (!action && state.phase === 'debt' && state.debt && state.debt.player === playerId) {
    action = { type: 'PAY_DEBT', playerId };
  }
  return action;
}

/** True when a stored game state was made with the current (Hustle, 36-tile) rules. */
export const isCurrentBoard = (state) =>
  Array.isArray(state?.owners) && state.owners.length === BOARD_SIZE && typeof state?.cfg?.mode === 'string';

const topLevels = (p, meta) => {
  const n = Number(meta?.hotels?.[p.id] ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100) : 0;
};

const MODE_SUMMARY = (s) => {
  const m = engine.MODES[s.mode] || engine.MODES.standard;
  return m.rounds ? `${m.label} · ${m.rounds} rounds · richest wins` : `${m.label} · last one standing wins`;
};

// ------------------------------------------------------------------ the adapter

const adapter = {
  id: ID,
  name: 'Hyderabad Tycoon',
  minPlayers: MAX_PLAYERS_MIN,
  maxPlayers: MAX_PLAYERS_MAX,
  defaultMaxPlayers: 4,
  defaultSettings: ROOM_DEFAULTS,
  /** Soundboard keys accepted in `{t:'chat', emote}`. */
  emotes: EMOTES,
  /** Pieces a lobby player may pick (`{t:'piece', piece}`); passed to createGame as `players[i].piece`. */
  pieces: PIECES.map((p) => p.id),
  /** Client animation time after the game starts (the first move waits for it). */
  startAnimMs: START_ANIM_MS,

  /** Strict check of untrusted host settings; unknown keys are dropped, defaults filled in. */
  validateSettings(raw) {
    const { settings, errors } = sanitizeSettings(raw);
    if (errors.length) return { ok: false, error: errors[0] };
    return { ok: true, settings: normalizeSettings(settings) };
  },

  /** Settings as the lobby shows them: exactly what createGame runs with (state.cfg). */
  lobbySettings(settings) {
    return engine.normalizeSettings(normalizeSettings(settings));
  },

  /** One line for open-table cards, e.g. "Standard City Hustle · 20 rounds · richest wins". */
  summarize(settings) {
    return MODE_SUMMARY(normalizeSettings(settings));
  },

  createGame({ players, settings, seed }) {
    return engine.createGame({
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        ...(typeof p.piece === 'string' ? { piece: p.piece } : {}),
      })),
      settings: normalizeSettings(settings), // mode, dice, auctionOnDecline
      seed,
    });
  },

  /** Clean an action received from a client (allow-list; `playerId` is forced). */
  sanitizeAction,

  applyAction: (state, action) => engine.applyAction(state, action),

  /** The player the idle timer waits for (the debtor during the debt phase). */
  turnPlayerId(state) {
    return pendingActors(state)[0] ?? null;
  },

  /**
   * Optional extension: EVERY player the game waits for right now (auction bidders; for a pending
   * trade the recipient and the offerer). GameRoom falls back to [turnPlayerId] without it.
   */
  pendingPlayerIds(state) {
    const ids = pendingActors(state);
    if (state && state.trade && state.phase !== 'over') {
      const from = state.players.find((p) => p.id === state.trade.from);
      if (from && !from.bankrupt && !ids.includes(from.id)) ids.push(from.id);
    }
    return ids;
  },

  /** Timers besides the turn timer: an unanswered trade offer is auto-rejected after 30 s. */
  deadlines(state) {
    const t = state && state.phase !== 'over' ? state.trade : null;
    if (!t) return [];
    const to = state.players.find((p) => p.id === t.to);
    if (!to || to.bankrupt) {
      // The recipient is out of the game: the offerer takes the offer back.
      return [{ key: `trade:${t.id}:void`, afterMs: TRADE_VOID_MS, playerId: t.from, action: { type: 'TRADE_CANCEL', playerId: t.from } }];
    }
    return [{ key: `trade:${t.id}`, afterMs: TRADE_MS, playerId: to.id, action: { type: 'TRADE_REJECT', playerId: to.id } }];
  },

  /** Auto-play for an AFK / disconnected player. Ignoring a trade offer means rejecting it. */
  idleAction(state, playerId) {
    const t = state && state.trade;
    if (t) {
      if (t.to === playerId) return { type: 'TRADE_REJECT', playerId };
      if (t.from === playerId) return { type: 'TRADE_CANCEL', playerId };
      return null;
    }
    return autoMove(state, playerId);
  },

  /** What leaving a running game does to the leaver. */
  resignAction(state, playerId) {
    const p = state && state.players.find((x) => x.id === playerId);
    return p && !p.bankrupt ? { type: 'RESIGN', playerId } : null;
  },

  isOver: (state) => !!state && state.phase === 'over',

  /** `animationMs(events, state?)`: pass the state after the action so round changes are timed exactly. */
  animationMs: estimateAnimMs,

  /** Pause before an automated move (bids are quicker). */
  moveDelayMs: (action) => (action && action.type === 'BID' ? BID_MOVE_MS : AUTO_MOVE_MS),

  /** Rooms stored by the previous versions kept hotels / the trade clock in their own fields. */
  upgradeRecord(r) {
    if (r.hotels && !(r.meta && r.meta.hotels)) r.meta = { ...r.meta, hotels: r.hotels };
    if (r.tradeId != null && !(r.deadlines && Object.keys(r.deadlines).length)) {
      r.deadlines = { ...r.deadlines, [`trade:${r.tradeId}`]: r.tradeAt || Date.now() };
    }
    delete r.hotels;
    delete r.tradeId;
    delete r.tradeAt;
    // A game stored with the old rules (28 or 40 squares, jail, snatch) cannot be resumed on the Hustle board:
    // drop it and call the room off, unrecorded. Snatch timers of such a room are dropped too.
    if (r.deadlines) for (const k of Object.keys(r.deadlines)) if (k.startsWith('snatch:')) delete r.deadlines[k];
    if (r.state && !isCurrentBoard(r.state)) {
      r.state = null;
      if (r.status !== 'lobby') {
        r.status = 'finished';
        r.abandoned = true;
        r.endedAt ||= Date.now();
      }
    }
    // Lobby settings from the old rules (goal, maxRounds, snatches ...) are replaced by the Hustle defaults.
    if (r.settings && typeof r.settings === 'object' && !('mode' in r.settings)) r.settings = normalizeSettings(r.settings);
  },

  /** Fold the events of an applied action into the per-match `meta` (districts raised to the top level, per player). */
  track(meta, events, state) {
    let hotels = null;
    for (const ev of events || []) {
      if (ev.type === 'level' && ev.reason === 'upgrade' && ev.level >= MAX_LEVEL) {
        const owner = state.owners[ev.tile];
        if (owner) {
          hotels ||= { ...(meta && meta.hotels) };
          hotels[owner] = (hotels[owner] || 0) + 1;
        }
      }
    }
    return hotels ? { ...meta, hotels } : meta;
  },

  /**
   * Final standings by net worth (rank 1 = the winner). `score` is the final net worth; `stats.rentEarned` is the rent
   * collected and `stats.hotelsBuilt` counts districts raised to the top level. `legacy` feeds the old users.* columns
   * (best_worth = final net worth, rent_earned) and the matches max_rounds / dice_mode columns.
   */
  result(state, meta) {
    const table = engine.standings(state);
    const byId = new Map(state.players.map((p) => [p.id, p]));
    const rawMax = state.cfg && state.cfg.maxRounds;
    const maxRounds = Number.isFinite(rawMax) ? rawMax : null; // null = no limit (classic)
    const rounds = Math.min(state.round, maxRounds ?? engine.ROUND_CAP);
    return {
      winnerId: state.winner || null,
      reason: state.winReason || null,
      rounds,
      standings: table.map((row) => {
        const p = byId.get(row.id) || {};
        return {
          id: row.id,
          rank: row.rank,
          score: Math.round(row.worth),
          stats: { rentEarned: Math.round(p.stats?.rentEarned || 0), hotelsBuilt: topLevels(p, meta) },
        };
      }),
      legacy: {
        goal: null,
        maxRounds,
        diceMode: state.cfg?.dice === 'fair' ? 'fair' : 'lucky',
        mode: state.cfg?.mode || 'standard',
      },
    };
  },

  /** Sealed auctions: other players' bid amounts are hidden (the keys stay, so "has bid" is visible). */
  redact: (state, viewerId) => maskStateFor(state, viewerId),
};

export default adapter;
