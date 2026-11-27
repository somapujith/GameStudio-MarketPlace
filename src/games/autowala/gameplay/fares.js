// OWNER: fares agent. The economy loop: a citywide dispatch board of customers waiting in real time, a few of them standing at the kerb
// near you (3D people with markers), pick one up, agree the price (meter / fixed / bargain), drive them, the meter ticks, and the
// drop-off pays a fare, a tip and a star rating plus a one-line review. CNG refuelling lives in fuel.js. See ARCHITECTURE.md.
//
// ctx.fares = { waiting, trip, riders(), completed, reviews, target(), select(id), abandon(), penalize({fareMul, mood, reason}),
//               choose(n), choice, uiMounted }
//   waiting[]: EVERY customer on the board (>= 20, all districts), data-only unless `near` (a 3D person exists, within ~450 m):
//     { id, x, z, name, te, kind, voice (= kind), female, pax, patience (0..1, 1 = fresh), fareEstimate, destName, destTe, dist, near,
//       district, place: null | { name, te, brand?|station?|poiId? }, wants: { luggage, urgent: null | 'train'|'flight'|'hospital'|'exam'|'meeting' }, sharer }
//   trip: null | { id, name, te, kind, female, pax, from:{x,z}, dest:{x,z,name,te,poiId,front:{x,z,edge,t}}, distanceTotal, distanceLeft,
//                  fareNow, fareEstimate (with surcharges), timeLeft|null, timeLimit|null, mood (0..1), fareMul (1 = no penalty), status:'riding',
//                  terms: { mode: 'pending'|'meter'|'fixed', fixedFare|null, rounds?, opening? },
//                  modifiers: [{ id: 'night'|'rain'|'peak'|'luggage', label, te, mul?|flat? }], surge (product of the multipliers), luggage,
//                  urgent: null | { id, en, te },
//                  shared: null | { role: 'host'|'guest', mate: { name, te, kind }, mateDest: { x, z, name, te }, extra (metres) } }
//     With a shared ride `trip` is the first rider still aboard; `riders()` lists every rider's trip (1 or 2).
// Events:
//   fare:hail     { customer: { id, x, z, kind, name, te, female, pax, place, wants } }  a customer first comes within 90 m
//   fare:missed   { customer }                                                    their patience ran out in view (they walk off)
//   fare:pickup   { trip }                                                        the (first) passenger is seated
//   fare:bargain  { trip, mode: 'meter'|'fixed', fixedFare, premium, rounds }     the price was agreed
//   fare:decline  { trip, reason: 'refused' }                                     the passenger was let go (no pay, no rating)
//   fare:shared   { trip, mate, extra }                                           a second passenger boarded (trip = host, mate = guest)
//   fare:dropoff  { trip, fare, tip, rating, fareMul, penalty, bonus, terms }     paid; rating is 1..5 stars; penalty = rupees lost to rage etc.
//   fare:review   { stars, text, te, customer: { id, name, te, kind }, fare, tip }  the passenger's review (also kept in `reviews`, last 6)
//   fare:abandon  { trip }                                                        the player dropped the fare (rating penalty, no pay)
//   fare:complain { trip, reason: 'jolt'|'speed'|'drift'|'route', stage? }        a grumble (route: stage 1 = suspicious, 2 = furious)
// Snapshot additions: trip.{terms,modifiers,surge,luggage,urgent,shared}, fareChoice (the open question or null), fareReviews, lastReview.
import { clamp, makeRng } from '../game/rng.js';
import { randomLook } from '../sim/autoModel.js';
import { DISTRICTS, districtAt } from '../world/layout.js';
import { findRoute, routeLength } from '../world/routing.js';
import { FAMOUS_SPOTS, FARE, KINDS, PLACE_KINDS, PLACE_PAIR, makeIdentity, pickKind, pickWeighted } from './fare-kinds.js';
import { brakeHit, complaintReason, crashHit, estimateFare, hardStopStep, meterNow, moodStep, newHardStop, patienceStep, rushTimeLimit, settleRide } from './fare-math.js';
import { nearestRoadInfo, pickDestination, pickHailSpot, pickPoiHailSpot, spotFromPlace } from './fare-spots.js';
import { createMarkerKit } from './fare-markers.js';
import { GROUND_Y, clearPassengers, clearSeat, createRig, createWalkers, disposeRig, poseWalk, poseWave, seatPassengers, seatRider } from './customers.js';
import { installFuel } from './fuel.js';
import { overcharged, termsOutcome } from './fare-bargain.js';
import { applyMods, computeModifiers, describeMods, isRaining, readDemand, urgentFor, urgentSettle } from './fare-modifiers.js';
import { SHARE, along, candidateFit, canOfferShare, detourExtra, detourMoodHit, effectiveDriven, shareAgrees, sharedFixedFare } from './fare-share.js';
import { ROUTE, complaintEffect, detourOf, detourStage, makeReview, pushReview } from './fare-review.js';
import { TALK, nextTalkIn } from './fare-talk.js';
import { createChoices } from './fare-choice.js';
import { maybeTalk, startTerms } from './fare-flow.js';
import { sayKey, sayLine } from './fare-say.js';

export const TUNING = {
  board: 24, // customers on the citywide dispatch board (data only unless close)
  target: 7, // customers with 3D bodies around the player
  maxRigs: 9, // never more people meshes than this (waiting + boarding + leaving)
  ringMin: 120,
  ringMax: 450,
  nearD: 220, // at least two customers live inside this
  meshIn: 450, // a customer gets a body inside this...
  meshOut: 510, // ...and loses it beyond this
  closeD: 110, // a customer this close always gets a body, even above maxRigs (by up to 3)
  hailD: 90,
  missVoiceD: 260, // a missed customer further away than this just vanishes quietly
  farRate: 0.6, // patience drains at this fraction of the speed out of view
  famousChance: 0.15,
  shopChance: 0.4,
  metroChance: 0.1,
  walkSpeed: 4.2,
  boardPad: 4, // metres added to the kerb distance for the pick-up radius
  shareChance: 0.55, // of the riders who agree to share, how many get the chance
  luggage: { tourist: 0.35, elder: 0.1, regular: 0.05, women: 0.06, student: 0.03, rusher: 0.03 },
};

const COMPLAINTS = {
  jolt: ['Aiyyo, careful!', 'Slowly, baba!', 'Arre, my back!'],
  speed: ['Not so fast!', 'Slow down, please!', 'Why the hurry?'],
  drift: ['Stop sliding!', 'Are you mad?', 'Straight, please!'],
};

const pickOf = (arr, n) => arr[n % arr.length];
const brief = (c) => ({ id: c.id, x: c.x, z: c.z, kind: c.kind, name: c.name, te: c.te, female: c.female, pax: c.pax, place: c.place, wants: c.wants });
const modView = (list) => list.map((m) => ({ ...m }));

