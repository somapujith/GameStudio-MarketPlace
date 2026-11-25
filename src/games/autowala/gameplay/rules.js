// OWNER: rules agent. Hyderabad road rules the player can break and be fined for. See ARCHITECTURE.md (Addendum 3).
//
//   ctx.signals   the signal controller traffic obeys (world/signal-logic.js): stateOf(edgeId, dir), mustStop(...), state(ai), left(ai)
//   ctx.rules = { signals (junctions), cameras, schools, checkpoints, limitAt(x, z) -> km/h, violations[], fines (count), heat 0..1,
//                 wanted }
//   events   rule:violation { kind: 'signal'|'speed'|'checkpoint'|'docs', fine, x, z, label }   (every challan)
//            rule:fined     { kind, fine, x, z }                                                 (money really taken)
//            expense        { kind: 'challan', amount }
//   snapshot key `rules`: { limit, zone: 'school'|'city'|'fast', speeding, signalAhead, cameraAhead, checkpoint, heat, wanted, fines, lastFine }
//     signalAhead: null | { state: 'red'|'yellow'|'green', dist (m to the stop line), left (s until it changes), watched: 'cop'|'cam'|null }
//     cameraAhead: null | { dist, limit }       checkpoint: null | { phase: 'near'|'stopped'|'checking', dist }
//
// Fines are paid from ctx.economy.spend (capped by the wallet); a customer on board pays less (ctx.fares.penalize), like road rage.
// Guardrail contacts (`crash` with guard: true) and pavement driving are never offences. Everything timed stands ON a road.
import { buildSignals } from '../world/signals.js';
import { SIGNAL, createSignalController, createSignalPlan } from '../world/signal-logic.js';
import {
  RULES, addHeat, createCooldowns, crossedEither, crossedLine, decayHeat, initialCheckpoint, isWanted, limitAtPoint, payable,
  reduceCheckpoint, speedFine,
} from './rule-logic.js';
import { planRuleSites, edgePoint } from './rule-sites.js';
import { buildRuleArt } from './rule-art.js';

const STATE_NAME = ['red', 'yellow', 'green'];
const SEEN_NOTHING = 'Phew, nobody was watching';

