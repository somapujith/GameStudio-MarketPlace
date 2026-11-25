// Tiffin Centre: the things that happen to a street stall (docs/TIFFIN_CENTRE_PLAN.md section 3b): rain, a cricket-match night, a power cut,
// a festival rush, the GHMC food-safety inspector and the tiffin delivery boy.
//
// The PLAN of a shift (which events, when, how long) is a pure function of (level events, seed, shiftTicks): it never depends on what the
// players do, so the crowd generator can look ahead into it and the same seed always gives the same day. It is not stored in the state;
// the state only keeps the events that are RUNNING: `state.events = [{ id, until }]`.
import { EVENTS, HEAT } from './catalog.js';
import { nextFloat, randInt, seedToUint32 } from '../rng.js';
import { bonus as addBonus, spend } from './economy.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const cache = new Map();

/** [{ id, at, until }] sorted by start. Deterministic; cached per (events, seed, shiftTicks). */
export function eventPlan({ ids, seed, shiftTicks }) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const key = `${typeof seed}:${String(seed)}|${shiftTicks}|${ids.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = { rng: (seedToUint32(seed) ^ 0x5bd1e995) >>> 0 };
  const out = [];
  for (const id of ids) {
    if (!hasOwn(EVENTS, id) || out.some((e) => e.id === id)) continue;
    const def = EVENTS[id];
    const f = def.at[0] + nextFloat(h) * (def.at[1] - def.at[0]);
    const dur = randInt(h, def.dur[0], def.dur[1]);
    const at = Math.max(8, Math.round(f * shiftTicks));
    out.push({ id, at, until: Math.min(at + dur, shiftTicks) });
  }
  out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

export const planOf = (s) => eventPlan({ ids: s.cfg.events, seed: s.seed, shiftTicks: s.shiftTicks });

const activeAt = (plan, tick) => plan.filter((e) => e.at <= tick && tick < e.until);

/** Multiplier on the arrival rate at `tick` (rain thins the crowd, a festival or a cricket night swells it). */
export function crowdMult(plan, tick) {
  let m = 1;
  for (const e of activeAt(plan, tick)) m *= EVENTS[e.id].crowd || 1;
  return m;
}
/** Multiplier on how likely a dish is to be ordered at `tick`. */
export function dishMult(plan, tick, dish) {
  let m = 1;
  for (const e of activeAt(plan, tick)) m *= (EVENTS[e.id].dish && EVENTS[e.id].dish[dish]) || 1;
  return m;
}
/** Multiplier on how likely a customer kind is to turn up at `tick`. */
export function kindMult(plan, tick, kind) {
  let m = 1;
  for (const e of activeAt(plan, tick)) m *= (EVENTS[e.id].kind && EVENTS[e.id].kind[kind]) || 1;
  return m;
}
/** A cricket night: people arrive in clusters. */
export const burstAt = (plan, tick) => activeAt(plan, tick).some((e) => EVENTS[e.id].burst);
/** Tip multiplier of the running events (festival: generous crowd). */
export function tipMult(s) {
  let m = 1;
  for (const e of s.events || []) m *= EVENTS[e.id].tip || 1;
  return m;
}

/** Is something down because of a running event? `what`: 'steamer' | 'grinder' | 'lights'. */
export function isDown(s, what) {
  if (!s.events || !s.events.length) return false;
  for (const e of s.events) if (EVENTS[e.id] && EVENTS[e.id].down && EVENTS[e.id].down.includes(what)) return true;
  return false;
}
export const isActive = (s, id) => !!s.events && s.events.some((e) => e.id === id);

/** The running events with their labels, for the HUD / scene / audio: [{ id, name, te, until, left }]. */
export function eventsNow(s) {
  if (!s || !Array.isArray(s.events)) return [];
  const out = [];
  for (const e of s.events) {
    const def = hasOwn(EVENTS, e.id) ? EVENTS[e.id] : null;
    if (def) out.push({ id: e.id, name: def.name, te: def.te, until: e.until, left: Math.max(0, e.until - s.tick) });
  }
  return out;
}

// The inspector: passes when nothing burnt is lying on a station and every pan was tended recently.
function inspect(s, ev) {
  const why = [];
  for (const sid of s.cfg.stations) {
    const st = s.stations[sid];
    if (st.kind !== 'prep' && st.slots.some((sl) => sl.st === 'burnt')) { why.push('burnt'); break; }
  }
  if (s.cfg.heat) {
    for (const sid of s.cfg.stations) {
      const st = s.stations[sid];
      if (st.kind !== 'tawa') continue; // the inspector looks at the dosa tawas
      const clean = s.tick - st.tendAt <= HEAT.inspectorWindow || tendNeed(st) < 0.2;
      if (!clean) { why.push('untended'); break; }
    }
  }
  const lvl = s.level;
  if (!why.length) {
    const amount = EVENTS.inspector.bonus + 5 * lvl;
    addBonus(s, amount);
    ev.push({ type: 'inspector', pass: true, bonus: amount, fine: 0, why });
  } else {
    const fine = EVENTS.inspector.fine + 3 * lvl;
    spend(s, fine);
    s.fines = (s.fines || 0) + fine;
    ev.push({ type: 'inspector', pass: false, bonus: 0, fine, why });
    if (!s.cfg.tutorial) {
      s.lives = Math.max(0, s.lives - 1);
      ev.push({ type: 'life-lost', lives: s.lives });
    }
  }
}

// need of one station (0..1); duplicated here from ops.js to keep the import graph acyclic (ops imports events)
function tendNeed(st) {
  if (typeof st.water === 'number') return Math.max(0, Math.min(1, (100 - st.water) / 70));
  if (typeof st.heat !== 'number') return 0;
  return Math.max(0, Math.min(1, Math.max(Math.abs(st.heat - 52) / 22, (st.gunk || 0) / 75)));
}

/**
 * Called once per tick by the engine: ends and starts events. `hooks.spawnDelivery(s, ev) -> boolean` seats the delivery boy.
 * Event entries: { id, until } (+ `w: 1` while the delivery boy is still waiting for a free spot).
 */
export function tickEvents(s, ev, hooks) {
  if (!s.cfg.events || !s.cfg.events.length) return;
  const keep = [];
  for (const e of s.events) {
    if (s.tick >= e.until) {
      if (e.id === 'inspector') inspect(s, ev);
      ev.push({ type: 'event-end', id: e.id });
    } else keep.push(e);
  }
  s.events = keep;
  for (const p of planOf(s)) {
    if (p.at <= s.tick && s.tick < p.until && !s.events.some((e) => e.id === p.id)) {
      const entry = { id: p.id, until: p.until };
      if (p.id === 'delivery') entry.w = 1;
      s.events.push(entry);
      ev.push({ type: 'event-start', id: p.id, until: p.until });
    }
  }
  for (const e of s.events) {
    if (e.id === 'delivery' && e.w && hooks && hooks.spawnDelivery(s, ev)) delete e.w;
  }
}

