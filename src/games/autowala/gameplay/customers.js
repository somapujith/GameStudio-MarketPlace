// The 3D people: a waiting customer waving at the kerb, a walker (someone walking to the auto, leaving angry, getting out of it),
// and the passenger sitting in the auto. Logic lives in fares.js; this file only builds, poses and disposes meshes.
import { buildCustomerRig } from '../sim/person-mesh.js';

export const GROUND_Y = 0.2; // the pavement slab top
const SHOULDER_Y = 1.19;
const ARM_HALF = 0.23;

/**
 * One or two people (`c.pax`) built from the customer's look, side by side, plus a suitcase when they carry one. Faces +z; rotate it
 * to face somewhere. It is a single skinned mesh (sim/person-mesh.js): ONE draw call for the whole customer, and `userData.persons[i]`
 * are the people's root Bones whose `userData.{lArm,rArm,lLeg,rLeg}` the pose functions below animate.
 */
export function createRig(c) {
  const people = [];
  for (let i = 0; i < c.pax; i++) {
    people.push({
      look: i === 0 ? c.look : { ...c.look, shirt: c.look2?.shirt || c.look.shirt },
      female: c.female,
      scale: c.kind === 'elder' ? 0.94 : c.kind === 'student' ? 0.98 : 1,
      x: c.pax === 1 ? 0 : i === 0 ? -0.42 : 0.42,
    });
  }
  // a tourist with a suitcase at their feet
  const bag = c.luggage ? { x: c.pax === 1 ? 0.62 : 1.0, color: c.kind === 'tourist' ? '#2b6cb0' : '#8a3b2a' } : null;
  const group = buildCustomerRig(people, bag);
  group.userData.phase = Math.random() * 6.28;
  return group;
}

/** Waving at the kerb: the right arm raised and swinging, faster the closer the auto and the angrier the customer. */
export function poseWave(rig, time, excite, angry) {
  const persons = rig.userData.persons;
  const freq = 3.2 + excite * 5 + angry * 4;
  for (let i = 0; i < persons.length; i++) {
    const u = persons[i].userData;
    const a = 0.32 + (0.42 + angry * 0.2) * Math.sin(time * freq + rig.userData.phase + i * 1.7);
    u.rArm.rotation.z = -a;
    u.rArm.position.set(0.25 + Math.sin(a) * ARM_HALF, SHOULDER_Y + Math.cos(a) * ARM_HALF, 0.06);
    if (angry > 0.4) {
      // an angry customer waves both arms
      const b = 0.3 + 0.4 * Math.sin(time * freq * 1.1 + 2 + i);
      u.lArm.rotation.z = b;
      u.lArm.position.set(-0.25 - Math.sin(b) * ARM_HALF, SHOULDER_Y + Math.cos(b) * ARM_HALF, 0.06);
    } else {
      u.lArm.rotation.z = 0;
      u.lArm.position.set(-0.27, 1.01, 0.06);
    }
    persons[i].position.y = 0;
  }
}

/** Walking: legs and arms swing, a little bounce. `phase` grows with distance walked. */
export function poseWalk(rig, phase) {
  const persons = rig.userData.persons;
  for (let i = 0; i < persons.length; i++) {
    const u = persons[i].userData;
    const s = Math.sin(phase + i * 0.9);
    u.lLeg.rotation.x = s * 0.7;
    u.rLeg.rotation.x = -s * 0.7;
    u.rArm.rotation.set(-s * 0.55, 0, 0);
    u.lArm.rotation.set(s * 0.55, 0, 0);
    u.rArm.position.set(0.27, 1.01, 0.06);
    u.lArm.position.set(-0.27, 1.01, 0.06);
    persons[i].position.y = Math.abs(Math.cos(phase + i * 0.9)) * 0.05;
  }
}

/** Free every geometry and material of a rig and take it out of its parent. */
export function disposeRig(rig) {
  rig.removeFromParent();
  rig.traverse((m) => {
    if (m.isMesh) {
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mats) x?.dispose();
    }
  });
}

/**
 * People who are walking somewhere and then vanish: a missed customer stalking off, a passenger who just got out.
 * Each walker: { rig, dx, dz, speed, ttl, phase }.
 */
export function createWalkers(scene) {
  const list = [];
  return {
    get count() {
      return list.length;
    },
    add(rig, dx, dz, { speed = 1.5, ttl = 4 } = {}) {
      rig.rotation.y = Math.atan2(dx, dz);
      list.push({ rig, dx, dz, speed, ttl, phase: 0 });
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const w = list[i];
        w.ttl -= dt;
        w.phase += dt * w.speed * 5.2;
        w.rig.position.x += w.dx * w.speed * dt;
        w.rig.position.z += w.dz * w.speed * dt;
        poseWalk(w.rig, w.phase);
        if (w.ttl <= 0) {
          disposeRig(w.rig);
          list.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const w of list) disposeRig(w.rig);
      list.length = 0;
    },
  };
}

/** Colour one hidden pax[] figure from a look (the bench seat people built by buildAuto). */
function paintPax(p, look) {
  const u = p.userData;
  if (u.mats) {
    u.mats.shirt.color.set(look.shirt);
    u.mats.skin.color.set(look.skin);
  } else if (u.torso) {
    u.torso.material.color.set(look.shirt);
    u.head.material.color.set(look.skin);
    u.lArm.material.color.set(look.skin);
  }
}

/** Show the customer's riders on the auto's bench seat (hidden pax[] slots built by buildAuto). */
export function seatPassengers(auto, c) {
  const pax = auto.userData.pax || [];
  pax.forEach((p, i) => {
    const show = i < c.pax;
    p.visible = show;
    if (!show) return;
    paintPax(p, i === 0 ? c.look : { ...c.look, shirt: c.look2?.shirt || c.look.shirt });
  });
}

/** Seat ONE rider (a shared ride's second passenger) in bench slot `slot`, leaving the other slots as they are. */
export function seatRider(auto, slot, look) {
  const p = (auto.userData.pax || [])[slot];
  if (!p) return false;
  p.visible = true;
  paintPax(p, look);
  return true;
}

/** Hide the rider in bench slot `slot` (they got out). */
export function clearSeat(auto, slot) {
  const p = (auto.userData.pax || [])[slot];
  if (p) p.visible = false;
}

export function clearPassengers(auto) {
  for (const p of auto.userData.pax || []) p.visible = false;
}
