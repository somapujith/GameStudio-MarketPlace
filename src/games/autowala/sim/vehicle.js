// The player's auto: an arcade-sim model. Forward speed and sideways slip are separate, so the handbrake turns the auto into
// a controlled drift (which charges a boost), the front wheel steers by speed, CNG burns by distance, and bumps cost speed.
// Pure maths: no three.js. The caller passes an env (grip, upgrades, colliders, ground height) and reads events back.
import { CAR } from '../game/config.js';
import { clamp, damp, lerp } from '../game/rng.js';

export function createVehicle(start = { x: 0, z: 0, heading: 0 }) {
  const s = {
    x: start.x, z: start.z, y: 0, vy: 0, heading: start.heading,
    vx: 0, vz: 0, fwd: 0, side: 0, speed: 0, kmh: 0,
    steer: 0, yawRate: 0, roll: 0, pitch: 0, slip: 0,
    drifting: false, driftTime: 0, driftCharge: 0, boosting: false, boostTime: 0,
    fuel: CAR.fuelTank, airborne: false, airTime: 0, lastAir: 0,
    braking: false, reversing: false, hornTime: 0, distance: 0, wheelSpin: 0,
    jolt: 0, // 0..1 recent roughness (spills, a fragile passenger complains)
  };
  const events = [];

  const params = (env) => {
    const up = env.upgrades || {};
    return {
      top: CAR.topSpeed * (1 + 0.06 * (up.engine || 0)) * (env.speedMul || 1),
      accel: CAR.accel * (1 + 0.07 * (up.engine || 0)),
      grip: CAR.grip * (1 + 0.1 * (up.tyres || 0)) * (env.gripMul ?? 1),
      tank: CAR.fuelTank * (1 + 0.25 * (up.tank || 0)),
    };
  };

  /**
   * input: { steer (-1..1, +1 = right), throttle 0..1, brake 0..1, handbrake bool, boost bool }
   * env: { colliders, heightAt(x,z), gripMul, speedMul, upgrades, onRoad }
   */
  function update(dt, input, env = {}) {
    events.length = 0;
    const P = params(env);
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const rx = Math.cos(s.heading);
    const rz = -Math.sin(s.heading);
    let vF = s.vx * fx + s.vz * fz;
    let vR = s.vx * rx + s.vz * rz;
    const fuelOk = s.fuel > 0;

    // steering input eases in and snaps back faster (auto-rickshaws are twitchy)
    const target = clamp(input.steer, -1, 1);
    const ease = Math.abs(target) > Math.abs(s.steer) ? 9 : 14;
    s.steer = damp(s.steer, target, ease, dt);

    // engine, boost and brakes
    let top = P.top;
    let accel = P.accel;
    const wantsBoost = input.boost && (s.driftCharge > 0.05 || env.boostFuel > 0);
    if (wantsBoost && fuelOk) {
      top = CAR.boostSpeed * (1 + 0.04 * (env.upgrades?.engine || 0));
      accel *= 2.1 * (1 + 0.1 * (env.upgrades?.turbo || 0));
      if (!s.boosting) events.push({ type: 'boost-start' });
      s.boosting = true;
      s.boostTime += dt;
      s.driftCharge = Math.max(0, s.driftCharge - dt * 0.55 / (1 + 0.22 * (env.upgrades?.turbo || 0)));
    } else {
      if (s.boosting) events.push({ type: 'boost-end' });
      s.boosting = false;
      s.boostTime = 0;
    }
    s.braking = false;
    s.reversing = false;
    if (input.throttle > 0 && fuelOk && !s.airborne) {
      const headroom = clamp(1 - Math.max(vF, 0) / top, 0, 1);
      vF += accel * input.throttle * (0.25 + 0.75 * headroom) * dt;
      if (vF > top) vF = damp(vF, top, 3, dt);
    }
    if (input.brake > 0 && !s.airborne) {
      if (vF > 0.8) {
        vF = Math.max(0, vF - CAR.brake * (1 + 0.14 * (env.upgrades?.brakes || 0)) * input.brake * dt);
        s.braking = true;
      } else if (fuelOk) {
        vF = Math.max(-CAR.reverseMax, vF - P.accel * 0.45 * input.brake * dt);
        s.reversing = vF < -0.3;
        s.braking = !s.reversing && input.brake > 0.2;
      }
    }
    if (!s.airborne) {
      vF -= vF * (CAR.drag + (input.throttle > 0 ? 0 : 0.28)) * dt;
      if (Math.abs(vF) < 0.15 && input.throttle === 0 && input.brake === 0) vF = 0;
    }

    // handbrake: the rear lets go, steering bites harder, and a drift builds boost charge
    const speed = Math.hypot(vF, vR);
    const hb = input.handbrake && speed > 6 && !s.airborne;
    let grip = hb ? CAR.gripDrift : P.grip;
    if (!hb && Math.abs(vR) > 3.2) grip *= 0.55; // recovering from a slide: grip returns gradually
    if (!s.airborne) vR *= Math.exp(-grip * dt);
    const sliding = Math.abs(vR) > 3.4 && speed > 9 && !s.airborne;
    if (sliding) {
      s.driftTime += dt;
      s.driftCharge = clamp(s.driftCharge + dt * 0.34 * (1 + 0.1 * (env.upgrades?.turbo || 0)), 0, 1);
      if (!s.drifting) events.push({ type: 'drift-start' });
      s.drifting = true;
    } else {
      if (s.drifting && s.driftTime > 0.5) events.push({ type: 'drift-end', time: s.driftTime });
      if (s.drifting) s.driftTime = 0;
      s.drifting = false;
    }

    // yaw: bicycle-ish; low speed turns tight, high speed turns wide; nothing happens at standstill
    const spd = Math.abs(vF);
    // counter-steer assist: the further the tail steps out, the less the nose keeps rotating, so a slide settles at a
    // controllable angle (about 45 degrees) instead of spinning the auto round
    const slipNow = Math.abs(Math.atan2(vR, Math.max(Math.abs(vF), 1)));
    const assist = 1 - 0.88 * Math.pow(clamp(slipNow / 0.8, 0, 1), 1.4);
    const rate = lerp(CAR.steerLow, CAR.steerHigh, clamp(spd / P.top, 0, 1)) * (hb ? 1.35 : 1) * assist;
    // heading grows toward +x, which is screen-LEFT for a driver looking along +z: steering right LOWERS the heading
    const yaw = -s.steer * rate * clamp(spd / 2.4, 0, 1) * (vF >= -0.2 ? 1 : -1);
    s.yawRate = damp(s.yawRate, yaw, 14, dt);
    if (!s.airborne) s.heading += s.yawRate * dt;
    else s.heading += s.yawRate * dt * 0.4;

    // Back to world velocity using the axes from BEFORE the nose turned: the auto keeps travelling the way it was going,
    // and next frame that direction, seen from the new heading, is the slip angle (that is what makes a drift possible).
    s.vx = fx * vF + rx * vR;
    s.vz = fz * vF + rz * vR;

    // move, then push out of buildings
    const pre = { x: s.x, z: s.z };
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    const p = { x: s.x, z: s.z };
    const hit = env.colliders?.resolve(p, CAR.radius);
    if (hit) {
      s.x = p.x;
      s.z = p.z;
      const vn = s.vx * hit.nx + s.vz * hit.nz; // negative = into the wall
      // Everything the auto bumps into is a GUARDRAIL: buildings and apartments, landmarks, metro pillars, trees and lamp posts, the
      // lake edge. It stops the auto and slides it along (no bounce-back, no wreck) and reports a soft contact: `guard: true`.
      // A kerb (only if the old rule is switched on) is softer still. Downstream systems (damage, the red crash flash) ignore soft ones.
      const soft = true;
      const kerbish = hit.box.tag === 'kerb' || hit.box.tag === 'lake';
      if (vn < -0.5) {
        const k = kerbish ? 0.06 : 0.1; // restitution
        s.vx -= (1 + k) * vn * hit.nx;
        s.vz -= (1 + k) * vn * hit.nz;
        // scrub along the rail too
        const scrub = kerbish ? 0.93 : 0.9;
        s.vx *= scrub;
        s.vz *= scrub;
        const strength = clamp(-vn / 14, 0, 1.4) * (kerbish ? 0.4 : 0.55);
        s.jolt = Math.min(1, s.jolt + strength * 0.9);
        if (strength > 0.12) events.push({ type: 'crash', strength, tag: hit.box.tag, guard: true, nx: hit.nx, nz: hit.nz });
      } else if (soft) {
        // sliding along a kerb: it rubs the speed off a little
        s.vx *= 0.995;
        s.vz *= 0.995;
      }
    }
    // world edge
    const lim = env.limit ?? 690;
    if (Math.abs(s.x) > lim) { s.x = clamp(s.x, -lim, lim); s.vx *= -0.3; }
    if (Math.abs(s.z) > lim) { s.z = clamp(s.z, -lim, lim); s.vz *= -0.3; }

    // vertical: ride the ground, fly off ramps
    const gh = env.heightAt ? env.heightAt(s.x, s.z) : 0;
    const wasAir = s.airborne;
    if (s.airborne) {
      s.vy -= 22 * dt;
      s.y += s.vy * dt;
      s.airTime += dt;
      if (s.y <= gh) {
        s.y = gh;
        const impact = -s.vy;
        s.airborne = false;
        s.lastAir = s.airTime;
        events.push({ type: 'land', air: s.airTime, impact });
        if (impact > 6) s.jolt = Math.min(1, s.jolt + clamp(impact / 16, 0, 0.9));
        s.vy = 0;
        s.airTime = 0;
      }
    } else {
      const slope = (gh - s.y) / Math.max(dt, 1e-3);
      if (gh - s.y < -0.35 && spd > 7 && (env.heightAt ? env.heightAt(s.x + s.vx * 0.12, s.z + s.vz * 0.12) : 0) < gh - 0.2) {
        // the ground fell away under a fast auto: launch
        s.airborne = true;
        s.vy = Math.max(0, Math.min(10, slope));
        s.airTime = 0;
        events.push({ type: 'launch', speed: spd });
      } else {
        s.vy = 0;
        s.y += (gh - s.y) * Math.min(1, dt * 22); // ride up onto / down off the pavement step instead of snapping
        if (Math.abs(gh - s.y) < 0.002) s.y = gh;
      }
    }

    // fuel
    const burn = Math.hypot(s.vx, s.vz) * dt * CAR.fuelUse * (s.boosting ? 2.4 : 1) + CAR.idleUse * dt;
    s.fuel = clamp(s.fuel - burn, 0, P.tank);

    // body language: lean into corners and slides, nose-dive under braking, squat on throttle
    // lean outward in a corner (a right turn has a negative yaw rate and leans the body to the left)
    const lean = clamp(s.yawRate * spd * 0.012 - vR * 0.018, -0.34, 0.34);
    s.roll = damp(s.roll, lean, 7, dt);
    const dive = clamp((s.braking ? 0.07 : 0) - (input.throttle > 0 ? 0.035 : 0), -0.06, 0.09);
    s.pitch = damp(s.pitch, s.airborne ? -s.vy * 0.015 : dive, 6, dt);
    s.jolt = Math.max(0, s.jolt - dt * 0.6);

    s.fwd = vF;
    s.side = vR;
    s.speed = Math.hypot(s.vx, s.vz);
    s.kmh = s.speed * 3.6;
    s.slip = Math.atan2(vR, Math.max(Math.abs(vF), 0.1));
    s.distance += s.speed * dt;
    s.wheelSpin += vF * dt / 0.34;
    if (s.hornTime > 0) s.hornTime = Math.max(0, s.hornTime - dt);
    return events;
  }

  /**
   * Park the auto (a menu is open): kill its velocity quickly and without reversing. (Pressing the brake at a standstill means
   * REVERSE, so holding the brake down would make the auto creep backwards for as long as a menu stayed open.)
   */
  const hold = (dt) => {
    const k = Math.exp(-7 * dt);
    s.vx *= k;
    s.vz *= k;
    s.yawRate *= k;
    s.steer *= k;
    s.driftCharge = 0;
    s.boosting = false;
    s.drifting = false;
    if (Math.hypot(s.vx, s.vz) < 0.04) {
      s.vx = 0;
      s.vz = 0;
    }
    s.fwd = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
    s.side = s.vx * Math.cos(s.heading) - s.vz * Math.sin(s.heading);
    s.speed = Math.hypot(s.vx, s.vz);
    s.kmh = s.speed * 3.6;
    s.braking = s.speed > 0.3;
  };
  const honk = () => {
    s.hornTime = 0.45;
    events.push({ type: 'honk' });
  };
  const teleport = (x, z, heading) => {
    s.x = x; s.z = z; s.vx = s.vz = 0; s.fwd = s.side = s.speed = 0; s.yawRate = 0; s.steer = 0;
    if (heading !== undefined) s.heading = heading;
  };
  return { state: s, update, hold, honk, teleport, events, params };
}
