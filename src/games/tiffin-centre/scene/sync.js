// Reconciles the engine state with the 3D objects, FIRST PERSON: customers walking in from the street, standing across the counter
// looking at the cook (the camera) with mood / patience / speech, dishes on the counter in front of them, the OTHER cooks as full avatars
// on the line, station slots + emitters, the local cook's own walker (the camera follows it) and viewmodel, and the one-shot animations
// that events trigger. Thin: the maths lives in interp.js / camera.js. Objects and animation outside the view are skipped.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, Frustum, Matrix4, Sphere } from 'three';
import { LAYOUT, STATIONS } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS, standX } from '../../../../shared/tiffin-centre/movement.js';
import { buildDish, buildCustomer, buildAvatar } from '../models/index.js';
import { buildInspector, buildDeliveryBoy } from '../models/inspector.js';
import { buildParcelBag, buildRegularStar } from '../models/marks.js';
import * as modelsAll from '../models/index.js';
import {
  clamp, lerp, easeInOut, angleDamp, tickFrac, patienceFrac, payFrac, slotVisual, moodOf, arrivalStart, departureEnd, hashSeed,
  laneOffset, stepAvatarX, workForEvent, actionSeqFor, crowdOffset, avatarColor, hourAt,
} from './interp.js';
import { shade } from './kit.js';
import { createActionPlayer, loadViewmodel } from './vm.js';
import { boxAt } from './picking.js';
import {
  eventFlags, eventOf, gasView, panView, customerMarks, inspectorPos, deliveryBikePos, offKey,
} from './ops-view.js';
import { createEventsFx, makeLevels, stepLevels } from './events-fx.js';
import { createWeather } from './weather.js';

const PI = Math.PI;
/** 0 (day) .. 1 (night) from the clock hour: dusk 18..19.5, dawn 4.6..6. */
export const nightOf = (h) => {
  const x = ((h % 24) + 24) % 24;
  if (x >= 12) return clamp((x - 18) / 1.5, 0, 1);
  return clamp((6 - x) / 1.4, 0, 1);
};
export const PLATE_Z = LAYOUT.counterZ + 0.1; // dishes served to a customer stand on the counter just inside its customer-side edge
const AIM_HOLD = 1.3; // seconds the head stays on the work after the walk / the hands stop
const CULL_STEP = 0.25; // an off-screen character still advances this often
const TEND_S = 0.8; // how long the pad, skimmer or jug of a `tend` beat works
const INSPECT_LINGER_S = 1.1; // the inspector shows his verdict this long before he leaves

