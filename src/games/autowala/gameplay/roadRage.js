// OWNER: traffic agent. Road rage: hit someone and the traffic chases you; escape and nothing happens, get caught and you pay.
//
//   ctx.rage = { active, heat (0..1), chasers (count), escape (0..1 progress to being free), caughtIn (0..1 progress to being caught) }
//   snapshot key `rage` (the same numbers) for the HUD
//   events (every payload carries `chasers: [{ x, z }]`, the positions of the vehicles chasing right then, and `count`):
//     rage:start { chasers, count }, rage:escaped { chasers, count }, rage:caught { fine, chasers, count },
//     rage:shout { kind, x, z, chasers, count } (an angry driver, rider, pedestrian or cow: kind is the shouter's kind; x, z where it is)
//
// The rules are the pure state machine in rage-logic.js; the chasers themselves (road graph pursuit, honking, boxing the player in)
// are driven by sim/traffic.js through ctx.traffic.recruit / release / chaseInfo. This file only wires the two together.
import { RAGE, initialRage, reduceRage, wantChasers } from './rage-logic.js';

const VEHICLE_KINDS = new Set(['car', 'auto', 'bike', 'bus', 'truck']);

export function installRoadRage(ctx) {
  let state = initialRage();
  const rage = { active: false, heat: 0, chasers: 0, escape: 0, caughtIn: 0 };
  ctx.rage = rage;
  const info = { chasers: 0, contact: 0, pairs: 0, boxGap: Infinity };
  let shoutT = 3;

  const sync = () => {
    rage.active = state.active;
    rage.heat = state.heat;
    rage.chasers = state.active ? info.chasers : 0;
    rage.escape = state.escape;
    rage.caughtIn = state.caughtIn;
  };

  /** Positions of the chasers right now (before they are released), for the stereo placement of shouts. */
  const chaserList = () => {
    const out = [];
    for (const c of ctx.traffic?.vehicles || []) if (c.mode === 'chase') out.push({ x: c.x, z: c.z });
    return out;
  };

  function apply(fx) {
    const t = ctx.traffic;
    const list = chaserList();
    if (fx.type === 'start') {
      ctx.emit('rage:start', { chasers: list, count: fx.chasers });
      ctx.toast?.("They're after you!", { tone: 'bad', icon: '!', ms: 2200 });
      shoutT = 0.6;
    } else if (fx.type === 'escaped') {
      t?.release?.(null, 25);
      ctx.emit('rage:escaped', { chasers: list, count: list.length });
      ctx.toast?.('You lost them!', { tone: 'good', ms: 2800 });
    } else if (fx.type === 'caught') {
      const fine = Math.min(fx.fine, ctx.economy?.wallet ?? fx.fine);
      if (fine > 0) ctx.economy?.spend?.(fine, 'road rage fine');
      t?.release?.(null, 40);
      ctx.toast?.(`Caught! Fined Rs ${fine}`, { tone: 'bad', icon: '!', ms: 3600 });
      try {
        ctx.fares?.penalize?.({ fareMul: 0.7, mood: -0.25, reason: 'road rage' });
      } catch (err) {
        console.error('[autowala] fares.penalize failed', err);
      }
      ctx.emit('rage:caught', { fine, chasers: list, count: fx.chasers });
    }
  }

  function dispatch(action) {
    const r = reduceRage(state, action);
    state = r.state;
    for (const fx of r.effects) apply(fx);
    sync();
  }

  const offEvents = ctx.game.on((e) => {
    if (e.type !== 'traffic:hit') return;
    const t = ctx.traffic;
    const sev = Number(e.severity) || 0;
    const vehicle = VEHICLE_KINDS.has(e.kind);
    let recruited = 0;
    const want = wantChasers(state, sev);
    if (want > 0 && t?.recruit) {
      if (t.chaseInfo) t.chaseInfo(RAGE.escapeDist, info);
      const have = state.active ? info.chasers : 0;
      recruited = t.recruit(Math.max(vehicle ? 1 : 0, want - have), e.x, e.z, { first: vehicle ? e.id : 0, radius: vehicle ? 140 : 70 });
    }
    dispatch({ type: 'hit', severity: sev, recruited });
    const list = chaserList();
    ctx.emit('rage:shout', { kind: e.kind, x: e.x, z: e.z, chasers: list, count: list.length });
  });

  ctx.addSnapshot(() => ({ rage: { active: rage.active, heat: rage.heat, chasers: rage.chasers, escape: rage.escape, caughtIn: rage.caughtIn } }));

  ctx.addSystem({
    update(dt) {
      const t = ctx.traffic;
      if (state.active && t?.chaseInfo) t.chaseInfo(RAGE.escapeDist, info);
      else {
        info.chasers = info.contact = info.pairs = 0;
        info.boxGap = Infinity;
      }
      const v = ctx.v;
      const wasActive = state.active;
      dispatch({
        type: 'tick',
        dt,
        menu: ctx.state.menu,
        paused: ctx.state.paused,
        chasers: info.chasers,
        contact: info.contact,
        boxGap: info.boxGap,
        pairs: info.pairs,
        speed: Math.hypot(v.vx, v.vz),
        wallet: ctx.economy?.wallet ?? 0,
      });
      if (!ctx.state.menu && !ctx.state.paused && wasActive && state.active) {
        // the odd angry shout from the nearest chaser
        shoutT -= dt;
        if (shoutT <= 0) {
          shoutT = 3.5 + Math.random() * 3;
          const c = nearestChaser(t, v);
          if (c) {
            const list = chaserList();
            ctx.emit('rage:shout', { kind: c.kind, x: c.x, z: c.z, chasers: list, count: list.length });
          }
        }
      }
    },
    dispose() {
      offEvents();
      ctx.traffic?.release?.(null, 0);
      ctx.rage = { active: false, heat: 0, chasers: 0, escape: 0, caughtIn: 0 };
    },
  });
}

function nearestChaser(t, v) {
  let best = null;
  let bd = 60 * 60;
  for (const c of t?.vehicles || []) {
    if (c.mode !== 'chase') continue;
    const d = (c.x - v.x) ** 2 + (c.z - v.z) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
