// Reconciles the engine state with the 3D objects, FIRST PERSON: customers walking in from the street, standing across the counter
// looking at the cook (the camera) with mood / patience / speech, dishes on the counter in front of them, the OTHER cooks as full avatars
// on the line, station slots + emitters, the local cook's own walker (the camera follows it) and viewmodel, and the one-shot animations
// that events trigger. Thin: the maths lives in interp.js / camera.js. Objects and animation outside the view are skipped.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, Frustum, Matrix4, Sphere } from 'three';
import { LAYOUT, STATIONS } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS, standX } from '../../../../shared/tiffin-centre/movement.js';
import { buildDish, buildCustomer, buildAvatar } from '../models/index.js';
import {
  clamp, lerp, easeInOut, angleDamp, tickFrac, patienceFrac, payFrac, slotVisual, moodOf, arrivalStart, departureEnd, hashSeed,
  laneOffset, stepAvatarX, workForEvent, actionSeqFor, crowdOffset, avatarColor,
} from './interp.js';
import { shade } from './kit.js';
import { createActionPlayer, loadViewmodel } from './vm.js';
import { boxAt } from './picking.js';

const PI = Math.PI;
export const PLATE_Z = LAYOUT.counterZ + 0.1; // dishes served to a customer stand on the counter just inside its customer-side edge
const AIM_HOLD = 1.3; // seconds the head stays on the work after the walk / the hands stop
const CULL_STEP = 0.25; // an off-screen character still advances this often

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
      model = buildCustomer(c.kind, hashSeed(`${c.id}:${c.name}`));
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
      mood: '', pat: -1, yaw: 0, leave: null, stompDone: false, acc: 0, seen: true,
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
  };
  function updateStations(dt, tickF) {
    if (!st) return;
    for (const [sid, s] of stall.stations) {
      if (!s.prop) continue;
      const data = st.stations?.[sid];
      if (!data) continue;
      const near = inView(s.group.position.x, 1.1, s.group.position.z, 1.1); // emit only where it can be seen (the pool is small)
      for (let i = 0; i < data.slots.length; i++) {
        const vis = slotVisual(data.slots[i], tickF);
        const key = `${sid}:${i}`;
        const c = slotCache.get(key);
        if (!c || c.st !== vis.st || c.dish !== vis.dish || Math.abs(c.progress - vis.progress) > 0.01 || Math.abs(c.burnFrac - vis.burnFrac) > 0.02) {
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

  // --- API -------------------------------------------------------------------------------------------------------------------------------------------
  function setState(next, at) {
    const prev = st;
    st = next;
    tickAt = at ?? performance.now();
    if (!st) return;
    if (!prev || prev.cfg?.stations?.join() !== st.cfg?.stations?.join()) {
      stall.setStations(st.cfg?.stations || []);
      slotCache.clear();
    }
    stall.setSpots(st.cfg?.spots ?? LAYOUT.spots);
    stall.setMenu(st.cfg?.menu);
    const snap = !first.done; // first state of this scene: customers already standing there are not walked in again
    first.done = true;
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

  const meHands = [];
  /** Per frame, AFTER the camera rig: positions, animation of what is in view, the viewmodel. `look` = the head's change this frame. */
  function update(dt, t, now, look) {
    refreshView();
    const frac = tickFrac(now, tickAt);
    const tickF = (st?.tick || 0) + frac;
    updateStations(dt, tickF);
    actions.update(dt, onActionFrame);
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
        const s = stall.stations.get(target.id ?? target.station);
        if (!s) return 0;
        centre.set(s.group.position.x, 1.0, s.group.position.z + 0.3);
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
    for (const e of customers.values()) e.model.dispose?.();
    for (const a of avatars.values()) a.model?.dispose?.();
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
