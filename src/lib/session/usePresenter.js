// The presenter: replays engine events with timing (dice roll, pawn steps, cash changes, card reveal, auction
// result...) on top of a `display` copy of the game state, fires sound effects, builds the centre-stage bubble,
// the log and the board effects, then snaps `display` to the authoritative state. Used by the online session.
//
//   usePresenter({ meId, initialState, speed = 1 }) ->
//     { display, busy, rolling, bubble, stageTile, lastCash, card, handoff, flights, log,
//       enqueue(events, newState), reset(state), isBusy() }
//
//   card     null | { player, deck, title, text, kind, cardId }   while a card event plays
//   handoff  null | { player, round, isFinal }                     while a turn event plays (isFinal: last round)
//   auctionResult  null | { ...auction_end, id, ms }              while an auction_end plays (the bidding screen's reveal; ms = how long it is held)
//   power    null | { id, kind, player, ms, ... }                  while a power-card event plays (docs/POWER_CARDS.md 3.3):
//              kind 'draw'    { source, tile?, card? }             card = { uid, id, exp } only for MY draw (found by diffing my hand
//                                                                  between two authoritative states: the event never names the card)
//              kind 'play'    { card, target? }                    the card id, now public
//              kind 'shield' | 'double'  { card, amount, other? }  an armed card did its job
//              kind 'expire'  { count }
//   flights  [{ id, from, to, amount, reason, ms }]                money in the air; from / to = player id | 'bank'.
//            Pushed on cash transfers (rent pair -> player->player, gains -> bank->player, payments ->
//            player->bank) and dropped again once their animation is over (`ms`). FxLayer flies them.
//   display  also carries `landing` (the tile just landed on, until the next move / turn: the phone camera)
//            and per player `piece stuck chai motion` (motion: null | 'ride' | 'teleport' during a move). With the power-cards
//            rule on, each player also has `hand` (as the masked state gives it), `shield` and `doubleRent` (armed-until rounds),
//            kept in step with the power beats; a game without the rule has none of the three keys.
//
// `speed` is the playback RATE (settings.playbackSpeed, 0.75..2): 2 plays twice as fast. On top of it playback
// trims itself for background activity (nothing the local player needs to see), when the queue backs up, and
// under reduced motion. Every base delay comes from ANIM_MS in @shared/timing.js: the server waits by the same
// table, so nothing here may wait for anything that is not one of its keys.
//
// The playback logic lives in `createPresenterCore` (plain JS, no React) so it can be tested with fake
// timers. The hook only subscribes React to the core's snapshots.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ANIM_MS, LONG_TRIP, cardMs, eventMs } from '@shared/timing.js';
import { BOARD_SIZE, MAX_LEVEL, TILES } from '@shared/board.js';
import { POWER } from '@shared/powerCards.js';
import * as SFX from '../sfx.js';
import { buzz } from '../haptics.js';
import { DICE_BOUNCES } from '../soundscape/recipes.js';
import { CARD_CLIPS, playCardClip } from '../cardClips.js';
import { describeEvent } from '../messages.js';
import { loadSettings } from '../storage.js';

const LOG_CAP = 200;
const BANK = 'bank';
const TRAFFIC_TILE = (TILES.find((t) => t && t.type === 'traffic') || { id: 9 }).id;

/**
 * Pacing trims for "background" playback: other players acting while the local player has nothing to decide.
 * A multiplier on the base delay (events missing here keep full length).
 */
const QUICK = {
  dice: 0.85,
  afterDice: 0.6,
  step: 0.8,
  teleportPre: 0.7,
  teleport: 0.7,
  land: 0.7,
  rentOut: 0.85,
  rentIn: 0.75,
  cash: 0.75,
  own: 0.7,
  level: 0.7,
  jail: 0.8,
  jailStay: 0.8,
  card: 0.8,
  round: 0.8,
  finalRound: 0.8,
  mortgage: 0.8,
  quiet: 0.7,
  ride: 0.75,
  chai: 0.75,
  turn: 0.8,
};

/** Events the human should always get to see at full pacing, whoever caused them. */
const NEEDS_ATTENTION = new Set([
  'win', 'bankrupt', 'debt', 'set_complete',
  'auction_start', 'auction_end',
  'trade_offer', 'trade_countered', 'trade_done', 'trade_rejected', 'city_event',
  'snatch_open', 'snatch_end', 'token_earned',
  'power_draw', 'power_play', 'power_trigger', 'power_expire', // the power-card moments always play at full pace
]);

/** Fallbacks for the power waits until shared/timing.js carries the keys (a test fails loudly if they go missing once it does). */
export const POWER_MS_FALLBACK = Object.freeze({ powerDraw: 900, powerPlay: 1500, powerTrigger: 1400, powerExpire: 700 });

/** The cards I can see in my own hand of a state (other hands are redacted to { hidden: true }). */
function myHandOf(state, me) {
  const p = state && Array.isArray(state.players) ? state.players.find((x) => x && x.id === me) : null;
  return p && Array.isArray(p.hand) ? p.hand.filter((c) => c && !c.hidden && typeof c.uid === 'string') : [];
}

let uid = 0;
const nextId = () => {
  uid += 1;
  return uid;
};

const devWarn = (...args) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) console.warn('[presenter]', ...args);
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------------------------------------
// State -> display
// ---------------------------------------------------------------------------------------------

const EMPTY_OWNERS = Object.freeze(Array(BOARD_SIZE).fill(null));
const EMPTY_LEVELS = Object.freeze(Array(BOARD_SIZE).fill(0));
const EMPTY_MORTGAGED = Object.freeze(Array(BOARD_SIZE).fill(false));

