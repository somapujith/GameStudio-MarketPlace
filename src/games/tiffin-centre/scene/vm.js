// First-person hands: loading the viewmodel from the models (with a tiny stand-in while that file is being rebuilt) and the pure
// action player that turns an event's sequence into (kind, t01) frames for the viewmodel AND the station prop.
import { Group, Mesh, CapsuleGeometry, MeshStandardMaterial } from 'three';
import * as models from '../models/index.js';
import { sampleSeq } from './interp.js';

/** A pool of running action sequences. Nothing is allocated after construction (`start` reuses slots). */
export function createActionPlayer(size = 12) {
  const pool = [];
  for (let i = 0; i < size; i++) pool.push({ on: false, seq: null, el: 0, station: null, slot: 0, who: null, id: 0 });
  const frame = { kind: null, t01: 0, done: true };
  let next = 0;
  let ids = 0;
  return {
    /** Start `seq` for `who` (a player id) at a station slot; a running sequence of the same `who` is replaced. Returns the play. */
    start(seq, who, station = null, slot = 0) {
      if (!seq || !seq.length) return null;
      let p = null;
      for (let i = 0; i < pool.length; i++) if (pool[i].on && pool[i].who === who) p = pool[i];
      if (!p) {
        for (let i = 0; i < pool.length; i++) {
          if (!pool[i].on) {
            p = pool[i];
            break;
          }
        }
      }
      if (!p) {
        p = pool[next];
        next = (next + 1) % pool.length;
      }
      p.on = true;
      p.seq = seq;
      p.el = 0;
      p.station = station;
      p.slot = slot;
      p.who = who;
      p.id = ++ids;
      return p;
    },
    /** Stop a player's sequence (e.g. they started walking). Returns true when one was running. */
    cancel(who) {
      let any = false;
      for (let i = 0; i < pool.length; i++) {
        if (pool[i].on && pool[i].who === who) {
          pool[i].on = false;
          any = true;
        }
      }
      return any;
    },
    active(who) {
      for (let i = 0; i < pool.length; i++) if (pool[i].on && pool[i].who === who) return true;
      return false;
    },
    /** Advance every sequence; fn(play, kind, t01, done) per running one. The last call of a sequence has done = true (t01 = 1). */
    update(dt, fn) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.on) continue;
        p.el += dt;
        sampleSeq(p.seq, p.el, frame);
        if (frame.done) p.on = false;
        fn(p, frame.kind, frame.t01, frame.done);
      }
    },
    get size() {
      return pool.length;
    },
  };
}

/** A minimal stand-in for models.buildViewmodel (two forearms that reach forward with the action) so the view is never handless. */
function fallbackViewmodel() {
  const group = new Group();
  const geo = new CapsuleGeometry(0.035, 0.34, 3, 8);
  const mat = new MeshStandardMaterial({ color: '#b9825a', roughness: 0.8 });
  const arms = [-1, 1].map((s) => {
    const m = new Mesh(geo, mat);
    m.rotation.x = Math.PI / 2 - 0.35;
    group.add(m);
    return { m, s };
  });
  let act = null;
  let ph = 0;
  const api = {
    group,
    setAction(kind, phase01 = 0) {
      act = kind;
      ph = phase01;
    },
    setHands() {},
    setLookDelta() {},
    update(dt, t) {
      const k = act ? Math.sin(Math.min(1, ph) * Math.PI) : 0;
      for (const a of arms) {
        a.m.position.set(a.s * (0.2 - k * 0.07), -0.3 + k * 0.06 + Math.sin(t * 1.3 + a.s) * 0.004, -0.42 - k * 0.2);
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
    isFallback: true,
  };
  return api;
}

/** buildViewmodel() from the models when it exists (and works), else the stand-in. Every method is safe to call. */
export function loadViewmodel() {
  let vm = null;
  try {
    if (typeof models.buildViewmodel === 'function') vm = models.buildViewmodel();
  } catch (err) {
    console.error('[tiffin] buildViewmodel failed, using the stand-in', err);
  }
  if (!vm || !vm.group) vm = fallbackViewmodel();
  return vm;
}
