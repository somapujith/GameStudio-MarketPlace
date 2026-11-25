// OWNER: traffic agent. Real traffic on the road graph. See ARCHITECTURE.md (Addendum) for the contract.
//
// Vehicles (cars, autos, bikes, buses, trucks) drive along `city.edges` in the driver's LEFT lane, choose a random next edge at
// every junction and swing through it on a smooth link (sim/traffic-lanes.js), keep a following distance behind whoever is ahead
// in the lane (IDM, sim/traffic-follow.js), give way inside junctions, brake for the player, cows and jaywalkers, and honk when
// they are stuck. About `gfx.cfg.traffic` of them live in a ring 60..450 m around the player: spawned out of sight, despawned when
// far. Bodies are instanced: ONE merged low-poly geometry and one draw call per kind (sim/traffic-models.js), no shadow pass.
//
// Contact with the player (sim/traffic-collide.js) exchanges momentum (the heavier body wins), shakes the camera and emits
// `traffic:hit`. The chase itself (road rage) lives in gameplay/roadRage.js and talks to this system through `ctx.traffic.recruit`,
// `release` and `chaseInfo`.
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { clamp, makeRng } from '../game/rng.js';
import { createRouter } from '../world/routing.js';
import { districtAt } from '../world/layout.js';
import { QUALITY } from '../game/config.js';
import { BUILDERS, PAINTS, createTrafficMaterial, lampLayout } from './traffic-models.js';
import { createTrafficAudio } from './traffic-audio.js';
import { createPeds, writeMatrix } from './traffic-peds.js';
import { evalLink, junctionLink, laneCount, lanePoint, newLink, uTurnLink } from './traffic-lanes.js';
import { KINDS, PLAYER_MASS, buildNet, chaseNextEdge, districtDensity, pickKind, pickNextEdge, pickSpawn, speedLimit } from './traffic-net.js';
import { approachSpeed, followSpeed } from './traffic-follow.js';
import { PLAYER_CIRCLES, circleAt, exchangeImpulse, hitSeverity, separate } from './traffic-collide.js';

export const TRAFFIC = {
  rMin: 60, // m: nothing spawns nearer than this
  rMax: 450, // m: the ring
  despawn: 500, // m: vehicles further than this are recycled
  maxCap: 64, // hard cap of instances per kind
  hitClosing: 0.6, // m/s of closing speed that counts as a hit
  hitCooldown: 0.8, // s per vehicle
  // a chaser cruises at this share of the player's nominal top speed. The auto's real flat-out speed is ~77% of nominal (drag), and the
  // brief caps chasers at ~85% of it: 0.66 of nominal is 85% of what a clean run reaches, so a good driver pulls away, a boost is far faster
  chaseTop: 0.66,
};

const LAMP_PER = 8;
const SEDAN_Z = 1.1; // a sedan is the hatchback stretched along its length

