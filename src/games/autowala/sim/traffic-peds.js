// Pedestrians and cows: light, comic and never graphic. Pedestrians stroll round the pavements of the blocks near the player (one
// instanced mesh), step back from a passing auto, scatter at the horn, and a few jaywalk across the road; cows doze at the
// roadside, wander onto the road and stand there while the traffic waits. Touch one and it stumbles aside with a shout.
import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh } from 'three';
import { clamp, damp } from '../game/rng.js';
import { nearestRoad } from '../world/layout.js';
import { PLAYER_CIRCLES, circleAt, exchangeImpulse, hitSeverity, SOFT_MASS } from './traffic-collide.js';
import { PLAYER_MASS, districtDensity } from './traffic-net.js';
import { districtAt } from '../world/layout.js';
import { merge, part } from './traffic-models.js';

const SHIRTS = ['#e8453c', '#2d7be8', '#f2c230', '#2fb572', '#a05cf0', '#f07ab0', '#f4f4f4', '#ff8a3d', '#2ec4b6', '#c2185b', '#7cb342', '#ffb300'];
const SLAB = 0.2;
const box = (w, h, d) => new BoxGeometry(w, h, d);

/** One merged geometry: 6 boxes = 72 triangles. The shirt (torso) takes the per-instance tint. */
function pedGeometry() {
  return merge([
    part(box(0.42, 0.62, 0.3), '#ffffff', true, 0, 1.15, 0),
    part(box(0.13, 0.82, 0.16), '#2a3350', false, -0.1, 0.41, 0),
    part(box(0.13, 0.82, 0.16), '#2a3350', false, 0.1, 0.41, 0),
    part(box(0.26, 0.28, 0.26), '#b07a52', false, 0, 1.62, 0),
    part(box(0.08, 0.55, 0.1), '#b07a52', false, -0.3, 1.15, 0),
    part(box(0.08, 0.55, 0.1), '#b07a52', false, 0.3, 1.15, 0),
  ]);
}

/** A cow: 10 boxes = 120 triangles; the body and head take the tint (white, fawn, grey), the patch and legs are fixed. */
function cowGeometry() {
  const p = [
    part(box(0.85, 0.8, 1.9), '#f1ebdd', true, 0, 1.05, 0),
    part(box(0.42, 0.46, 0.62), '#efe6d2', true, 0, 1.25, 1.2),
    part(box(0.3, 0.2, 0.2), '#b9a58a', false, 0, 1.1, 1.55),
    part(box(0.4, 0.3, 0.5), '#e8dcc6', true, 0, 1.6, 0.5),
    part(box(0.88, 0.45, 0.7), '#8a5a35', false, 0, 1.1, -0.4),
    part(box(0.1, 0.1, 0.5), '#5a4030', false, 0, 1.0, -1.05, -0.5, 0),
  ];
  for (const sx of [-1, 1]) for (const z of [-0.65, 0.65]) p.push(part(box(0.15, 0.7, 0.16), '#cfc6ae', false, sx * 0.3, 0.35, z));
  return merge(p);
}

