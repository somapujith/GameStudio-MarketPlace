// Tiffin Centre audio: the PURE decisions. Nothing here touches Web Audio, the DOM or a clock, so it is all unit-tested in node.
//
//   soundsForEvent(event, { meId, state })  -> [{ name, opts, priority, gain }]   engine event -> sounds to play
//   createVoiceLimiter({ maxVoices, cooldowns })                                    polyphony cap + per-sound cooldowns + stealing
//   collectTier(amount), comboSteps(combo)                                          how a collect jingle scales

import { DISHES, STATIONS, LAYOUT } from '@shared/tiffin-centre/catalog.js';
import { standX, walkSeconds } from '@shared/tiffin-centre/movement.js';

/** Higher = more important: wins a voice when the cap is reached, and is never dropped for a lower one. */
export const PRIORITY = {
  fanfare: 10,
  closed: 10,
  lifeLost: 8,
  angry: 7,
  unpaid: 7,
  burnt: 6,
  collect: 6,
  payWarning: 6,
  ding: 5,
  kring: 5,
  payReady: 5,
  combo: 4,
  take: 3,
  serve: 3,
  sizzle: 2,
  emote: 2,
  discard: 2,
  scrape: 2,
  eat: 1,
  turnaway: 1,
  steps: 1,
};

/** Minimum gap (ms) between two starts of the same sound, so four players' events cannot machine-gun one sample. */
export const COOLDOWN_MS = {
  sizzle: 120,
  ding: 80,
  burnt: 250,
  scrape: 120,
  take: 70,
  serve: 90,
  kring: 200,
  turnaway: 400,
  eat: 700,
  payReady: 150,
  payWarning: 600,
  collect: 60,
  angry: 350,
  unpaid: 500,
  discard: 150,
  lifeLost: 600,
  combo: 200,
  emote: 150,
  fanfare: 2000,
  closed: 2000,
  steps: 220, // per walker (the limiter key), see soundsForMove
};

export const SOUND_NAMES = Object.freeze(Object.keys(PRIORITY));
export const MAX_VOICES = 12;
/** A voice that has not reported "done" after this long (a suspended tab, a stuck source) is forgotten by the limiter. */
export const MAX_VOICE_LIFE_MS = 8000;
/** Other players' actions are heard, but a little behind your own. */
export const OTHERS_GAIN = 0.6;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Stereo position of something at world x (the stall is about 9 m wide); gentle, never hard-panned. */
export const panOfX = (x) => (Number.isFinite(x) ? clamp((x / 4.5) * 0.7, -0.7, 0.7) : 0);

/** 'tawa' | 'kadai' | 'steamer' | 'chai' for a station id (or a dish id as a fallback). */
export function stationKind(ev) {
  const st = STATIONS[ev?.station];
  if (st) return st.kind;
  return DISHES[ev?.dish]?.station || 'tawa';
}

function spotOf(ev, state) {
  if (Number.isFinite(ev?.spot)) return ev.spot;
  const c = state?.customers?.find?.((x) => x.id === ev?.customer);
  return Number.isFinite(c?.spot) ? c.spot : null;
}
const panOfCustomer = (ev, state) => {
  const spot = spotOf(ev, state);
  return spot === null ? 0 : panOfX(LAYOUT.spotX(spot));
};
const panOfStation = (ev) => panOfX(STATIONS[ev?.station]?.x);

/** Small ticket: < 70 rupees, middle: < 160, big: everything above. */
export function collectTier(amount) {
  const a = Number(amount) || 0;
  return a >= 160 ? 2 : a >= 70 ? 1 : 0;
}

/** Semitone climb of the collect jingle per consecutive collect (a pentatonic ladder, capped). */
export const COMBO_LADDER = Object.freeze([0, 2, 4, 7, 9, 12, 14, 16, 19, 21]);
export function comboSteps(combo) {
  const i = clamp(Math.trunc(Number(combo) || 0) - 1, 0, COMBO_LADDER.length - 1);
  return COMBO_LADDER[i];
}

// Footsteps (slippers on the footpath). Soft; your own avatar is clearly heard, the others are faint and short.
export const STEP_SECONDS = 0.26; // cadence: one tap per this many seconds of walking
export const MAX_STEPS = 6;
export const MAX_STEPS_OTHERS = 3;
export const STEP_GAIN = 0.7;
export const OTHERS_STEP_GAIN = 0.28;

/**
 * An avatar went from `fromAt` to `toAt` (players[id].at, see shared movement.js): the footstep sound for that walk, or [].
 * `key` = the walker's id so each walker has its own cooldown.
 */