export function installTraffic(ctx) {
  const city = ctx.world.city;
  const colliders = ctx.world.colliders;
  const net = buildNet(city);
  const router = createRouter(city);
  const routeFn = (a, b) => router.route(a, b);
  const rnd = makeRng(0x7aff1c ^ (city.seed || 1));
  const audio = createTrafficAudio(ctx.camera);
  const P = ctx.v;
  const cam = ctx.camera;
  const quality = () => ctx.gfx?.cfg || QUALITY.medium;
  const CAP = Math.min(TRAFFIC.maxCap, Math.max(QUALITY.high.traffic, quality().traffic) + 8);

  // ------------------------------------------------------------------------------------------------ meshes
  const material = createTrafficMaterial();
  const meshes = {};
  const instColor = (n) => new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  // ONE instanced mesh (one draw call) per kind; `count` is the number of active vehicles of that kind, packed every frame
  for (const key of Object.keys(BUILDERS)) {
    const b = BUILDERS[key]();
    const tint = new InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    tint.setUsage(35048);
    b.geo.setAttribute('aTint', tint);
    const mesh = new InstancedMesh(b.geo, material, CAP);
    mesh.castShadow = false; // no shadow pass for traffic: it is the biggest saver, and the road carries a dark underside instead
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(35048);
    mesh.count = 0;
    mesh.visible = false;
    ctx.scene.add(mesh);
    meshes[key] = { mesh, tint, geo: b.geo, n: 0 };
  }
  const lampMat = new MeshBasicMaterial({ color: 0xffffff });
  const lampGeo = new BoxGeometry(0.24, 0.13, 0.08);
  const lamps = new InstancedMesh(lampGeo, lampMat, CAP * LAMP_PER);
  lamps.instanceColor = instColor(CAP * LAMP_PER);
  lamps.frustumCulled = false;
  lamps.instanceMatrix.setUsage(35048);
  lamps.count = 0;
  ctx.scene.add(lamps);

  // headlight pools on the road at night
  const beamTex = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 128);
    g.globalCompositeOperation = 'destination-in';
    const side = g.createLinearGradient(0, 0, 32, 0);
    side.addColorStop(0, 'rgba(0,0,0,0)');
    side.addColorStop(0.5, 'rgba(0,0,0,1)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = side;
    g.fillRect(0, 0, 32, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const beamGeo = new PlaneGeometry(3.4, 12).rotateX(-Math.PI / 2);
  const beamMat = new MeshBasicMaterial({ map: beamTex, color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
  const beams = new InstancedMesh(beamGeo, beamMat, CAP);
  beams.instanceColor = instColor(CAP);
  beams.frustumCulled = false;
  beams.instanceMatrix.setUsage(35048);
  beams.count = 0;
  beams.renderOrder = 2;
  ctx.scene.add(beams);

  // ------------------------------------------------------------------------------------------------ vehicles
  const vehicles = []; // active, dense
  const pool = []; // idle objects
  let nextId = 1;
  const sel = { edge: null, dir: 1 };
  const tmp = { x: 0, z: 0, heading: 0 };
  const occ = new Map(); // node id -> vehicles inside its junction
  const chaseTarget = P;

  function newVehicle() {
    return {
      id: 0, kind: 'car', variant: 0, zs: 1, cr: 1, cg: 1, cb: 1, color: 0, mode: 'drive', chase: false,
      x: 0, z: 0, heading: 0, speed: 0, px: 0, pz: 0, ph: 0, fx: 0, fz: 1,
      edge: null, dir: 1, lane: 0, u: 0, uEnd: 0, inLink: false, ls: 0, link: newLink(), nextEdge: null, nextDir: 1, nextLane: 0,
      fromEdge: null, fromDir: 1, fromLane: 0, occNode: -1, uturn: false,
      len: 4, wid: 1.7, mass: 1000, pace: 1, acc: 3, brk: 3.5,
      gap: Infinity, lead: 0, blocked: false, red: false, waitT: 0, stuckT: 0, ghost: 0, blockT: 0,
      stun: 0, hitCd: 0, hornCd: 0, braking: false, lat: 0, ox: 0, oz: 0, ovx: 0, ovz: 0, oyaw: 0, oyawv: 0, spin: 0,
      lamp: null, ignoreUntil: 0, chaseSince: 0, los: true, losT: 0, uTimer: 0, indicate: 0, ai: 0,
    };
  }

  const nightNow = () => ctx.world.sky?.state?.night ?? 0;
  const paintFor = (kind) => {
    const list = PAINTS[kind] || PAINTS.car;
    return list[(rnd() * list.length) | 0];
  };

  function leaveJunction(v) {
    if (v.occNode < 0) return;
    const list = occ.get(v.occNode);
    if (list) {
      const i = list.indexOf(v);
      if (i >= 0) list.splice(i, 1);
    }
    v.occNode = -1;
  }

  /** Can `v` enter the junction at the end of its edge now? (Same approach, or opposite flows that do not cross, may share it.) */
  function canEnter(v) {
    if (v.chase || v.ghost > 0 || v.waitT > 7) return true;
    const list = occ.get(v.link.node);
    if (!list || list.length === 0) return true;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === v) continue;
      const same = o.fromEdge === v.edge && o.fromDir === v.dir;
      if (same) continue;
      const opposite = o.fromEdge === v.edge && o.fromDir !== v.dir;
      if (opposite && !o.link.right && !v.link.right) continue;
      return false;
    }
    return true;
  }

  /** Signals (world/signal-logic.js, ctx.signals, set up by the rules agent): must `v` stop for the junction at the end of its road? */
  function redAhead(v, braking) {
    const sg = ctx.signals;
    return !!sg && !v.chase && !v.uturn && sg.mustStop(v.edge.id, v.dir, v.uEnd - v.u - 0.5 * v.len, v.speed, braking);
  }

  function enterJunction(v, carry) {
    v.inLink = true;
    v.ls = carry;
    v.fromEdge = v.edge;
    v.fromDir = v.dir;
    v.fromLane = v.lane;
    v.waitT = 0;
    if (v.link.node >= 0) {
      let list = occ.get(v.link.node);
      if (!list) occ.set(v.link.node, (list = []));
      list.push(v);
      v.occNode = v.link.node;
    }
  }

  const preferLane = (v, n2) => {
    if (n2 < 2) return 0;
    if (v.kind === 'bike' || v.kind === 'auto') return n2 - 1;
    return v.lane < n2 && rnd() < 0.7 ? v.lane : (rnd() * n2) | 0;
  };

  /** Choose the next edge at the end of the current one and build the junction link. */
  function plan(v) {
    const e = v.edge;
    if (v.chase) chaseNextEdge(city, routeFn, e, v.dir, chaseTarget, sel);
    else pickNextEdge(city, e, v.dir, v.kind, rnd, sel);
    v.nextEdge = sel.edge;
    v.nextDir = sel.dir;
    v.nextLane = preferLane(v, laneCount(sel.edge.w));
    junctionLink(city, e, v.dir, v.lane, sel.edge, sel.dir, v.nextLane, v.link);
    v.uEnd = e.len - v.link.k1;
    v.uturn = false;
  }

  /** Re-plan the next junction (a chaser picks a new way); keeps the old plan when the new link would start behind the vehicle. */
  function replan(v) {
    const e = v.edge;
    const oe = v.nextEdge;
    const od = v.nextDir;
    const ol = v.nextLane;
    plan(v);
    if (v.u > v.uEnd - 0.5 && oe) {
      v.nextEdge = oe;
      v.nextDir = od;
      v.nextLane = ol;
      junctionLink(city, e, v.dir, v.lane, oe, od, ol, v.link);
      v.uEnd = e.len - v.link.k1;
    }
  }

  /** The player is behind a chaser on this road: swing round into the opposite lane. */
  function startUTurn(v) {
    const e = v.edge;
    const ahead = 7 + v.speed * 0.35;
    if (v.u + ahead > v.uEnd - 4) return false;
    const lane2 = Math.min(v.lane, laneCount(e.w) - 1);
    uTurnLink(city, e, v.dir, v.lane, v.u, lane2, ahead, v.link);
    v.link.k2 = e.len - (v.u + ahead);
    v.link.cap = 6.5;
    v.nextEdge = e;
    v.nextDir = -v.dir;
    v.nextLane = lane2;
    v.fromEdge = e;
    v.fromDir = v.dir;
    v.fromLane = v.lane;
    v.inLink = true;
    v.ls = 0;
    v.uturn = true;
    return true;
  }

  function placeOnPath(v) {
    if (v.inLink) evalLink(v.link, v.ls, tmp);
    else lanePoint(city, v.edge, v.dir, v.lane, v.u, tmp);
    v.px = tmp.x;
    v.pz = tmp.z;
    v.ph = tmp.heading;
  }

  function finalPose(v) {
    const c = Math.cos(v.ph);
    const s = Math.sin(v.ph);
    v.x = v.px + v.ox + c * v.lat;
    v.z = v.pz + v.oz - s * v.lat;
    v.heading = v.ph + v.oyaw;
    v.fx = Math.sin(v.heading);
    v.fz = Math.cos(v.heading);
  }

  const onScreen = (x, z, cosHalf) => {
    const m = cam.matrixWorld.elements;
    const fx = -m[8];
    const fz = -m[10];
    const fl = Math.hypot(fx, fz) || 1;
    const dx = x - cam.position.x;
    const dz = z - cam.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * fx + dz * fz) / (d * fl) > cosHalf;
  };

  function spawn(primed) {
    const px = P.x;
    const pz = P.z;
    const kind = pickKind(rnd());
    const spec = KINDS[kind];
    const s = pickSpawn(
      net, px, pz, rnd,
      {
        rMin: primed ? 45 : TRAFFIC.rMin,
        rMax: TRAFFIC.rMax,
        reject: (x, z, e) => {
          if ((kind === 'bus' || kind === 'truck') && e.w < 9) return true;
          if (!primed && (x - px) ** 2 + (z - pz) ** 2 < 190 * 190 && onScreen(x, z, 0.5)) return true;
          for (let i = 0; i < vehicles.length; i++) {
            const o = vehicles[i];
            if ((o.x - x) ** 2 + (o.z - z) ** 2 < (9 + 0.5 * (o.len + spec.len)) ** 2) return true;
          }
          return false;
        },
      },
    );
    if (!s) return false;
    const v = pool.pop() || newVehicle();
    v.kind = kind;
    v.variant = kind === 'car' && rnd() < 0.45 ? 1 : 0;
    v.zs = v.variant ? SEDAN_Z : 1;
    v.id = nextId++;
    v.len = spec.len * v.zs;
    v.wid = spec.wid;
    v.mass = spec.mass;
    v.acc = spec.acc;
    v.brk = spec.brk;
    v.pace = 0.86 + rnd() * 0.26;
    v.edge = s.edge;
    v.dir = s.dir;
    v.lane = kind === 'bike' || kind === 'auto' ? laneCount(s.edge.w) - 1 : s.lane;
    v.u = s.u;
    v.inLink = false;
    v.ls = 0;
    v.chase = false;
    v.mode = 'drive';
    v.speed = 0;
    v.gap = Infinity;
    v.lead = 0;
    v.waitT = v.stuckT = v.ghost = v.blockT = 0;
    v.red = false;
    v.stun = v.hitCd = 0;
    v.hornCd = 1 + rnd() * 4;
    v.lat = v.ox = v.oz = v.ovx = v.ovz = v.oyaw = v.oyawv = 0;
    v.occNode = -1;
    v.ignoreUntil = 0;
    v.indicate = 0;
    plan(v);
    v.u = Math.min(v.u, v.uEnd - 1);
    v.speed = Math.min(speedLimit(v.edge.w) * spec.sf * v.pace, 10) * 0.8;
    v.color = paintFor(kind);
    const lin = hexToLinear(v.color);
    v.cr = lin[0];
    v.cg = lin[1];
    v.cb = lin[2];
    v.lamp = lampLayout(v.kind, v.len);
    placeOnPath(v);
    finalPose(v);
    vehicles.push(v);
    return true;
  }

  function despawn(i) {
    const v = vehicles[i];
    leaveJunction(v);
    v.chase = false;
    vehicles[i] = vehicles[vehicles.length - 1];
    vehicles.pop();
    pool.push(v);
  }

  // ------------------------------------------------------------------------------------------------ driving
  /** Distance along `v`'s own path to vehicle `o` if it is ahead in the same lane stream, else -1. */
  function pathDist(v, o) {
    if (!v.inLink) {
      if (!o.inLink) {
        if (o.edge === v.edge && o.dir === v.dir && o.lane === v.lane) return o.u > v.u ? o.u - v.u : -1;
        if (o.edge === v.nextEdge && o.dir === v.nextDir && o.lane === v.nextLane) {
          const d = v.uEnd - v.u + v.link.L + (o.u - v.link.k2);
          return o.u >= v.link.k2 - 1 ? d : -1;
        }
        return -1;
      }
      if (o.fromEdge === v.edge && o.fromDir === v.dir && o.fromLane === v.lane) return v.uEnd - v.u + o.ls;
      return -1;
    }
    // v is in a link
    if (o.inLink) {
      if (o.fromEdge === v.fromEdge && o.fromDir === v.fromDir && o.nextEdge === v.nextEdge && o.nextDir === v.nextDir) return o.ls > v.ls ? o.ls - v.ls : -1;
      return -1;
    }
    if (o.edge === v.nextEdge && o.dir === v.nextDir && o.lane === v.nextLane) return v.link.L - v.ls + (o.u - v.link.k2);
    return -1;
  }

  const OB = { gap: 0, lead: 0 };

  function scan(v) {
    let gap = Infinity;
    let lead = 0;
    const fx = v.fx;
    const fz = v.fz;
    const lx = fz; // left = (cos h, -sin h) = (fz, -fx)
    const lz = -fx;
    const look = 14 + v.speed * 2.6;
    const ghost = v.ghost > 0;
    if (!ghost) {
      for (let j = 0; j < vehicles.length; j++) {
        const o = vehicles[j];
        if (o === v) continue;
        const dx = o.x - v.x;
        const dz = o.z - v.z;
        if (dx * dx + dz * dz > 7000) continue;
        const d = pathDist(v, o);
        if (d >= 0) {
          const g = d - 0.5 * (v.len + o.len);
          if (g < gap) { gap = g; lead = o.speed; }
        }
        const f = dx * fx + dz * fz;
        if (f > 0 && f < 6 + v.speed * 0.9) {
          const l = dx * lx + dz * lz;
          if (Math.abs(l) < 0.5 * (v.wid + o.wid) + 0.35 && fx * o.fx + fz * o.fz > 0.35) {
            const g = f - 0.5 * (v.len + o.len);
            if (g < gap) { gap = g; lead = Math.max(0, o.speed * (fx * o.fx + fz * o.fz)); }
          }
        }
      }
    }
    // the player (any heading): a circle ahead in my corridor
    {
      const dx = P.x - v.x;
      const dz = P.z - v.z;
      const f = dx * fx + dz * fz;
      if (f > 0 && f < look) {
        const l = dx * lx + dz * lz;
        if (Math.abs(l) < 0.5 * v.wid + 1.15) {
          const g = f - 0.5 * v.len - 1.4;
          if (g < gap) { gap = g; lead = Math.max(0, P.vx * fx + P.vz * fz); }
        }
      }
    }
    // cows in the road and jaywalkers
    const obs = peds.obstacles;
    const n = peds.obstacleCount;
    for (let i = 0; i < n; i++) {
      const o = obs[i];
      const dx = o.x - v.x;
      const dz = o.z - v.z;
      const f = dx * fx + dz * fz;
      if (f > 0 && f < look) {
        const l = dx * lx + dz * lz;
        if (Math.abs(l) < 0.5 * v.wid + o.r + 0.3) {
          const g = f - 0.5 * v.len - o.r;
          if (g < gap) { gap = g; lead = Math.max(0, o.vx * fx + o.vz * fz); }
        }
      }
    }
    // a stop line: the junction ahead is busy
    v.blocked = false;
    const wasRed = v.red;
    v.red = false;
    if (!v.inLink) {
      const toLine = v.uEnd - v.u;
      // a red (or a yellow it cannot beat): the line holds it back even while it ignores other cars (a "ghost")
      if (toLine < 70 && redAhead(v, wasRed)) {
        v.red = true;
        if (toLine < 55) {
          v.blocked = true;
          const g = toLine - 0.5 * v.len - 1;
          if (g < gap) { gap = g; lead = 0; }
        }
      } else if (!ghost && toLine < 24 && !canEnter(v)) {
        v.blocked = true;
        const g = toLine - 0.5 * v.len - 1;
        if (g < gap) { gap = g; lead = 0; }
      }
    }
    OB.gap = gap;
    OB.lead = lead;
  }

  const playerTop = () => ctx.vehicle.params({ upgrades: ctx.state.upgrades }).top;

  function drive(v, dt, now, top) {
    scan(v);
    const e = v.edge;
    const spec = KINDS[v.kind];
    let v0 = speedLimit(e.w) * spec.sf * v.pace;
    let acc = v.acc;
    if (v.chase) {
      v0 = Math.max(v0, TRAFFIC.chaseTop * top * spec.chase);
      acc = Math.max(acc, spec.acc * 1.9);
    }
    const capMul = v.chase ? 1.35 : 1;
    if (!v.inLink) v0 = Math.min(v0, approachSpeed(v.link.cap * capMul, v.uEnd - v.u, v.brk));
    else v0 = Math.min(v0, v.link.cap * capMul);
    if (v.stun > 0) v0 = 0;
    if (v0 < 0.4 && v.stun <= 0) v0 = 0.4;
    const before = v.speed;
    v.speed = followSpeed(v.speed, dt, v0, OB.gap, OB.lead, acc, v.brk);
    v.braking = v.speed < before - 0.4 * dt || (OB.gap < 12 && v.speed < 2);
    v.gap = OB.gap;
    v.lead = OB.lead;

    // stuck bookkeeping (a gridlock breaker: after a while a car stuck at a junction ignores the other cars)
    if (v.speed < 0.3 && v.stun <= 0) {
      if (!v.red) v.stuckT += dt; // waiting for a red light is not being stuck
      if (v.blocked && !v.red) v.waitT += dt;
      if (v.stuckT > 12) { v.ghost = 4; v.stuckT = 0; }
    } else {
      v.stuckT = Math.max(0, v.stuckT - dt * 2);
      v.waitT = Math.max(0, v.waitT - dt);
    }
    if (v.ghost > 0) v.ghost -= dt;

    // advance along the path
    let adv = v.speed * dt;
    if (!v.inLink) {
      v.u += adv;
      if (v.u >= v.uEnd) {
        const carry = v.u - v.uEnd;
        if (canEnter(v)) {
          v.u = v.uEnd;
          enterJunction(v, carry);
        } else {
          v.u = v.uEnd;
          v.speed = 0;
        }
      }
    } else {
      v.ls += adv;
    }
    if (v.inLink && v.ls >= v.link.L) {
      const carry = v.ls - v.link.L;
      leaveJunction(v);
      v.edge = v.nextEdge;
      v.dir = v.nextDir;
      v.lane = v.nextLane;
      v.u = v.link.k2 + carry;
      v.inLink = false;
      v.ls = 0;
      plan(v);
      if (v.u > v.uEnd - 0.5) v.u = v.uEnd - 0.5;
    }

    // chasers: turn round when the player is behind, and square up to a stopped player
    if (v.chase) {
      v.uTimer -= dt;
      const dx = P.x - v.x;
      const dz = P.z - v.z;
      const dist = Math.hypot(dx, dz);
      if (v.uTimer <= 0 && !v.inLink && v.speed < 14) {
        v.uTimer = 0.6;
        const f = dx * v.fx + dz * v.fz;
        if (f < -14 && dist < 150 && dist > 16) {
          const ex = v.edge;
          const a = city.nodes[ex.a];
          const lat = Math.abs((P.x - a.x) * ex.dz - (P.z - a.z) * ex.dx); // distance from the road's centre line
          if (lat < 26) startUTurn(v);
        }
      }
      const e2 = v.edge;
      if (!v.inLink && dist < 22 && Math.hypot(P.vx, P.vz) < 5) {
        const o = Math.abs(laneOff(e2, v.lane));
        const hw = e2.w / 2 - 1.2;
        const rel = dx * Math.cos(v.ph) - dz * Math.sin(v.ph); // lateral position of the player relative to my path (left +)
        const target = clamp(v.lat + rel, -(o + hw), hw - o);
        v.lat += clamp(target - v.lat, -2.2 * dt, 2.2 * dt);
      } else v.lat *= Math.exp(-2.5 * dt);
    } else if (v.lat !== 0) v.lat *= Math.exp(-3 * dt);
  }
  const laneOff = (e, lane) => ((Math.min(lane, laneCount(e.w) - 1) + 0.5) * (e.w / 2)) / laneCount(e.w);

  // ------------------------------------------------------------------------------------------------ player contact
  const imp = { dax: 0, daz: 0, dbx: 0, dbz: 0, closing: 0 };
  const sep = { ax: 0, az: 0, bx: 0, bz: 0 };
  const pc = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  const vc = { x: 0, z: 0 };

  function emitHit(kind, id, severity, speed, x, z) {
    ctx.emit('traffic:hit', { kind, id, severity, speed, x, z });
    audio.thud(x, z, severity);
  }

  function collide(v, dt) {
    const spec = KINDS[v.kind];
    const dx = P.x - v.x;
    const dz = P.z - v.z;
    const far = 2 + 0.5 * v.len + 2;
    if (dx * dx + dz * dz > far * far) return;
    for (let k = 0; k < 2; k++) circleAt(P.x, P.z, P.heading, PLAYER_CIRCLES.offsets[k], pc[k]);
    let worst = 0;
    let wx = 0;
    let wz = 0;
    for (let ci = 0; ci < spec.circles.length; ci++) {
      circleAt(v.x, v.z, v.heading, spec.circles[ci], vc);
      for (let k = 0; k < 2; k++) {
        const ex = vc.x - pc[k].x;
        const ez = vc.z - pc[k].z;
        const lim = spec.r + PLAYER_CIRCLES.r;
        const d2 = ex * ex + ez * ez;
        if (d2 >= lim * lim) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? ex / d : v.fx;
        const nz = d > 1e-4 ? ez / d : v.fz;
        const depth = lim - d;
        // velocities: the vehicle drives along its heading and carries whatever shove it has been given
        const avx = v.fx * v.speed + v.ovx;
        const avz = v.fz * v.speed + v.ovz;
        exchangeImpulse(PLAYER_MASS, P.vx, P.vz, spec.mass, avx, avz, nx, nz, 0.3, imp);
        if (imp.closing > 0) {
          P.vx += imp.dax;
          P.vz += imp.daz;
          const dvf = imp.dbx * v.fx + imp.dbz * v.fz;
          v.speed = Math.max(0, v.speed + dvf);
          v.ovx += imp.dbx - v.fx * dvf;
          v.ovz += imp.dbz - v.fz * dvf;
          const rx = vc.x - v.x;
          const rz = vc.z - v.z;
          v.oyawv = clamp(v.oyawv + clamp((rx * imp.dbz - rz * imp.dbx) * 0.35, -2.5, 2.5), -3.5, 3.5);
          if (imp.closing > worst) { worst = imp.closing; wx = vc.x; wz = vc.z; }
        }
        separate(PLAYER_MASS, spec.mass, depth, nx, nz, sep);
        P.x += sep.ax;
        P.z += sep.az;
        v.ox = clamp(v.ox + sep.bx, -3.5, 3.5);
        v.oz = clamp(v.oz + sep.bz, -3.5, 3.5);
        v.x += sep.bx;
        v.z += sep.bz;
      }
    }
    if (worst > TRAFFIC.hitClosing && v.hitCd <= 0) {
      const sev = hitSeverity(worst, v.kind, spec.mass);
      v.hitCd = TRAFFIC.hitCooldown;
      v.stun = 0.7 + 1.5 * sev;
      v.hornCd = 0;
      P.jolt = Math.min(1, P.jolt + 0.25 + 0.65 * sev);
      ctx.rig?.kick?.(0.2 + 0.9 * sev);
      emitHit(v.kind, v.id, sev, worst, wx, wz);
      honkNow(v, 2);
    }
  }

  function honkNow(v, beeps) {
    audio.honk(v.x, v.z, v.kind, beeps);
  }

  // ------------------------------------------------------------------------------------------------ chase interface
  /** Make the nearest `n` free vehicles near (x, z) chase the player; `first` (a vehicle id) is recruited before the rest. Returns how many. */
  function recruit(n, x, z, { first = 0, radius = 140 } = {}) {
    const now = ctx.clock.time;
    let got = 0;
    const take = (v) => {
      v.chase = true;
      v.mode = 'chase';
      v.chaseSince = now;
      v.hornCd = 0.2 + rnd() * 0.5;
      v.ghost = 0;
      v.uTimer = 0;
      got++;
      if (!v.inLink) replan(v);
    };
    if (first) {
      const f = vehicles.find((v) => v.id === first);
      if (f && !f.chase) take(f);
    }
    while (got < n) {
      let best = null;
      let bd = radius * radius;
      for (const v of vehicles) {
        if (v.chase || v.ignoreUntil > now) continue;
        const d = (v.x - x) ** 2 + (v.z - z) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) break;
      take(best);
    }
    return got;
  }

  /** Chasers lose interest (`ids` null = all) and will not pick the player up again for `ignoreFor` seconds. */
  function release(ids = null, ignoreFor = 25) {
    const now = ctx.clock.time;
    let n = 0;
    for (const v of vehicles) {
      if (!v.chase) continue;
      if (ids && !ids.includes(v.id)) continue;
      v.chase = false;
      v.mode = 'drive';
      v.ignoreUntil = now + ignoreFor;
      v.lat = 0;
      n++;
      if (!v.inLink) replan(v);
    }
    return n;
  }

  /** Summary of the chasers around the player for the rage state machine. Writes and returns `out`. */
  function chaseInfo(escapeDist, out = {}) {
    let chasers = 0;
    let contact = 0;
    let pairs = 0;
    let boxGap = Infinity;
    const now = ctx.clock.time;
    for (const v of vehicles) {
      if (!v.chase) continue;
      chasers++;
      const d = Math.hypot(v.x - P.x, v.z - P.z);
      if (d < 9) pairs++;
      boxGap = Math.min(boxGap, d - 0.5 * v.len);
      if (d < escapeDist) {
        if (now - v.losT > 0.35) {
          v.losT = now;
          v.los = d < 25 || !colliders.blocked(v.x, v.z, P.x, P.z);
        }
        if (v.los) contact++;
      }
    }
    out.chasers = chasers;
    out.contact = contact;
    out.pairs = pairs;
    out.boxGap = boxGap;
    return out;
  }

  // ------------------------------------------------------------------------------------------------ pedestrians and cows
  const peds = createPeds(ctx, {
    rnd,
    material,
    maxPeds: Math.max(QUALITY.high.peds, 60),
    maxCows: 8,
    onHit: (kind, id, severity, speed, x, z) => emitHit(kind, id, severity, speed, x, z),
  });

  // ------------------------------------------------------------------------------------------------ the frame
  let spawnClock = 0;
  let lastX = P.x;
  let lastZ = P.z;
  const timing = { ms: 0 };

  function targetCount() {
    const d = districtDensity(districtAt(P.x, P.z).id);
    return Math.round(quality().traffic * (0.72 + 0.28 * Math.min(1, d / 1.5)));
  }

  function step(dt) {
    const now = ctx.clock.time;
    const top = playerTop();
    // teleport / fast travel: refill the ring at once
    const jump = Math.hypot(P.x - lastX, P.z - lastZ);
    lastX = P.x;
    lastZ = P.z;
    const want = targetCount();

    peds.update(dt, quality().peds);

    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      v.stun = Math.max(0, v.stun - dt);
      v.hitCd = Math.max(0, v.hitCd - dt);
      v.hornCd -= dt;
      drive(v, dt, now, top);
      // shoves from collisions fade out
      if (v.ox !== 0 || v.oz !== 0 || v.oyaw !== 0 || v.ovx !== 0 || v.ovz !== 0) {
        v.ox += v.ovx * dt;
        v.oz += v.ovz * dt;
        const k = Math.exp(-2.4 * dt);
        v.ovx *= k;
        v.ovz *= k;
        const r = Math.exp(-0.7 * dt);
        v.ox *= r;
        v.oz *= r;
        v.oyaw += v.oyawv * dt;
        v.oyawv *= Math.exp(-2.0 * dt);
        v.oyaw *= Math.exp(-0.9 * dt);
        if (Math.abs(v.ox) + Math.abs(v.oz) + Math.abs(v.oyaw) < 0.002) v.ox = v.oz = v.oyaw = 0;
      }
      placeOnPath(v);
      finalPose(v);
      v.mode = v.chase ? 'chase' : v.speed < 0.3 ? 'stopped' : 'drive';
      // honks: a chaser leaning on it, or anyone held up by the player / a cow
      if (v.hornCd <= 0) {
        const dpx = P.x - v.x;
        const dpz = P.z - v.z;
        if (v.chase && dpx * dpx + dpz * dpz < 80 * 80) {
          honkNow(v, 2);
          v.hornCd = 1.0 + rnd() * 1.6;
        } else if (v.speed < 0.6 && v.gap < 9 && v.stun <= 0 && !v.blocked) {
          v.blockT += 0.5;
          if (v.blockT > 2.2 && dpx * dpx + dpz * dpz < 160 * 160) {
            honkNow(v, v.kind === 'auto' || v.kind === 'bike' ? 2 : 1);
            v.blockT = 0;
            v.hornCd = 2.2 + rnd() * 3;
          } else v.hornCd = 0.5;
        } else v.hornCd = 0.5 + rnd() * 0.5;
      }
      collide(v, dt);
      const d2 = (v.x - P.x) ** 2 + (v.z - P.z) ** 2;
      if (d2 > TRAFFIC.despawn * TRAFFIC.despawn * (v.chase ? 2.2 : 1) || (v.stuckT > 40 && d2 > 150 * 150)) despawn(i);
    }

    // keep the ring populated: one a tick, a burst after a teleport or when well short
    spawnClock += dt;
    const short = vehicles.length < want * 0.6 || jump > 80;
    if (vehicles.length < want && (spawnClock > 0.12 || short)) {
      spawnClock = 0;
      const tries = short ? 10 : 2;
      for (let i = 0; i < tries && vehicles.length < want; i++) spawn(false);
    }
    // quality dropped: shed the surplus, furthest first
    if (vehicles.length > want + 6) {
      let far = -1;
      let fd = -1;
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        if (v.chase) continue;
        const d = (v.x - P.x) ** 2 + (v.z - P.z) ** 2;
        if (d > fd) { fd = d; far = i; }
      }
      if (far >= 0 && fd > 150 * 150) despawn(far);
    }
  }

  // ------------------------------------------------------------------------------------------------ drawing
  let blink = 0;

  function draw(t) {
    const night = nightNow();
    const dark = night > 0.12;
    blink = Math.sin(t * 7.5) > 0 ? 1 : 0;
    const flash = Math.sin(t * 9) > 0;
    for (const key in meshes) meshes[key].n = 0;
    let nBeam = 0;
    let nLamp = 0;
    const ba = beams.instanceMatrix.array;
    const bc = beams.instanceColor.array;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const m = meshes[v.kind];
      const mi = m.n++;
      writeMatrix(m.mesh.instanceMatrix.array, mi, v.x, 0, v.z, v.heading, 1, 0, v.zs);
      m.tint.array[mi * 3] = v.cr;
      m.tint.array[mi * 3 + 1] = v.cg;
      m.tint.array[mi * 3 + 2] = v.cb;
      // lamps and headlight pools: only near the player (further away they are specks)
      if ((v.x - P.x) ** 2 + (v.z - P.z) ** 2 > 170 * 170) continue;
      const L = v.lamp;
      const la = lamps.instanceMatrix.array;
      const lc = lamps.instanceColor.array;
      const base = nLamp;
      nLamp += LAMP_PER;
      const c = Math.cos(v.heading);
      const s = Math.sin(v.heading);
      const head = night > 0.12 ? 1 : 0;
      const hBr = 0.5 + 3 * Math.min(1, night * 1.6);
      const turning = !v.inLink ? v.uEnd - v.u < 26 : true;
      const side = turning && v.link.angle > 0.45 ? (v.link.right ? -1 : 1) : 0; // +1: left indicators
      const hazard = v.chase || (v.stun > 0 && v.hitCd > 0) ? 1 : 0;
      for (let k = 0; k < LAMP_PER; k++) {
        // 0,1 head L/R; 2,3 tail L/R; 4,5 front indicators L/R; 6,7 rear indicators L/R
        let lx;
        let ly;
        let lz;
        let r;
        let g;
        let b;
        const sx = k % 2 === 0 ? 1 : -1; // left first
        if (k < 2) {
          lx = L.head[0] * sx; ly = L.head[1]; lz = L.head[2];
          const on = head || (v.chase && (flash ? sx > 0 : sx < 0));
          const q = on ? (head ? hBr : 3.2) : 0.5;
          r = q; g = q * 0.92; b = q * 0.7;
        } else if (k < 4) {
          lx = L.tail[0] * sx; ly = L.tail[1]; lz = L.tail[2];
          const q = v.braking ? 2.8 : 0.3 + head * 0.35;
          r = q; g = q * 0.05; b = q * 0.06;
        } else {
          const rear = k >= 6;
          lx = L.ind[rear ? 3 : 0] * sx; ly = L.ind[rear ? 4 : 1]; lz = L.ind[rear ? 5 : 2];
          const on = hazard ? flash : side === sx && blink === 1;
          r = on ? 3.4 : 0.14; g = on ? 1.7 : 0.07; b = 0;
        }
        // one-lamp kinds (the bike's headlamp) keep the right-hand twin out of sight: scaled to nothing
        const sc = lx === 0 && sx < 0 ? 0 : 1;
        writeCS(la, base + k, v.x + lx * c + lz * s, ly, v.z - lx * s + lz * c, c, s, sc);
        lc[(base + k) * 3] = r;
        lc[(base + k) * 3 + 1] = g;
        lc[(base + k) * 3 + 2] = b;
      }
      // headlight pool
      if (dark && nBeam < CAP && v.kind !== 'bike') {
        const fwd = v.len * 0.5 + 6.2;
        writeMatrix(ba, nBeam, v.x + v.fx * fwd, 0.07, v.z + v.fz * fwd, v.heading, 1, 0);
        const q = 0.32 * Math.min(1, (night - 0.1) * 2.2);
        bc[nBeam * 3] = q;
        bc[nBeam * 3 + 1] = q * 0.92;
        bc[nBeam * 3 + 2] = q * 0.7;
        nBeam++;
      }
    }
    beams.count = nBeam;
    for (const key in meshes) {
      const m = meshes[key];
      m.mesh.count = m.n;
      m.mesh.visible = m.n > 0;
      m.mesh.instanceMatrix.needsUpdate = true;
      m.tint.needsUpdate = true;
    }
    lamps.count = nLamp;
    lamps.visible = nLamp > 0;
    lamps.instanceMatrix.needsUpdate = true;
    lamps.instanceColor.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
    beams.instanceColor.needsUpdate = true;
    beams.visible = dark;
  }

  // ------------------------------------------------------------------------------------------------ install
  const api = {
    vehicles,
    get count() { return vehicles.length; },
    nearest(x, z, r = 20) {
      let best = null;
      let bd = r * r;
      for (const v of vehicles) {
        const d = (v.x - x) ** 2 + (v.z - z) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },
    /** Relative traffic density at a point (district and avenue boosted): data only. */
    density: (x, z, w = 0) => districtDensity(districtAt(x, z).id) * (w >= 15 ? 1.5 : 1),
    recruit,
    release,
    chaseInfo,
    peds,
    audio,
    stats: timing,
    /** Every instanced mesh of the traffic system (diagnostics: draw calls and triangles). */
    get meshes() {
      return [...Object.values(meshes).map((m) => m.mesh), lamps, beams, peds.pedMesh, peds.cowMesh];
    },
    prime(n = targetCount()) {
      for (let i = 0; i < n * 3 && vehicles.length < n; i++) spawn(true);
      for (const v of vehicles) { placeOnPath(v); finalPose(v); }
      draw(ctx.clock.time);
    },
  };
  ctx.traffic = api;

  const offEvents = ctx.game.on((e) => {
    if (e.type === 'honk') peds.scare(P.x, P.z);
  });

  api.prime();

  let frame = 0;
  ctx.addSystem({
    update(dt) {
      if (ctx.state.menu || ctx.state.paused) return;
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      step(Math.min(dt, 0.1));
      draw(ctx.clock.time);
      frame++;
      if (t0) timing.ms += ((performance.now() - t0) - timing.ms) * 0.05;
    },
    dispose() {
      offEvents();
      audio.dispose();
      peds.dispose();
      for (const key in meshes) {
        ctx.scene.remove(meshes[key].mesh);
        meshes[key].mesh.dispose?.();
        meshes[key].geo.dispose();
      }
      for (const m of [lamps, beams]) {
        ctx.scene.remove(m);
        m.dispose?.();
      }
      material.dispose();
      lampMat.dispose();
      lampGeo.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      beamTex?.dispose();
      vehicles.length = 0;
      occ.clear();
      if (ctx.traffic === api) ctx.traffic = { vehicles: [], nearest: () => null };
    },
  });
}

/** Instance matrix for a yaw given as cos/sin (no trig per lamp). */
function writeCS(a, i, x, y, z, c, s, sc) {
  const o = i * 16;
  a[o] = c * sc; a[o + 1] = 0; a[o + 2] = -s * sc; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sc; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sc; a[o + 9] = 0; a[o + 10] = c * sc; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
