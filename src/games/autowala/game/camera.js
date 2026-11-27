// The chase camera: sits behind the auto, swings out in a drift, widens the lens with speed and shakes on impacts.
// It steps in when a building is between it and the auto so you never end up looking at a wall.
import { Vector3 } from 'three';
import { angleDiff, clamp, damp } from './rng.js';

const IGNORE_KERB = { ignore: ['kerb', 'lake'] }; // read-only options for colliders.resolve (shared: nothing allocated per frame)
const NO_EXTRA = {};

export function createChaseCamera(camera, colliders) {
  const pos = new Vector3();
  const look = new Vector3();
  const targetPos = new Vector3();
  const probe = { x: 0, z: 0 };
  let yaw = 0;
  let shake = 0;
  let dist = 8.4;
  let fov = 62;
  let mode = 0; // 0 chase, 1 high, 2 hood
  let first = true;
  let snap = true;
  let t = 0;

  const kick = (amount) => { shake = Math.min(1.2, shake + amount); };

  function update(dt, v, extra = NO_EXTRA) {
    t += dt;
    const spd = v.speed;
    // camera yaw follows the heading but leans toward the direction of travel while sliding
    const targetYaw = v.heading + clamp(v.slip, -0.6, 0.6) * 0.55;
    if (first) { yaw = targetYaw; first = false; }
    yaw += angleDiff(yaw, targetYaw) * (1 - Math.exp(-(spd < 2 ? 2 : 4.2) * dt));

    const m = extra.cameraMode ?? mode;
    const back = m === 1 ? 12.5 : m === 2 ? -0.3 : 7.4 + clamp(spd / 30, 0, 1) * 2.6;
    const height = m === 1 ? 7.5 : m === 2 ? 2.1 : 3.3 + clamp(spd / 30, 0, 1) * 0.5;
    dist = damp(dist, back, 3, dt);

    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    let cx = v.x - sy * dist;
    let cz = v.z - cy * dist;
    // keep clear of walls: pull in until the line from the auto to the camera is free
    if (m !== 2 && colliders) {
      let d = dist;
      for (let i = 0; i < 6 && colliders.blocked(v.x, v.z, v.x - sy * d, v.z - cy * d); i++) d *= 0.7;
      if (d < dist) {
        cx = v.x - sy * Math.max(d, 2.6);
        cz = v.z - cy * Math.max(d, 2.6);
      }
    }
    targetPos.set(cx, v.y + height, cz);
    if (m !== 2 && colliders) {
      probe.x = targetPos.x;
      probe.z = targetPos.z;
      if (colliders.resolve(probe, 2.6, IGNORE_KERB)) { targetPos.x = probe.x; targetPos.z = probe.z; }
    }
    if (snap) { pos.copy(targetPos); snap = false; }
    pos.x = damp(pos.x, targetPos.x, 11, dt);
    pos.z = damp(pos.z, targetPos.z, 11, dt);
    pos.y = damp(pos.y, targetPos.y, 6, dt);

    shake = Math.max(0, shake - dt * 2.4);
    const sx = (Math.sin(t * 61) + Math.sin(t * 37)) * shake * 0.09;
    const sz = (Math.cos(t * 53) + Math.sin(t * 29)) * shake * 0.09;
    camera.position.set(pos.x + sx, pos.y + shake * (Math.sin(t * 71) * 0.06), pos.z + sz);

    const ahead = m === 2 ? 14 : 6.5 + spd * 0.12;
    look.set(v.x + Math.sin(yaw) * ahead, v.y + (m === 1 ? 0.5 : m === 2 ? 1.6 : 1.5), v.z + Math.cos(yaw) * ahead);
    camera.lookAt(look);
    camera.rotateZ(-v.roll * 0.35 + (v.drifting ? -v.slip * 0.05 : 0));

    const targetFov = 60 + clamp(spd / 30, 0, 1) * 15 + (v.boosting ? 9 : 0) + (m === 2 ? 8 : 0);
    fov = damp(fov, targetFov, 4, dt);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  const cycle = () => { mode = (mode + 1) % 3; return mode; };
  return { update, kick, cycle, get mode() { return mode; } };
}