export function installFares(ctx) {
  const { scene, world, v, auto } = ctx;
  const city = world.city;
  const colliders = world.colliders;
  const rng = makeRng(((Math.random() * 0xffffffff) >>> 0) || 7);
  const kit = createMarkerKit(scene);
  const walkers = createWalkers(scene);
  const choices = createChoices(ctx);
  const env = { ctx, choices, rng };
  const waiting = [];
  const reviews = [];
  const dropQueue = [];

  let trip = null; // the first rider still aboard (what the HUD shows)
  let riders = []; // [{ t (public trip), rd (the hidden half) }], 1 or 2 of them; riders[0].t === trip
  let ride = null; // counters shared by the whole ride
  let boarding = null; // { c, t, phase, share }
  let nextId = 1;
  let spawnT = 0.5;
  let selectedId = null;
  let nearest = null;
  let pickCand = null;
  let completed = 0;
  let lastResult = null;
  let lastReview = null;
  let stopT = 0;
  let eligible = false;
  let shareCand = null;
  let shareEligible = false;
  let clockT = 0; // game seconds with the menus subtracted
  let rigs = 0;

  const fares = {
    waiting,
    trip: null,
    completed: 0,
    reviews,
    uiMounted: false, // ui/fares/FareChoice.jsx sets this while it is mounted (otherwise the HUD prompt chip carries the hint)
    get choice() {
      return choices.snapshot();
    },
    /** Answer the open question with option n (1..3). Used by the touch buttons; keyboard 1/2/3 and the D-pad also call it. */
    choose: (n) => choices.choose(n),
    /** The trip of every rider aboard (public copies are in the events; these are the live objects). */
    riders: () => riders.map((r) => r.t),
    target() {
      if (riders.length) {
        let best = riders[0].t;
        for (let i = 1; i < riders.length; i++) {
          const o = riders[i].t;
          if (Math.hypot(o.dest.x - v.x, o.dest.z - v.z) < Math.hypot(best.dest.x - v.x, best.dest.z - v.z)) best = o;
        }
        return { type: 'dropoff', id: best.id, x: best.dest.x, z: best.dest.z, name: best.dest.name };
      }
      const c = (selectedId != null && waiting.find((w) => w.id === selectedId)) || nearest || (boarding && boarding.c);
      return c ? { type: 'pickup', id: c.id, x: c.x, z: c.z, name: c.name } : null;
    },
    select(id) {
      selectedId = waiting.some((w) => w.id === id) ? id : null;
      return selectedId != null;
    },
    abandon() {
      if (riders.length) {
        for (let i = riders.length - 1; i >= 0; i--) dropRider(riders[i], 'abandon');
      } else if (boarding) cancelBoarding();
    },
    /** Cut the fare (cumulative, never below 40%) and/or the passengers' mood: road rage, a bad scrape. No-op without a trip. */
    penalize({ fareMul = 1, mood = 0, reason = '' } = {}) {
      if (!riders.length) return false;
      for (const { t, rd } of riders) {
        rd.fareMul = Math.max(0.4, rd.fareMul * clamp(fareMul, 0, 1));
        t.fareMul = rd.fareMul;
        t.mood = clamp(t.mood + mood, 0, 1);
        t.fareNow = Math.round(rd.base * rd.fareMul);
      }
      if (reason) ctx.toast(reason, { tone: 'bad', ms: 2800 });
      return true;
    },
  };
  ctx.fares = fares;

  // ------------------------------------------------------------------------------------------------ spawning
  const countWithin = (r) => {
    let n = 0;
    for (const c of waiting) if (c.dist < r) n++;
    return n;
  };

  /** Find where the next customer stands. ring: { minD, maxD } around the player, or null to spread over `district`. */
  function findSpot(ring, district) {
    const placeIds = new Set();
    for (const c of waiting) if (c.placeId) placeIds.add(c.placeId);
    const okSpacing = (x, z, sp = 28) => !waiting.some((c) => Math.hypot(c.x - x, c.z - z) < sp);
    const inScope = (x, z) => {
      if (ring) {
        const d = Math.hypot(x - v.x, z - v.z);
        return d >= ring.minD && d <= ring.maxD;
      }
      return !district || districtAt(x, z).id === district.id;
    };
    const r = rng();
    const shops = world.shops?.shops || [];
    const stations = world.metro?.stations || [];
    if (r < TUNING.shopChance && shops.length) {
      const pool = shops.filter((s) => s.hail && !placeIds.has(s.id) && inScope(s.hail.x, s.hail.z));
      if (pool.length) {
        const s = rng.pick(pool);
        const spot = spotFromPlace(city, colliders, s.hail, { placeId: s.id, place: { name: s.name, te: s.te, brand: s.brand } });
        if (spot && okSpacing(spot.x, spot.z)) {
          return { spot, kind: pickWeighted(rng, PLACE_KINDS[s.kind] || PLACE_KINDS.restaurant), pair: PLACE_PAIR[s.kind] ?? null, luggage: s.kind === 'hotel' };
        }
      }
    } else if (r < TUNING.shopChance + TUNING.metroChance && stations.length) {
      const pool = stations.filter((s) => s.front && !placeIds.has(s.id) && inScope(s.front.x, s.front.z));
      if (pool.length) {
        const s = rng.pick(pool);
        const spot = pickPoiHailSpot(city, colliders, rng, { id: s.id, x: s.x, z: s.z, front: s.front }, waiting, 28);
        if (spot) {
          spot.placeId = s.id;
          spot.place = { name: s.name, te: s.te, station: s.id };
          return { spot, kind: pickWeighted(rng, PLACE_KINDS.metro), pair: PLACE_PAIR.metro, luggage: false };
        }
      }
    } else if (r < TUNING.shopChance + TUNING.metroChance + TUNING.famousChance) {
      const pool = [];
      for (const id of Object.keys(FAMOUS_SPOTS)) {
        const p = city.poiById[id];
        if (p?.front && !placeIds.has(id) && inScope(p.front.x, p.front.z)) pool.push(p);
      }
      if (pool.length) {
        const p = rng.pick(pool);
        const spot = pickPoiHailSpot(city, colliders, rng, p, waiting);
        if (spot) {
          spot.placeId = p.id;
          spot.place = { name: p.name, te: p.te, poiId: p.id };
          const fav = FAMOUS_SPOTS[p.id];
          return { spot, kind: rng.chance(0.7) ? rng.pick(fav) : pickKind(rng), pair: null, luggage: p.id === 'airport' };
        }
      }
    }
    let spot;
    if (ring) {
      const sp = Math.hypot(v.vx, v.vz);
      spot = pickHailSpot(city, colliders, rng, {
        px: v.x, pz: v.z, minD: ring.minD, maxD: ring.maxD, avoid: waiting, spacing: 45,
        biasX: sp > 5 ? v.vx / sp : 0, biasZ: sp > 5 ? v.vz / sp : 0, bias: sp > 5 ? 0.7 : 0,
      });
    } else {
      const d = district || rng.pick(DISTRICTS);
      spot = pickHailSpot(city, colliders, rng, { px: d.center[0], pz: d.center[1], minD: 0, maxD: d.r * 0.9, avoid: waiting, spacing: 40 });
    }
    return spot ? { spot, kind: pickKind(rng), pair: null, luggage: false } : null;
  }

  /** Build the customer record for a spot. `opts.dest`: a ready destination; `opts.sharer`: a single rider waiting along a ride. */
  function makeCustomer(spot, kind, pair, luggage, opts = {}) {
    const id = makeIdentity(rng, kind, pair);
    if (opts.sharer) id.pax = 1;
    const look = randomLook(rng);
    look.female = id.female;
    if (kind === 'elder') look.hair = '#dcdcdc';
    const dest =
      opts.dest ||
      pickDestination(city, rng, kind, spot, {
        exclude: spot.poiId ? [spot.poiId] : [],
        extra: (world.metro?.stations || []).map((s) => ({ id: s.id, name: s.name, te: s.te, kind: 'metro', front: s.front })),
      });
    const straight = Math.hypot(dest.x - spot.x, dest.z - spot.z);
    const info = nearestRoadInfo(city, spot.x, spot.z);
    const urgent = opts.sharer ? null : urgentFor(kind, dest.poiId, rng());
    const bag = !!luggage || (!opts.sharer && rng.chance(TUNING.luggage[kind] ?? 0.04));
    return {
      id: nextId++, x: spot.x, z: spot.z, kind, voice: kind, name: id.name, te: id.te, female: id.female, pax: id.pax,
      patience: 1, patienceTotal: opts.sharer ? 150 : id.patienceSeconds, fareEstimate: estimateFare(kind, straight),
      dest, destName: dest.name, destTe: dest.te, edge: spot.edge, district: spot.district, placeId: spot.placeId || null, place: spot.place || null,
      face: spot.face, boardRange: (info ? info.dist : 6) + TUNING.boardPad,
      hailed: false, near: false, dist: Math.hypot(spot.x - v.x, spot.z - v.z), look, look2: id.pax > 1 ? randomLook(rng) : null,
      luggage: bag, urgent, wants: { luggage: bag, urgent: urgent ? urgent.id : null }, sharer: !!opts.sharer, rig: null,
    };
  }

  function spawn(ring, district) {
    const found = findSpot(ring, district);
    if (!found) return false;
    waiting.push(makeCustomer(found.spot, found.kind, found.pair, found.luggage));
    return true;
  }

  /** A single rider waiting along the host's route, heading the same way (only when the host agreed to share). */
  function spawnSharer(host) {
    const from = { x: v.x, z: v.z };
    const drop = host.t.dest;
    const L = Math.hypot(drop.x - from.x, drop.z - from.z);
    if (L < 480) return false;
    for (let k = 0; k < 4; k++) {
      const p = along(from, drop, rng.range(0.3, 0.6));
      const spot = pickHailSpot(city, colliders, rng, { px: p.x, pz: p.z, minD: 0, maxD: 45, avoid: waiting, spacing: 24, tries: 40 });
      if (!spot) continue;
      const kind = rng.pick(['regular', 'student', 'women', 'tourist']);
      for (let j = 0; j < 6; j++) {
        const dest = pickDestination(city, rng, kind, spot, { minD: 220, maxD: L * 1.2, exclude: drop.poiId ? [drop.poiId] : [] });
        const fit = candidateFit(from, drop, { x: spot.x, z: spot.z, pax: 1, kind, urgent: null, dest }, Infinity);
        if (fit.ok) {
          const c = makeCustomer(spot, kind, 0, false, { sharer: true, dest });
          waiting.push(c);
          ride.sharerId = c.id;
          return true;
        }
      }
    }
    return false;
  }

  /** Where a customer's feet are: the pavement slab, or the bare ground in a park block (there is no slab there, they used to float 20 cm). */
  const groundAt = (x, z) => (typeof ctx.world?.heightAt === 'function' ? ctx.world.heightAt(x, z) : GROUND_Y);

  function attach(c) {
    c.rig = createRig(c);
    c.rig.position.set(c.x, groundAt(c.x, c.z), c.z);
    c.rig.rotation.y = c.face;
    scene.add(c.rig);
    c.near = true;
    rigs++;
  }

  function detach(c) {
    disposeRig(c.rig);
    c.rig = null;
    c.near = false;
    rigs--;
  }

  function removeAt(i) {
    const [c] = waiting.splice(i, 1);
    if (c.id === selectedId) selectedId = null;
    if (c === nearest) nearest = null;
    if (c === shareCand) shareCand = null;
    return c;
  }

  function expire(i) {
    const c = removeAt(i);
    if (c.rig && c.dist < TUNING.missVoiceD) {
      ctx.emit('fare:missed', { customer: brief(c) });
      if (c.dist < 160) ctx.toast(`${c.name} gave up waiting`, { tone: 'bad', ms: 1800 });
      const e = city.edges[c.edge];
      const s = rng.sign();
      walkers.add(c.rig, e.dx * s, e.dz * s, { speed: 1.7, ttl: 4.5 });
      c.rig = null;
      rigs--;
    } else if (c.rig) {
      disposeRig(c.rig);
      c.rig = null;
      rigs--;
    }
  }

  // ------------------------------------------------------------------------------------------------ boarding
  function startBoarding(c, share = false) {
    const i = waiting.indexOf(c);
    if (i >= 0) waiting.splice(i, 1);
    if (c.id === selectedId) selectedId = null;
    nearest = null;
    pickCand = null;
    shareCand = null;
    boarding = { c, t: 0, phase: 0, share };
    stopT = 0;
    ctx.setPrompt('pickup', null);
    ctx.setPrompt('share', null);
  }

  function cancelBoarding() {
    const c = boarding.c;
    boarding = null;
    c.x = c.rig.position.x;
    c.z = c.rig.position.z;
    c.rig.position.y = groundAt(c.x, c.z);
    waiting.push(c);
  }

  /** The hidden half of a rider: everything the ride tracks for one passenger. */
  function buildRider(c, slot) {
    const straight = Math.hypot(c.dest.x - v.x, c.dest.z - v.z);
    const estRaw = estimateFare(c.kind, Math.hypot(c.dest.x - c.x, c.dest.z - c.z));
    const hour = ctx.clock?.hour ?? 12;
    const mods = computeModifiers({ hour, raining: isRaining(ctx.weather), demand: readDemand(ctx.career, hour), luggage: c.luggage });
    const limit = c.urgent ? rushTimeLimit(straight) : null;
    const t = {
      id: c.id, name: c.name, te: c.te, kind: c.kind, female: c.female, pax: c.pax, place: c.place,
      from: { x: c.x, z: c.z },
      dest: { ...c.dest },
      distanceTotal: straight, distanceLeft: straight,
      fareNow: applyMods(meterNow(c.kind, 0, 0, estRaw), mods), fareEstimate: applyMods(estRaw, mods), fareMul: 1,
      timeLeft: limit, timeLimit: limit, mood: KINDS[c.kind].start, status: 'riding',
      terms: { mode: 'pending', fixedFare: null },
      modifiers: modView(mods.list), surge: mods.mul, luggage: !!c.luggage, urgent: c.urgent ? { ...c.urgent } : null, shared: null,
    };
    let ideal = 0;
    try {
      ideal = routeLength(findRoute(city, { x: v.x, z: v.z }, c.dest));
    } catch {
      ideal = 0;
    }
    const rd = {
      slot, cust: { pax: c.pax, look: c.look, look2: c.look2, kind: c.kind, female: c.female, luggage: false },
      estRaw, mods, startT: ride.elapsed, drivenAt: ride.driven, waitedAt: ride.waited, sharedM: 0, moodSum: 0, moodN: 0,
      fareMul: 1, base: t.fareNow, tipMul: 1, premium: 0, crashes: 0, joltT: 0, fastT: 0, host: false, terms: t.terms, flags: {},
      route: { driven0: ride.driven, ideal, stage: 0, grace: 0, appliedMood: 0, appliedMul: 1 },
      talk: { used: [], count: 0, next: nextTalkIn(true, rng()) },
    };
    return { t, rd };
  }

  function completeBoarding() {
    const c = boarding.c;
    const share = boarding.share;
    boarding = null;
    if (share && riders.length) return completeShare(c);
    ride = {
      driven: 0, waited: 0, elapsed: 0, lastDist: v.distance, stop: newHardStop(v.fwd),
      scenic: false, scenicT: 0, complainT: 4, routeT: ROUTE.checkEvery, routeI: 0, shareOk: false, sharerId: null, shareHinted: false,
    };
    const rider = buildRider(c, 0);
    riders = [rider];
    trip = rider.t;
    fares.trip = trip;
    disposeRig(c.rig);
    c.rig = null;
    rigs--;
    seatPassengers(auto, c);
    ctx.emit('fare:pickup', { trip: publicTrip(trip) });
    const t = trip;
    const urgentText = t.urgent ? `${t.urgent.en}! ` : '';
    ctx.toast(t.urgent ? `${c.name}: ${urgentText}Hurry to ${t.dest.name}` : `${c.name} wants to go to ${t.dest.name}`, { tone: t.urgent ? 'gold' : 'info', ms: 3600 });
    if (t.urgent) sayKey(ctx, 'urgentOn', { speaker: t.name, kind: t.kind, n: t.id });
    // the price talk: a question, never a block (it times out to the meter)
    startTerms(env, { t, ref: t.fareEstimate, note: describeMods({ list: t.modifiers }) || null }, (terms) => onTerms(rider, terms));
    // would they share? only some rides, never an urgent or a double booking
    const agrees = !t.urgent && c.pax === 1 && shareAgrees(t.kind, rng()) && rng() < TUNING.shareChance;
    ride.shareOk = agrees;
    if (agrees && rng() < SHARE.spawnChance) spawnSharer(rider);
  }

  /** The second passenger gets in. */
  function completeShare(c) {
    const host = riders[0];
    const rider = buildRider(c, 1);
    rider.t.terms = rider.rd.terms = { mode: 'meter', fixedFare: null };
    const extra = detourExtra({ x: v.x, z: v.z }, c, host.t.dest);
    const hit = detourMoodHit(host.t.kind, extra);
    host.t.mood = clamp(host.t.mood - hit, 0, 1);
    host.rd.host = true;
    host.rd.flags.shared = true;
    rider.rd.flags.shared = true;
    // the host's route is judged from here: the share detour is the mood hit above, not a "wrong route"
    rebaseRoute(host);
    rebaseRoute(rider);
    host.t.shared = { role: 'host', mate: { name: rider.t.name, te: rider.t.te, kind: rider.t.kind }, mateDest: { x: rider.t.dest.x, z: rider.t.dest.z, name: rider.t.dest.name, te: rider.t.dest.te }, extra: Math.round(extra) };
    rider.t.shared = { role: 'guest', mate: { name: host.t.name, te: host.t.te, kind: host.t.kind }, mateDest: { x: host.t.dest.x, z: host.t.dest.z, name: host.t.dest.name, te: host.t.dest.te }, extra: Math.round(extra) };
    riders.push(rider);
    disposeRig(c.rig);
    c.rig = null;
    rigs--;
    seatRider(auto, 1, c.look);
    ctx.emit('fare:shared', { trip: publicTrip(host.t), mate: publicTrip(rider.t), extra: Math.round(extra) });
    ctx.toast(`${c.name} shares the ride to ${c.dest.name}. Two drop-offs, fares split!`, { tone: 'gold', ms: 3600 });
    sayKey(ctx, 'shareBoard', { speaker: c.name, kind: c.kind, n: c.id });
    if (hit > 0.06) sayKey(ctx, 'shareGrumble', { speaker: host.t.name, kind: host.t.kind, n: host.t.id });
  }

  function rebaseRoute(rider) {
    const rt = rider.rd.route;
    let ideal = 0;
    try {
      ideal = routeLength(findRoute(city, { x: v.x, z: v.z }, rider.t.dest));
    } catch {
      ideal = 0;
    }
    rt.driven0 = ride.driven;
    rt.ideal = ideal;
    rt.stage = 0;
    rt.appliedMood = 0;
    rt.appliedMul = 1;
  }

  const publicTrip = (t) => ({
    ...t, from: { ...t.from }, dest: { ...t.dest, front: { ...t.dest.front } }, terms: { ...t.terms }, modifiers: modView(t.modifiers),
    urgent: t.urgent ? { ...t.urgent } : null, shared: t.shared ? { ...t.shared } : null,
  });

  /** The price is settled: apply what it does to the rider. `terms` null: the passenger is let go. */
  function onTerms(rider, terms) {
    if (!riders.includes(rider)) return;
    const { t, rd } = rider;
    if (!terms) {
      dropRider(rider, 'decline');
      return;
    }
    const o = termsOutcome(t.kind, terms, t.fareEstimate);
    t.terms = rd.terms = { mode: terms.mode, fixedFare: terms.mode === 'fixed' ? terms.fixedFare : null, rounds: terms.rounds || 0, opening: terms.opening || null };
    t.mood = clamp(t.mood + o.mood - (terms.afterRefusal ? 0.04 : 0), 0, 1);
    rd.tipMul = o.tipMul;
    rd.premium = o.premium;
    rd.flags.honest = terms.mode === 'meter' && !terms.afterRefusal;
    rd.flags.bargain = terms.mode === 'fixed' && (terms.rounds || 0) > 1 && o.premium <= 0.2;
    rd.flags.overcharged = overcharged(t.kind, o.premium);
    ctx.emit('fare:bargain', { trip: publicTrip(t), mode: t.terms.mode, fixedFare: t.terms.fixedFare, premium: o.premium, rounds: t.terms.rounds });
    ctx.toast(terms.mode === 'fixed' ? `Agreed: Rs ${terms.fixedFare} fixed` : 'Meter it is', { tone: terms.mode === 'fixed' && o.premium < -0.02 ? 'bad' : 'good', ms: 2000 });
  }

  // ------------------------------------------------------------------------------------------------ the ride
  function sceneryNear() {
    for (const p of city.pois) {
      if (p.kind === 'cng' || p.id === 'garage') continue;
      if (Math.hypot(v.x - p.x, v.z - p.z) < Math.max(p.w, p.d) * 0.5 + 45) return true;
    }
    return false;
  }

  /** The fare a rider would pay if the ride ended now (before the rage / detour cut). */
  function riderBase(t, rd) {
    if (rd.terms.mode === 'fixed') return sharedFixedFare(rd.terms.fixedFare, rd.sharedM);
    const eff = effectiveDriven(ride.driven, rd.drivenAt, rd.sharedM);
    return applyMods(meterNow(t.kind, eff, Math.max(0, ride.waited - rd.waitedAt), rd.estRaw), rd.mods);
  }

  function complainRoute(rider, stage) {
    const { t, rd } = rider;
    const rt = rd.route;
    const eff = complaintEffect(stage, t.kind);
    t.mood = clamp(t.mood + (eff.mood - rt.appliedMood), 0, 1);
    const mulStep = eff.fareMul / rt.appliedMul;
    rd.fareMul = Math.max(0.4, rd.fareMul * mulStep);
    t.fareMul = rd.fareMul;
    rt.appliedMood = eff.mood;
    rt.appliedMul = eff.fareMul;
    rd.flags.wrongRoute = true;
    ctx.emit('fare:complain', { trip: publicTrip(t), reason: 'route', stage });
    sayKey(ctx, stage >= 2 ? 'wrong2' : 'wrong1', { speaker: t.name, kind: t.kind, n: t.id });
    ctx.toast(`${t.name} thinks you are taking the long way${stage >= 2 ? ' round' : ''}!`, { tone: 'bad', ms: 2200 });
  }

  /** Compare the way driven with the shortest road route to this rider's drop-off. */
  function checkRoute(rider) {
    const rt = rider.rd.route;
    if (!(rt.ideal > 0) || ride.driven - rt.driven0 < ROUTE.minDriven) return;
    let remaining = 0;
    try {
      remaining = routeLength(findRoute(city, { x: v.x, z: v.z }, rider.t.dest));
    } catch {
      return;
    }
    if (!(remaining > 0)) return;
    const stage = detourStage(detourOf(ride.driven, rt.driven0, remaining, rt.ideal), rt.ideal, rt.grace);
    if (stage > rt.stage) {
      rt.stage++; // one step per check: a first grumble before the furious one
      complainRoute(rider, rt.stage);
    }
  }

  function updateRide(dt) {
    const r = ride;
    r.elapsed += dt;
    const dd = Math.max(0, v.distance - r.lastDist);
    r.driven += dd;
    r.lastDist = v.distance;
    if (v.speed < 0.5) r.waited += dt;
    r.scenicT -= dt;
    if (r.scenicT <= 0) {
      r.scenicT = 0.6;
      r.scenic = sceneryNear();
    }
    // a hard stop from speed: once per stop, not once per frame of braking
    const hardStop = hardStopStep(r.stop, v.fwd, dt);
    const shared = riders.length > 1;
    dropQueue.length = 0;
    for (let i = 0; i < riders.length; i++) {
      const rider = riders[i];
      const { t, rd } = rider;
      const k = KINDS[t.kind] || KINDS.regular;
      const mine = r.elapsed - rd.startT;
      if (hardStop) t.mood = brakeHit(t.kind, t.mood);
      if (shared) {
        rd.sharedM += dd;
        if (rd.host) t.mood = clamp(t.mood - SHARE.moodDrain * dt, 0, 1);
      }
      const late = t.timeLimit != null && mine > t.timeLimit;
      const s = { kmh: v.kmh, jolt: v.jolt, drifting: v.drifting, scenic: r.scenic, late };
      t.mood = moodStep(t.kind, t.mood, s, dt);
      rd.moodSum += t.mood * dt;
      rd.moodN += dt;
      if (v.jolt > 0.45) rd.joltT += dt;
      if (v.kmh > k.maxKmh + 8 && k.speedPain > 0.001) rd.fastT += dt;
      if (i === 0) {
        r.complainT -= dt;
        if (r.complainT <= 0) {
          const why = complaintReason(t.kind, s);
          if (why) {
            r.complainT = 9;
            ctx.emit('fare:complain', { trip: publicTrip(t), reason: why });
            ctx.toast(`${t.name}: "${pickOf(COMPLAINTS[why], t.id + rd.crashes)}"`, { tone: 'bad', ms: 1700 });
          }
        }
      }
      t.distanceLeft = Math.hypot(v.x - t.dest.x, v.z - t.dest.z);
      rd.base = riderBase(t, rd);
      t.fareNow = Math.round(rd.base * rd.fareMul);
      if (t.timeLimit != null) t.timeLeft = Math.max(0, t.timeLimit - mine);
      if (t.distanceLeft < FARE.dropRadius && v.speed < FARE.dropSpeed) dropQueue.push(rider);
    }
    // the way: one rider is checked every few seconds (a route search each)
    r.routeT -= dt;
    if (r.routeT <= 0 && riders.length) {
      r.routeT = ROUTE.checkEvery;
      r.routeI = (r.routeI + 1) % riders.length;
      const rider = riders[r.routeI];
      if (rider && rider.rd.terms.mode !== 'pending') checkRoute(rider);
    }
    // small talk: an optional question now and then
    const host = riders[0];
    if (host && !choices.current && !boarding && host.rd.terms.mode !== 'pending') {
      const tk = host.rd.talk;
      tk.next -= dt;
      if (tk.next <= 0) {
        if (tk.count >= TALK.max || ctx.rage?.active) {
          tk.next = 25;
        } else {
          const soon = host.t.timeLeft != null && host.t.timeLeft < TALK.minLeft;
          const opened = maybeTalk(env, host, { urgentSoon: soon }, (fx) => {
            host.t.mood = clamp(host.t.mood + fx.mood, 0, 1);
            host.rd.route.grace += fx.grace;
            host.rd.tipMul *= fx.tipMul;
          });
          tk.next = opened ? nextTalkIn(false, rng()) : 20;
        }
      }
    }
    for (const rider of dropQueue) if (riders.includes(rider)) dropRider(rider, 'pay');
  }

  /** One rider leaves the auto: paid, abandoned or let go. The other rider (if any) carries on as the trip. */
  function dropRider(rider, mode) {
    const { t, rd } = rider;
    const data = ctx.profile.data;
    // the passenger steps out on the auto's right side and walks away from the road
    const side = { x: Math.cos(v.heading), z: -Math.sin(v.heading) };
    const back = rd.slot ? -0.9 : 0;
    const rig = createRig(rd.cust);
    rig.position.set(v.x + side.x * 1.5 + Math.sin(v.heading) * back, GROUND_Y * 0.5, v.z + side.z * 1.5 + Math.cos(v.heading) * back);
    scene.add(rig);
    walkers.add(rig, side.x, side.z, { speed: mode === 'pay' ? 1.5 : 2.2, ttl: 4.5 });
    clearSeat(auto, rd.slot);
    if (mode === 'abandon') {
      data.ratingSum += 1;
      data.ratingCount += 1;
      ctx.profile.save();
      ctx.emit('fare:abandon', { trip: publicTrip(t) });
      ctx.toast(`${t.name} got out. Bad rating!`, { tone: 'bad', ms: 2600 });
    } else if (mode === 'decline') {
      ctx.emit('fare:decline', { trip: publicTrip(t), reason: 'refused' });
      ctx.toast(`${t.name} walked away. No ride.`, { tone: 'info', ms: 2200 });
    } else {
      settleRider(rider);
    }
    const i = riders.indexOf(rider);
    if (i >= 0) riders.splice(i, 1);
    if (riders.length) {
      trip = riders[0].t;
      trip.shared = null;
      riders[0].rd.host = false;
      ride.shareOk = false; // the second seat was used: no third rider (it would be built on the same seat slot and be invisible)
      fares.trip = trip;
    } else {
      choices.cancel();
      ctx.setPrompt('share', null);
      clearPassengers(auto);
      trip = null;
      ride = null;
      fares.trip = null;
    }
  }

  function settleRider(rider) {
    const { t, rd } = rider;
    const data = ctx.profile.data;
    const mine = ride.elapsed - rd.startT;
    if (t.terms.mode === 'pending') onTermsLate(rider);
    const avg = rd.moodN > 0 ? rd.moodSum / rd.moodN : t.mood;
    const res = settleRide({ kind: t.kind, fareNow: t.fareNow, mood: t.mood, avgMood: avg, timeLimit: t.timeLimit, timeLeft: t.timeLimit != null ? t.timeLimit - mine : null });
    const penalty = Math.max(0, Math.round(rd.base) - res.fare);
    let fare = res.fare;
    let bonus = 0;
    if (t.urgent) {
      const u = urgentSettle({ fare, timeLeft: t.timeLimit != null ? t.timeLimit - mine : NaN, timeLimit: t.timeLimit });
      fare = u.fare;
      bonus = u.bonus;
    }
    const tip = Math.round(res.tip * rd.tipMul);
    ctx.economy.add(fare, 'fare', 'fare');
    if (tip > 0) ctx.economy.add(tip, 'tip', 'tip');
    data.rides += 1;
    data.ratingSum += res.stars;
    data.ratingCount += 1;
    ctx.profile.save();
    completed++;
    fares.completed = completed;
    t.status = 'arrived';
    const pub = publicTrip(t);
    pub.stars = res.stars;
    // the review
    const flags = {
      ...rd.flags, late: res.late, crashed: rd.crashes > 0, rough: rd.joltT > 4, speeding: rd.fastT > 6,
      shared: !!rd.flags.shared && rd.sharedM > 50, urgentOk: !!t.urgent && !res.late,
    };
    const review = makeReview({ stars: res.stars, flags, n: t.id + res.stars + completed });
    const entry = { stars: review.stars, text: review.text, te: review.te, name: t.name, kind: t.kind, fare, tip, at: ctx.clock.time };
    pushReview(reviews, entry);
    lastReview = entry;
    lastResult = { name: t.name, te: t.te, fare, tip, stars: res.stars, late: res.late, kind: t.kind, penalty, fareMul: rd.fareMul, bonus, at: ctx.clock.time };
    ctx.emit('fare:dropoff', { trip: pub, fare, tip, rating: res.stars, fareMul: rd.fareMul, penalty, bonus, terms: { ...t.terms } });
    ctx.emit('fare:review', { stars: review.stars, text: review.text, te: review.te, customer: { id: t.id, name: t.name, te: t.te, kind: t.kind }, fare, tip });
    const stars = '★'.repeat(res.stars);
    const cut = rd.fareMul < 0.99 ? ' (cut)' : '';
    const extra = bonus > 0 ? ` (incl. Rs ${bonus} urgent bonus)` : ''; // the bonus is already inside `fare`
    const text = res.late ? `${t.name} arrived late: Rs ${fare} ${stars}` : tip > 0 ? `Rs ${fare}${extra} + Rs ${tip} tip ${stars}${cut}` : `Fare Rs ${fare}${extra} ${stars}${cut}`;
    ctx.toast(text, { tone: res.late || res.stars <= 2 || rd.fareMul < 0.99 ? 'bad' : tip > 0 || bonus > 0 ? 'gold' : 'good', ms: 3200 });
    sayLine(ctx, { id: 'fare:review', speaker: t.name, kind: t.kind, line: { en: `${stars}  "${review.text}"`, te: `${stars}  ${review.te}` } });
  }

  /** The drop-off came before the price talk was answered (a very short ride): it was the meter all along. */
  function onTermsLate(rider) {
    rider.t.terms = rider.rd.terms = { mode: 'meter', fixedFare: null };
    rider.rd.base = riderBase(rider.t, rider.rd);
    rider.t.fareNow = Math.round(rider.rd.base * rider.rd.fareMul);
  }

  const offEvents = ctx.game.on((e) => {
    if (!riders.length) return;
    if (e.type === 'crash') {
      // a guardrail brush (wall, tree, lamp post) only jolts the passengers a little and is not counted as a crash
      for (const { t, rd } of riders) {
        if (e.guard) t.mood = crashHit(t.kind, t.mood, e.strength * 0.25);
        else {
          t.mood = crashHit(t.kind, t.mood, e.strength);
          rd.crashes++;
        }
      }
    } else if (e.type === 'traffic:hit') {
      for (const { t, rd } of riders) {
        t.mood = clamp(t.mood - (e.severity || 0.3) * 0.4, 0, 1);
        rd.crashes++;
      }
    } else if (e.type === 'rage:start') {
      for (const { t } of riders) t.mood = clamp(t.mood - 0.1, 0, 1);
    }
  });

  // ------------------------------------------------------------------------------------------------ the frame
  function updateWaiting(dt) {
    const busy = riders.length || boarding;
    nearest = null;
    pickCand = null;
    let best = Infinity;
    let bestPick = Infinity;
    for (let i = waiting.length - 1; i >= 0; i--) {
      const c = waiting[i];
      const d = Math.hypot(c.x - v.x, c.z - v.z);
      c.dist = d;
      // bodies come and go with distance (and never more than maxRigs of them)
      // (a sharer, or anyone you have almost reached, may exceed the cap a little: they must have a body when the auto arrives)
      const spare = c.sharer ? 2 : d < TUNING.closeD ? 3 : 0;
      if (!c.rig && d < (c.sharer ? 260 : TUNING.meshIn) && rigs + (boarding ? 1 : 0) + walkers.count < TUNING.maxRigs + spare) attach(c);
      else if (c.rig && d > TUNING.meshOut) detach(c);
      if (c.rig && !c.hailed && d < TUNING.hailD) {
        c.hailed = true;
        ctx.emit('fare:hail', { customer: brief(c) });
      }
      c.patience = patienceStep(c.patience, c.patienceTotal, dt, (busy ? 0.5 : 1) * (c.rig ? 1 : TUNING.farRate));
      if (c.patience <= 0) {
        expire(i);
        continue;
      }
      if (d < best) {
        best = d;
        nearest = c;
      }
      if (c.rig) {
        const over = d - c.boardRange;
        if (over < 0 && d < bestPick) {
          bestPick = d;
          pickCand = c;
        }
        const show = d < 300; // (was 520: a customer is ~5 px tall at 300 m and every visible one is a skinned draw of ~15 GL calls; their markers are separate)
        c.rig.visible = show;
        if (show) poseWave(c.rig, clockT, clamp(1 - d / 70, 0, 1), c.patience < 0.25 ? 1 - c.patience / 0.25 : 0);
      }
    }
  }

  function updatePickup(dt) {
    const cand = !riders.length && !boarding && pickCand && v.speed < FARE.boardSpeed ? pickCand : null;
    if (!cand) {
      if (eligible) ctx.setPrompt('pickup', null);
      eligible = false;
      stopT = 0;
      return;
    }
    ctx.setPrompt('pickup', `Pick up ${cand.name}`, 'E');
    if (!eligible) {
      eligible = true;
      ctx.input.pressed('interact'); // a tap from before we arrived must not board them
      return;
    }
    stopT = v.speed < 0.6 ? stopT + dt : 0;
    if (ctx.input.pressed('interact') || stopT >= FARE.boardStopSeconds) {
      eligible = false;
      startBoarding(cand);
    }
  }

  /** While one passenger rides and agreed to share, a fitting customer beside the auto can be taken along (E). */
  function updateShare() {
    const host = riders.length === 1 && !boarding ? riders[0] : null;
    let cand = null;
    if (host && ride.shareOk && canOfferShare({ pax: host.t.pax, urgent: !!host.t.urgent, kind: host.t.kind, shared: false }, { agreed: true, distLeft: host.t.distanceLeft, elapsed: ride.elapsed - host.rd.startT })) {
      const me = { x: v.x, z: v.z };
      let bestD = Infinity;
      for (const c of waiting) {
        if (!c.rig || c.pax !== 1 || c.dist > SHARE.reach || c.dist >= bestD) continue;
        if (!candidateFit(me, host.t.dest, c).ok) continue;
        bestD = c.dist;
        cand = c;
      }
      if (cand && !ride.shareHinted && cand.dist < 110) {
        ride.shareHinted = true;
        ctx.toast(`${host.t.name} is fine to share. ${cand.name} is waiting ahead.`, { tone: 'info', ms: 2800 });
        sayKey(ctx, 'shareOk', { speaker: host.t.name, kind: host.t.kind, n: host.t.id });
      }
    }
    shareCand = cand;
    const near = cand && cand.dist < cand.boardRange && v.speed < FARE.boardSpeed ? cand : null;
    if (!near) {
      if (shareEligible) ctx.setPrompt('share', null);
      shareEligible = false;
      return;
    }
    ctx.setPrompt('share', `Take ${near.name} along (share the fare)`, 'E');
    if (!shareEligible) {
      shareEligible = true;
      ctx.input.pressed('interact');
      return;
    }
    if (ctx.input.pressed('interact')) {
      shareEligible = false;
      startBoarding(near, true);
    }
  }

  function updateBoarding(dt) {
    const b = boarding;
    b.t += dt;
    const rig = b.c.rig;
    const dx = v.x - rig.position.x;
    const dz = v.z - rig.position.z;
    const d = Math.hypot(dx, dz);
    if (d > b.c.boardRange + 10) {
      cancelBoarding();
      return;
    }
    rig.visible = true;
    rig.rotation.y = Math.atan2(dx, dz);
    const step = Math.min(d, TUNING.walkSpeed * dt);
    if (d > 0.01) {
      rig.position.x += (dx / d) * step;
      rig.position.z += (dz / d) * step;
    }
    b.phase += dt * 13;
    poseWalk(rig, b.phase);
    if (d < 1.6 || b.t > 1.5) completeBoarding();
  }

  function updateSpawns(dt) {
    spawnT -= dt;
    if (spawnT > 0) return;
    const near = countWithin(TUNING.meshIn);
    let ok = true;
    if (waiting.length < TUNING.board + 4 && (countWithin(TUNING.nearD) < 2 || near < TUNING.target) && rigs < TUNING.maxRigs) {
      ok = spawn({ minD: TUNING.ringMin, maxD: countWithin(TUNING.nearD) < 2 ? TUNING.nearD : TUNING.ringMax }, null);
    } else if (waiting.length < TUNING.board) {
      // keep every district stocked: the emptiest one first
      const counts = new Map(DISTRICTS.map((d) => [d.id, 0]));
      for (const c of waiting) if (counts.has(c.district)) counts.set(c.district, counts.get(c.district) + 1);
      let low = DISTRICTS[0];
      for (const d of DISTRICTS) if (counts.get(d.id) < counts.get(low.id)) low = d;
      ok = spawn(null, rng.chance(0.75) ? low : null);
    }
    spawnT = ok ? 0.45 : 0.3;
  }

  const system = {
    update(dt) {
      if (ctx.state.menu) {
        if (ride) ride.stop.fwd = v.fwd; // the menu holds the auto: closing it at speed must not read as a crash stop
      } else {
        clockT += dt;
        if (riders.length) updateRide(dt);
        updateWaiting(dt);
        updatePickup(dt);
        if (riders.length) updateShare();
        else if (shareEligible) {
          shareEligible = false;
          ctx.setPrompt('share', null);
        }
        if (boarding) updateBoarding(dt);
        walkers.update(dt);
        updateSpawns(dt);
        choices.update(dt);
      }
      kit.frame(clockT);
    },
    dispose() {
      offEvents();
      choices.dispose();
      for (const c of waiting) if (c.rig) disposeRig(c.rig);
      waiting.length = 0;
      if (boarding?.c.rig) disposeRig(boarding.c.rig);
      boarding = null;
      walkers.dispose();
      clearPassengers(auto);
      kit.dispose();
      ctx.setPrompt('pickup', null);
      ctx.setPrompt('share', null);
    },
  };
  ctx.addSystem(system);

  ctx.addSnapshot(() => ({
    trip: trip
      ? {
          id: trip.id, name: trip.name, te: trip.te, kind: trip.kind, pax: trip.pax, status: trip.status,
          fareNow: trip.fareNow, fareEstimate: trip.fareEstimate, fareMul: trip.fareMul, distanceLeft: Math.round(trip.distanceLeft), distanceTotal: Math.round(trip.distanceTotal),
          timeLeft: trip.timeLeft, mood: trip.mood, dest: { name: trip.dest.name, te: trip.dest.te },
          terms: { mode: trip.terms.mode, fixedFare: trip.terms.fixedFare }, modifiers: trip.modifiers, surge: trip.surge, luggage: trip.luggage, urgent: trip.urgent,
          shared: trip.shared ? { role: trip.shared.role, mate: trip.shared.mate, mateDest: { name: trip.shared.mateDest.name, te: trip.shared.mateDest.te }, extra: trip.shared.extra } : null,
          riders: riders.length,
        }
      : null,
    waitingCount: waiting.length,
    waitingNear: countWithin(TUNING.meshIn),
    fares: completed,
    lastFare: lastResult,
    fareChoice: choices.snapshot(),
    fareReviews: reviews.slice(),
    lastReview,
    nearestFare: nearest
      ? { id: nearest.id, name: nearest.name, te: nearest.te, kind: nearest.kind, dist: Math.round(nearest.dist), patience: nearest.patience, fareEstimate: nearest.fareEstimate, place: nearest.place, wants: nearest.wants }
      : null,
  }));

  // ------------------------------------------------------------------------------------------------ markers
  kit.addPainter((k, time) => {
    for (const c of waiting) {
      const d = c.dist;
      if (d > 560) continue;
      const fade = clamp((560 - d) / 330, 0.3, 1);
      const urgency = clamp((0.35 - c.patience) / 0.35, 0, 1);
      const isTarget = c === nearest || c.id === selectedId;
      const pulse = 0.85 + 0.15 * Math.sin(time * 3.1 + c.id);
      const kk = fade * pulse * 1.15;
      // a rider who could share the current ride glows violet instead of gold
      const sharing = c === shareCand;
      const r = sharing ? 0.62 * kk : 1.0 * kk;
      const g = sharing ? 0.3 * kk : (0.72 - 0.54 * urgency) * kk;
      const b = sharing ? 1.0 * kk : (0.14 + 0.02 * urgency) * kk;
      k.ring(c.x, GROUND_Y + 0.05, c.z, ((isTarget || sharing ? 2.0 : 1.55) + d * 0.008) * (1 + 0.05 * Math.sin(time * 4 + c.id)), r, g, b);
      if (d > 8) {
        const size = clamp(0.38 + d * 0.012, 0.4, 5) * (isTarget || sharing ? 1.3 : 1);
        const y = GROUND_Y + 2.6 + size * 1.1 + 0.22 * Math.sin(time * 2.4 + c.id * 1.7);
        k.diamond(c.x, y, c.z, size * 0.55, size * 0.9, time * 1.6 + c.id, r * 1.05, g * 1.05, b * 1.4);
      }
      if (isTarget && c === nearest) {
        const bk = 0.5 * clamp((d - 6) / 40, 0.15, 1); // a thin pole that fades as you pull up beside them
        k.beam(c.x, GROUND_Y, c.z, 0.1 + d * 0.0012, 26 + d * 0.06, r * bk, g * bk, b * bk);
      }
    }
    for (let i = 0; i < riders.length; i++) {
      const t = riders[i].t;
      const second = i > 0;
      const d = t.distanceLeft;
      const pulse = 0.88 + 0.12 * Math.sin(time * 3.4 + i);
      const kk = (d < 40 ? 0.75 : 1.1) * pulse;
      // the first drop-off is green, the second (a shared ride) violet
      const cr = second ? 0.62 : 0.12;
      const cg = second ? 0.3 : 1.0;
      const cb = second ? 1.0 : 0.45;
      const R = FARE.dropRadius - 1;
      k.ring(t.dest.x, 0.07, t.dest.z, R * (1 + 0.015 * Math.sin(time * 3)), cr * kk, cg * kk, cb * kk);
      k.ring(t.dest.x, 0.075, t.dest.z, R * 0.45, cr * 0.85 * kk, cg * 0.7 * kk, cb * 0.7 * kk);
      k.beam(t.dest.x, 0.07, t.dest.z, 0.9 + d * 0.003, 95, cr * 0.6 * kk, cg * 0.55 * kk, cb * 0.6 * kk);
      const size = clamp(1.1 + d * 0.006, 1.1, 4);
      k.diamond(t.dest.x, 11 + size + 0.5 * Math.sin(time * 2.2 + i), t.dest.z, size * 0.55, size * 0.9, time * 1.3, cr * 1.6 * kk, cg * 1.1 * kk, cb * 1.2 * kk);
    }
  });

  installFuel(ctx, kit);

  // the board is stocked when the game opens: a few at the kerb near the garage first, then every district
  for (let i = 0; i < 90 && waiting.length < TUNING.board; i++) {
    const nearN = countWithin(TUNING.meshIn);
    const n220 = countWithin(TUNING.nearD);
    if (n220 < 2) spawn({ minD: TUNING.ringMin, maxD: TUNING.nearD }, null);
    else if (nearN < TUNING.target) spawn({ minD: TUNING.ringMin, maxD: TUNING.ringMax }, null);
    else {
      const counts = new Map(DISTRICTS.map((d) => [d.id, 0]));
      for (const c of waiting) if (counts.has(c.district)) counts.set(c.district, counts.get(c.district) + 1);
      let low = DISTRICTS[0];
      for (const d of DISTRICTS) if (counts.get(d.id) < counts.get(low.id)) low = d;
      spawn(null, low);
    }
  }
}
