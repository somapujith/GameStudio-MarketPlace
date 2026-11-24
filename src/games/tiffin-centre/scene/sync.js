// Reconciles the engine state with the 3D objects: customers walking in / standing / leaving, station slots, avatars that really walk
// along the kitchen line, the glowing pay note, and the one-shot animations that events trigger. Thin: the maths lives in interp.js.
import {
  Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, AdditiveBlending, DoubleSide, Sprite, SpriteMaterial, RingGeometry,
} from 'three';
import { LAYOUT, STATIONS, PAY_WINDOW, DISHES } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS, standX } from '../../../../shared/tiffin-centre/movement.js';
import { buildDish, buildCustomer, buildAvatar } from '../models/index.js';
import {
  clamp, lerp, easeInOut, easeOutBack, angleDamp, damp, tickFrac, patienceFrac, payFrac, slotVisual, moodOf, arrivalStart, hashSeed,
  laneOffset, stepAvatarX, workForEvent, avatarColor,
} from './interp.js';
import { shade } from './kit.js';

const COUNTER_Y = 0.99;
const PI = Math.PI;

export function createSync({ scene, stall, fx, art, tr, quality, reducedMotion, onShake }) {
  const root = new Group();
  root.name = 'actors';
  scene.add(root);

  let st = null;
  let tickAt = null;
  let meId = null;
  let clock = 0;
  const arriveListeners = new Set();
  const first = { done: false };

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
  const tmpStart = { x: 0, z: 0 };

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
      mood: "", pat: -1, yaw: 0, leave: null, stompDone: false, walking: false,
    };
    if (!snap) {
      arriveStart(e);
    }
    holder.position.set(e.x, 0, e.z);
    holder.rotation.y = e.yaw;
    customers.set(c.id, e);
    return e;
  }
  function arriveStart(e) {
    arrivalStart(e.spot, tmpStart);
    e.phase = 'in';
    e.t0 = clock;
    e.dur = 1.0;
    e.fx0 = tmpStart.x; e.fz0 = tmpStart.z;
    e.fx1 = e.sx; e.fz1 = LAYOUT.spotZ;
    e.x = e.fx0; e.z = e.fz0;
  }

  function startLeave(e, c) {
    const outcome = c?.outcome || null;
    const kind = outcome === 'angry' ? 'angry' : outcome === 'unpaid' ? 'unpaid' : 'happy';
    e.phase = 'out';
    e.leave = kind;
    e.t0 = clock;
    e.fx0 = e.x; e.fz0 = e.z;
    e.fx1 = e.x + e.side * 3.4; e.fz1 = 5.6;
    e.dur = kind === 'angry' ? 2.4 : kind === 'unpaid' ? 1.3 : 1.9;
    e.stompDone = false;
    e.plates.visible = false;
    if (kind === 'unpaid') {
      fx.burst('nopay', e.x, 1.0, 1.0, 1);
      fx.floatText('No pay!', '#ff6a5a', e.x, 2.1, e.z - 0.4, { life: 1.6, rise: 0.7 });
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

  function updateCustomer(e, dt, t, frac) {
    const h = e.holder;
    const cfg = st?.cfg;
    if (e.phase === 'in') {
      const u = clamp((clock - e.t0) / e.dur, 0, 1);
      const k = easeInOut(u);
      e.x = lerp(e.fx0, e.fx1, k);
      e.z = lerp(e.fz0, e.fz1, k);
      e.yaw = angleDamp(e.yaw, Math.atan2(-(e.fx1 - e.fx0), -(e.fz1 - e.fz0)), 12, dt);
      setMood(e, 'waiting');
      gait(e, t, 1);
      if (u >= 1) {
        e.phase = 'stand';
        e.walking = false;
      }
    } else if (e.phase === 'stand') {
      e.x = e.sx;
      e.z = LAYOUT.spotZ;
      e.yaw = angleDamp(e.yaw, e.spot % 2 ? -0.38 : 0.38, 7, dt); // facing the stall, turned a little towards the camera
      gait(e, t, 0);
      const c = e.c;
      if (c) {
        setMood(e, moodOf(c));
        setPat(e, c.st === 'paying' ? payFrac(c, frac, cfg) : c.st === 'eating' ? 1 : patienceFrac(c, frac, cfg));
      }
    } else {
      // leaving: happy hop / angry stomp, then walk off through the street
      const el = clock - e.t0;
      const hold = e.leave === 'angry' ? 0.7 : e.leave === 'happy' ? 0.3 : 0;
      if (el < hold) {
        const k = el / hold;
        e.yaw = angleDamp(e.yaw, e.leave === 'angry' ? 0.3 : 0, 10, dt);
        e.model.group.position.y = e.leave === 'happy' ? Math.sin(k * PI) * 0.18 : Math.abs(Math.sin(k * PI * 3)) * 0.1;
        e.model.group.rotation.z = e.leave === 'angry' ? Math.sin(k * PI * 6) * 0.1 : 0;
        setMood(e, e.leave === 'angry' ? 'angry' : 'happy');
        setPat(e, e.leave === 'angry' ? 0 : 1);
        if (e.leave === 'angry' && !e.stompDone) {
          e.stompDone = true;
          fx.burst('angry', e.x, 1.7, e.z - 0.2, 1);
          fx.burst('dust', e.x, 0.05, e.z, 1);
          onShake?.(0.12);
        }
      } else {
        const u = clamp((el - hold) / Math.max(0.1, e.dur - hold), 0, 1);
        const k = e.leave === 'unpaid' ? u : u * u * (3 - 2 * u);
        e.x = lerp(e.fx0, e.fx1, k);
        e.z = lerp(e.fz0, e.fz1, k);
        e.yaw = angleDamp(e.yaw, Math.atan2(-(e.fx1 - e.fx0), -(e.fz1 - e.fz0)), 10, dt);
        setMood(e, e.leave === 'happy' ? 'happy' : 'walkaway');
        gait(e, t, e.leave === 'unpaid' ? 1.7 : e.leave === 'angry' ? 1.3 : 1);
        if (e.leave === 'angry' && Math.sin(t * 9) > 0.96) fx.burst('dust', e.x, 0.03, e.z, 0.3);
      }
    }
    h.position.set(e.x, 0, e.z);
    h.rotation.y = e.yaw;
    e.model.update?.(dt, t);
  }
  function gait(e, t, speed) {
    const g = e.model.group;
    if (speed > 0) {
      g.position.y = Math.abs(Math.sin(t * 9 * speed)) * 0.06;
      g.rotation.z = Math.sin(t * 9 * speed) * 0.05;
    } else {
      g.position.y = 0;
      g.rotation.z = 0;
    }
  }

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
      o.position.set(e.sx + (i - (n - 1) / 2) * 0.42, COUNTER_Y, 0.02);
      o.scale.setScalar(0.85);
      e.plates.add(o);
    });
  }

  // (the customer model holds the glowing rupee note and its shrinking halo itself; we drive it with setPatience(payFrac))

  // --- avatars -----------------------------------------------------------------------------------------------------------------------------------
  /** id -> entry */
  const avatars = new Map();
  const xsTmp = [];
  const meRing = new Mesh(tr.track(new RingGeometry(0.34, 0.42, 28)), tr.track(new MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide, fog: false })));
  meRing.rotation.x = -PI / 2;
  meRing.renderOrder = 3;
  meRing.visible = false;
  root.add(meRing);

  function makeAvatar(p, idx) {
    let model;
    try {
      model = buildAvatar({ color: avatarColor(p, idx), name: p.name || 'Cook' });
    } catch (err) {
      console.error('[tiffin] buildAvatar failed', err);
      return null;
    }
    const holder = new Group();
    holder.add(model.group);
    shade(model.group);
    addBlob(holder, 1.0);
    root.add(holder);
    const x = standX(p.at ?? null);
    const e = {
      id: p.id, model, holder, w: { x, dir: 0, arrived: true }, z: LAYOUT.cookZ, facing: 9, lane: 0, pose: '', handsKey: '', work: null, workT: 0, workDur: WORK_MS / 1000,
      cheer: 0, at: p.at ?? null, idx, hands: [], handsDirty: true,
    };
    holder.position.set(x, 0, e.z);
    avatars.set(p.id, e);
    return e;
  }

  function startWork(e, kind, station) {
    e.work = { kind, station };
    e.workT = e.workDur;
    e.pose = ''; // force setPose again: the model restarts the work animation on every call
  }

  function updateAvatar(e, dt, t, laneZ) {
    const p = st?.players?.[e.id];
    const at = p ? (p.at ?? null) : e.at;
    e.at = at;
    const tx = standX(at);
    const arrived = stepAvatarX(e.w, tx, dt);
    if (arrived) for (const fn of arriveListeners) fn({ playerId: e.id, at, x: e.w.x });
    e.z = LAYOUT.cookZ; // the model owns the lane offset (setLane) and its heading (setFacing + the pose)
    e.workT = Math.max(0, e.workT - dt);
    e.cheer = Math.max(0, e.cheer - dt);
    if (e.workT <= 0) e.work = null;
    const walking = e.w.dir !== 0;
    if (e.facing !== e.w.dir) {
      e.facing = e.w.dir;
      e.model.setFacing?.(e.w.dir);
    }
    if (Math.abs(e.lane - laneZ) > 0.004) {
      e.lane = laneZ;
      e.model.setLane?.(laneZ);
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
    e.holder.position.set(e.w.x, 0, e.z);
    e.model.update?.(dt, t);
  }

  // --- station slots + emitters ------------------------------------------------------------------------------------------------------------------
  const slotCache = new Map(); // `${sid}:${i}` -> { st, dish, progress, burnFrac }
  const emitters = new Map();
  const _v = new Vector3();
  const EMIT = {
    tawa: { cooking: ['steam', 3.5], ready: ['steam', 1.6] },
    steamer: { cooking: ['steam', 6], ready: ['steam', 3] },
    kadai: { cooking: ['sizzle', 12], ready: ['oil', 3] },
    chai: { cooking: ['chai', 5], ready: ['chai', 2.2] },
  };
  function updateStations(dt, tickF) {
    if (!st) return;
    for (const [sid, s] of stall.stations) {
      if (!s.prop) continue;
      const data = st.stations?.[sid];
      if (!data) continue;
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
          em.rate = 3.5;
        } else if (rule) {
          em.kind = rule[0];
          em.rate = rule[1];
        } else em.rate = 0;
        if (em.rate > 0 && stall.slotWorld(sid, i, _v)) fx.emit(em, _v.x, _v.y + 0.12, _v.z, dt);
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
        root.remove(a.holder);
        a.model.dispose?.();
        avatars.delete(id);
      }
    }
  }

  function update(dt, t, now) {
    clock += dt;
    const frac = tickFrac(now, tickAt);
    const tickF = (st?.tick || 0) + frac;
    updateStations(dt, tickF);
    for (const e of customers.values()) updateCustomer(e, dt, t, frac);
    for (const [id, e] of customers) {
      if (e.phase === 'out' && clock - e.t0 >= e.dur) {
        root.remove(e.holder, e.plates);
        e.model.dispose?.();
        customers.delete(id);
      }
    }
    xsTmp.length = 0;
    for (const e of avatars.values()) xsTmp.push(e.w.x);
    let i = 0;
    for (const e of avatars.values()) updateAvatar(e, dt, t, laneOffset(i++, xsTmp));
    const me = meId && avatars.get(meId);
    if (me) {
      meRing.visible = true;
      meRing.position.set(me.w.x, 0.03, me.z);
      const s = 1 + (reducedMotion ? 0 : Math.sin(t * 4) * 0.08);
      meRing.scale.set(s, s, 1);
    } else meRing.visible = false;
  }

  const slotPos = new Vector3();
  function customerPos(id) {
    const e = customers.get(id);
    return e ? e : null;
  }

  function handleEvents(events) {
    if (!events) return;
    for (const ev of events) {
      const w = workForEvent(ev);
      if (w) {
        const a = avatars.get(w.by);
        if (a) startWork(a, w.kind, w.station);
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
          if (stall.slotWorld(ev.station, ev.slot, slotPos)) fx.burst('ping', slotPos.x, slotPos.y + 0.45, slotPos.z);
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
          if (e) fx.burst('puff', e.sx, COUNTER_Y + 0.2, 0.1, 0.5);
          break;
        }
        case 'collect': {
          const e = customerPos(ev.customer);
          const x = e ? e.sx : 0;
          fx.burst('coin', x, 1.35, 1.1, 1);
          fx.floatText(`+₹${ev.amount ?? 0}`, '#ffd34d', x, 1.9, 0.9, { life: 1.5, rise: 1.0, scale: 1.1 });
          if (ev.tip > 0) fx.floatText(`tip +₹${ev.tip}`, '#9dff9d', x, 1.7, 0.9, { life: 1.4, rise: 0.8, scale: 0.8, delay: 0.25 });
          const a = avatars.get(ev.by);
          if (a) a.cheer = 1.0;
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
          if (e) fx.burst('ring', e.sx, 1.3, 1.2, 1);
          break;
        }
        case 'pay-ready': {
          const e = customerPos(ev.customer);
          if (e) fx.burst('sparkle', e.sx, 1.35, 1.2, 0.6);
          break;
        }
        case 'combo':
          if (!(ev.combo >= 2)) break;
          fx.burst('sparkle', 0, 1.4, 0.3, 2);
          fx.floatText(`COMBO x${ev.combo}`, '#ff9a3a', 0, 2.3, 0.4, { life: 1.6, rise: 0.8, scale: 1.2 });
          break;
        case 'emote': {
          const a = avatars.get(ev.by);
          const icon = { thumbs: '👍', fire: '🔥', help: '🆘', thanks: '🙏' }[ev.e] || '';
          if (a && icon) fx.floatText(icon, '#ffffff', a.w.x, 2.4, a.z, { life: 1.6, rise: 0.7, scale: 0.9 });
          break;
        }
        case 'shift-end':
          for (let i = 0; i < 4; i++) fx.burst('confetti', lerp(-3.5, 3.5, i / 3), 2.6, 0.3, 1);
          break;
        default:
          break;
      }
    }
  }

  // --- targets: anchors for highlight / project / pick ---------------------------------------------------------------------------------------------
  /** Fill base (floor / ring centre) and top (bubble anchor) for a target; returns the ring radius or 0. */
  function resolve(target, base, top) {
    if (!target) return 0;
    switch (target.kind) {
      case 'station': {
        const s = stall.stations.get(target.id ?? target.station);
        if (!s) return 0;
        base.set(s.group.position.x, 0.02, s.group.position.z);
        top.set(base.x, 1.9, base.z);
        return 0.95;
      }
      case 'slot': {
        const sid = target.station ?? target.id;
        if (!stall.slotWorld(sid, target.slot ?? 0, base)) return 0;
        top.set(base.x, base.y + 0.5, base.z);
        return 0.34;
      }
      case 'customer': {
        const e = customers.get(target.id);
        if (!e) return 0;
        base.set(e.x, 0.02, e.z);
        top.set(e.x, 2.05, e.z);
        return 0.55;
      }
      case 'bin':
        base.set(stall.binPos.x, 0.02, stall.binPos.z);
        top.set(base.x, 1.25, base.z);
        return 0.6;
      case 'hands': {
        const a = meId && avatars.get(meId);
        if (!a) return 0;
        base.set(a.w.x, 0.02, a.z);
        top.set(a.w.x, 2.1, a.z);
        return 0.6;
      }
      default:
        return 0;
    }
  }

  /** Invisible hit proxies in world metres (see picking.js). Rebuilt per pick (rare), so allocation is fine. */
  function buildProxies() {
    const out = [];
    for (const [sid, s] of stall.stations) {
      if (!s.prop) continue;
      const data = st?.stations?.[sid];
      const n = data ? data.slots.length : s.anchors.length;
      for (let i = 0; i < n; i++) {
        const p = stall.slotWorld(sid, i, new Vector3());
        if (!p) continue;
        out.push({ kind: 'slot', target: { kind: 'slot', station: sid, slot: i }, a: { x: p.x, y: p.y + 0.05, z: p.z }, radius: 0.2 });
      }
      out.push({ kind: 'station', target: { kind: 'station', station: sid }, a: { x: s.group.position.x, y: 0.85, z: s.group.position.z }, radius: 0.75 });
    }
    for (const e of customers.values()) {
      if (e.phase !== 'stand' || !e.c || e.c.st === 'left') continue;
      out.push({ kind: 'customer', target: { kind: 'customer', id: e.id }, a: { x: e.x, y: 0.3, z: e.z }, b: { x: e.x, y: 1.6, z: e.z }, radius: 0.38 });
    }
    out.push({ kind: 'bin', target: { kind: 'bin' }, a: { x: stall.binPos.x, y: 0.45, z: stall.binPos.z }, radius: 0.55 });
    return out;
  }

  function dispose() {
    scene.remove(root);
    for (const e of customers.values()) e.model.dispose?.();
    for (const a of avatars.values()) a.model.dispose?.();
    customers.clear();
    avatars.clear();
    for (const p of dishProto.values()) p.traverse?.((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      ms.forEach((m) => m.dispose?.());
    });
    dishProto.clear();
    void DISHES;
    void PAY_WINDOW;
  }

  return {
    setState,
    update,
    handleEvents,
    resolve,
    buildProxies,
    dispose,
    setMe: (id) => { meId = id || null; },
    getAvatarX: (id) => avatars.get(id)?.w.x ?? null,
    onAvatarArrive: (fn) => {
      arriveListeners.add(fn);
      return () => arriveListeners.delete(fn);
    },
    get state() { return st; },
  };
}