/** Column-major matrix of: translate(x,y,z) * Ry(h) * Rx(tilt) * scale(sc). Written straight into an instance array. */
export function writeMatrix(a, i, x, y, z, h, sc, tilt = 0, sz = sc) {
  const c = Math.cos(h);
  const s = Math.sin(h);
  const ca = Math.cos(tilt);
  const sa = Math.sin(tilt);
  const o = i * 16;
  a[o] = c * sc; a[o + 1] = 0; a[o + 2] = -s * sc; a[o + 3] = 0;
  a[o + 4] = s * sa * sc; a[o + 5] = ca * sc; a[o + 6] = c * sa * sc; a[o + 7] = 0;
  a[o + 8] = s * ca * sz; a[o + 9] = -sa * sz; a[o + 10] = c * ca * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
export const hide = (a, i) => {
  a.fill(0, i * 16, i * 16 + 16);
  a[i * 16 + 15] = 1;
  a[i * 16 + 13] = -50;
};

/**
 * @param ctx   the game context (scene, v, world, camera, emit, rig)
 * @param opts  { rnd, maxPeds, maxCows, onHit(kind, id, severity, speed, x, z), honk(x, z) }
 */
export function createPeds(ctx, { rnd, material, maxPeds = 150, maxCows = 7, onHit }) {
  const city = ctx.world.city;
  const colliders = ctx.world.colliders;
  const blocks = city.blocks.filter((b) => b.type !== 'water' && b.w > 14 && b.d > 14);
  const wBlock = blocks.map((b) => districtDensity(b.district));
  const v = ctx.v;

  // ---- meshes: ONE draw call for the pedestrians and one for the cows; only the active ones are drawn (mesh.count)
  const pedGeo = pedGeometry();
  const cowGeo = cowGeometry();
  const pedTint = new InstancedBufferAttribute(new Float32Array(maxPeds * 3).fill(1), 3);
  const cowTint = new InstancedBufferAttribute(new Float32Array(maxCows * 3).fill(1), 3);
  pedTint.setUsage(35048);
  cowTint.setUsage(35048);
  pedGeo.setAttribute('aTint', pedTint);
  cowGeo.setAttribute('aTint', cowTint);
  const pedMesh = new InstancedMesh(pedGeo, material, maxPeds);
  const cowMesh = new InstancedMesh(cowGeo, material, maxCows);
  const col = new Color();
  for (const m of [pedMesh, cowMesh]) {
    m.frustumCulled = false;
    m.castShadow = false;
    m.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    m.count = 0;
    ctx.scene.add(m);
  }

  // ---- state
  const peds = [];
  for (let i = 0; i < maxPeds; i++) {
    peds.push({
      id: i, active: false, block: null, p: 0, dir: 1, speed: 1.2, inset: 1, baseInset: 1, mode: 0, x: 0, z: 0, y: SLAB, h: 0,
      cr: 1, cg: 1, cb: 1, phase: 0, sc: 1, timer: 0, vx: 0, vz: 0, tilt: 0, crossT: 0, crossLen: 0, nx: 0, nz: 0, sx: 0, sz: 0, cd: 0, side: 0, scared: 0,
    });
  }
  const cows = [];
  for (let i = 0; i < maxCows; i++) {
    cows.push({ id: 1000 + i, cr: 1, cg: 1, cb: 1, active: false, edge: null, u: 0, q: 0, qSide: 1, state: 0, timer: 0, x: 0, z: 0, h: 0, vx: 0, vz: 0, tilt: 0, cd: 0, hop: 0, tone: 0 });
  }
  /** What the traffic must slow for: cows standing in the road, pedestrians crossing it. Preallocated, `count` entries valid. */
  const obstacles = [];
  for (let i = 0; i < maxPeds + maxCows; i++) obstacles.push({ x: 0, z: 0, r: 0.5, vx: 0, vz: 0, kind: 'ped', ref: null });
  let nObs = 0;

  const PED_RING = 230;
  const COW_RING = 260;
  const pt = { x: 0, z: 0 };

  /** Point on the perimeter of block b, `inset` metres inside its edge, at arc length p. Writes {x, z, side, tx, tz}. */
  const perim = (b, inset, p, out) => {
    const W = Math.max(2, b.x1 - b.x0 - 2 * inset);
    const D = Math.max(2, b.z1 - b.z0 - 2 * inset);
    const per = 2 * (W + D);
    let s = ((p % per) + per) % per;
    if (s < W) { out.x = b.x0 + inset + s; out.z = b.z0 + inset; out.side = 0; out.tx = 1; out.tz = 0; out.len = W; out.t = s; return out; }
    s -= W;
    if (s < D) { out.x = b.x1 - inset; out.z = b.z0 + inset + s; out.side = 1; out.tx = 0; out.tz = 1; out.len = D; out.t = s; return out; }
    s -= D;
    if (s < W) { out.x = b.x1 - inset - s; out.z = b.z1 - inset; out.side = 2; out.tx = -1; out.tz = 0; out.len = W; out.t = s; return out; }
    s -= W;
    out.x = b.x0 + inset; out.z = b.z1 - inset - s; out.side = 3; out.tx = 0; out.tz = -1; out.len = D; out.t = s;
    return out;
  };
  const perimLen = (b, inset) => 2 * (Math.max(2, b.x1 - b.x0 - 2 * inset) + Math.max(2, b.z1 - b.z0 - 2 * inset));
  const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  const dist2 = (x, z) => (x - v.x) ** 2 + (z - v.z) ** 2;

  function spawnPed(p, near) {
    // weighted pick of a block within the ring
    let total = 0;
    let pick = -1;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const d = Math.hypot(b.cx - v.x, b.cz - v.z) - Math.max(b.w, b.d) * 0.4;
      if (d > PED_RING || d < -40) continue;
      const w = wBlock[i] * (b.type === 'park' ? 0.4 : 1);
      total += w;
      if (rnd() * total < w) pick = i;
    }
    if (pick < 0) return false;
    const b = blocks[pick];
    p.block = b;
    p.baseInset = 0.5 + rnd() * 1.3;
    p.inset = p.baseInset;
    p.p = rnd() * perimLen(b, p.baseInset);
    perim(b, p.inset, p.p, pt);
    if (!near && dist2(pt.x, pt.z) < 25 * 25 && rnd() < 0.7) return false; // mostly appear out of sight
    if (dist2(pt.x, pt.z) > PED_RING * PED_RING) return false;
    p.dir = rnd() < 0.5 ? 1 : -1;
    p.speed = 0.9 + rnd() * 0.9;
    p.mode = 0;
    p.phase = rnd() * 6.28;
    p.sc = 0.9 + rnd() * 0.18;
    p.timer = 4 + rnd() * 10;
    p.tilt = 0;
    p.active = true;
    p.cd = 0;
    p.scared = 0;
    const i = p.id;
    col.set(SHIRTS[(rnd() * SHIRTS.length) | 0]);
    p.cr = col.r;
    p.cg = col.g;
    p.cb = col.b;
    p.x = pt.x;
    p.z = pt.z;
    return true;
  }

  function spawnCow(c) {
    let best = null;
    for (let tries = 0; tries < 12 && !best; tries++) {
      const e = city.edges[(rnd() * city.edges.length) | 0];
      if (e.len < 30 || e.w > 14) continue;
      const a = city.nodes[e.a];
      const u = 8 + rnd() * (e.len - 16);
      const x = a.x + e.dx * u;
      const z = a.z + e.dz * u;
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < 35 || d > COW_RING) continue;
      if (districtAt(x, z).id === 'hitech') continue;
      best = { e, u };
    }
    if (!best) return false;
    c.edge = best.e;
    c.u = best.u;
    c.qSide = rnd() < 0.5 ? 1 : -1;
    c.q = c.qSide * (best.e.w / 2 - 0.35);
    c.state = 0;
    c.timer = 3 + rnd() * 8;
    c.tilt = 0;
    c.hop = 0;
    c.cd = 0;
    c.active = true;
    col.set(['#ffffff', '#e8d4b8', '#c9b8a0', '#f4e8e0'][(rnd() * 4) | 0]);
    c.cr = col.r;
    c.cg = col.g;
    c.cb = col.b;
    return true;
  }

  const cowPos = (c) => {
    const e = c.edge;
    const a = city.nodes[e.a];
    // left of the a->b direction is (dz, -dx)
    c.x = a.x + e.dx * c.u + e.dz * c.q;
    c.z = a.z + e.dz * c.u - e.dx * c.q;
  };

  const hitOut = { dax: 0, daz: 0, dbx: 0, dbz: 0, closing: 0 };
  const c1 = { x: 0, z: 0 };

  /** Player against one soft body at (x, z) of radius r. Returns the closing speed (> 0) on a touch, else 0. Sets (nx, nz). */
  let nx = 0;
  let nz = 0;
  function touch(x, z, r, mass, push) {
    let hitC = 0;
    for (const off of PLAYER_CIRCLES.offsets) {
      circleAt(v.x, v.z, v.heading, off, c1);
      const dx = x - c1.x;
      const dz = z - c1.z;
      const d = Math.hypot(dx, dz);
      const lim = r + PLAYER_CIRCLES.r;
      if (d >= lim) continue;
      const ux = d > 1e-4 ? dx / d : Math.sin(v.heading);
      const uz = d > 1e-4 ? dz / d : Math.cos(v.heading);
      exchangeImpulse(PLAYER_MASS, v.vx, v.vz, mass, 0, 0, ux, uz, 0.15, hitOut);
      if (hitOut.closing > hitC) {
        hitC = hitOut.closing;
        nx = ux;
        nz = uz;
      }
      // the player gives way a little; the soft body is pushed clear
      const depth = lim - d;
      push.x = ux * depth;
      push.z = uz * depth;
      v.vx += hitOut.dax * (mass > 100 ? 1 : 0.4);
      v.vz += hitOut.daz * (mass > 100 ? 1 : 0.4);
      push.dvx = hitOut.dbx;
      push.dvz = hitOut.dbz;
      push.hit = true;
    }
    return hitC;
  }
  const push = { x: 0, z: 0, dvx: 0, dvz: 0, hit: false };

  function report(kind, id, closing, x, z) {
    const mass = kind === 'cow' ? SOFT_MASS.cow : SOFT_MASS.ped;
    const sev = hitSeverity(closing, kind, mass);
    v.jolt = Math.min(1, v.jolt + 0.1 + 0.3 * sev);
    ctx.rig?.kick?.(0.06 + 0.25 * sev);
    onHit(kind, id, sev, closing, x, z);
  }

  let honkScare = 0;
  let sx = 0;
  let sz = 0;
  /** The player honked: pedestrians within ~16 m run for it, cows in the road shuffle off. */
  function scare(x, z) {
    honkScare = 0.05;
    sx = x;
    sz = z;
  }

  let spawnClock = 0;
  let crossers = 0;
  let cowsActive = 0;

  function update(dt, active) {
    // ---- scare pass
    if (honkScare > 0) {
      honkScare = 0;
      for (const p of peds) {
        if (!p.active) continue;
        if ((p.x - sx) ** 2 + (p.z - sz) ** 2 < 16 * 16) p.scared = 2.4;
      }
      for (const c of cows) if (c.active && (c.x - sx) ** 2 + (c.z - sz) ** 2 < 22 * 22 && c.state >= 1 && c.state <= 2) { c.state = 3; c.timer = 0; }
    }

    // ---- spawn / despawn (a few per frame)
    spawnClock += dt;
    let spawned = 0;
    crossers = 0;
    let nActive = 0;
    for (const p of peds) {
      if (!p.active) continue;
      nActive++;
      if (dist2(p.x, p.z) > (PED_RING + 30) ** 2) {
        p.active = false;
        nActive--;
      } else if (p.mode === 1 || p.mode === 2) crossers++;
    }
    const want = Math.min(active, maxPeds);
    if (nActive < want) {
      for (const p of peds) {
        if (p.active) continue;
        if (spawnPed(p, false) && ++spawned >= 4) break;
        if (++spawned >= 8) break; // failed attempts are cheap but bounded
      }
    }
    cowsActive = 0;
    for (const c of cows) {
      if (!c.active) continue;
      cowPos(c);
      if (dist2(c.x, c.z) > (COW_RING + 40) ** 2) {
        c.active = false;
      } else cowsActive++;
    }
    if (cowsActive < Math.min(maxCows, Math.round(maxCows * (active / maxPeds + 0.2))) && rnd() < 0.2) {
      for (const c of cows) if (!c.active) { spawnCow(c); break; }
    }

    // ---- peds
    nObs = 0;
    const pa = pedMesh.instanceMatrix.array;
    let nP = 0;
    const pSpeed = Math.hypot(v.vx, v.vz);
    for (const p of peds) {
      if (!p.active) continue;
      const d2 = dist2(p.x, p.z);
      p.cd = Math.max(0, p.cd - dt);
      p.scared = Math.max(0, p.scared - dt);
      p.phase += dt * p.speed * 5.5 * (p.scared > 0 ? 2 : 1);
      const near = d2 < 14 * 14;
      if (p.mode === 0) {
        // walking round the block; step back from a passing auto, run when scared
        const wantInset = (near && pSpeed > 3) || p.scared > 0 ? Math.max(p.baseInset, 2.4) : p.baseInset;
        p.inset = damp(p.inset, wantInset, p.scared > 0 ? 6 : 3, dt);
        p.p += p.dir * p.speed * (p.scared > 0 ? 2.6 : 1) * dt;
        const b = p.block;
        perim(b, p.inset, p.p, pt);
        p.x = pt.x;
        p.z = pt.z;
        p.h = Math.atan2(pt.tx * p.dir, pt.tz * p.dir);
        p.y = SLAB;
        p.timer -= dt;
        // a few take a chance on the road when the player is around
        if (p.timer <= 0) {
          p.timer = 5 + rnd() * 10;
          if (crossers < Math.max(2, maxPeds * 0.1) && d2 < 120 * 120 && d2 > 12 * 12 && pt.t > 6 && pt.len - pt.t > 6 && rnd() < 0.35) {
            const r = nearestRoad(city, p.x + OUT[pt.side][0] * 3, p.z + OUT[pt.side][1] * 3);
            if (r && r.dist < 12) {
              p.mode = 1;
              p.nx = OUT[pt.side][0];
              p.nz = OUT[pt.side][1];
              p.sx = p.x;
              p.sz = p.z;
              p.crossLen = r.edge.w / 2 + Math.max(0, r.dist) * 0 + r.edge.w / 2 + 0.8;
              p.crossT = 0;
              p.side = pt.side;
              crossers++;
            }
          }
        }
        if (p.cd <= 0 && d2 < 4 * 4 && pSpeed > 0.5) checkPed(p, pSpeed);
      } else if (p.mode === 1 || p.mode === 2) {
        // jaywalking out (mode 1) and back (mode 2); hurry when the auto is close
        const hurry = d2 < 25 * 25 && pSpeed > 2 ? 1.5 : 1;
        const sp = 1.5 * hurry * (p.scared > 0 ? 1.6 : 1);
        p.crossT += sp * dt;
        const t = p.mode === 1 ? p.crossT : Math.max(0, p.crossLen - p.crossT);
        if (p.crossT >= p.crossLen) {
          if (p.mode === 1) {
            p.mode = 2;
            p.crossT = 0;
            p.timer = 0;
          } else {
            p.mode = 0;
            p.timer = 6 + rnd() * 8;
            p.inset = p.baseInset;
          }
        }
        p.x = p.sx + p.nx * t;
        p.z = p.sz + p.nz * t;
        const sgn = p.mode === 1 ? 1 : -1;
        p.h = Math.atan2(p.nx * sgn, p.nz * sgn);
        p.y = t > 0.3 ? 0.05 : SLAB;
        if (p.cd <= 0 && d2 < 6 * 6) checkPed(p, pSpeed);
        const o = obstacles[nObs++];
        o.x = p.x; o.z = p.z; o.r = 0.5; o.vx = p.nx * sgn * sp; o.vz = p.nz * sgn * sp; o.kind = 'ped'; o.ref = p;
      } else if (p.mode === 3) {
        // stumbling aside after a bump
        p.timer -= dt;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.vx *= Math.exp(-3 * dt);
        p.vz *= Math.exp(-3 * dt);
        p.tilt = Math.sin(Math.min(1, p.timer / 1.2) * Math.PI) * 0.7;
        if (p.timer <= 0) {
          p.tilt = 0;
          // go back to strolling from the nearest bit of pavement
          const b = p.block;
          const cx = clamp(p.x, b.x0 + 0.6, b.x1 - 0.6);
          const cz = clamp(p.z, b.z0 + 0.6, b.z1 - 0.6);
          p.x = cx;
          p.z = cz;
          p.mode = 0;
          p.inset = Math.min(p.baseInset + 0.5, 2);
          p.p = nearestPerimP(b, p.inset, cx, cz);
        }
      }
      // writes
      const bob = p.mode === 3 ? 0 : Math.abs(Math.sin(p.phase)) * 0.045 * (p.scared > 0 ? 1.8 : 1);
      writeMatrix(pa, nP, p.x, p.y + bob, p.z, p.h, p.sc, p.tilt);
      pedTint.array[nP * 3] = p.cr;
      pedTint.array[nP * 3 + 1] = p.cg;
      pedTint.array[nP * 3 + 2] = p.cb;
      nP++;
    }
    pedMesh.count = nP;
    pedMesh.visible = nP > 0;
    pedMesh.instanceMatrix.needsUpdate = true;
    pedTint.needsUpdate = true;

    // ---- cows
    const ca = cowMesh.instanceMatrix.array;
    let nC = 0;
    for (const c of cows) {
      if (!c.active) continue;
      const e = c.edge;
      c.cd = Math.max(0, c.cd - dt);
      c.timer -= dt;
      const roadside = c.qSide * (e.w / 2 - 0.35);
      const lane = c.qSide * (e.w * 0.18);
      if (c.state === 0) {
        // dozing at the roadside, parallel to the road
        c.h = Math.atan2(e.dx, e.dz) + (c.id % 2 ? 0 : Math.PI);
        if (c.timer <= 0) {
          c.state = 1;
        }
      } else if (c.state === 1) {
        // ambling out into the road
        c.q += clamp(lane - c.q, -0.7 * dt, 0.7 * dt);
        c.h = crossHeading(e, c.qSide, -1);
        if (Math.abs(c.q - lane) < 0.05) {
          c.state = 2;
          c.timer = 5 + rnd() * 6;
        }
      } else if (c.state === 2) {
        // standing in the road: the traffic waits (and honks)
        c.h = crossHeading(e, c.qSide, -1);
        if (c.timer <= 0) c.state = 3;
      } else if (c.state === 3) {
        c.q += clamp(roadside - c.q, -0.9 * dt, 0.9 * dt);
        c.h = crossHeading(e, c.qSide, 1);
        if (Math.abs(c.q - roadside) < 0.05) {
          c.state = 0;
          c.timer = 8 + rnd() * 14;
        }
      } else if (c.state === 4) {
        // startled by a bump: hop aside
        c.hop -= dt;
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        c.vx *= Math.exp(-3 * dt);
        c.vz *= Math.exp(-3 * dt);
        c.tilt = Math.sin(Math.min(1, c.hop / 1.4) * Math.PI) * 0.35;
        if (c.hop <= 0) {
          c.tilt = 0;
          // re-anchor to the road from wherever we ended up
          const a = city.nodes[e.a];
          c.u = clamp((c.x - a.x) * e.dx + (c.z - a.z) * e.dz, 4, e.len - 4);
          c.q = clamp((c.x - a.x) * e.dz - (c.z - a.z) * e.dx, -e.w / 2 + 0.3, e.w / 2 - 0.3);
          c.qSide = c.q >= 0 ? 1 : -1;
          c.state = 3;
        }
      }
      if (c.state !== 4) cowPos(c);
      const inRoad = Math.abs(c.q) < e.w / 2 - 1.5 && c.state !== 4;
      if (inRoad || (c.state === 4 && c.hop > 0.3)) {
        const o = obstacles[nObs++];
        o.x = c.x; o.z = c.z; o.r = 1.0; o.vx = 0; o.vz = 0; o.kind = 'cow'; o.ref = c;
      }
      if (c.cd <= 0 && c.state !== 4 && dist2(c.x, c.z) < 5 * 5 && pSpeed > 0.4) {
        push.hit = false;
        const closing = touch(c.x, c.z, 0.9, SOFT_MASS.cow, push);
        if (push.hit && closing > 0.3) {
          c.cd = 1;
          c.state = 4;
          c.hop = 1.4;
          c.vx = clamp(push.dvx, -5, 5) + nx * 1.5;
          c.vz = clamp(push.dvz, -5, 5) + nz * 1.5;
          c.x += push.x;
          c.z += push.z;
          report('cow', c.id, closing, c.x, c.z);
        } else if (push.hit) {
          v.x -= push.x * 0.5;
          v.z -= push.z * 0.5;
        }
      }
      writeMatrix(ca, nC, c.x, 0.03, c.z, c.h, 1, c.tilt);
      cowTint.array[nC * 3] = c.cr;
      cowTint.array[nC * 3 + 1] = c.cg;
      cowTint.array[nC * 3 + 2] = c.cb;
      nC++;
    }
    cowMesh.count = nC;
    cowMesh.visible = nC > 0;
    cowMesh.instanceMatrix.needsUpdate = true;
    cowTint.needsUpdate = true;
  }

  // a stroller or jaywalker touched by the auto
  function checkPed(p, pSpeed) {
    push.hit = false;
    const closing = touch(p.x, p.z, 0.4, SOFT_MASS.ped, push);
    if (!push.hit) return;
    p.x += push.x;
    p.z += push.z;
    if (closing > 0.3) {
      p.cd = 1.2;
      p.mode = 3;
      p.timer = 1.2;
      p.vx = clamp(push.dvx, -4, 4) + nx * 1.2;
      p.vz = clamp(push.dvz, -4, 4) + nz * 1.2;
      p.y = SLAB;
      report('ped', p.id, closing, p.x, p.z);
    }
  }

  function nearestPerimP(b, inset, x, z) {
    // arc length of the perimeter point nearest (x, z): coarse search over the four sides
    const W = Math.max(2, b.x1 - b.x0 - 2 * inset);
    const D = Math.max(2, b.z1 - b.z0 - 2 * inset);
    const cx = clamp(x, b.x0 + inset, b.x1 - inset);
    const cz = clamp(z, b.z0 + inset, b.z1 - inset);
    const dTop = Math.abs(cz - (b.z0 + inset));
    const dBot = Math.abs(cz - (b.z1 - inset));
    const dL = Math.abs(cx - (b.x0 + inset));
    const dR = Math.abs(cx - (b.x1 - inset));
    const m = Math.min(dTop, dBot, dL, dR);
    if (m === dTop) return cx - (b.x0 + inset);
    if (m === dR) return W + (cz - (b.z0 + inset));
    if (m === dBot) return W + D + (b.x1 - inset - cx);
    return 2 * W + D + (b.z1 - inset - cz);
  }

  function dispose() {
    for (const m of [pedMesh, cowMesh]) {
      ctx.scene.remove(m);
      m.dispose?.();
    }
    pedGeo.dispose();
    cowGeo.dispose();
  }

  return {
    update,
    scare,
    dispose,
    obstacles,
    get obstacleCount() { return nObs; },
    peds,
    cows,
    get activePeds() { let n = 0; for (const p of peds) if (p.active) n++; return n; },
    get activeCows() { let n = 0; for (const c of cows) if (c.active) n++; return n; },
    pedMesh,
    cowMesh,
  };
}

/** Heading of a cow facing across the road: outward +1 faces the kerb on its side, -1 faces the road centre. */
function crossHeading(e, side, outward) {
  // left of a->b is (dz, -dx); a cow with q > 0 (side +1) stands on that side
  return Math.atan2(side * outward * e.dz, side * outward * -e.dx);
}
