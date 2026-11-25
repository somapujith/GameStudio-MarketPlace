// Tiffin Centre audio: the OPERATIONS layer's PURE decisions (plan section 3b). Nothing here touches Web Audio, the DOM or a clock.
//
//   eventIdsOf(state)            -> string[]   ids of state.events (rain | cricket | power | festival | inspector | delivery)
//   opsTargets(state, extra)     -> { rain, cricket, festival, delivery, grinder, simmer, gasHiss, generator, power }   0..1 per loop
//   prepKindOf(item)             -> 'batter' | 'stone' | 'dough' | 'pot' | 'tin'     which prep sound an ingredient makes
//   adjustAmbience(levels, flags)-> levels   rain thins the dry-weather beds, a power cut silences the electric ones
//   pickLoops(targets, budget)   -> Set of loop ids allowed to run under the noise-source cap (the most important first)
//
// Every function tolerates a missing / partial state (level 0 has none of the operations fields) and never throws.

import { INGREDIENTS, GAS } from '@shared/tiffin-centre/catalog.js';

export const EVENT_IDS = Object.freeze(['rain', 'cricket', 'power', 'festival', 'inspector', 'delivery']);

/** Loops in priority order (a cap drops the LAST first) with how many looping NOISE sources each one needs. */
export const LOOP_ORDER = Object.freeze(['rain', 'grinder', 'gasHiss', 'cricket', 'simmer', 'delivery', 'generator']);
export const NOISE_COST = Object.freeze({ rain: 2, grinder: 1, gasHiss: 1, cricket: 1, simmer: 1, delivery: 0, generator: 0 });
/** The most looping noise sources the operations layer keeps alive at once (phones: a noise source is the costly node). */
export const MAX_NOISE_LOOPS = 4;
/** Seconds after a power cut before a generator / inverter hum starts. */
export const GENERATOR_DELAY_MS = 4000;

const isObj = (v) => v !== null && typeof v === 'object';

export function eventIdsOf(state) {
  const list = Array.isArray(state?.events) ? state.events : [];
  const ids = [];
  for (const e of list) {
    const id = typeof e === 'string' ? e : e?.id;
    if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Which prep sound an ingredient makes (the engine's prep item ids). */
export function prepKindOf(item) {
  const id = String(item || '');
  if (id.startsWith('batter') || id === 'vada_batter') return 'batter';
  if (id === 'coconut_chutney' || id === 'podi_ghee') return 'stone';
  if (id === 'poori_dough' || id === 'besan_batter') return 'dough';
  if (INGREDIENTS[id]?.prep?.needs === 'gas') return 'pot';
  if (id === 'biscuits' || id === 'oil') return 'tin';
  return 'pot';
}

const needsOf = (item) => INGREDIENTS[item]?.prep?.needs || null;

/** Is the LPG burner on (levels without a cylinder: always)? Mirrors the engine's gasOn. */
export function gasUsable(state) {
  if (!state?.cfg?.gas) return true;
  const g = state.gas;
  return !!g && Number(g.u) > 0 && !(Number(g.sw) > 0);
}

/** The prep jobs cooking right now: [{ item, kind, needs }]. */
export function prepJobsOf(state) {
  const out = [];
  const slots = state?.stations?.prep1?.slots;
  if (!Array.isArray(slots)) return out;
  for (const sl of slots) {
    if (isObj(sl) && sl.st === 'cooking' && typeof sl.item === 'string') out.push({ item: sl.item, kind: prepKindOf(sl.item), needs: needsOf(sl.item) });
  }
  return out;
}

/**
 * What loops the state asks for. `extra.generatorReady` (the app: a few seconds into a power cut) switches the generator on when the
 * level has one (`cfg.generator` / `cfg.inverter`). Values are 0 or 1 (a loop's own mix level is in opsAudio).
 */
export function opsTargets(state, { events = null, generatorReady = false } = {}) {
  const ids = new Set(events || eventIdsOf(state));
  const power = ids.has('power');
  const jobs = prepJobsOf(state);
  const gasOk = gasUsable(state);
  const grind = jobs.some((j) => j.needs === 'power') && !power; // grinders pause during a power cut
  const pot = jobs.some((j) => j.needs === 'gas') && gasOk;
  const g = state?.gas;
  const cap = Number(GAS.cap) || 1000;
  const low = !!state?.cfg?.gas && isObj(g) && Number(g.u) > 0 && Number(g.u) <= cap * GAS.lowFrac && !(Number(g.sw) > 0);
  const hasGen = !!(state?.cfg?.generator || state?.cfg?.inverter);
  return {
    rain: ids.has('rain') ? 1 : 0,
    cricket: ids.has('cricket') ? 1 : 0,
    festival: ids.has('festival') ? 1 : 0,
    delivery: ids.has('delivery') ? 1 : 0,
    grinder: grind ? 1 : 0,
    simmer: pot ? 1 : 0,
    gasHiss: low ? 1 : 0,
    generator: power && hasGen && generatorReady ? 1 : 0,
    power: power ? 1 : 0,
  };
}

/** Which loops may run: walk LOOP_ORDER and keep each wanted one while the noise budget lasts. */
export function pickLoops(targets, budget = MAX_NOISE_LOOPS) {
  const keep = new Set();
  let used = 0;
  for (const id of LOOP_ORDER) {
    if (!(targets?.[id] > 0)) continue;
    const cost = NOISE_COST[id] || 0;
    if (used + cost > budget) continue;
    used += cost;
    keep.add(id);
  }
  return keep;
}

/** The beds of the dry-weather soundscape change with the weather and the power. `flags` = { rain, power }. Returns a NEW object. */
export function adjustAmbience(levels, flagsIn = {}) {
  const flags = flagsIn || {};
  const lv = { ...(levels || {}) };
  const mul = (k, m) => {
    if (typeof lv[k] === 'number') lv[k] *= m;
  };
  if (flags.power) {
    lv.radio = 0; // no electricity: no radio hum, no tabla from the speaker
    lv.tabla = 0;
  }
  if (flags.rain) {
    mul('cicadas', 0);
    mul('birds', 0);
    mul('heat', 0.2);
    mul('crickets', 0.4);
    mul('hawkers', 0.4);
    mul('dogs', 0.4);
    mul('scooter', 0.6);
    mul('autos', 0.7);
    mul('traffic', 0.85);
  }
  return lv;
}

/** A small key of the flags that change the ambience, for change detection. */
export const flagsKey = (f) => `${f?.rain ? 1 : 0}${f?.power ? 1 : 0}`;
