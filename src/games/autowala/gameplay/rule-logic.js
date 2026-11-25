// The road rules as pure logic (no three.js, no DOM, no ctx): speed limits, what a challan costs, how often one can be written, the
// "wanted heat" that makes a night checkpoint check your papers, line-crossing tests, and the checkpoint state machine.
// gameplay/rules.js wires these to the game; every function here is unit-tested in rule-logic.test.js.
import { clamp } from '../game/rng.js';

export const RULES = {
  limits: { school: 20, city: 40, fast: 60 }, // km/h
  speedTolerance: 5, // km/h over the limit before a camera cares
  fine: { signal: 250, speedBase: 100, speedPerKmh: 6, speedMax: 400, docs: 250, ran: 200 },
  fareMul: { signal: 0.9, speed: 0.92, docs: 0.9, ran: 0.85 }, // what a customer on board pays after a challan
  cooldown: { global: 6, signal: 25, camera: 20, checkpoint: 90 }, // s: between ANY two fines / per site
  heat: { signal: 0.5, speed: 0.4, ran: 0.6, decay: 1 / 90, wanted: 0.2 }, // heat 0..1; `decay` per second (about 90 s to forget)
  schoolRadius: 42, // m
  checkpoint: {
    near: 40, // m: the prompt appears
    stopZone: 13, // m: be this close and almost stopped for `stopTime` s and the check begins
    stopSpeed: 2.8, // m/s
    stopTime: 0.9,
    checkTime: 1.8, // s the policeman takes
    ranSpeed: 8, // m/s: crossing the line this fast is running the check
    nightFrom: 0.55, // sky night level at which checkpoints come out
  },
};

/** Speed limit of a road edge (km/h) and its zone name: fast roads (Outer Ring Road, Necklace Road, avenues) 60, the rest 40. */
export function edgeLimit(edge, cfg = RULES) {
  const fast = edge.w >= 16 || /ring road|necklace/i.test(edge.name || '');
  return fast ? { limit: cfg.limits.fast, zone: 'fast' } : { limit: cfg.limits.city, zone: 'city' };
}

