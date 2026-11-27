// OWNER: quests agent. The step types a mission is made of. PURE: no three.js, no DOM, no ctx; every handler is a function of
// (def, state, dt, sample) so it can be unit tested with plain objects (quest-engine.test.js).
//
//   sample = { x, z, speed (m/s), airborne, jolt (0..1), distance (m driven, ever), time }
//   env    = { trains: [{ x, z, speed, line }] }   (the live metro trains, optional)
//
// A step is { type, label, te?, hint?, timeLimit?, ...params }. `tick` returns null (keep going), 'done', or { fail: 'reason' }.
// `event` is fed the bus events the mission cares about (land, honk, menu, workshop:enter...).
// `targets` lists what the markers and the minimap should show for the step right now; `hud` is the short progress text.
import { pathAt, projectOnPath } from './quest-math.js';

const hyp = Math.hypot;
const STOPPED = 2.2; // m/s: "stopped" for a pickup / a photo stop
const P = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
const PRJ = { s: 0, d: 0 };

/** How fast the rival drives: a little slower when it is far ahead of the player, a little faster when far behind (rubber band). */
export function rivalPace(base, gap) {
  // gap = rival progress - player progress (metres, positive: the rival is ahead)
  if (gap > 90) return base * 0.72;
  if (gap > 40) return base * (1 - 0.28 * ((gap - 40) / 50));
  if (gap < -80) return base * 1.14;
  if (gap < -20) return base * (1 + 0.14 * ((-gap - 20) / 60));
  return base;
}

/** How far the convoy has to wait for the player (m/s multiplier): it slows down when the player trails far behind. */
export function convoyPace(base, dist) {
  if (dist > 42) return base * 0.35;
  if (dist > 30) return base * 0.7;
  return base;
}