export function soundsForMove(fromAt, toAt, { mine = true, key = 'me' } = {}) {
  const x0 = standX(fromAt);
  const x1 = standX(toAt);
  if (!(Math.abs(x1 - x0) >= 0.25)) return [];
  const dur = walkSeconds(x0, x1);
  const n = Math.max(1, Math.min(mine ? MAX_STEPS : MAX_STEPS_OTHERS, Math.round(dur / STEP_SECONDS)));
  const dt = Math.min(STEP_SECONDS, dur / n);
  const times = Array.from({ length: n }, (_, i) => +(i * dt).toFixed(3));
  return [{ name: 'steps', opts: { times, pan: panOfX((x0 + x1) / 2), mine }, priority: PRIORITY.steps, gain: mine ? STEP_GAIN : OTHERS_STEP_GAIN, key: `steps:${key}` }];
}

const mk = (name, opts = {}, gain = 1) => ({ name, opts, priority: PRIORITY[name], gain });

/**
 * One engine event (plan section 3) -> the sounds it should trigger ([] when it is silent).
 * `ctx.meId` makes other players' actions quieter; `ctx.state` (optional) gives positions of customers.
 */
export function soundsForEvent(ev, ctx = {}) {
  if (!ev || typeof ev.type !== 'string') return [];
  const { meId = null, state = null } = ctx;
  const mine = ev.by == null || meId == null || ev.by === meId;
  const g = mine ? 1 : OTHERS_GAIN;
  switch (ev.type) {
    case 'cook-start':
      return [mk('sizzle', { kind: stationKind(ev), pan: panOfStation(ev) }, g)];
    case 'ready':
      return [mk('ding', { kind: stationKind(ev), pan: panOfStation(ev) })];
    case 'burnt':
      return [mk('burnt', { pan: panOfStation(ev) })];
    case 'burnt-cleared':
      return [mk('scrape', { pan: panOfStation(ev) }, g)];
    case 'take':
      return [mk('take', { pan: panOfStation(ev), q: ev.q }, g)];
    case 'serve':
      return [mk('serve', { pan: panOfCustomer(ev, state) }, g)];
    case 'customer-arrive':
      return [mk('kring', { pan: panOfCustomer(ev, state) })];
    case 'customer-turned-away':
      return [mk('turnaway', { pan: panOfCustomer(ev, state) })];
    case 'eating':
      return [mk('eat', { pan: panOfCustomer(ev, state) })];
    case 'pay-ready':
      return [mk('payReady', { pan: panOfCustomer(ev, state) })];
    case 'pay-warning':
      return [mk('payWarning', { pan: panOfCustomer(ev, state) })];
    case 'collect': {
      const amount = Number(ev.amount) || 0;
      return [mk('collect', { amount, tip: Number(ev.tip) || 0, tier: collectTier(amount), steps: comboSteps(ev.combo), pan: panOfCustomer(ev, state) }, g)];
    }
    case 'customer-angry':
      return [mk('angry', { pan: panOfCustomer(ev, state) })];
    case 'customer-unpaid':
      return [mk('unpaid', { pan: panOfCustomer(ev, state) })];
    case 'discard':
      return [mk('discard', {}, g)];
    case 'life-lost':
      return [mk('lifeLost')];
    case 'combo':
      return Number(ev.combo) >= 2 ? [mk('combo', { steps: comboSteps(ev.combo) })] : [];
    case 'emote':
      return [mk('emote', { e: ev.e }, g)];
    case 'shift-end': {
      const win = ev.status === 'done';
      return win ? [mk('fanfare', { stars: clamp(Math.trunc(Number(ev.stars) || 0), 1, 3) })] : [mk('closed')];
    }
    default:
      return []; // tick, tutorial-spawn, unknown future events
  }
}

/**
 * Decides whether a new voice may start. Pure bookkeeping, the caller owns the audio nodes.
 *   request(name, priority, tMs) -> { ok:true, id, steal: id|null } | { ok:false, reason:'cooldown'|'cap' }
 *   end(id)   the voice finished (or was stolen)
 */
export function createVoiceLimiter({ maxVoices = MAX_VOICES, cooldowns = COOLDOWN_MS, maxLife = MAX_VOICE_LIFE_MS } = {}) {
  const active = new Map(); // id -> { name, priority, at }
  const last = new Map(); // name -> last start (ms)
  let nextId = 1;
  return {
    request(name, priority = 1, t = 0, key = name) {
      for (const [id, v] of active) if (t - v.at > maxLife) active.delete(id);
      const cd = cooldowns[name] || 0;
      if (cd && last.has(key) && t - last.get(key) < cd) return { ok: false, reason: 'cooldown' };
      let steal = null;
      if (active.size >= maxVoices) {
        let weakest = null;
        for (const [id, v] of active) {
          if (!weakest || v.priority < weakest.v.priority || (v.priority === weakest.v.priority && v.at < weakest.v.at)) weakest = { id, v };
        }
        if (!weakest || weakest.v.priority > priority) return { ok: false, reason: 'cap' };
        steal = weakest.id;
        active.delete(steal);
      }
      const id = nextId++;
      active.set(id, { name, priority, at: t });
      last.set(key, t);
      return { ok: true, id, steal };
    },
    end(id) {
      active.delete(id);
    },
    count: () => active.size,
    reset() {
      active.clear();
      last.clear();
    },
  };
}
