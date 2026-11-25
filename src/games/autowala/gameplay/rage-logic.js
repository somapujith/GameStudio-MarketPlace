// Road rage as a pure state machine (no three.js, no DOM, no ctx): `reduceRage(state, action, cfg)` -> { state, effects }.
//
//   hit      { severity (0..1), recruited }  the player hit something; `recruited` = how many vehicles the caller got to chase
//   tick     { dt, menu, paused, chasers, contact, boxGap, pairs, speed, wallet }   advance time
//              chasers: how many are chasing; contact: how many of them are within ~90 m and can see the player;
//              boxGap: the smallest bumper-to-player distance (m) among chasers; pairs: chasers within ~9 m; speed: player m/s
//
// Effects: { type: 'start', chasers } | { type: 'escaped' } | { type: 'caught', fine, chasers } (the caller spends the fine, toasts,
// penalises the trip and releases the chasers).
//
// Rules: a hit raises `heat` (more for a harder hit, more again for repeated hits) and starts a chase when vehicles could be
// recruited. Nobody within escapeDist (and seeing you) for escapeTime seconds -> escaped, no fine. A chaser boxing you in (within
// ~6 m while you are nearly stopped for ~3 s) or two chasers within ~9 m for ~4 s -> caught: fine = min(wallet, 150 + 300 * sev).
// After being caught there is a grace period in which nothing new starts. A menu (or pause) freezes every timer.
import { clamp } from '../game/rng.js';

export const RAGE = {
  escapeDist: 90, // m: a chaser nearer than this (and in sight) keeps the chase on
  escapeTime: 10, // s with no contact to lose them
  boxGap: 4.6, // m from the chaser's nose to the player (about "within 6 m" centre to centre for a car)
  boxSpeed: 2.5, // m/s: slower than this counts as held
  boxTime: 3, // s held by one chaser
  pairDist: 9, // m: two chasers this close hold you too
  pairSpeed: 14, // m/s: only while you are not simply driving away at speed
  pairTime: 4, // s
  grace: 10, // s after being caught before anything can start again
  fineBase: 150,
  fineScale: 300,
  maxChasers: 5,
  heatDecayCalm: 0.04, // per second while no chase is on
  heatDecayChase: 0.006, // per second while chased
  heatDecayLost: 0.03, // per second while the chasers cannot find you
};

export const initialRage = () => ({
  active: false, heat: 0, sev: 0, hits: 0, chasers: 0, escapeT: 0, boxT: 0, pairT: 0, caughtIn: 0, escape: 0, grace: 0, time: 0,
});

const NONE = Object.freeze([]);

/** The severity a hit adds up to, given what has happened lately (repeat offenders pay more). */
export function nextSeverity(state, severity) {
  const s = clamp(Number(severity) || 0, 0, 1);
  const rep = state.hits > 0 && (state.active || state.heat > 0.05) ? 0.08 * Math.min(state.hits, 4) : 0;
  return clamp(Math.max(state.sev, s) + rep, 0, 1);
}

/** How many vehicles should chase after this hit (0 during the grace period). */
export function wantChasers(state, severity, cfg = RAGE) {
  if (state.grace > 0) return 0;
  const sev = nextSeverity(state, severity);
  const again = state.hits > 0 && (state.active || state.heat > 0.05) ? 1 : 0;
  return clamp(1 + Math.round(sev * 3) + again, 1, cfg.maxChasers);
}

export function fineFor(sev, wallet, cfg = RAGE) {
  return Math.max(0, Math.min(Math.round(Number(wallet) || 0), Math.round(cfg.fineBase + cfg.fineScale * clamp(sev, 0, 1))));
}

export function reduceRage(state, action, cfg = RAGE) {
  if (action.type === 'hit') return onHit(state, action, cfg);
  if (action.type === 'tick') return onTick(state, action, cfg);
  return { state, effects: NONE };
}

function onHit(state, { severity = 0.3, recruited = 0 }, cfg) {
  const s = clamp(Number(severity) || 0, 0, 1);
  if (state.grace > 0) {
    // just caught: the incident is closed; a little heat so the next one is not free
    return { state: { ...state, heat: clamp(state.heat + 0.05 + 0.1 * s, 0, 1) }, effects: NONE };
  }
  const repeat = state.hits > 0 && (state.active || state.heat > 0.05);
  const sev = nextSeverity(state, s);
  const heat = clamp(state.heat + 0.16 + 0.5 * s + (repeat ? 0.12 + 0.05 * Math.min(state.hits, 4) : 0), 0, 1);
  const next = { ...state, heat, sev, hits: state.hits + 1, escapeT: 0 };
  const effects = [];
  if (recruited > 0) {
    next.chasers = Math.max(next.chasers, recruited);
    if (!state.active) {
      next.active = true;
      next.boxT = 0;
      next.pairT = 0;
      next.caughtIn = 0;
      effects.push({ type: 'start', chasers: recruited });
    }
  }
  return { state: next, effects: effects.length ? effects : NONE };
}

function onTick(state, a, cfg) {
  if (a.menu || a.paused) return { state, effects: NONE };
  const dt = clamp(Number(a.dt) || 0, 0, 0.25);
  if (dt <= 0) return { state, effects: NONE };
  const next = { ...state, time: state.time + dt, grace: Math.max(0, state.grace - dt) };

  if (!state.active) {
    next.heat = Math.max(0, state.heat - cfg.heatDecayCalm * dt);
    next.chasers = 0;
    next.escape = 0;
    next.caughtIn = 0;
    if (next.heat <= 0.02 && state.heat > 0) {
      next.hits = 0;
      next.sev = 0;
    } else if (next.heat <= 0) {
      next.hits = 0;
      next.sev = 0;
    }
    return { state: next, effects: NONE };
  }

  const chasers = Math.max(0, a.chasers | 0);
  const contact = Math.max(0, a.contact | 0);
  next.chasers = chasers;

  // losing them
  if (chasers === 0 || contact === 0) next.escapeT = state.escapeT + dt;
  else next.escapeT = 0;
  next.escape = clamp(next.escapeT / cfg.escapeTime, 0, 1);
  next.heat = Math.max(0.05, state.heat - (contact > 0 ? cfg.heatDecayChase : cfg.heatDecayLost) * dt);

  // being boxed in
  const speed = Number(a.speed) || 0;
  const held = chasers > 0 && Number(a.boxGap) <= cfg.boxGap && speed < cfg.boxSpeed;
  const paired = (a.pairs | 0) >= 2 && speed < cfg.pairSpeed;
  next.boxT = held ? state.boxT + dt : Math.max(0, state.boxT - dt);
  next.pairT = paired ? state.pairT + dt : Math.max(0, state.pairT - dt);
  next.caughtIn = clamp(Math.max(next.boxT / cfg.boxTime, next.pairT / cfg.pairTime), 0, 1);

  if (next.caughtIn >= 1) {
    const fine = fineFor(state.sev, a.wallet, cfg);
    const out = {
      ...initialRage(), time: next.time, grace: cfg.grace, heat: 0,
    };
    return { state: out, effects: [{ type: 'caught', fine, chasers: Math.max(chasers, 1) }] };
  }
  if (next.escapeT >= cfg.escapeTime) {
    const out = { ...initialRage(), time: next.time, heat: next.heat * 0.5, hits: state.hits, sev: state.sev * 0.5 };
    return { state: out, effects: [{ type: 'escaped' }] };
  }
  return { state: next, effects: NONE };
}