const copyEvent = (e) => (e ? { ...e, ...(Array.isArray(e.groups) ? { groups: [...e.groups] } : null) } : null);

/**
 * The animated view of an engine state. `cfg` mirrors `state.cfg` (maxRounds is number|null);
 * `mortgaged`, `debt`, `trade` and `event` mirror the state; `assist` is the last dice roll's assist (or null).
 */
export function displayFromState(state) {
  if (!state || !Array.isArray(state.players)) {
    return {
      players: [], owners: [...EMPTY_OWNERS], levels: [...EMPTY_LEVELS], mortgaged: [...EMPTY_MORTGAGED], turn: 0, round: 1, dice: [0],
      phase: 'roll', cfg: {}, winner: null, lastCash: null, assist: null, assistPlayer: null, debt: null, trade: null, event: null,
      ride: null, landing: null, moving: null,
    };
  }
  return {
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      piece: p.piece ?? null,
      cash: p.cash,
      pos: p.pos,
      stuck: !!p.stuck,
      chai: Number(p.chai) || 0,
      bankrupt: !!p.bankrupt,
      laps: p.laps ?? 0,
      ...(Number.isFinite(p.snatches) ? { snatches: p.snatches } : null), // Snatch buttons (public); absent in a game without the rule
      // Power cards (only when the state has them, so a game without the rule is unchanged): the hand exactly as the masked state
      // gives it (rivals' cards are { hidden: true }), the armed Shield / Double Rent rounds. The beats below keep them in step.
      ...(Array.isArray(p.hand) ? { hand: p.hand.map((c) => ({ ...c })) } : null),
      ...(Number.isFinite(p.shield) ? { shield: p.shield } : null),
      ...(Number.isFinite(p.doubleRent) ? { doubleRent: p.doubleRent } : null),
      motion: null,
    })),
    owners: Array.isArray(state.owners) ? state.owners.slice() : [...EMPTY_OWNERS],
    levels: Array.isArray(state.levels) ? state.levels.slice() : [...EMPTY_LEVELS],
    mortgaged: Array.isArray(state.mortgaged) ? state.mortgaged.map(Boolean) : [...EMPTY_MORTGAGED],
    turn: state.turn || 0,
    round: state.round || 1,
    dice: Array.isArray(state.dice) ? [...state.dice] : [0],
    phase: state.phase || 'roll',
    cfg: state.cfg ? { ...state.cfg } : {},
    winner: state.winner ?? null,
    winReason: state.winReason ?? null,
    lastCash: null,
    assist: null,
    assistPlayer: null,
    debt: state.debt ? { ...state.debt } : null,
    trade: state.trade ? { ...state.trade } : null,
    event: copyEvent(state.event), // the city event of this round (public)
    ride: state.ride ? { ...state.ride } : null, // open transport offer for the turn player
    landing: null,
    moving: null,
  };
}

/** Centre-stage tile for a freshly loaded state: where the player to move is standing. */
function stageFor(state) {
  const p = state && Array.isArray(state.players) ? state.players[state.turn] : null;
  return p && Number.isInteger(p.pos) ? p.pos : 0;
}

function makeSnapshot(state) {
  return {
    display: displayFromState(state),
    busy: false,
    rolling: false,
    bubble: null,
    stageTile: stageFor(state),
    lastCash: null,
    card: null,
    handoff: null,
    auctionResult: null,
    power: null,
    flights: [],
    log: [],
  };
}

const setAt = (arr, i, v) => {
  const next = arr.slice();
  next[i] = v;
  return next;
};

// ---------------------------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------------------------

/** Playback rate: 0.75 (relaxed) .. 2 (fast); anything else -> 1. */
export const clampSpeed = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(2, Math.max(0.75, n)) : 1;
};