export function installRules(ctx) {
  const city = ctx.world.city;
  const P = ctx.v;
  const plan = createSignalPlan(city);
  const signals = createSignalController(plan, () => ctx.clock.time);
  ctx.signals = signals; // traffic reads this lazily every frame
  const sites = planRuleSites(city, plan.nodes);
  const schools = sites.schools;

  let signalArt = null;
  let art = null;
  try {
    signalArt = buildSignals(ctx.scene, plan);
    art = buildRuleArt(ctx.scene, sites, city);
  } catch (err) {
    console.error('[autowala] rules art failed', err);
  }

  const cooldowns = createCooldowns();
  const violations = [];
  let heat = 0;
  let fineCount = 0;
  let lastFine = null;
  const cps = sites.checkpoints.map((c) => ({ c, st: initialCheckpoint(), prevAlong: NaN, dist: Infinity }));
  const prevDD = new Float32Array(plan.approaches.length).fill(NaN);
  const prevAlong = new Float32Array(sites.cameras.length).fill(NaN);
  const told = new Map(); // approach id -> time of the last "red light ahead" toast
  let limit = { limit: RULES.limits.city, zone: 'city' };
  let limitT = 0;
  const ahead = { signal: null, camera: null, checkpoint: null };

  const rules = {
    signals: plan.nodes,
    cameras: sites.cameras,
    schools,
    checkpoints: sites.checkpoints,
    violations,
    fines: 0,
    heat: 0,
    wanted: false,
    limitAt: (x, z) => limitAtPoint(city, schools, x, z).limit,
  };
  ctx.rules = rules;

  // the screen flash of a camera: a white overlay over the game for a moment (an element style, no stylesheet needed)
  let flashEl = null;
  let flashT = 0;
  try {
    const host = ctx.gfx?.renderer?.domElement?.parentElement;
    if (host && typeof document !== 'undefined') {
      flashEl = document.createElement('div');
      const s = flashEl.style;
      s.position = 'absolute';
      s.inset = '0';
      s.background = '#ffffff';
      s.opacity = '0';
      s.pointerEvents = 'none';
      s.zIndex = '3';
      flashEl.setAttribute('aria-hidden', 'true');
      host.appendChild(flashEl);
    }
  } catch {
    flashEl = null;
  }

  const night = () => ctx.world.sky?.state?.night ?? 0;

  /** Write a challan: spend (capped by the wallet), tell career, penalise a ride in progress, toast, remember. */
  function fine(kind, amount, label, x, z, fareMul) {
    const pay = payable(amount, ctx.economy?.wallet);
    if (pay > 0) ctx.economy?.spend?.(pay, `challan: ${label}`);
    ctx.emit('expense', { kind: 'challan', amount: pay });
    const data = { kind, fine: pay, x, z, label };
    ctx.emit('rule:violation', data);
    if (pay > 0) ctx.emit('rule:fined', { kind, fine: pay, x, z });
    fineCount++;
    rules.fines = fineCount;
    lastFine = { kind, amount: pay, label, t: ctx.clock.time };
    violations.push({ ...data, t: ctx.clock.time });
    if (violations.length > 20) violations.shift();
    ctx.toast?.(pay > 0 ? `Challan Rs ${pay}: ${label}` : `Booked: ${label} (no cash to take)`, { tone: 'bad', icon: '!', ms: 3800 });
    try {
      if (ctx.fares?.trip) ctx.fares.penalize?.({ fareMul, mood: -0.08, reason: '' });
    } catch (err) {
      console.error('[autowala] fares.penalize failed', err);
    }
    return pay;
  }

  const flash = (x, y, z) => {
    flashT = 0.28;
    art?.flash(x, y, z, ctx.camera);
  };

  // ---------------------------------------------------------------------------------------------------- signals
  function checkSignals(now, fwdX, fwdZ, speed) {
    ahead.signal = null;
    let bestD = Infinity;
    const A = plan.approaches;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      const dx = P.x - a.x;
      const dz = P.z - a.z;
      if (dx * dx + dz * dz > 7000) {
        prevDD[i] = NaN;
        continue;
      }
      const along = -(dx * a.tx + dz * a.tz); // before the junction: > 0
      const dd = along - a.k; // before the stop line: > 0
      const lat = dx * a.tz - dz * a.tx; // to the driver's left of the road's centre line
      const fwd = fwdX * a.tx + fwdZ * a.tz;
      const onRoad = lat >= -1 && lat <= a.w / 2 + 1.5;
      const st = signals.state(i);
      if (onRoad && fwd > 0.55 && dd > -3 && dd < bestD && dd < 80) {
        bestD = dd;
        ahead.signal = i;
      }
      const prev = prevDD[i];
      prevDD[i] = dd;
      if (!(speed > 1.5)) continue;
      // "red light ahead", once per approach
      if (st !== 2 && onRoad && fwd > 0.55 && dd > 4 && dd < 38 && (told.get(i) ?? -99) < now - 12) {
        told.set(i, now);
        ctx.toast?.(st === 0 ? 'Red light ahead: stop' : 'Light turning red', { tone: st === 0 ? 'bad' : 'gold', icon: '!', ms: 1800 });
      }
      if (st === 0 && crossedLine(prev, dd, lat, -1, a.w / 2 + 1.5, fwd) && signals.redSince(i) > 0.5) {
        ranRed(a, now);
      }
    }
  }

  function ranRed(a, now) {
    const key = `signal:${a.nodeId}`;
    if (!a.enf) {
      if ((told.get(`quiet${a.nodeId}`) ?? -99) < now - 20) {
        told.set(`quiet${a.nodeId}`, now);
        ctx.toast?.(SEEN_NOTHING, { tone: 'info', ms: 2000 });
      }
      return;
    }
    if (!cooldowns.ready(key, now)) return;
    cooldowns.mark(key, now, RULES.cooldown.signal);
    if (a.enf === 'cam') flash(a.px, 5.4, a.pz);
    fine('signal', RULES.fine.signal, a.enf === 'cop' ? 'ran a red light, traffic police' : 'red light camera', P.x, P.z, RULES.fareMul.signal);
    heat = addHeat(heat, RULES.heat.signal);
  }

  // ---------------------------------------------------------------------------------------------------- cameras
  function checkCameras(now, fwdX, fwdZ, speedKmh) {
    ahead.camera = null;
    const C = sites.cameras;
    let bestD = 140;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      const dx = P.x - c.x;
      const dz = P.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 160 * 160) {
        prevAlong[i] = NaN;
        continue;
      }
      const along = dx * c.dx + dz * c.dz;
      const lat = dx * c.dz - dz * c.dx;
      const travel = fwdX * c.dx + fwdZ * c.dz; // + travelling a -> b along the edge
      const onRoad = Math.abs(lat) <= c.w / 2 + 1;
      // a camera ahead: close, on my road, I am heading towards it
      const toward = travel > 0 ? -along : along;
      if (onRoad && Math.abs(travel) > 0.6 && toward > 0 && toward < bestD) {
        bestD = toward;
        ahead.camera = { dist: toward, limit: c.limit };
      }
      const prev = prevAlong[i];
      prevAlong[i] = along;
      if (!crossedEither(prev, along, lat, c.w / 2 + 2) || !(P.fwd > 1)) continue;
      const fine$ = speedFine(speedKmh, c.limit);
      const key = `cam:${c.id}`;
      if (fine$ <= 0 || !cooldowns.ready(key, now)) continue;
      cooldowns.mark(key, now, RULES.cooldown.camera);
      const e = city.edges[c.edgeId];
      const lens = edgePoint(city, e, e.len * 0.5, e.w / 2 + 0.9, travel >= 0 ? 1 : -1);
      flash(lens.x, 5.5, lens.z);
      fine('speed', fine$, `speeding ${Math.round(speedKmh)} in a ${c.limit} zone`, P.x, P.z, RULES.fareMul.speed);
      heat = addHeat(heat, RULES.heat.speed);
    }
  }

  // ---------------------------------------------------------------------------------------------------- checkpoints
  function checkCheckpoints(dt, now, speed) {
    ahead.checkpoint = null;
    const nightNow = night();
    let prompt = null;
    for (const cp of cps) {
      const c = cp.c;
      const dx = P.x - c.x;
      const dz = P.z - c.z;
      const dist = Math.hypot(dx, dz);
      cp.dist = dist;
      if (dist > 130 && cp.st.phase === 'idle') {
        cp.prevAlong = NaN;
        continue;
      }
      const along = dx * c.dx + dz * c.dz;
      const lat = dx * c.dz - dz * c.dx;
      const crossed = crossedEither(cp.prevAlong, along, lat, c.w / 2 + 2);
      cp.prevAlong = along;
      const r = reduceCheckpoint(cp.st, {
        dt, dist, speed, crossed, night: nightNow, wanted: isWanted(heat, ctx.rage?.heat), busy: false,
      });
      cp.st = r.state;
      for (const fx of r.effects) {
        if (fx.type === 'near') ctx.toast?.('Police check ahead: slow down', { tone: 'gold', icon: '!', ms: 2400 });
        else if (fx.type === 'checking') ctx.toast?.('Checking your papers...', { tone: 'info', ms: 1800 });
        else if (fx.type === 'clear') {
          ctx.toast?.('Papers in order. Carry on!', { tone: 'good', ms: 2400 });
        } else if (fx.type === 'fine-docs') {
          fine('docs', RULES.fine.docs, 'documents check, recent offences', P.x, P.z, RULES.fareMul.docs);
          heat = 0; // paid up
        } else if (fx.type === 'fine-ran') {
          fine('checkpoint', RULES.fine.ran, 'ran the police checkpoint', P.x, P.z, RULES.fareMul.ran);
          heat = addHeat(heat, RULES.heat.ran);
        }
      }
      if (cp.st.phase !== 'idle' && (!ahead.checkpoint || dist < ahead.checkpoint.dist)) {
        ahead.checkpoint = { phase: cp.st.phase, dist };
        prompt = cp.st.phase === 'checking' ? 'Hold still: the police are checking your papers' : 'Police check: slow down and stop';
      }
    }
    ctx.setPrompt?.('rules', prompt, '!');
  }

  // ---------------------------------------------------------------------------------------------------- the system
  const sys = {
    update(dt) {
      const now = ctx.clock.time;
      const n = night();
      signalArt?.update(dt, now, n);
      art?.update(dt, n);
      if (flashEl) {
        if (flashT > 0) {
          flashT -= dt;
          flashEl.style.opacity = flashT > 0 ? String(Math.round((flashT / 0.28) * 0.55 * 20) / 20) : '0';
        } else if (flashEl.style.opacity !== '0') flashEl.style.opacity = '0';
      }
      if (ctx.state.menu || ctx.state.paused) {
        prevDD.fill(NaN);
        prevAlong.fill(NaN);
        return;
      }
      heat = decayHeat(heat, dt);
      rules.heat = heat;
      rules.wanted = isWanted(heat, ctx.rage?.heat);
      const speed = Math.hypot(P.vx, P.vz);
      const fwdX = Math.sin(P.heading);
      const fwdZ = Math.cos(P.heading);
      limitT -= dt;
      if (limitT <= 0) {
        limitT = 0.25;
        limitAtPoint(city, schools, P.x, P.z, limit);
      }
      checkSignals(now, fwdX, fwdZ, speed);
      checkCameras(now, fwdX, fwdZ, P.kmh);
      checkCheckpoints(dt, now, speed);
    },
    dispose() {
      ctx.setPrompt?.('rules', null);
      signalArt?.dispose();
      art?.dispose();
      flashEl?.remove();
      ctx.signals = null;
      ctx.rules = { signals: [], cameras: [], violations: [], limitAt: () => RULES.limits.city, fines: 0 };
    },
  };
  ctx.addSystem(sys);

  ctx.addSnapshot(() => {
    let signalAhead = null;
    if (ahead.signal != null) {
      const a = plan.approaches[ahead.signal];
      const dx = P.x - a.x;
      const dz = P.z - a.z;
      signalAhead = {
        state: STATE_NAME[signals.state(ahead.signal)],
        dist: Math.max(0, Math.round(-(dx * a.tx + dz * a.tz) - a.k)),
        left: Math.round(signals.left(ahead.signal) * 10) / 10,
        watched: a.enf,
      };
    }
    return {
      rules: {
        limit: limit.limit,
        zone: limit.zone,
        speeding: P.kmh > limit.limit + RULES.speedTolerance,
        signalAhead,
        cameraAhead: ahead.camera ? { dist: Math.round(ahead.camera.dist), limit: ahead.camera.limit } : null,
        checkpoint: ahead.checkpoint ? { phase: ahead.checkpoint.phase, dist: Math.round(ahead.checkpoint.dist) } : null,
        heat: Math.round(heat * 100) / 100,
        wanted: rules.wanted,
        fines: fineCount,
        lastFine,
      },
    };
  });

  rules.stats = { signalled: plan.nodes.length, cameras: sites.cameras.length, schools: schools.length, checkpoints: cps.length, signal: SIGNAL };
}
