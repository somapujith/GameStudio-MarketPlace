// The baraat: a wedding procession that walks down one road in the left lane. A groom on a lit horse, dancers all round him, women
// carrying glowing lamps ahead, a band and a generator cart behind. All of it is ~25 instanced people (two draws), one horse, one
// cart, one bulb mesh, one lamp mesh and a ground glow: under a dozen draw calls. It slows the traffic behind it and the player
// who drives into the crowd. The maths (route, formation, traffic cap, crowd drag) is in event-logic.js.
import { AdditiveBlending, Color, DoubleSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry } from 'three';
import { canvasTexture } from '../render/textures.js';
import { baraatFormation, baraatPose, crowdDrag, trafficCap } from './event-logic.js';
import { bulbGeometry, cartGeometry, createPeople, glowMaterial, horseGeometry, lampGeometry, selfLit } from './event-figures.js';

const SARI = [0xff3d8a, 0xff8a1f, 0x2fd0c0, 0x8a4dff, 0xffc400, 0xe83a3a];
const o = new Object3D();

export function createBaraat(ctx) {
  const F = baraatFormation();
  const group = new Group();
  group.visible = true; // visible until the first update, so every shader compiles with the rest of the scene
  group.position.y = -40;
  ctx.scene.add(group);

  const people = createPeople(F.people.length);
  people.setCount(F.people.length);
  F.people.forEach((p, i) => {
    const c = p.role === 'groom' ? 0xfff0b8 : p.role === 'band' ? 0xd8202e : p.role === 'lamp' ? SARI[i % SARI.length] : SARI[(i * 5 + 2) % SARI.length];
    people.setColor(i, c);
  });
  for (const m of people.meshes) group.add(m);

  const horseGeo = horseGeometry();
  const horseMat = selfLit(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), 'event-horse', 0.55);
  const horse = new Mesh(horseGeo, horseMat);
  horse.position.set(F.horse.w, 0, F.horse.u);
  group.add(horse);

  const cartGeo = cartGeometry();
  const cartMat = selfLit(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 'event-cart', 0.3);
  const cart = new Mesh(cartGeo, cartMat);
  cart.position.set(F.cart.w, 0, F.cart.u);
  group.add(cart);

  const bulbGeo = bulbGeometry(F.horse.u, F.cart.u);
  const bulbMat = glowMaterial(2.4);
  const bulbs = new Mesh(bulbGeo, bulbMat);
  group.add(bulbs);

  const lampGeo = lampGeometry();
  const lampMat = new MeshBasicMaterial({ vertexColors: true, color: new Color(1.7, 1.7, 1.7) });
  const lampers = F.people.map((p, i) => ({ p, i })).filter((x) => x.p.role === 'lamp');
  const lamps = new InstancedMesh(lampGeo, lampMat, lampers.length);
  lamps.frustumCulled = false;
  const lampTint = new Color();
  for (let k = 0; k < lampers.length; k++) lamps.setColorAt(k, lampTint.set([0xffd27a, 0xff9ac8, 0xffe9a8][k % 3]));
  group.add(lamps);

  // warm pool of light on the road around the procession (no real light: that would change every material's shader)
  const glowTex = canvasTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,200,120,0.9)');
    gr.addColorStop(0.5, 'rgba(255,120,150,0.35)');
    gr.addColorStop(1, 'rgba(255,100,160,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { anisotropy: 1 });
  const glowGeo = new PlaneGeometry(30, 15).rotateX(-Math.PI / 2);
  const glowMat = new MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide });
  const glow = new Mesh(glowGeo, glowMat);
  glow.position.set(0, 0.07, -1);
  glow.renderOrder = 2;
  group.add(glow);

  let route = null;
  let speed = 1.15;
  let elapsed = 0;
  const pose = { x: 0, z: 0, s: 0, done: false };
  const b = { x: 0, z: 0, dx: 0, dz: 1, speed: 1.15, tail: F.tail, head: F.head };
  const info = { x: 0, z: 0, heading: 0, drag: 0, done: false };

  const place = (t) => {
    const night = ctx.world?.sky?.state?.night ?? 0;
    const n = F.people.length;
    let li = 0;
    for (let i = 0; i < n; i++) {
      const p = F.people[i];
      const ph = i * 1.7;
      let bob = 0;
      let roll = 0;
      let yaw = 0;
      let du = 0;
      let dw = 0;
      if (p.role === 'dancer') {
        bob = Math.abs(Math.sin(t * 6.2 + ph)) * 0.2;
        roll = Math.sin(t * 3.1 + ph) * 0.2;
        yaw = Math.sin(t * 1.4 + ph) * 1.1 + (i % 2 ? 1 : -1) * 0.3;
        du = Math.sin(t * 1.7 + ph) * 0.35;
        dw = Math.cos(t * 1.3 + ph * 2) * 0.35;
      } else if (p.role === 'band') {
        bob = Math.abs(Math.sin(t * 4.4 + ph)) * 0.07;
        roll = Math.sin(t * 2.2 + ph) * 0.05;
      } else if (p.role === 'lamp') {
        bob = Math.abs(Math.sin(t * 3.6 + ph)) * 0.05;
      } else if (p.role === 'groom') {
        bob = Math.abs(Math.sin(t * 2.6)) * 0.04;
      }
      o.position.set(p.w + dw, p.y + bob, p.u + du);
      o.rotation.set(0, yaw, roll);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      people.clothes.setMatrixAt(i, o.matrix);
      if (p.role === 'lamp') {
        o.position.set(p.w, bob + 1.62, p.u);
        o.rotation.set(0, 0, 0);
        o.updateMatrix();
        lamps.setMatrixAt(li++, o.matrix);
      }
    }
    people.clothes.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    const hb = Math.abs(Math.sin(t * 2.6)) * 0.05;
    horse.position.y = hb;
    bulbs.position.y = hb;
    glowMat.opacity = 0.14 + 0.5 * night;
  };

  return {
    group,
    info,
    get route() { return route; },
    /** Begin a procession on `r` (from event-logic pickBaraatRoute) `startElapsed` seconds into its walk, taking `seconds` in all. */
    begin(r, seconds, startElapsed = 0) {
      route = r;
      speed = Math.max(0.8, Math.min(1.6, r.length / seconds));
      elapsed = Math.min(startElapsed, (0.6 * r.length) / speed); // joined late: it is still on its way, not already over
      group.visible = true;
      info.done = false;
      this.update(0, 0);
    },
    end() {
      route = null;
      group.visible = false;
      group.position.y = -40;
    },
    /** `dt` game seconds. Also slows traffic and works out how deep in the crowd the player is (`info.drag`). */
    update(dt, t) {
      if (!route) return info;
      elapsed += dt;
      baraatPose(route, speed, elapsed, pose);
      group.position.set(pose.x, 0.03, pose.z);
      group.rotation.y = Math.atan2(route.dx, route.dz);
      b.x = pose.x; b.z = pose.z; b.dx = route.dx; b.dz = route.dz; b.speed = pose.done ? 0 : speed;
      info.x = pose.x; info.z = pose.z; info.heading = group.rotation.y; info.done = pose.done;
      place(t);
      // slow the vehicles around it (the traffic system ran before us this frame; the cap holds from the next step on)
      const veh = ctx.traffic?.vehicles;
      if (veh && !pose.done) {
        for (let i = 0; i < veh.length; i++) {
          const v = veh[i];
          if (Math.abs(v.x - b.x) > 90 || Math.abs(v.z - b.z) > 90) continue;
          const cap = trafficCap(v, b);
          if (cap < v.speed) v.speed = cap;
        }
      }
      info.drag = ctx.v ? crowdDrag(ctx.v.x, ctx.v.z, b) : 0;
      return info;
    },
    dispose() {
      ctx.scene.remove(group);
      people.dispose();
      horseGeo.dispose();
      horseMat.dispose();
      cartGeo.dispose();
      cartMat.dispose();
      bulbGeo.dispose();
      bulbMat.dispose();
      lampGeo.dispose();
      lampMat.dispose();
      lamps.dispose?.();
      glowGeo.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}