export function createPresenterCore({ meId, initialState, speed: speedOpt = 1, deps } = {}) {
  const D = { sfx: SFX.sfx, sfxNames: SFX.SFX_NAMES, buzz, playCardClip, describeEvent, loadSettings, ...(deps || {}) };

  let me = meId;
  let S = makeSnapshot(initialState);
  const listeners = new Set();

  let epoch = 0; // bumped by reset()/dispose(): in-flight playback notices and stops
  let pending = 0; // enqueue() calls not finished yet (the playing one included)
  let chain = Promise.resolve();
  let disposed = false;
  let reducedNow = false;
  let rate = clampSpeed(speedOpt);
  let quickNow = false; // the item being played is background activity (see QUICK)
  let knownHand = new Set(myHandOf(initialState, meId).map((c) => c.uid)); // my hand's uids in the last authoritative state seen (the power-draw diff)
  let swapQuiet = 0; // the two teleport moves of a Swap Tiles are told by the power_play line: they stay out of the log and silent
  let lastLeg = null; // the last money flight of this item (so the other leg of a rent pair does not fly twice)
  const timers = new Set();
  const flightTimers = new Set();

  // ---- store plumbing ----
  function commit(patch) {
    S = { ...S, ...patch };
    listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* ignore */
      }
    });
  }
  const patchDisplay = (fn) => commit({ display: fn(S.display) });
  const patchPlayer = (id, fn) =>
    patchDisplay((d) => ({ ...d, players: d.players.map((p) => (p.id === id ? { ...p, ...fn(p) } : p)) }));
  const setPos = (id, pos) => patchPlayer(id, () => ({ pos }));
  /** Change a player's displayed hand (only in a game that has power cards: a display player without `hand` is left alone). */
  const patchHand = (id, fn) => patchPlayer(id, (p) => (Array.isArray(p.hand) ? { hand: fn(p.hand) } : null));
  const hasHand = (id) => { const p = S.display.players.find((x) => x.id === id); return !!p && Array.isArray(p.hand); };
  const playerById = (id) => S.display.players.find((p) => p.id === id);

  // ---- timing ----
  function sleep(ms) {
    return new Promise((resolve) => {
      if (!(ms > 0)) {
        resolve();
        return;
      }
      const t = { resolve, id: null };
      t.id = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });
  }
  function flushTimers() {
    for (const t of timers) {
      clearTimeout(t.id);
      t.resolve();
    }
    timers.clear();
    for (const id of flightTimers) clearTimeout(id);
    flightTimers.clear();
  }
  function reducedMotion() {
    try {
      if (D.loadSettings().reducedMotion) return true;
    } catch {
      /* ignore */
    }
    try {
      return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }
  const waiting = () => Math.max(0, pending - 1);
  /** True when more than 3 enqueues are queued behind the one playing: hurry up and stay quiet. */
  const backedUp = () => waiting() > 5;
  /** Overall delay multiplier: 1 / playback rate, then the catch-up and reduced-motion limits. */
  function factor() {
    const w = waiting();
    let f = 1 / rate;
    if (w > 10) f = Math.min(f, 0.05);
    else if (w > 5) f = Math.min(f, 0.4);
    if (reducedNow) f = Math.min(f, 0.35);
    return f;
  }
  /** Base delay for an ANIM_MS key, trimmed when the item being played is background activity. */
  const dl = (name) => (ANIM_MS[name] || 0) * (quickNow ? QUICK[name] ?? 1 : 1);
  /** Like dl, with a fallback for a key the shared table may not carry yet (the Snatch pauses). */
  const dlOr = (name, fallback) => (ANIM_MS[name] ?? fallback) * (quickNow ? QUICK[name] ?? 1 : 1);
  /** An item is "quick" when it does not involve the local player and nothing in it needs their eyes. */
  function computeQuick(events) {
    for (const ev of events) {
      if (!ev) continue;
      if (NEEDS_ATTENTION.has(ev.type)) return false;
      if (ev.player === me || ev.other === me || ev.owner === me || ev.winner === me || ev.from === me || ev.to === me || ev.buyer === me) return false;
    }
    return true;
  }

  // ---- sound ----
  // `opts` shape the sound (cash amount, dice faces, pawn step, deck...): see lib/soundscape/recipes.js
  const fx = (name, fallback, opts) => {
    if (disposed || backedUp()) return;
    let n = name;
    if (fallback && Array.isArray(D.sfxNames) && !D.sfxNames.includes(name)) n = fallback;
    try {
      D.sfx.play(n, opts);
    } catch {
      /* ignore */
    }
  };
  /** A short vibration for the local player's own moments (callers check it is them); never while catching up. */
  const hp = (kind) => {
    if (disposed || backedUp()) return;
    try {
      D.buzz(kind);
    } catch {
      /* ignore */
    }
  };

  /** A power moment: commit it (unless catching up), wait the ANIM_MS key for it, clear it. Resolves false when cancelled. */
  async function powerMoment(key, moment, wait) {
    const base = dlOr(key, POWER_MS_FALLBACK[key]);
    if (!backedUp()) commit({ power: { id: `pw${nextId()}`, ...moment, ms: Math.round(base * factor()) } });
    const ok = await wait(base);
    if (ok) commit({ power: null });
    return ok;
  }

  // ---- money flights ----
  function pushFlight(from, to, amount, reason) {
    if (disposed || backedUp() || !(amount > 0) || from === to) return;
    const ms = Math.round(Math.max(240, (ANIM_MS.rentOut + ANIM_MS.rentIn) * factor()));
    const flight = { id: `fl${nextId()}`, from, to, amount, reason: reason || null, ms, tile: Number.isInteger(S.stageTile) ? S.stageTile : null }; // `tile`: the square being played (rent toll sweep)
    commit({ flights: [...S.flights, flight] });
    const myEpoch = epoch;
    const t = setTimeout(() => {
      flightTimers.delete(t);
      if (epoch !== myEpoch) return;
      if (S.flights.some((f) => f.id === flight.id)) commit({ flights: S.flights.filter((f) => f.id !== flight.id) });
    }, ms + 300);
    flightTimers.add(t);
  }
  /** One cash event -> one flight; the second leg of a player-to-player transfer is skipped. */
  function flightFor(ev, delta) {
    const amount = Math.abs(delta);
    if (!amount) return;
    const other = ev.other !== undefined && ev.other !== null && ev.other !== BANK ? ev.other : null;
    const from = delta < 0 ? ev.player : other ?? BANK;
    const to = delta < 0 ? other ?? BANK : ev.player;
    if (other !== null && lastLeg && lastLeg.from === from && lastLeg.to === to && lastLeg.amount === amount) {
      lastLeg = null; // the other leg of the pair already flew
      return;
    }
    lastLeg = { from, to, amount };
    pushFlight(from, to, amount, ev.reason);
  }

  // ---- bubble and log ----
  const playerOf = (ev) => {
    if (ev.player !== undefined && ev.player !== null) return ev.player;
    if (ev.owner !== undefined && ev.owner !== null) return ev.owner;
    if (ev.winner !== undefined && ev.winner !== null) return ev.winner;
    if (ev.from !== undefined && ev.from !== null && typeof ev.from !== 'number') return ev.from; // trades
    if (ev.tile !== undefined) return S.display.owners[ev.tile] ?? undefined;
    return undefined;
  };

  /** Describe an event, append it to the log and show it in the bubble. Returns the description. */
  function announce(ev, { log = true, bubble = true } = {}) {
    const dsp = S.display;
    let d = null;
    try {
      d = D.describeEvent(ev, {
        players: dsp.players,
        me,
        owners: dsp.owners,
        round: dsp.round,
        maxRounds: dsp.cfg ? dsp.cfg.maxRounds ?? null : null,
        targetWorth: dsp.cfg ? dsp.cfg.targetWorth ?? null : null,
        tile: S.stageTile, // the square being played (a tax payment follows its 'land' event)
        lastCash: S.lastCash, // the cash event just before (a Traffic Jam fine's amount)
      });
    } catch (err) {
      devWarn('describe failed', ev, err);
    }
    if (!d) return null;
    const patch = {};
    if (log) {
      const entry = { id: nextId(), text: d.text, tone: d.tone, icon: d.icon, player: playerOf(ev), tile: d.tile !== undefined ? d.tile : ev.tile, at: Date.now(), ev }; // `ev` + `at`: the activity feed and the tile effects classify by them
      const added = [entry];
      if (d.extra && d.extra.text) {
        added.push({ id: nextId(), text: d.extra.text, tone: d.extra.tone || 'info', icon: d.extra.icon, player: entry.player, tile: entry.tile });
      }
      const all = [...S.log, ...added];
      patch.log = all.length > LOG_CAP ? all.slice(all.length - LOG_CAP) : all;
    }
    if (bubble) {
      patch.bubble = {
        id: nextId(),
        text: d.bubble || d.text,
        tone: d.tone,
        tile: d.tile !== undefined ? d.tile : ev.tile,
        icon: d.icon,
        type: ev.type,
        ...(ev.reason ? { reason: ev.reason } : null),
        ...(ev.type === 'card' ? { card: { title: ev.title, text: ev.text, kind: ev.kind, deck: ev.deck, cardId: ev.cardId } } : null),
      };
    }
    commit(patch);
    return d;
  }

  // ---- event playback ----
  /** Plays one event. Resolves to false when playback was cancelled (reset/unmount). */
  async function playEvent(ev, wait, item = { drawn: [], keep: null }) {
    const dsp = S.display;
    const byMe = ev.player === me;

    switch (ev.type) {
      case 'dice': {
        // `diceMs` = how long this tumble lasts (the Dice paces its throw and bounces by it); set before `rolling` flips
        const tumbleMs = Math.round(dl('dice') * factor());
        patchDisplay((d) => ({ ...d, diceMs: tumbleMs, ...(d.landing === null ? null : { landing: null }) }));
        commit({ rolling: true });
        // the rattle and the table knocks follow the die's bounces (DICE_BOUNCES = diceMotion.BOUNCE_AT) over the same `tumbleMs`
        fx('dice', undefined, { ms: tumbleMs, vol: byMe ? 1 : 0.8 });
        if (byMe) {
          hp('roll');
          const myEpoch = epoch;
          for (const b of DICE_BOUNCES) {
            const id = setTimeout(() => {
              flightTimers.delete(id);
              if (epoch === myEpoch) hp('bounce');
            }, Math.round(b * tumbleMs));
            flightTimers.add(id);
          }
        }
        if (!(await wait(dl('dice')))) return false;
        const values = ev.values || [1];
        const assist = ev.assist || null;
        // Keep the landing transition inside the presenter pause, including fast/catch-up play.
        const diceSettleMs = reducedNow ? 0 : Math.max(0, Math.min(560, dl('afterDice') * factor() - 32));
        patchDisplay((d) => ({ ...d, dice: [...values], diceSettleMs, assist, assistPlayer: assist ? ev.player : null }));
        commit({ rolling: false });
        announce(ev);
        fx('diceLand', undefined, { values, vol: byMe ? 1 : 0.8 }); // the knock on the table, pitched by the faces
        if (byMe) hp(values.some((x) => x === 6) ? 'six' : 'land');
        if (assist && byMe) fx('lucky');
        return wait(dl('afterDice'));
      }

      case 'move': {
        const path = Array.isArray(ev.path) ? ev.path : [];
        const motion = ev.teleport ? 'teleport' : ev.ride ? 'ride' : null;
        patchDisplay((d) => ({ ...d, landing: null, moving: ev.player }));
        if (ev.teleport || path.length === 0) {
          // one arc over the board: the pawn flies for teleportPre + teleport (`stepMs` = its flight time)
          const quietSwap = !!ev.teleport && swapQuiet > 0;
          if (quietSwap) swapQuiet -= 1;
          else fx(ev.teleport ? 'card' : 'step');
          patchDisplay((d) => ({
            ...d,
            stepMs: Math.round((dl('teleportPre') + dl('teleport')) * factor()),
            players: d.players.map((p) => (p.id === ev.player ? { ...p, pos: ev.to, motion } : p)),
          }));
          if (ev.teleport && !quietSwap) announce(ev);
          if (!(await wait(dl('teleportPre')))) return false;
          const ok = await wait(dl('teleport'));
          if (ok) {
            patchPlayer(ev.player, () => ({ motion: null }));
            patchDisplay((d) => ({ ...d, moving: null }));
          }
          return ok;
        }
        // Long trips (a card can send you across the board) hop faster; a ride skims along faster still.
        const walkScale = Math.max(0.3, Math.min(1, LONG_TRIP / path.length));
        const stepScale = motion === 'ride' ? Math.max(0.3, walkScale * 0.55) : walkScale;
        let hop = 0;
        for (const tile of path) {
          patchDisplay((d) => ({
            ...d,
            stepMs: Math.round(dl('step') * stepScale * factor()),
            players: d.players.map((p) => (p.id === ev.player ? { ...p, pos: tile, motion } : p)),
          }));
          fx('step', undefined, { i: hop, n: path.length, vol: byMe ? 1 : 0.7 }); // the pitch climbs along the move
          hop += 1;
          if (!(await wait(dl('step') * stepScale))) return false;
        }
        const p = playerById(ev.player);
        if (p && p.pos !== ev.to && Number.isInteger(ev.to)) setPos(ev.player, ev.to);
        patchPlayer(ev.player, () => ({ motion: null }));
        patchDisplay((d) => ({ ...d, moving: null }));
        return true;
      }

      case 'land': {
        commit({ stageTile: ev.tile });
        patchDisplay((d) => ({ ...d, landing: Number.isInteger(ev.tile) ? ev.tile : null }));
        announce(ev);
        fx('land', undefined, { vol: byMe ? 1 : 0.6 }); // the pawn settles: a soft thud
        return wait(dl('land'));
      }

      case 'cash': {
        const delta = Number(ev.delta) || 0;
        const lastCash = { id: nextId(), player: ev.player, delta, reason: ev.reason };
        patchDisplay((d) => ({
          ...d,
          players: d.players.map((p) => (p.id === ev.player ? { ...p, cash: p.cash + delta } : p)),
          lastCash,
        }));
        commit({ lastCash });
        flightFor(ev, delta);
        const d = announce(ev);
        let sound = null;
        switch (ev.reason) {
          case 'salary':
          case 'liquidate':
          case 'event':
          case 'sell':
          case 'mortgage':
            sound = 'coin';
            break;
          case 'rent':
          case 'card':
          case 'trade':
            sound = delta >= 0 ? 'coin' : ev.reason === 'rent' ? 'rent' : 'pay';
            break;
          case 'tax':
          case 'fare':
          case 'traffic':
          case 'unmortgage':
            sound = 'pay';
            break;
          default:
            break; // buy / upgrade / auction: own, level and auction_end make the sound
        }
        if (sound) {
          // the sum shapes the sound (one tick for a small amount, a cascade for a big one); other players' money is quieter
          fx(sound, undefined, { amount: Math.abs(delta), vol: byMe ? 1 : 0.7 });
          if (byMe) hp(delta >= 0 ? 'earn' : 'pay');
        }

        if (ev.reason === 'rent') return wait(delta < 0 ? dl('rentOut') : dl('rentIn'));
        return wait(d ? dl('cash') : dl('quiet'));
      }

      case 'own': {
        announce(ev); // before the change, so liquidations can name the previous owner
        patchDisplay((d) => ({
          ...d,
          owners: setAt(d.owners, ev.tile, ev.owner ?? null),
          // a tile that goes back to the bank comes back unmortgaged and without upgrades (bankruptcy: the bank takes everything)
          mortgaged: ev.owner === null || ev.owner === undefined ? setAt(d.mortgaged, ev.tile, false) : d.mortgaged,
          levels: ev.owner === null || ev.owner === undefined ? setAt(d.levels, ev.tile, 0) : d.levels,
        }));
        if (ev.reason === 'buy' || ev.reason === 'auction') {
          fx('buy', undefined, { vol: ev.owner === me ? 1 : 0.75 });
          if (ev.owner === me) hp('buy');
          return wait(dl('own'));
        }
        if (ev.reason === 'snatch') {
          // snatch_end made the sound and flashed the district; let the new owner's bar settle, then drop the flash
          const ok = await wait(dl('own'));
          if (ok) patchDisplay((d) => (d.snatchMark ? { ...d, snatchMark: null } : d));
          return ok;
        }
        if (ev.reason === 'liquidate') fx('coin');
        return wait(ev.reason === 'liquidate' ? dl('cash') : dl('quiet'));
      }

      case 'level': {
        announce(ev);
        patchDisplay((d) => ({ ...d, levels: setAt(d.levels, ev.tile, ev.level) }));
        if (ev.reason === 'upgrade') {
          commit({ stageTile: ev.tile });
          const top = ev.level >= MAX_LEVEL;
          fx(top ? 'hotel' : 'upgrade', undefined, { level: ev.level });
          return wait(top ? dl('level') * 1.5 : dl('level'));
        }
        if (ev.reason === 'sell') {
          fx('coin');
          return wait(dl('cash'));
        }
        return wait(dl('quiet'));
      }

      case 'set_complete': {
        announce(ev);
        fx(byMe ? 'cheer' : 'click');
        return wait(dl('setComplete'));
      }

      case 'mortgage': {
        patchDisplay((d) => ({ ...d, mortgaged: setAt(d.mortgaged, ev.tile, true) }));
        announce(ev);
        fx('mortgage');
        return wait(dl('mortgage'));
      }

      case 'unmortgage': {
        patchDisplay((d) => ({ ...d, mortgaged: setAt(d.mortgaged, ev.tile, false) }));
        announce(ev);
        fx('pay');
        return wait(dl('mortgage') * 0.8);
      }

      case 'trade_offer': {
        patchDisplay((d) => ({ ...d, trade: { id: ev.id, from: ev.from, to: ev.to, give: ev.give, get: ev.get } }));
        announce(ev);
        fx(ev.to === me ? 'card' : 'click');
        return wait(dl('trade'));
      }

      case 'trade_countered': {
        // the counter-offer itself follows as a normal trade_offer: this one only announces and chimes
        announce(ev);
        fx('trade');
        return true;
      }

      case 'trade_done': {
        patchDisplay((d) => ({ ...d, trade: null }));
        announce(ev);
        fx('trade');
        return wait(dl('trade'));
      }

      case 'trade_rejected': {
        patchDisplay((d) => ({ ...d, trade: null }));
        announce(ev);
        fx(ev.from === me || ev.to === me ? 'error' : 'click');
        return wait(dl('trade'));
      }

      case 'debt': {
        patchDisplay((d) => ({ ...d, debt: { player: ev.player, amount: ev.amount, creditor: ev.creditor ?? null } }));
        announce(ev);
        fx('error');
        return wait(dl('debt'));
      }

      case 'traffic': {
        // stuck (Traffic Jam tile or the Ameerpet card), or free again: paid the fine, used chai, waited it out
        patchPlayer(ev.player, () => ({ stuck: !!ev.stuck }));
        announce(ev);
        if (ev.stuck) {
          const p = playerById(ev.player);
          commit({ stageTile: ev.reason === 'tile' || !p ? TRAFFIC_TILE : p.pos });
          fx('traffic', 'jail');
          return wait(dl('jail'));
        }
        if (ev.reason === 'waited') {
          fx('click');
          return wait(dl('jailStay'));
        }
        return wait(dl('quiet')); // paid / chai: the cash and chai events carry the moment
      }

      case 'ride': {
        // the auto / metro / MMTS pulls up; its `move { ride: true }` follows
        commit({ stageTile: Number.isInteger(ev.from) ? ev.from : S.stageTile });
        patchPlayer(ev.player, () => ({ motion: 'ride' }));
        announce(ev);
        fx('ride', 'step');
        return wait(dl('ride'));
      }

      case 'skip': {
        announce(ev); // "Ravi passed on Madhapur. It stays free": the log line; nothing animates
        return wait(dl('quiet'));
      }

      case 'chai': {
        patchPlayer(ev.player, () => ({ chai: Math.max(0, Number(ev.chai) || 0) }));
        announce(ev);
        fx('chai', undefined, { use: !(ev.change > 0) }); // poured when gained, a sip when spent
        return wait(dl('chai'));
      }

      case 'card': {
        commit({
          card: { player: ev.player, deck: ev.deck === 'drama' ? 'drama' : 'luck', title: ev.title, text: ev.text, kind: ev.kind, cardId: ev.cardId, ...(ev.capped ? { capped: true } : null) },
        });
        fx('card', undefined, { deck: ev.deck === 'drama' ? 'drama' : 'luck' }); // flip + the deck's own sting
        if (byMe) hp('card');
        announce(ev);
        // A recorded clip for this card: the players who get paid hear it, the one who drew it does not.
        if (CARD_CLIPS[ev.cardId] && !byMe && !disposed && !backedUp()) {
          try {
            D.playCardClip(ev.cardId);
          } catch {
            /* ignore */
          }
        }
        const ok = await wait(cardMs(ev) * (quickNow ? QUICK.card : 1));
        if (ok) commit({ card: null });
        return ok;
      }

      case 'snatch_open': {
        // Only announces the window: it runs in REAL time from the state that opened it (the pop-up reads `session.view`),
        // so this pause never delays or shortens it.
        commit({ stageTile: ev.tile });
        announce(ev);
        // a player who may press hears the alarm + tick-tock from the pop-up itself (it runs in real time); the rest a soft tick
        if (!(Array.isArray(ev.eligible) && ev.eligible.includes(me))) fx('click');
        return wait(dlOr('snatchOpen', 300));
      }

      case 'snatch_end': {
        commit({ stageTile: ev.tile });
        if (ev.outcome === 'snatched' && ev.winner !== null && ev.winner !== undefined) {
          // the district changes hands on screen at once and flashes (the board reads `display.snatchMark`)
          patchDisplay((d) => ({ ...d, owners: setAt(d.owners, ev.tile, ev.winner), snatchMark: { tile: ev.tile, winner: ev.winner } }));
          announce(ev);
          fx(ev.winner === me ? 'snatchWin' : ev.buyer === me ? 'snatchLost' : 'click');
          if (ev.winner === me) hp('snatchWin');
          else if (ev.buyer === me) hp('snatchLost');
          return wait(dlOr('snatchEnd', 1800));
        }
        if (ev.outcome === 'bidding') {
          announce(ev);
          fx('auction');
          return wait(dlOr('snatchEnd', 1800));
        }
        return wait(dl('quiet')); // nobody snatched: silence (describeEvent has no line for it)
      }

      case 'snatch_token': {
        patchPlayer(ev.player, () => ({ snatches: Math.max(0, Number(ev.snatches) || 0) }));
        return wait(dl('quiet'));
      }

      case 'token_earned': {
        patchPlayer(ev.player, () => ({ snatches: Math.max(0, Number(ev.snatches) || 0) }));
        announce(ev);
        fx(ev.player === me ? 'lucky' : 'click');
        return wait(dlOr('token', 1100));
      }

      case 'city_event': {
        patchDisplay((d) => ({
          ...d,
          event: copyEvent({ id: ev.id, title: ev.title, text: ev.text, kind: ev.kind, group: ev.group, groups: ev.groups, mult: ev.mult, amount: ev.amount, round: ev.round }),
        }));
        announce(ev);
        fx('announce', undefined, { bad: (ev.mult != null && ev.mult < 1) || (ev.amount != null && ev.amount < 0) });
        return wait(eventMs(ev));
      }

      case 'auction_start': {
        if (Number.isInteger(ev.tile)) commit({ stageTile: ev.tile });
        announce(ev);
        fx('auction');
        return wait(dl('auctionStart'));
      }

      case 'auction_end': {
        announce(ev);
        const hasWinner = ev.winner !== null && ev.winner !== undefined;
        fx(hasWinner ? 'sold' : 'click'); // the hammer and "sold"; the `own` event that follows rings the till
        if (hasWinner && ev.winner === me) hp('sold');
        // the bidding screen stays open for the reveal: `auctionResult` is the event + how long it is held (ms), for as long as we wait
        commit({ auctionResult: { ...ev, bids: { ...(ev.bids || {}) }, id: `ar${nextId()}`, ms: Math.round(dl('auctionEnd') * factor()) } });
        const ok = await wait(dl('auctionEnd'));
        if (ok) commit({ auctionResult: null });
        return ok;
      }

      case 'bankrupt': {
        patchPlayer(ev.player, () => ({ bankrupt: true, cash: 0, stuck: false, motion: null }));
        announce(ev);
        fx('bankrupt', undefined, { mine: byMe }); // the falling glide
        if (byMe) hp('bankrupt');
        return wait(dl('bankrupt'));
      }

      case 'power_draw': {
        // the event never names the card: my own draw carries the card found in my hand diff, a rival's is a card back
        const mine = byMe ? item.drawn.shift() || null : null;
        patchHand(ev.player, (h) => [...h, mine ? { uid: mine.uid, id: mine.id, exp: mine.exp } : { hidden: true }]); // the count ticks with the moment
        announce(ev, { bubble: false });
        fx('powerDraw', 'card', { vol: byMe ? 1 : 0.6 });
        if (byMe) hp('powerDraw');
        return powerMoment('powerDraw', {
          kind: 'draw',
          player: ev.player,
          source: ev.source === 'tile' ? 'tile' : 'turn',
          ...(Number.isInteger(ev.tile) ? { tile: ev.tile } : null),
          ...(mine ? { card: { uid: mine.uid, id: mine.id, exp: mine.exp } } : null),
        }, wait);
      }

      case 'power_play': {
        patchHand(ev.player, (h) => {
          const i = h.findIndex((c) => c && c.id === ev.card); // my own card is named; a rival's is hidden: drop one of them
          const at = i >= 0 ? i : h.findIndex((c) => c && c.hidden);
          return at >= 0 ? h.filter((_, j) => j !== at) : h;
        });
        if (hasHand(ev.player) && (ev.card === 'shield' || ev.card === 'double')) {
          const until = (Number(S.display.round) || 1) + POWER.ARMED_ROUNDS;
          patchPlayer(ev.player, () => (ev.card === 'shield' ? { shield: until } : { doubleRent: until })); // the chip appears with the reveal
        }
        announce(ev, { bubble: false });
        fx('powerPlay', 'card', { vol: byMe ? 1 : 0.8 });
        if (ev.card === 'swap' || ev.card === 'steal') {
          // the card's own sound follows the slam
          const myEpoch = epoch;
          const id = setTimeout(() => {
            flightTimers.delete(id);
            if (epoch === myEpoch) fx(ev.card === 'swap' ? 'powerSwap' : 'powerSteal', 'card', { vol: byMe ? 1 : 0.8 });
          }, Math.round(220 * factor()));
          flightTimers.add(id);
        }
        if (ev.card === 'swap') swapQuiet = 2; // two teleport moves follow
        if (byMe) hp('powerPlay');
        return powerMoment('powerPlay', {
          kind: 'play',
          player: ev.player,
          card: ev.card,
          ...(ev.target !== undefined && ev.target !== null ? { target: ev.target } : null),
        }, wait);
      }

      case 'power_trigger': {
        const kind = ev.card === 'double' ? 'double' : 'shield';
        if (hasHand(ev.player)) patchPlayer(ev.player, () => (kind === 'double' ? { doubleRent: 0 } : { shield: 0 })); // consumed: the chip flashes away
        announce(ev, { bubble: false });
        fx(kind === 'double' ? 'powerDouble' : 'powerShield', 'coin', { vol: byMe || ev.other === me ? 1 : 0.8 });
        if (byMe) hp(kind === 'double' ? 'powerDouble' : 'powerShield');
        return powerMoment('powerTrigger', {
          kind,
          player: ev.player,
          card: kind,
          amount: Number(ev.amount) || 0,
          ...(ev.other !== undefined && ev.other !== null ? { other: ev.other } : null),
        }, wait);
      }

      case 'power_expire': {
        patchHand(ev.player, (h) => {
          let left = Math.max(1, Math.floor(Number(ev.count)) || 1);
          // mine: the cards the final state no longer holds; a rival's: that many hidden ones
          return h.filter((c) => {
            if (left <= 0 || !c) return true;
            const gone = c.hidden ? !byMe : !!item.keep && !item.keep.has(c.uid);
            if (gone) left -= 1;
            return !gone;
          });
        });
        announce(ev, { bubble: false });
        fx('powerExpire', 'click', { vol: byMe ? 1 : 0.6 });
        if (byMe) hp('powerExpire');
        return powerMoment('powerExpire', { kind: 'expire', player: ev.player, count: Math.max(1, Math.floor(Number(ev.count)) || 1) }, wait);
      }

      case 'turn': {
        const idx = dsp.players.findIndex((p) => p.id === ev.player);
        const max = dsp.cfg ? Number(dsp.cfg.maxRounds) : NaN;
        const round = ev.round ?? dsp.round;
        const isFinal = Number.isFinite(max) && max > 0 && round === max;
        const d = announce(ev); // null unless the round changes (quiet per-turn)
        patchDisplay((x) => ({
          ...x,
          turn: idx >= 0 ? idx : x.turn,
          round,
          landing: null,
          // a city event lasts one round: drop it when a later round begins
          event: x.event && ev.round !== undefined && x.event.round !== ev.round ? null : x.event,
        }));
        commit({ handoff: { player: ev.player, round, isFinal } });
        if (ev.player !== me) fx('turnOther'); // my own turn has its chime in the TurnBanner
        let ok;
        if (!d) {
          ok = await wait(dl('turn'));
        } else {
          fx(isFinal ? 'card' : 'click');
          ok = await wait(isFinal ? dl('finalRound') : Math.max(dl('round'), dl('turn')));
        }
        if (ok) commit({ handoff: null });
        return ok;
      }

      case 'win': {
        // every win reason ('last_standing', 'rounds', 'target') gets the same full-pace fanfare; the reason rides along
        patchDisplay((x) => ({ ...x, phase: 'over', winner: ev.player ?? null, winReason: ev.reason ?? null }));
        announce(ev);
        const mine = ev.player === me;
        try {
          D.sfx.play(mine ? 'win' : 'lose'); // celebrate even while catching up
          if (mine) setTimeout(() => !disposed && D.sfx.play('cheer'), 450);
        } catch {
          /* ignore */
        }
        return wait(dl('win'));
      }

      default:
        return true;
    }
  }

  async function playItem(events, myEpoch, item = { drawn: [], keep: null }) {
    reducedNow = reducedMotion();
    swapQuiet = 0;
    quickNow = computeQuick(events);
    lastLeg = null;
    const alive = () => epoch === myEpoch && !disposed;
    const wait = async (ms) => {
      await sleep(ms * factor());
      return alive();
    };
    for (const ev of events) {
      if (!alive()) return false;
      if (!ev || typeof ev.type !== 'string') continue;
      try {
        if (!(await playEvent(ev, wait, item))) return false;
      } catch (err) {
        devWarn('event failed', ev, err);
      }
    }
    return alive();
  }

  function snapTo(state) {
    if (!state || !Array.isArray(state.players)) {
      commit({ rolling: false, card: null, handoff: null, auctionResult: null, power: null });
      return;
    }
    // `assist` belongs to the last roll, which the state itself does not carry: keep it.
    commit({
      display: { ...displayFromState(state), assist: S.display.assist, assistPlayer: S.display.assistPlayer },
      rolling: false,
      card: null,
      handoff: null,
      auctionResult: null,
      power: null,
    });
  }

  // ---- public API ----
  function enqueue(events, newState) {
    if (disposed) return;
    const list = Array.isArray(events) ? events : [];
    if (list.length === 0 && pending === 0) {
      knownHand = new Set(myHandOf(newState, me).map((c) => c.uid));
      snapTo(newState); // nothing to play and nothing ahead of us: apply instantly, no busy flicker
      return;
    }
    const myEpoch = epoch;
    // my new cards since the last state, in the order drawn: my power_draw events take them one by one
    const nowHand = myHandOf(newState, me);
    const drawn = nowHand.filter((c) => !knownHand.has(c.uid));
    const item = { drawn, keep: new Set(nowHand.map((c) => c.uid)) }; // keep: the cards of mine that survive this item (an expiry removes the rest)
    knownHand = new Set(nowHand.map((c) => c.uid));
    pending += 1;
    if (!S.busy) commit({ busy: true });
    chain = chain.then(async () => {
      if (myEpoch !== epoch || disposed) return;
      try {
        await playItem(list, myEpoch, item);
      } catch (err) {
        devWarn('playback failed', err);
      }
      if (myEpoch !== epoch || disposed) return;
      pending = Math.max(0, pending - 1);
      snapTo(newState);
      if (pending === 0) commit({ busy: false, rolling: false });
    });
  }

  function reset(state) {
    epoch += 1;
    flushTimers();
    chain = Promise.resolve();
    pending = 0;
    lastLeg = null;
    swapQuiet = 0;
    knownHand = new Set(myHandOf(state, me).map((c) => c.uid)); // a fresh snapshot: nothing in it is "new"
    S = { ...makeSnapshot(state) };
    listeners.forEach((l) => l());
  }

  function dispose() {
    disposed = true;
    epoch += 1;
    flushTimers();
    chain = Promise.resolve();
    pending = 0;
  }

  function mount() {
    disposed = false;
  }

  return {
    enqueue,
    reset,
    dispose,
    mount,
    setMe(id) {
      me = id;
    },
    /** Change the playback rate (0.75..2; applies from the next wait). */
    setSpeed(v) {
      rate = clampSpeed(v);
    },
    isBusy: () => pending > 0,
    getSnapshot: () => S,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------------------------

export function usePresenter({ meId, initialState, speed = 1 } = {}) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = createPresenterCore({ meId, initialState, speed });
  const core = ref.current;
  core.setMe(meId);
  core.setSpeed(speed);

  useEffect(() => {
    core.mount(); // StrictMode runs effects twice in dev: mount -> dispose -> mount
    return () => core.dispose();
  }, [core]);

  const snap = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  return useMemo(() => ({ ...snap, enqueue: core.enqueue, reset: core.reset, isBusy: core.isBusy }), [snap, core]);
}

export default usePresenter;
