// Match night at the stadium: a crowd of fans in papaya orange on the pavement in front of the gate (it builds up before the match and
// thins out after), floodlight beams over the bowl after dark. The extra traffic is `ctx.events.trafficMul` (event-logic matchPhase).
// ~44 instanced people (two draws) and one instanced mesh of four additive beams.
import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, InstancedMesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { makeRng } from '../game/rng.js';
import { onRoad } from '../world/roads.js';
import { createPeople } from './event-figures.js';
import { matchPhase } from './event-logic.js';

const o = new Object3D();
const target = new Vector3();
const FANS = [0xff7a1a, 0xff7a1a, 0xff7a1a, 0xff7a1a, 0xff9a3c, 0xf4f0e8, 0xf4f0e8, 0x2a62d8, 0xffc400];

/** Crowd positions on the paving in front of the stadium gate: [{x, z, yaw, s}], at most `n`. Pure given the city and colliders. */
export function crowdSpots(city, colliders, poi, n, seed = 11) {
  const rng = makeRng(seed);
  const f = poi.front;
  let nx = poi.x - f.x;
  let nz = poi.z - f.z;
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  const tx = -nz;
  const tz = nx;
  const edge = city.edges[f.edge];
  const half = (edge?.w ?? 12) / 2;
  const out = [];
  for (let i = 0; i < n * 14 && out.length < n; i++) {
    const d = half + 1.3 + rng() * 8;
    const s = (rng() - 0.5) * 70;
    const x = f.x + nx * d + tx * s;
    const z = f.z + nz * d + tz * s;
    if (onRoad(city, x, z, 0.6)) continue;
    if (colliders.inside(x, z, 0.7)) continue;
    // most face the gate, some are turned round chatting
    const yaw = Math.atan2(nx, nz) + (rng() < 0.45 ? rng.range(-3, 3) : rng.range(-0.4, 0.4));
    out.push({ x, z, yaw, s: 0.92 + rng() * 0.16 });
  }
  return out;
}

export function createMatch(ctx, max = 44) {
  const poi = ctx.world.city.poiById?.stadium;
  if (!poi) return null;
  const group = new Group();
  ctx.scene.add(group);
  const people = createPeople(max);
  const rng = makeRng(5);
  for (let i = 0; i < max; i++) people.setColor(i, FANS[(rng() * FANS.length) | 0]);
  for (const m of people.meshes) group.add(m);

  // floodlight beams: from each tower head down onto the pitch (the towers are built in world/landmarks.js)
  const R = Math.min(poi.w, poi.d) / 2 - 7;
  const beamGeo = new CylinderGeometry(0.8, 10, 40, 14, 1, true).translate(0, -20, 0).rotateX(-Math.PI / 2);
  const beamMat = new MeshBasicMaterial({ color: 0xfff1cc, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  const beams = new InstancedMesh(beamGeo, beamMat, 4);
  beams.frustumCulled = false;
  beams.renderOrder = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    o.position.set(poi.x + Math.cos(a) * (R + 3), 33, poi.z + Math.sin(a) * (R + 3));
    o.scale.set(1, 1, 1);
    o.rotation.set(0, 0, 0);
    o.lookAt(target.set(poi.x, 0, poi.z));
    const len = o.position.distanceTo(target) / 40;
    o.scale.set(1, 1, len * 1.05);
    o.updateMatrix();
    beams.setMatrixAt(i, o.matrix);
  }
  beams.instanceMatrix.needsUpdate = true;
  group.add(beams);

  let spots = [];
  let shown = -1;
  const place = (t, n) => {
    for (let i = 0; i < n; i++) {
      const p = spots[i];
      const ph = i * 2.3;
      const gy = ctx.world.heightAt ? ctx.world.heightAt(p.x, p.z) : 0;
      o.position.set(p.x + Math.sin(t * 0.5 + ph) * 0.15, gy + Math.abs(Math.sin(t * 2.2 + ph)) * 0.03, p.z + Math.cos(t * 0.4 + ph) * 0.15);
      o.rotation.set(0, p.yaw + Math.sin(t * 0.7 + ph) * 0.2, Math.sin(t * 1.3 + ph) * 0.03);
      o.scale.set(p.s, p.s, p.s);
      o.updateMatrix();
      people.clothes.setMatrixAt(i, o.matrix);
    }
    people.clothes.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    start() {
      spots = crowdSpots(ctx.world.city, ctx.world.colliders, poi, max);
      group.visible = true;
      shown = -1;
      return true;
    },
    end() {
      group.visible = false;
      people.setCount(0);
      beamMat.opacity = 0;
      shown = -1;
    },
    /** Returns the phase { crowd, exodus, trafficMul, pedMul } for the HUD / systems. */
    update(dt, t, hour) {
      const ph = matchPhase(hour);
      const n = Math.min(spots.length, Math.round(ph.crowd * max));
      const near = Math.hypot(ctx.v.x - poi.x, ctx.v.z - poi.z) < 260;
      group.visible = near;
      if (near) {
        if (n !== shown) { people.setCount(n); shown = n; }
        if (n) place(t, n);
        const night = ctx.world?.sky?.state?.night ?? 0;
        beamMat.opacity = 0.075 * Math.min(1, night * 1.6) * Math.min(1, ph.crowd * 2);
      }
      return ph;
    },
    dispose() {
      ctx.scene.remove(group);
      people.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      beams.dispose?.();
    },
  };
}