/** The school zone (if any) whose centre is within its radius of (x, z). `zones[i] = { x, z, r }`. */
export function schoolZoneAt(zones, x, z) {
  for (const s of zones) if ((x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r) return s;
  return null;
}

/** The limit at a point: a school zone wins, else the nearest road's. Writes and returns `out` { limit, zone }. */
export function limitAtPoint(city, schools, x, z, out = { limit: 40, zone: 'city' }, cfg = RULES) {
  const s = schoolZoneAt(schools, x, z);
  if (s) {
    out.limit = cfg.limits.school;
    out.zone = 'school';
    return out;
  }
  let best = null;
  let bd = Infinity;
  const nodes = city.nodes;
  for (const e of city.edges) {
    const a = nodes[e.a];
    const t = clamp(((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len, 0, 1) * e.len;
    const dx = x - (a.x + e.dx * t);
    const dz = z - (a.z + e.dz * t);
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  const r = best ? edgeLimit(best, cfg) : { limit: cfg.limits.city, zone: 'city' };
  out.limit = r.limit;
  out.zone = r.zone;
  return out;
}

/** What a speed camera charges for doing `kmh` where the limit is `limit` (0 when within the tolerance). */
export function speedFine(kmh, limit, cfg = RULES) {
  const over = kmh - limit;
  if (over <= cfg.speedTolerance) return 0;
  const f = cfg.fine.speedBase + cfg.fine.speedPerKmh * (over - cfg.speedTolerance);
  return Math.round(clamp(f, cfg.fine.speedBase, cfg.fine.speedMax) / 10) * 10;
}

/** The amount actually taken: never more than the wallet. */
export const payable = (fine, wallet) => Math.max(0, Math.min(Math.round(fine), Math.round(Number(wallet) || 0)));

/** Cooldowns: no challan twice for the same thing, and never two within a few seconds. Keys are strings (`signal:12`, `cam:3`). */
export function createCooldowns() {
  const until = new Map();
  let anyUntil = -Infinity;
  return {
    /** May a fine be written for `key` at time `now`? */
    ready: (key, now) => now >= anyUntil && now >= (until.get(key) ?? -Infinity),
    /** Record a fine: blocks `key` for `siteCd` s and everything for `globalCd` s. */
    mark(key, now, siteCd, globalCd = RULES.cooldown.global) {
      until.set(key, now + siteCd);
      anyUntil = now + globalCd;
    },
    clear() {
      until.clear();
      anyUntil = -Infinity;
    },
  };
}

/** Wanted heat after a violation (0..1, saturating). */
export const addHeat = (heat, amount) => clamp(heat + amount, 0, 1);
export const decayHeat = (heat, dt, cfg = RULES) => Math.max(0, heat - cfg.heat.decay * dt);
/** Is the player "wanted"? Our own heat, or the road-rage heat of rage-logic.js (absent: ignored). */
export const isWanted = (heat, rageHeat = 0, cfg = RULES) => Math.max(heat, (Number(rageHeat) || 0) * 0.8) >= cfg.heat.wanted;

/**
 * Did the player cross a stop line / camera plane this frame? `prev` and `now` are the signed distances to the plane (> 0 before it,
 * <= 0 past it); `lat` the sideways offset from the road's travelling side and `[latMin, latMax]` where the road is.
 * `fwd`: dot of the player's travel direction with the road's direction (> 0.3: going the right way).
 */
export function crossedLine(prev, now, lat, latMin, latMax, fwd = 1) {
  return prev > 0 && now <= 0 && prev - now < 8 && lat >= latMin && lat <= latMax && fwd > 0.3;
}

/** Same plane crossing for a camera that watches both ways: either direction counts. */
export function crossedEither(prev, now, lat, halfWidth) {
  return ((prev > 0 && now <= 0) || (prev < 0 && now >= 0)) && Math.abs(prev - now) < 8 && Math.abs(lat) <= halfWidth;
}

// ---------------------------------------------------------------------------------------------------------- night checkpoint
export const initialCheckpoint = () => ({ phase: 'idle', t: 0, cool: 0 });

/**
 * One tick of a checkpoint. In: { dt, dist (to its centre), speed (m/s), crossed (the player crossed its line this frame),
 * night (sky night 0..1), wanted (bool), busy (a menu or pause) }. Out: { state, effects } with effects
 * { type: 'near' | 'far' | 'checking' | 'clear' | 'fine-docs' | 'fine-ran' }.
 *   idle -> near (prompt) -> stopped (slow and close) -> checking -> clear | fine-docs, then `cool` s with no check at all.
 *   Crossing the line fast without stopping is `fine-ran`. At daytime the checkpoint is not there.
 */
export function reduceCheckpoint(state, a, cfg = RULES.checkpoint, coolAfter = RULES.cooldown.checkpoint) {
  const NONE = [];
  if (a.busy) return { state, effects: NONE };
  const dt = clamp(Number(a.dt) || 0, 0, 0.25);
  const s = { ...state, cool: Math.max(0, state.cool - dt) };
  const active = a.night >= cfg.nightFrom && s.cool <= 0;
  if (!active && s.phase !== 'checking') {
    const was = s.phase !== 'idle';
    s.phase = 'idle';
    s.t = 0;
    return { state: s, effects: was ? [{ type: 'far' }] : NONE };
  }
  const fx = [];
  if (s.phase === 'checking') {
    s.t += dt;
    if (s.t >= cfg.checkTime) {
      s.phase = 'idle';
      s.t = 0;
      s.cool = coolAfter;
      fx.push({ type: a.wanted ? 'fine-docs' : 'clear' });
    }
    return { state: s, effects: fx };
  }
  if (a.crossed && a.speed > cfg.ranSpeed) {
    s.phase = 'idle';
    s.t = 0;
    s.cool = coolAfter;
    fx.push({ type: 'fine-ran' });
    return { state: s, effects: fx };
  }
  if (a.dist <= cfg.stopZone && a.speed < cfg.stopSpeed) {
    s.t += dt;
    s.phase = 'stopped';
    if (s.t >= cfg.stopTime) {
      s.phase = 'checking';
      s.t = 0;
      fx.push({ type: 'checking' });
    }
    return { state: s, effects: fx };
  }
  if (a.dist <= cfg.near) {
    if (s.phase === 'idle') fx.push({ type: 'near' });
    s.phase = 'near';
    s.t = 0;
  } else if (s.phase !== 'idle') {
    s.phase = 'idle';
    s.t = 0;
    fx.push({ type: 'far' });
  }
  return { state: s, effects: fx.length ? fx : NONE };
}