export function createSync({ scene, camera, stall, fx, art, tr, quality, reducedMotion, onShake }) {
  const root = new Group();
  root.name = 'actors';
  scene.add(root);

  let st = null;
  let tickAt = null;
  let meId = null;
  let clock = 0;
  let reduced = !!reducedMotion;
  const arriveListeners = new Set();
  const first = { done: false };

  // --- the operations layer: events in the world ---------------------------------------------------------------------------------------------------------------
  // `world` holds the smoothed levels of rain / power cut / cricket / festival (the lighting reads them); the modules that draw them are built the first time
  // an event runs (levels 1-2 never pay for them).
  const world = makeLevels();
  const evFlags = {};
  const cueFns = new Set();
  let ev = null;
  let weather = null;
  let hasWorldFx = false;
  const nightL = { night: 0 }; // an L-like snapshot for the events (they only read .night)
  function ensureWorldFx() {
    if (hasWorldFx) return;
    hasWorldFx = true;
    try {
      ev = createEventsFx({ scene, art, tr, quality, fx, reducedMotion: reduced, levels: world });
      ev.onCue((cue) => {
        for (const fn of cueFns) fn(cue);
      });
    } catch (err) {
      console.error('[tiffin] events fx failed', err);
      ev = null;
    }
    try {
      weather = createWeather({ scene, camera, art, tr, quality, reducedMotion: reduced, roofGaps: stall.roofGaps || [] });
    } catch (err) {
      console.error('[tiffin] weather failed', err);
      weather = null;
    }
  }
  const gv = {};
  const gvLast = { frac: -1, low: null, burners: null, swapping: null, swapT: -1 };
  const panViews = {};
  const panSig = {};
  const visTmp = {};
  const torchList = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
  let offSig = null;
  // the pad / skimmer / jug beats of `tend` events (a pool: nothing is allocated per event)
  const tends = [];
  for (let i = 0; i < 4; i++) tends.push({ on: false, station: null, kind: '', el: 0, fired: false, by: null });
  let nextTend = 0;
  const startTend = (station, kind, by) => {
    const o = tends[nextTend];
    nextTend = (nextTend + 1) % tends.length;
    o.on = true;
    o.station = station;
    o.kind = kind;
    o.el = 0;
    o.fired = false;
    o.by = by;
  };

  // --- view bookkeeping (frustum for culling) ------------------------------------------------------------------------------------------------
  const frustum = new Frustum();
  const projScreen = new Matrix4();
  const sphere = new Sphere();
  const camPos = new Vector3();
  function refreshView() {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    camPos.copy(camera.position);
  }
  const inView = (x, y, z, r) => {
    sphere.center.set(x, y, z);
    sphere.radius = r;
    return frustum.intersectsSphere(sphere);
  };

  // shared blob shadow (a cheap ground contact, so characters never float even with shadow maps off)
  const blobGeo = tr.track(new PlaneGeometry(1, 1));
  const blobM = tr.track(new MeshBasicMaterial({ map: art.blob(), transparent: true, depthWrite: false, fog: false }));
  const addBlob = (holder, size) => {
    const b = new Mesh(blobGeo, blobM);
    b.rotation.x = -PI / 2;
    b.position.y = 0.012;
    b.scale.setScalar(size);
    b.renderOrder = 1;
    holder.add(b);
    return b;
  };

  // --- dishes on plates (served, in front of the customer) --------------------------------------------------------------------------------
  const dishProto = new Map();
  const dishClone = (dish, q) => {
    const key = `${dish}|${q}`;
    let p = dishProto.get(key);
    if (!p) {
      try {
        p = buildDish(dish, q);
      } catch {
        p = new Group();
      }
      dishProto.set(key, p);
    }
    return p.clone(true);
  };

  // --- customers ---------------------------------------------------------------------------------------------------------------------------
  /** id -> entry */
  const customers = new Map();
  const tmpA = { x: 0, z: 0 };

  function makeCustomer(c, snap) {
    let model;
    try {
      // the tiffin delivery rider has his own model (a red company tee, a big red bag); everybody else is a customer of their kind
      model = c.delivery ? buildDeliveryBoy(hashSeed(`${c.id}:${c.name}`)) : buildCustomer(c.kind, hashSeed(`${c.id}:${c.name}`));
    } catch (err) {
      console.error('[tiffin] buildCustomer failed', err);
      return null;
    }
    const holder = new Group();
    holder.add(model.group);
    shade(model.group);
    addBlob(holder, 0.9);
    const plates = new Group();
    root.add(holder, plates);
    const sx = LAYOUT.spotX(c.spot);
    const e = {
      id: c.id, c, model, holder, plates, platesKey: '', spot: c.spot, sx, side: c.spot % 2 === 0 ? -1 : 1,
      phase: 'stand', t0: clock, dur: 1, fx0: sx, fz0: LAYOUT.spotZ, fx1: sx, fz1: LAYOUT.spotZ, x: sx, z: LAYOUT.spotZ,
      mood: '', pat: -1, yaw: 0, leave: null, stompDone: false, acc: 0, seen: true, bag: null, star: null,
    };
    if (!snap) arriveStart(e);
    holder.position.set(e.x, 0, e.z);
    holder.rotation.y = e.yaw;
    customers.set(c.id, e);
    return e;
  }
  function arriveStart(e) {
    arrivalStart(e.spot, tmpA);
    e.phase = 'in';
    e.t0 = clock;
    e.dur = 1.5;
    e.fx0 = tmpA.x; e.fz0 = tmpA.z;
    e.fx1 = e.sx; e.fz1 = LAYOUT.spotZ;
    e.x = e.fx0; e.z = e.fz0;
    e.yaw = Math.atan2(e.fx1 - e.fx0, e.fz1 - e.fz0);
  }

  function startLeave(e, c) {
    const outcome = c?.outcome || null;
    const kind = outcome === 'angry' ? 'angry' : outcome === 'unpaid' ? 'unpaid' : 'happy';
    e.phase = 'out';
    e.leave = kind;
    e.t0 = clock;
    e.fx0 = e.x; e.fz0 = e.z;
    departureEnd(e.spot, e.x, tmpA);
    e.fx1 = tmpA.x; e.fz1 = tmpA.z;
    e.dur = kind === 'angry' ? 2.6 : kind === 'unpaid' ? 1.6 : 2.2;
    e.stompDone = false;
    e.plates.visible = false;
    if (kind === 'unpaid') {
      fx.burst('nopay', e.x, 1.0, e.z + 0.3, 1);
      fx.floatText('No pay!', '#ff6a5a', e.x, 2.15, e.z + 0.3, { life: 1.6, rise: 0.7 });
    }
  }

  const marks = {};
  /** A packed bag in the hand of a customer who is taking away, a gold star over a regular's head (created the first time they are asked for). */
  function syncMarks(e, c) {
    customerMarks(c, marks);
    if (marks.parcel && !e.bag) {
      try {
        e.bag = buildParcelBag(e.id);
        // hung from the right hand at the hip: on the holder, so it does not ride along when that hand lifts a bite
        e.bag.group.position.set(-0.27, 0.88, 0.06);
        e.holder.add(e.bag.group);
      } catch (err) {
        console.error('[tiffin] parcel bag failed', err);
      }
    }
    if (marks.regular && !e.star) {
      try {
        e.star = buildRegularStar();
        e.star.group.position.set(0, (e.model.group.userData.height || 1.75) + 0.17, 0);
        e.star.group.scale.setScalar(1.35);
        e.holder.add(e.star.group);
      } catch (err) {
        console.error('[tiffin] regular star failed', err);
      }
    }
  }

  function setMood(e, mood) {
    if (e.mood !== mood) {
      e.mood = mood;
      e.model.setMood?.(mood);
    }
  }
  function setPat(e, v) {
    if (Math.abs(e.pat - v) > 0.004) {
      e.pat = v;
      e.model.setPatience?.(v);
    }
  }

  function updateCustomer(e, dt, t, frac, vis) {
    const h = e.holder;
    const cfg = st?.cfg;
    if (e.phase === 'in') {
      const u = clamp((clock - e.t0) / e.dur, 0, 1);
      const k = easeInOut(u);
      e.x = lerp(e.fx0, e.fx1, k);
      e.z = lerp(e.fz0, e.fz1, k);
      e.yaw = angleDamp(e.yaw, Math.atan2(e.fx1 - e.fx0, e.fz1 - e.fz0), 10, dt);
      setMood(e, 'waiting');
      gait(e, t, 1);
      if (u >= 1) e.phase = 'stand';
    } else if (e.phase === 'stand') {
      e.x = e.sx;
      e.z = LAYOUT.spotZ;
      // facing the cook: the body turns a little towards the camera (the head does the rest, via lookAt)
      const goal = vis ? Math.atan2(camPos.x - e.x, camPos.z - e.z) * 0.35 : 0;
      e.yaw = angleDamp(e.yaw, goal, 6, dt);
      gait(e, t, 0);
      const c = e.c;
      if (c) {
        setMood(e, moodOf(c));
        setPat(e, c.st === 'paying' ? payFrac(c, frac, cfg) : c.st === 'eating' ? 1 : patienceFrac(c, frac, cfg));
      }
    } else {
      // leaving: happy hop / angry stomp (still facing the cook), then turn and walk off through the street
      const el = clock - e.t0;
      const hold = e.leave === 'angry' ? 0.7 : e.leave === 'happy' ? 0.35 : 0;
      if (el < hold) {
        const k = el / hold;
        e.yaw = angleDamp(e.yaw, 0, 10, dt);
        e.model.group.position.y = e.leave === 'happy' ? Math.sin(k * PI) * 0.12 : Math.abs(Math.sin(k * PI * 3)) * 0.08;
        e.model.group.rotation.z = e.leave === 'angry' ? Math.sin(k * PI * 6) * 0.08 : 0;
        setMood(e, e.leave === 'angry' ? 'angry' : 'happy');
        setPat(e, e.leave === 'angry' ? 0 : 1);
        if (e.leave === 'angry' && !e.stompDone) {
          e.stompDone = true;
          fx.burst('angry', e.x, 1.75, e.z + 0.2, 1);
          fx.burst('dust', e.x, 0.05, e.z, 1);
          onShake?.(0.12);
        }
      } else {
        const u = clamp((el - hold) / Math.max(0.1, e.dur - hold), 0, 1);
        const k = e.leave === 'unpaid' ? u : u * u * (3 - 2 * u);
        e.x = lerp(e.fx0, e.fx1, k);
        e.z = lerp(e.fz0, e.fz1, k);
        e.yaw = angleDamp(e.yaw, Math.atan2(e.fx1 - e.fx0, e.fz1 - e.fz0), 9, dt);
        setMood(e, e.leave === 'happy' ? 'happy' : 'walkaway');
        gait(e, t, e.leave === 'unpaid' ? 1.7 : e.leave === 'angry' ? 1.3 : 1);
        if (e.leave === 'angry' && vis && Math.sin(t * 9) > 0.96) fx.burst('dust', e.x, 0.03, e.z, 0.3);
      }
    }
    h.position.set(e.x, 0, e.z);
    h.rotation.y = e.yaw;
    if (e.star && vis) e.star.update(dt, t);
  }
  function gait(e, t, speed) {
    const g = e.model.group;
    if (speed > 0) {
      g.position.y = Math.abs(Math.sin(t * 9 * speed)) * 0.05;
      g.rotation.z = Math.sin(t * 9 * speed) * 0.04;
    } else {
      g.position.y = 0;
      g.rotation.z = 0;
    }
  }

  const counterY = () => stall.counterY ?? 0.99;
  function syncPlates(e, c) {
    const show = c.st === 'waiting' || c.st === 'eating';
    const key = show ? `${c.got.join(',')}|${(c.qs || []).join(',')}` : '';
    if (key === e.platesKey) return;
    e.platesKey = key;
    for (const ch of [...e.plates.children]) e.plates.remove(ch);
    if (!show) return;
    const n = c.got.length;
    c.got.forEach((d, i) => {
      const o = dishClone(d, (c.qs && c.qs[i]) || 'good');
      o.position.set(e.sx + (i - (n - 1) / 2) * 0.4, counterY(), PLATE_Z);
      o.scale.setScalar(0.8);
      e.plates.add(o);
    });
  }

  // --- the GHMC inspector: walks up to the end of the counter when the event starts, shows his verdict when the check comes, walks off when it ends ---------------
  const inspector = (() => {
    let model = null;
    let holder = null;
    let phase = 'none'; // none | in | stand | verdict | out
    let t0 = 0;
    let dur = 1.4;
    let x = 0;
    let z = 0;
    let x0 = 0;
    let z0 = 0;
    let x1 = 0;
    let z1 = 0;
    let yaw = 0;
    let verdict = null;
    let acc = 0;
    const pos = { x: 0, z: 0 };
    const from = { x: 0, z: 0 };
    const make = () => {
      if (model) return true;
      try {
        model = buildInspector(7);
      } catch (err) {
        console.error('[tiffin] buildInspector failed', err);
        return false;
      }
      holder = new Group();
      holder.add(model.group);
      shade(model.group);
      addBlob(holder, 0.9);
      root.add(holder);
      return true;
    };
    const api = {
      get phase() {
        return phase;
      },
      get x() {
        return x;
      },
      get z() {
        return z;
      },
      get model() {
        return model;
      },
      get verdict() {
        return verdict;
      },
      /** The event is running: arrive (walk in, or stand there at once when `snap` = we joined late). */
      arrive(spots, snap) {
        if (phase === 'in' || phase === 'stand' || phase === 'verdict') return;
        if (!make()) return;
        inspectorPos(spots, pos);
        arrivalStart(Math.max(0, (spots | 0) - 1), from);
        x1 = pos.x;
        z1 = pos.z;
        verdict = null;
        model.setMood('waiting');
        if (snap) {
          phase = 'stand';
          x = x1;
          z = z1;
          yaw = 0;
        } else {
          phase = 'in';
          t0 = clock;
          dur = 1.8;
          x0 = from.x + 1.2;
          z0 = from.z;
          x = x0;
          z = z0;
          yaw = Math.atan2(x1 - x0, z1 - z0);
        }
        holder.visible = true;
        holder.position.set(x, 0, z);
      },
      /** The check is done: thumbs-up or a stern finger. */
      verdictIs(pass) {
        if (!model || phase === 'none' || phase === 'out') return;
        verdict = pass ? 'pass' : 'fail';
        model.setMood(pass ? 'happy' : 'angry');
        phase = 'verdict';
        t0 = clock;
      },
      /** The event is over: he walks off. */
      leave() {
        if (!model || phase === 'none' || phase === 'out') return;
        phase = 'out';
        t0 = clock;
        dur = 2.2;
        x0 = x;
        z0 = z;
        x1 = x + 3.4;
        z1 = LAYOUT.spotZ - 3.0;
        model.setMood('walkaway');
      },
      update(dt, t, vis) {
        if (!model || phase === 'none') return;
        if (phase === 'in') {
          const u = clamp((clock - t0) / dur, 0, 1);
          const k = easeInOut(u);
          x = lerp(x0, x1, k);
          z = lerp(z0, z1, k);
          if (u >= 1) {
            phase = 'stand';
            yaw = 0;
          }
        } else if (phase === 'out') {
          const u = clamp((clock - t0) / dur, 0, 1);
          const k = u * u * (3 - 2 * u);
          x = lerp(x0, x1, k);
          z = lerp(z0, z1, k);
          yaw = angleDamp(yaw, Math.atan2(x1 - x0, z1 - z0), 9, dt);
          if (u >= 1) {
            phase = 'none';
            holder.visible = false;
            return;
          }
        } else if (phase === 'verdict' && clock - t0 > INSPECT_LINGER_S * 3.2) {
          // the event is still on after the verdict: he stands about with the clipboard
          model.setMood('waiting');
          phase = 'stand';
        }
        if (phase === 'stand' || phase === 'verdict') {
          const goal = vis ? Math.atan2(camPos.x - x, camPos.z - z) * 0.5 : 0;
          yaw = angleDamp(yaw, goal, 6, dt);
        }
        holder.position.set(x, 0, z);
        holder.rotation.y = yaw;
        acc += dt;
        if (vis || acc > CULL_STEP) {
          if (vis && phase !== 'out') model.lookAt?.(camPos);
          model.update(acc, t);
          acc = 0;
        }
      },
      dispose() {
        if (holder) root.remove(holder);
        model?.dispose?.();
        model = null;
        holder = null;
        phase = 'none';
      },
    };
    return api;
  })();

  // the delivery rider's scooter, parked beside the counter while he is there
  const bike = (() => {
    let prop = null;
    let tried = false;
    const bp = { x: 0, z: 0, ry: 0 };
    return {
      set(on) {
        if (on && !prop && !tried) {
          tried = true;
          try {
            prop = modelsAll.buildStreetProp?.('scooter', { body: '#d3281c' }) ?? null;
          } catch {
            prop = null;
          }
          if (prop?.group) {
            deliveryBikePos(bp);
            prop.group.position.set(bp.x, 0, bp.z);
            prop.group.rotation.y = bp.ry;
            shade(prop.group);
            root.add(prop.group);
          }
        }
        if (prop?.group) prop.group.visible = !!on;
      },
      update(dt, t) {
        if (prop?.group?.visible) prop.update?.(dt, t);
      },
      get prop() {
        return prop;
      },
      dispose() {
        if (prop?.group) root.remove(prop.group);
        prop?.dispose?.();
        prop = null;
      },
    };
  })();

  // --- cooks: the local one is the camera (only its walker + hands live here), the others are avatars on the line ---------------------------------
  /** id -> entry (every player, me included; `model` is null for me: you never see your own body) */
  const avatars = new Map();
  const xsTmp = [];
  const off = { x: 0, z: 0 };
  let meE = null; // the local cook's entry
  let vm = null; // the viewmodel (hands), created with the first local cook
  let vmOn = true;
  const actions = createActionPlayer();

  function makeAvatar(p, idx) {
    const e = {
      id: p.id, model: null, holder: null, w: { x: standX(p.at ?? null), dir: 0, arrived: true }, z: LAYOUT.cookZ, facing: 9, pose: '',
      handsKey: '', work: null, workT: 0, workDur: WORK_MS / 1000, cheer: 0, at: p.at ?? null, idx, hands: [], handsDirty: true, acc: 0,
      aimT: 0, wasWalking: false, seed: 0,
    };
    avatars.set(p.id, e);
    ensureModel(e, p);
    return e;
  }
  /** The local cook gets no body (first person); everybody else gets a full avatar. */
  function ensureModel(e, p) {
    const mine = e.id === meId;
    if (mine) {
      if (e.model) {
        root.remove(e.holder);
        e.model.dispose?.();
        e.model = null;
        e.holder = null;
      }
      meE = e;
      ensureViewmodel();
      e.handsDirty = true;
      return;
    }
    if (e.model) return;
    let model;
    try {
      model = buildAvatar({ color: avatarColor(p, e.idx), name: p?.name || 'Cook' });
    } catch (err) {
      console.error('[tiffin] buildAvatar failed', err);
      return;
    }
    const holder = new Group();
    holder.add(model.group);
    shade(model.group);
    addBlob(holder, 1.0);
    root.add(holder);
    holder.position.set(e.w.x, 0, e.z);
    e.model = model;
    e.holder = holder;
    e.pose = '';
    e.facing = 9;
    e.handsDirty = true;
    if (meE === e) meE = null;
  }
  function ensureViewmodel() {
    if (vm) return;
    vm = loadViewmodel();
    vm.group.visible = vmOn;
    camera.add(vm.group);
  }

  function startWork(e, kind) {
    e.work = { kind };
    e.workT = e.workDur;
    e.pose = ''; // force setPose again: the model restarts the work animation on every call
  }

  /** Walkers and work timers: runs BEFORE the camera rig so the eye follows this frame's position. */
  function advance(dt) {
    clock += dt;
    stepLevels(world, evFlags, dt);
    for (const e of avatars.values()) {
      const p = st?.players?.[e.id];
      const at = p ? (p.at ?? null) : e.at;
      e.at = at;
      const arrived = stepAvatarX(e.w, standX(at), dt);
      if (arrived) for (const fn of arriveListeners) fn({ playerId: e.id, at, x: e.w.x });
      e.workT = Math.max(0, e.workT - dt);
      e.cheer = Math.max(0, e.cheer - dt);
      if (e.workT <= 0) e.work = null;
      if (e === meE) {
        if (e.w.dir !== 0 || e.workT > 0) e.aimT = AIM_HOLD;
        else e.aimT = Math.max(0, e.aimT - dt);
      }
    }
  }

  function updateAvatar(e, dt, t, laneZ, side) {
    if (!e.model) return;
    const walking = e.w.dir !== 0;
    // beside / behind the local cook when close, so nobody stands in the eyes; lanes between the others as before
    const dxm = meE ? e.w.x - meE.w.x : 9;
    crowdOffset(dxm, side, off);
    const ex = e.w.x + off.x;
    const ez = e.z + off.z + laneZ;
    e.holder.position.set(ex, 0, ez);
    const vis = inView(ex, 0.95, ez, 1.25);
    if (e.facing !== e.w.dir) {
      e.facing = e.w.dir;
      e.model.setFacing?.(e.w.dir);
    }
    const hands = e.hands;
    const pose = e.cheer > 0 ? 'cheer' : walking ? 'walk' : e.work ? `work-${e.work.kind}` : hands.length ? 'carry' : 'idle';
    if (pose !== e.pose) {
      e.pose = pose;
      e.model.setPose?.(pose);
    }
    if (e.handsDirty) {
      e.handsDirty = false;
      e.model.setHands?.(hands);
    }
    e.acc += dt;
    if (vis || e.acc > CULL_STEP) {
      e.model.update?.(e.acc, t);
      e.acc = 0;
    }
  }

  // --- station slots + emitters ------------------------------------------------------------------------------------------------------------------
  const slotCache = new Map(); // `${sid}:${i}` -> { st, dish, progress, burnFrac }
  const emitters = new Map();
  const _v = new Vector3();
  const EMIT = {
    tawa: { cooking: ['steam', 3], ready: ['steam', 1.4] },
    steamer: { cooking: ['steam', 5], ready: ['steam', 2.5] },
    kadai: { cooking: ['sizzle', 10], ready: ['oil', 2.5] },
    chai: { cooking: ['chai', 4], ready: ['chai', 1.8] },
    prep: {}, // the back counter makes its own steam and glow (the prop)
  };
  function updateStations(dt, tickF) {
    if (!st) return;
    for (const [sid, s] of stall.stations) {
      if (!s.prop) continue;
      const data = st.stations?.[sid];
      if (!data) continue;
      const near = inView(s.group.position.x, 1.1, s.group.position.z, 1.1); // emit only where it can be seen (the pool is small)
      for (let i = 0; i < data.slots.length; i++) {
        const vis = slotVisual(data.slots[i], tickF, visTmp);
        const key = `${sid}:${i}`;
        const c = slotCache.get(key);
        if (!c || c.st !== vis.st || c.dish !== vis.dish || c.item !== vis.item || c.flaw !== vis.flaw || Math.abs(c.progress - vis.progress) > 0.01 || Math.abs(c.burnFrac - vis.burnFrac) > 0.02) {
          s.prop.setSlot(i, vis);
          slotCache.set(key, c ? Object.assign(c, vis) : { ...vis });
        }
        let em = emitters.get(key);
        if (!em) {
          em = { kind: 'steam', rate: 0, acc: 0 };
          emitters.set(key, em);
        }
        const rule = EMIT[s.kind]?.[vis.st];
        if (vis.st === 'burnt') {
          em.kind = 'smoke';
          em.rate = 3;
        } else if (rule) {
          em.kind = rule[0];
          em.rate = rule[1];
        } else em.rate = 0;
        if (near && em.rate > 0 && stall.slotWorld(sid, i, _v)) fx.emit(em, _v.x, _v.y + 0.12, _v.z, dt);
      }
    }
  }

  // --- the operations layer, per tick -------------------------------------------------------------------------------------------------------------------
  /** The stock on the shelves, the condition of the pans, the events running (their levels fade in update), the inspector and the delivery boy's bike. */
  function applyOps() {
    if (!st) return;
    stall.setShelf?.(st);
    offSig = offKey(st);
    if (st.cfg?.heat) {
      for (const [sid, s] of stall.stations) {
        const data = st.stations?.[sid];
        if (!s.prop || !data || (s.kind !== 'tawa' && s.kind !== 'kadai' && s.kind !== 'steamer')) continue;
        const v = panViews[sid] || (panViews[sid] = {});
        panView(data, v);
        const sig = `${(v.glow * 50) | 0}|${(v.gunk * 50) | 0}|${(v.hot * 20) | 0}|${(v.water * 50) | 0}|${v.dry ? 1 : 0}`;
        if (panSig[sid] !== sig) {
          panSig[sid] = sig;
          stall.setPan?.(sid, v);
        }
      }
    }
    eventFlags(st, evFlags);
    if (evFlags.rain || evFlags.power || evFlags.cricket || evFlags.festival) ensureWorldFx();
    ev?.setFlags(evFlags);
    // the inspector: present for the whole of the event
    const ins = eventOf(st, 'inspector');
    if (ins) inspector.arrive(st.cfg?.spots ?? LAYOUT.spots, !first.done);
    else if (inspector.phase !== 'none' && inspector.phase !== 'out') inspector.leave();
    // the delivery boy's scooter while he stands at the counter
    let rider = false;
    for (const c of st.customers || []) if (c.delivery && c.st !== 'left') rider = true;
    bike.set(rider);
  }

  // --- API -------------------------------------------------------------------------------------------------------------------------------------------
  function setState(next, at) {
    const prev = st;
    st = next;
    tickAt = at ?? performance.now();
    if (!st) return;
    if (!prev || prev.cfg?.stations?.join() !== st.cfg?.stations?.join()) {
      stall.setStations(st.cfg?.stations || []);
      slotCache.clear();
      for (const id of Object.keys(panSig)) delete panSig[id];
    }
    stall.setSpots(st.cfg?.spots ?? LAYOUT.spots);
    stall.setMenu(st.cfg?.menu, st.off);
    applyOps();
    const snap = !first.done; // first state of this scene: customers already standing there are not walked in again
    first.done = true;
    first.snapInspector = snap;
    // customers
    const seen = new Set();
    for (const c of st.customers || []) {
      seen.add(c.id);
      let e = customers.get(c.id);
      if (!e) {
        if (c.st === 'left') continue; // never saw them: nothing to animate
        const old = st.tick - (c.arrivedAt ?? st.tick) >= 2;
        e = makeCustomer(c, snap || old);
        if (!e) continue;
      }
      e.c = c;
      if ((c.parcel || c.regular) && c.st !== 'left') syncMarks(e, c);
      if (c.st === 'left' && e.phase !== 'out') startLeave(e, c);
      else if (e.phase !== 'out') syncPlates(e, c);
    }
    for (const e of customers.values()) if (!seen.has(e.id) && e.phase !== 'out') startLeave(e, e.c ? { outcome: e.c.outcome } : null);
    // players
    const order = st.order || Object.keys(st.players || {});
    order.forEach((id, idx) => {
      const p = st.players[id];
      if (p && !avatars.has(id)) makeAvatar(p, idx);
      const a = avatars.get(id);
      if (a && p) {
        a.idx = idx;
        const hk = (p.hands || []).map((h) => `${h.dish}:${h.q}`).join(',');
        if (hk !== a.handsKey) {
          a.handsKey = hk;
          a.hands = p.hands || [];
          a.handsDirty = true;
        }
      }
    });
    for (const [id, a] of avatars) {
      if (!st.players?.[id]) {
        if (a.holder) root.remove(a.holder);
        a.model?.dispose?.();
        if (a === meE) meE = null;
        avatars.delete(id);
      }
    }
  }

  // reused by the action player's callback (no closure per frame)
  const onActionFrame = (p, kind, t01, done) => {
    if (p.station) stall.stations.get(p.station)?.prop?.playAction?.(p.slot, kind, t01);
    if (vm && p.who === meId) {
      const walking = meE ? meE.w.dir !== 0 : false;
      if (done || walking) vm.setAction?.(null, 0);
      else vm.setAction?.(kind, t01);
    }
  };

  /** Per frame: the cylinder (the change is animated across ticks), tending beats, the world's events, phone torches, the inspector. */
  function updateOps(dt, t, frac) {
    if (!st) return;
    gasView(st, frac, gv);
    if (gv.frac !== gvLast.frac || gv.low !== gvLast.low || gv.burners !== gvLast.burners || gv.swapping !== gvLast.swapping || gv.swapT !== gvLast.swapT) {
      gvLast.frac = gv.frac;
      gvLast.low = gv.low;
      gvLast.burners = gv.burners;
      gvLast.swapping = gv.swapping;
      gvLast.swapT = gv.swapT;
      stall.setGas?.(gv);
    }
    if (offSig !== offKey(st)) {
      offSig = offKey(st);
      stall.setMenu?.(st.cfg?.menu, st.off);
    }
    // the beats of tending: the pad over the iron, the skimmer over the oil, the jug over the pots, with a sizzle and a puff at the right moment
    for (let i = 0; i < tends.length; i++) {
      const o = tends[i];
      if (!o.on) continue;
      o.el += dt;
      const t01 = clamp(o.el / TEND_S, 0, 1);
      const prop = stall.stations.get(o.station)?.prop;
      prop?.playTend?.(o.kind, t01);
      if (!o.fired && t01 >= (o.kind === 'wipe' ? 0.22 : 0.45) && stall.slotWorld(o.station, 1, slotPos)) {
        o.fired = true;
        if (o.kind === 'wipe') {
          fx.burst('sizzle', slotPos.x, slotPos.y + 0.04, slotPos.z, 4);
          fx.burst('steam', slotPos.x, slotPos.y + 0.06, slotPos.z, 3);
        } else if (o.kind === 'skim') fx.burst('oil', slotPos.x, slotPos.y + 0.05, slotPos.z, 3);
        else fx.burst('steam', slotPos.x, slotPos.y + 0.2, slotPos.z, 4);
      }
      if (t01 >= 1) o.on = false;
    }
    if (hasWorldFx) {
      nightL.night = nightOf(hourAt(st, frac));
      weather?.update(dt, t, world.rain);
      if (ev) {
        let n = 0;
        if (world.power > 0.05) {
          for (const e of customers.values()) {
            if (n >= torchList.length) break;
            if (e.phase !== 'stand' || !e.c || e.c.st === 'left') continue;
            torchList[n].x = e.x + 0.22;
            torchList[n].z = e.z + 0.3;
            n++;
          }
        }
        ev.setTorches(torchList, n);
        ev.update(dt, t, nightL);
      }
    }
    bike.update(dt, t);
    if (inspector.phase !== 'none') inspector.update(dt, t, inView(inspector.x, 0.95, inspector.z, 1.25));
  }

  const meHands = [];
  /** Per frame, AFTER the camera rig: positions, animation of what is in view, the viewmodel. `look` = the head's change this frame. */
  function update(dt, t, now, look) {
    refreshView();
    const frac = tickFrac(now, tickAt);
    const tickF = (st?.tick || 0) + frac;
    updateStations(dt, tickF);
    actions.update(dt, onActionFrame);
    updateOps(dt, t, frac);
    for (const e of customers.values()) {
      const vis = inView(e.x, 0.95, e.z, 1.25);
      updateCustomer(e, dt, t, frac, vis);
      e.acc += dt;
      if (vis || e.acc > CULL_STEP) {
        if (vis && e.phase !== 'out') e.model.lookAt?.(camPos);
        e.model.update?.(e.acc, t);
        e.acc = 0;
      }
    }
    for (const [id, e] of customers) {
      if (e.phase === 'out' && clock - e.t0 >= e.dur) {
        root.remove(e.holder, e.plates);
        e.bag?.dispose?.();
        e.star?.dispose?.();
        e.model.dispose?.();
        customers.delete(id);
      }
    }
    xsTmp.length = 0;
    for (const e of avatars.values()) if (e !== meE) xsTmp.push(e.w.x);
    let i = 0;
    const meIdx = meE ? meE.idx : -1;
    for (const e of avatars.values()) {
      if (e === meE) continue;
      updateAvatar(e, dt, t, xsTmp.length > 1 ? laneOffset(i, xsTmp) : 0, e.idx < meIdx ? -1 : 1);
      i++;
    }
    if (vm) {
      if (meE?.handsDirty) {
        meE.handsDirty = false;
        meHands.length = 0;
        for (const h of meE.hands) meHands.push(h);
        vm.setHands?.(meHands);
      }
      vm.setLookDelta?.(look ? look.yaw : 0, look ? look.pitch : 0);
      vm.update?.(dt, t);
    }
  }

  const slotPos = new Vector3();
  const customerPos = (id) => customers.get(id) || null;

  function handleEvents(events) {
    if (!events) return;
    for (const ev of events) {
      const w = workForEvent(ev);
      if (w) {
        const a = avatars.get(w.by);
        if (a) {
          if (a === meE) a.aimT = AIM_HOLD;
          else startWork(a, w.kind);
        }
        const seq = actionSeqFor(ev);
        if (seq) actions.start(seq, w.by, w.station ?? null, ev.slot ?? 0);
      }
      switch (ev.type) {
        case 'cook-start': {
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) {
            const k = STATIONS[ev.station]?.kind;
            fx.burst(k === 'kadai' ? 'sizzle' : k === 'chai' ? 'chai' : 'steam', slotPos.x, slotPos.y + 0.1, slotPos.z, k === 'kadai' ? 6 : 3);
          }
          break;
        }
        case 'ready':
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('ping', slotPos.x, slotPos.y + 0.4, slotPos.z);
          break;
        case 'burnt':
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('smoke', slotPos.x, slotPos.y + 0.15, slotPos.z);
          onShake?.(0.1);
          break;
        case 'take':
        case 'burnt-cleared':
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('puff', slotPos.x, slotPos.y + 0.2, slotPos.z, 0.7);
          break;
        case 'discard':
          fx.burst('puff', stall.binPos.x, 0.9, stall.binPos.z, 1);
          stall.bumpBin();
          break;
        case 'serve': {
          const e = customerPos(ev.customer);
          if (e) fx.burst('puff', e.sx, counterY() + 0.2, PLATE_Z, 0.5);
          break;
        }
        case 'collect': {
          const e = customerPos(ev.customer);
          const x = e ? e.sx : 0;
          fx.burst('coin', x, 1.3, LAYOUT.counterZ - 0.4, 1);
          fx.floatText(`+₹${ev.amount ?? 0}`, '#ffd34d', x, 2.0, LAYOUT.spotZ + 0.3, { life: 1.5, rise: 0.9, scale: 1.1 });
          if (ev.tip > 0) fx.floatText(`tip +₹${ev.tip}`, '#9dff9d', x, 1.8, LAYOUT.spotZ + 0.3, { life: 1.4, rise: 0.8, scale: 0.8, delay: 0.25 });
          const a = avatars.get(ev.by);
          if (a && a !== meE) a.cheer = 1.0;
          break;
        }
        case 'prep-start':
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('puff', slotPos.x, slotPos.y, slotPos.z, 0.6);
          break;
        case 'prep-done':
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('ping', slotPos.x, slotPos.y + 0.12, slotPos.z);
          break;
        case 'prep-collect':
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('puff', slotPos.x, slotPos.y + 0.1, slotPos.z, 0.7);
          break;
        case 'tend':
          startTend(ev.station, ev.kind === 'skim' ? 'skim' : ev.kind === 'water' ? 'water' : 'wipe', ev.by);
          break;
        case 'heat-warning':
          if (stall.slotWorld(ev.station, 1, slotPos)) {
            fx.burst(ev.band === 'hot' ? 'smoke' : 'steam', slotPos.x, slotPos.y + 0.1, slotPos.z, 0.8);
            if (ev.band === 'hot') onShake?.(0.05);
          }
          break;
        case 'gas-low':
          fx.floatText('Gas low', '#ffb02e', LAYOUT.gas.x, 1.15, LAYOUT.gas.z, { life: 1.8, rise: 0.4, scale: 0.9 });
          break;
        case 'gas-out':
          fx.burst('puff', LAYOUT.gas.x, 0.7, LAYOUT.gas.z, 1.2);
          fx.floatText('NO GAS', '#ff6a5a', LAYOUT.gas.x, 1.2, LAYOUT.gas.z, { life: 2.2, rise: 0.4, scale: 1.1 });
          onShake?.(0.12);
          break;
        case 'gas-swap':
          if (ev.phase === 'start') fx.floatText('New cylinder...', '#ffd34d', LAYOUT.gas.x, 1.15, LAYOUT.gas.z, { life: 2.2, rise: 0.3, scale: 0.9 });
          else fx.burst('sparkle', LAYOUT.gas.x, 0.7, LAYOUT.gas.z, 1);
          break;
        case 'inspector': {
          inspector.verdictIs(!!ev.pass);
          const ix = inspector.x || 3.6;
          const iz = inspector.z || LAYOUT.spotZ;
          fx.floatText(ev.pass ? `PASSED  +\u20b9${ev.bonus ?? 0}` : `FINE  -\u20b9${ev.fine ?? 0}`, ev.pass ? '#9dff9d' : '#ff6a5a', ix, 2.2, iz, { life: 2.2, rise: 0.6, scale: 1.2 });
          fx.burst(ev.pass ? 'sparkle' : 'angry', ix, 1.7, iz, 1.2);
          if (!ev.pass) onShake?.(0.15);
          break;
        }
        case 'customer-arrive':
          break;
        case 'customer-angry':
        case 'life-lost':
          onShake?.(ev.type === 'life-lost' ? 0.35 : 0.15);
          break;
        case 'customer-unpaid':
          onShake?.(0.12);
          break;
        case 'pay-warning': {
          const e = customerPos(ev.customer);
          if (e) fx.burst('ring', e.sx, 1.3, LAYOUT.counterZ - 0.5, 1);
          break;
        }
        case 'pay-ready': {
          const e = customerPos(ev.customer);
          if (e) fx.burst('sparkle', e.sx, 1.3, LAYOUT.counterZ - 0.5, 0.6);
          break;
        }
        case 'combo':
          if (!(ev.combo >= 2)) break;
          fx.burst('sparkle', meE ? meE.w.x : 0, 1.9, LAYOUT.counterZ + 0.2, 2);
          fx.floatText(`COMBO x${ev.combo}`, '#ff9a3a', meE ? meE.w.x : 0, 2.2, LAYOUT.counterZ - 0.3, { life: 1.6, rise: 0.8, scale: 1.2 });
          break;
        case 'emote': {
          const a = avatars.get(ev.by);
          const icon = { thumbs: '👍', fire: '🔥', help: '🆘', thanks: '🙏' }[ev.e] || '';
          if (a && icon) fx.floatText(icon, '#ffffff', a.w.x, 2.3, a.z, { life: 1.6, rise: 0.7, scale: 0.9 });
          break;
        }
        case 'shift-end':
          for (let i = 0; i < 4; i++) fx.burst('confetti', lerp(-3.5, 3.5, i / 3), 2.8, LAYOUT.spotZ + 0.3, 1);
          break;
        default:
          break;
      }
    }
  }

  // --- targets: anchors for highlight / project / pick / lookAt --------------------------------------------------------------------------------------
  /** Fill centre (aim point, ring centre) and top (bubble anchor) for a target; returns the ring radius (m) or 0. */
  function resolve(target, centre, top) {
    if (!target) return 0;
    switch (target.kind) {
      case 'station': {
        const sid = target.id ?? target.station;
        if (sid === 'gas') {
          // the LPG stand at the end of the line (behind the cook's left)
          centre.set(LAYOUT.gas.x, 0.55, LAYOUT.gas.z);
          top.set(centre.x, 1.1, centre.z);
          return 0.5;
        }
        const s = stall.stations.get(sid);
        if (!s) return 0;
        // a station's front faces the cook (+0.3 towards them); the back counter's front faces the other way
        centre.set(s.group.position.x, 1.0, s.group.position.z + 0.3 * (s.front ?? 1));
        top.set(centre.x, 1.55, centre.z);
        return 0.62;
      }
      case 'slot': {
        const sid = target.station ?? target.id;
        if (!stall.slotWorld(sid, target.slot ?? 0, centre)) return 0;
        centre.y += 0.06;
        top.set(centre.x, centre.y + 0.4, centre.z);
        return 0.26;
      }
      case 'customer': {
        const e = customers.get(target.id);
        if (!e) return 0;
        centre.set(e.x, 1.25, e.z);
        top.set(e.x, 2.0, e.z);
        return 0.6;
      }
      case 'bin':
        centre.set(stall.binPos.x, 0.8, stall.binPos.z);
        top.set(centre.x, 1.3, centre.z);
        return 0.5;
      case 'hands': {
        // your own hands, low in the picture: a point in front of the lens
        camera.updateMatrixWorld();
        centre.set(0, -0.32, -0.75).applyMatrix4(camera.matrixWorld);
        top.set(0, -0.12, -0.75).applyMatrix4(camera.matrixWorld);
        return 0.34;
      }
      default:
        return 0;
    }
  }

  /** The point the head should lead towards for a player's `at` (station / customer spot / bin), or false. */
  function aimPointFor(at, out) {
    if (at === null || at === undefined) return false;
    if (at === 'bin') {
      out.x = stall.binPos.x;
      out.y = 0.85;
      out.z = stall.binPos.z;
      return true;
    }
    if (at === 'gas') {
      out.x = LAYOUT.gas.x;
      out.y = 0.55;
      out.z = LAYOUT.gas.z;
      return true;
    }
    if (typeof at === 'string' && Object.hasOwn(STATIONS, at)) {
      const s = STATIONS[at];
      out.x = s.x;
      out.y = 0.95;
      out.z = s.z + 0.1;
      return true;
    }
    const m = typeof at === 'string' ? /^spot:(\d)$/.exec(at) : null;
    if (m) {
      out.x = LAYOUT.spotX(Number(m[1]));
      out.y = 1.5;
      out.z = LAYOUT.spotZ;
      return true;
    }
    return false;
  }

  // --- picking ---------------------------------------------------------------------------------------------------------------------------------------
  let proxyCache = null;
  let proxyAt = -1e9;
  /** Invisible hit proxies in world metres (see picking.js) + big boxes for the raycast fallback. Cached for a moment: pointer-move picks are frequent. */
  function buildProxies(now = performance.now()) {
    if (proxyCache && now - proxyAt < 120) return proxyCache;
    proxyAt = now;
    const out = [];
    const boxes = [];
    for (const [sid, s] of stall.stations) {
      if (!s.prop) continue;
      const data = st?.stations?.[sid];
      const n = data ? data.slots.length : s.anchors.length;
      for (let i = 0; i < n; i++) {
        const p = stall.slotWorld(sid, i, new Vector3());
        if (!p) continue;
        out.push({ kind: 'slot', target: { kind: 'slot', station: sid, slot: i }, a: { x: p.x, y: p.y + 0.05, z: p.z }, radius: 0.2 });
      }
      const g = s.group.position;
      out.push({ kind: 'station', target: { kind: 'station', station: sid }, a: { x: g.x, y: 0.95, z: g.z + 0.3 }, radius: 0.62 });
      boxes.push({ target: { kind: 'station', station: sid }, box: boxAt(g.x, 0.7, g.z, 0.68, 0.7, 0.5) });
    }
    for (const e of customers.values()) {
      if (e.phase !== 'stand' || !e.c || e.c.st === 'left') continue;
      out.push({ kind: 'customer', target: { kind: 'customer', id: e.id }, a: { x: e.x, y: 0.95, z: e.z }, b: { x: e.x, y: 1.7, z: e.z }, radius: 0.3 });
      boxes.push({ target: { kind: 'customer', id: e.id }, box: boxAt(e.x, 0.9, e.z, 0.4, 0.9, 0.35) });
    }
    if (st?.cfg?.gas) {
      out.push({ kind: 'station', target: { kind: 'station', station: 'gas' }, a: { x: LAYOUT.gas.x, y: 0.5, z: LAYOUT.gas.z }, radius: 0.5 });
      boxes.push({ target: { kind: 'station', station: 'gas' }, box: boxAt(LAYOUT.gas.x, 0.4, LAYOUT.gas.z, 0.25, 0.4, 0.25) });
    }
    out.push({ kind: 'bin', target: { kind: 'bin' }, a: { x: stall.binPos.x, y: 0.5, z: stall.binPos.z }, radius: 0.5 });
    boxes.push({ target: { kind: 'bin' }, box: boxAt(stall.binPos.x, 0.5, stall.binPos.z, 0.45, 0.5, 0.45) });
    out.boxes = boxes;
    proxyCache = out;
    return out;
  }

  function dispose() {
    scene.remove(root);
    if (vm) {
      camera.remove(vm.group);
      vm.dispose?.();
      vm = null;
    }
    for (const e of customers.values()) {
      e.bag?.dispose?.();
      e.star?.dispose?.();
      e.model.dispose?.();
    }
    for (const a of avatars.values()) a.model?.dispose?.();
    inspector.dispose();
    bike.dispose();
    ev?.dispose?.();
    weather?.dispose?.();
    customers.clear();
    avatars.clear();
    for (const p of dishProto.values()) p.traverse?.((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      ms.forEach((m) => m.dispose?.());
    });
    dishProto.clear();
  }

  return {
    setState,
    advance,
    update,
    handleEvents,
    resolve,
    aimPointFor,
    buildProxies,
    dispose,
    setMe(id) {
      meId = id || null;
      meE = null;
      for (const e of avatars.values()) ensureModel(e, st?.players?.[e.id]);
    },
    setViewmodel(on) {
      vmOn = !!on;
      if (vm) vm.group.visible = vmOn;
    },
    setReducedMotion(b) {
      reduced = !!b;
      ev?.setReduced?.(b);
      weather?.setReduced?.(b);
    },
    /** The smoothed levels of the events (0..1 each): { rain, power (how far the mains are cut), cricket, festival }: the lighting reads them. */
    world,
    /** fn({ type: 'power' | 'generator', on }) for the audio (the cut itself, and the neighbour's generator a moment later). Returns an unsubscribe. */
    onCue(fn) {
      cueFns.add(fn);
      return () => cueFns.delete(fn);
    },
    get inspector() {
      return inspector;
    },
    get worldFx() {
      return { ev, weather };
    },
    /** Make a customer's mouth move for `ms` (the dialogue director calls this when a line starts). */
    speak(id, ms, intensity = 1) {
      customers.get(id)?.model.setSpeaking?.(ms, intensity);
    },
    /** The local cook's walker: { x, dir } or null (no such player: the eye stays at the home x). */
    me: () => meE?.w ?? null,
    /** Where the head should lead right now (the local cook is walking to / working at something), or false. */
    autoAim(out) {
      if (!meE || meE.aimT <= 0) return false;
      return aimPointFor(meE.at, out);
    },
    meAt: () => meE?.at ?? null,
    getAvatarX: (id) => avatars.get(id)?.w.x ?? null,
    onAvatarArrive: (fn) => {
      arriveListeners.add(fn);
      return () => arriveListeners.delete(fn);
    },
    get viewmodel() { return vm; },
    /** For tests / tuning: the live actor entries. */
    get actors() { return { customers, avatars }; },
    get state() { return st; },
    get reduced() { return reduced; },
  };
}