const HANDLERS = {
  // ---- drive to a point (optionally stop there, optionally slower than maxSpeed) --------------------------------------------
  reach: {
    init: () => ({ held: 0 }),
    tick(def, st, dt, s) {
      const r = def.r ?? 14;
      if (!(hyp(s.x - def.x, s.z - def.z) <= r)) { // not `> r`: a NaN position is not inside the ring
        st.held = 0;
        return null;
      }
      if (def.maxSpeed != null && s.speed > def.maxSpeed) return null;
      if (def.stop) {
        if (s.speed > STOPPED) {
          st.held = 0;
          return null;
        }
        st.held += dt;
        return st.held >= (def.dwell ?? 0.6) ? 'done' : null;
      }
      return 'done';
    },
    targets: (def, st, out) => out.push({ x: def.x, z: def.z, r: def.r ?? 14, kind: def.marker || 'ring', stop: !!def.stop, held: st.held, dwell: def.dwell ?? 0.6 }),
    hud: (def, st, s) => `${Math.round(hyp(s.x - def.x, s.z - def.z))} m`,
  },

  // ---- collect points in any order (kites, parcels) ---------------------------------------------------------------------------
  collect: {
    init: (def) => ({ taken: def.points.map(() => false), count: 0 }),
    tick(def, st, dt, s) {
      const r = def.r ?? 11;
      for (let i = 0; i < def.points.length; i++) {
        if (st.taken[i]) continue;
        const p = def.points[i];
        if (hyp(s.x - p.x, s.z - p.z) <= r) {
          st.taken[i] = true;
          st.count++;
          st.justTaken = i;
        }
      }
      return st.count >= def.points.length ? 'done' : null;
    },
    targets(def, st, out) {
      for (let i = 0; i < def.points.length; i++) if (!st.taken[i]) out.push({ x: def.points[i].x, z: def.points[i].z, r: def.r ?? 11, kind: def.marker || 'kite', i });
    },
    hud: (def, st) => `${st.count} / ${def.points.length}`,
  },

  // ---- stunt jumps: land after at least `minAir` seconds in the air, `count` times ------------------------------------------
  jumps: {
    init: () => ({ count: 0, air: 0, best: 0 }),
    tick: () => null,
    event(def, st, e) {
      if (e.type !== 'land') return null;
      const air = Number(e.air) || 0;
      if (air < (def.minAir ?? 0.35)) return null;
      st.count++;
      st.air += air;
      st.best = Math.max(st.best, air);
      st.lastAir = air;
      return st.count >= def.count ? 'done' : null;
    },
    targets(def, st, out) {
      for (const r of def.marks || []) out.push({ x: r.x, z: r.z, r: 9, kind: 'ring' });
    },
    hud: (def, st) => `${st.count} / ${def.count} jumps`,
  },

  // ---- a baraat procession walks the route; stay close behind it, do not overtake -------------------------------------------
  escort: {
    init: () => ({ u: 0, hold: 0, pi: 0, far: 0, ahead: 0, dist: 0, note: '', moving: false }),
    tick(def, st, dt, s) {
      const path = def.path;
      pathAt(path, st.u, P);
      st.dist = hyp(s.x - P.x, s.z - P.z);
      projectOnPath(path, s.x, s.z, 0, Infinity, PRJ);
      const ahead = PRJ.s > st.u + (def.len ?? 10) * 0.6 + 2;
      st.far = st.dist > (def.tooFar ?? 55) ? st.far + dt : Math.max(0, st.far - dt * 2);
      st.ahead = ahead ? st.ahead + dt : Math.max(0, st.ahead - dt * 2);
      st.note = st.ahead > 0.4 ? 'Stay BEHIND the baraat!' : st.far > 0.4 ? 'Keep up with the baraat!' : st.hold > 0 ? 'The dhol is playing. Honk along!' : '';
      if (st.far > (def.tooFarTime ?? 7)) return { fail: 'lost' };
      if (st.ahead > (def.overtakeTime ?? 4)) return { fail: 'overtake' };
      if (st.hold > 0) {
        st.hold = Math.max(0, st.hold - dt);
        st.moving = false;
      } else if (st.u < path.length) {
        const pauses = def.pauses || [];
        if (st.pi < pauses.length && st.u >= pauses[st.pi] * path.length) {
          st.pi++;
          st.hold = def.pauseTime ?? 4.5;
        } else {
          st.u = Math.min(path.length, st.u + convoyPace(def.speed ?? 3.2, st.dist) * dt);
          st.moving = true;
        }
      }
      if (st.u >= path.length - 0.01) {
        pathAt(path, path.length, P);
        if (hyp(s.x - P.x, s.z - P.z) < (def.endR ?? 45)) return 'done';
      }
      return null;
    },
    targets(def, st, out) {
      const p = def.path.points[def.path.points.length - 1];
      pathAt(def.path, Math.min(def.path.length, st.u), P);
      out.push({ x: P.x, z: P.z, r: 8, kind: 'convoy' });
      out.push({ x: p.x, z: p.z, r: def.endR ?? 45, kind: 'ring' });
    },
    hud: (def, st) => `${Math.max(0, Math.round(def.path.length - st.u))} m to the venue`,
  },

  // ---- race a rival along a road route through checkpoints ---------------------------------------------------------------------
  race: {
    init: () => ({ t: 0, cp: 0, rivalS: 0, playerS: 0, gap: 0, go: false }),
    tick(def, st, dt, s) {
      projectOnPath(def.path, s.x, s.z, 0, Infinity, PRJ);
      st.playerS = PRJ.d < 60 ? PRJ.s : st.playerS;
      if (!st.go) {
        st.t += dt;
        if (st.t >= (def.countdown ?? 3)) st.go = true;
        return null;
      }
      st.gap = st.rivalS - st.playerS;
      st.rivalS = Math.min(def.path.length, st.rivalS + rivalPace(def.rivalSpeed ?? 12.5, st.gap) * dt);
      const cp = def.cps[st.cp];
      if (cp && hyp(s.x - cp.x, s.z - cp.z) <= (cp.r ?? 14)) st.cp++;
      if (st.cp >= def.cps.length) return 'done';
      if (st.rivalS >= def.path.length - 0.01) return { fail: 'rival' };
      return null;
    },
    targets(def, st, out) {
      for (let i = st.cp; i < Math.min(def.cps.length, st.cp + 2); i++) out.push({ x: def.cps[i].x, z: def.cps[i].z, r: def.cps[i].r ?? 14, kind: i === def.cps.length - 1 ? 'finish' : 'ring' });
    },
    hud: (def, st) => (st.go ? `Gate ${Math.min(st.cp + 1, def.cps.length)} / ${def.cps.length}  ${st.gap > 6 ? 'rival ahead' : st.gap < -6 ? 'you lead' : 'neck and neck'}` : `Get ready... ${Math.max(1, Math.ceil((def.countdown ?? 3) - st.t))}`),
  },

  // ---- wait for a bus event (honk, the pause menu, the workshop) -------------------------------------------------------------
  event: {
    init: () => ({}),
    tick: () => null,
    event(def, st, e) {
      if (e.type !== def.event) return null;
      if (def.match) for (const k of Object.keys(def.match)) if (e[k] !== def.match[k]) return null;
      return 'done';
    },
    targets: (def, st, out) => def.at && out.push({ x: def.at.x, z: def.at.z, r: def.at.r ?? 12, kind: 'ring' }),
    hud: () => '',
  },

  // ---- drive some metres (the tutorial's first step) -------------------------------------------------------------------------
  drive: {
    init: () => ({ last: null, metres: 0 }),
    tick(def, st, dt, s) {
      if (st.last == null) st.last = s.distance;
      st.metres += Math.max(0, s.distance - st.last);
      st.last = s.distance;
      return st.metres >= def.metres ? 'done' : null;
    },
    targets: () => {},
    hud: (def, st) => `${Math.max(0, Math.round(def.metres - st.metres))} m`,
  },

  // ---- beat a real metro train to a station ------------------------------------------------------------------------------------
  trainRace: {
    init: () => ({ eta: 0, dist: 0 }),
    tick(def, st, dt, s, env) {
      const tr = env?.trains?.[def.trainIdx];
      if (tr) {
        st.dist = hyp(tr.x - def.station.x, tr.z - def.station.z);
        st.eta = st.dist / Math.max(6, tr.speed || 16);
        if (st.dist < (def.arriveR ?? 24)) return { fail: 'train' };
      }
      return hyp(s.x - def.x, s.z - def.z) <= (def.r ?? 14) ? 'done' : null;
    },
    targets: (def, st, out) => out.push({ x: def.x, z: def.z, r: def.r ?? 14, kind: 'ring' }),
    hud: (def, st) => (st.dist ? `The train is ${Math.round(st.dist)} m from the platform` : ''),
  },
};

export const STEP_TYPES = Object.keys(HANDLERS);
const handlerOf = (def) => HANDLERS[def?.type] || HANDLERS.event;

export const initStep = (def) => handlerOf(def).init(def);
/** Advance one step by dt. Returns null | 'done' | { fail }. */
export const tickStep = (def, st, dt, sample, env) => handlerOf(def).tick(def, st, dt, sample, env);
/** Feed a bus event to the step. Returns null | 'done' | { fail }. */
export const eventStep = (def, st, e) => handlerOf(def).event?.(def, st, e) ?? null;
/** Push what the markers and minimap should show for the step into `out` ([{ x, z, r, kind }]). */
export function targetsOf(def, st, out) {
  out.length = 0;
  handlerOf(def).targets?.(def, st, out);
  return out;
}
export const hudOf = (def, st, sample) => handlerOf(def).hud?.(def, st, sample) || '';
