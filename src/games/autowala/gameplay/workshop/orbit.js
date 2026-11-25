// The garage's orbit camera: circles the auto, eases to a preset angle per menu section, drifts slowly when idle, and steps in
// when a wall is between it and the auto. Installed as `ctx.state.cameraOverride = (camera, dt) => orbit.update(camera, dt)`.
import { Vector3 } from 'three';
import { VIEWS } from './menuModel.js';

const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function createOrbit({ anchor, colliders, groundAt, reducedMotion = false }) {
  // anchor: { x, y, z, heading } of the auto being shown (read every frame)
  const s = { az: 0, pitch: 0.2, dist: 8, ty: 0.9, fov: 48 }; // az is relative to the auto's nose
  const goal = { ...s };
  const input = { x: 0, y: 0, z: 0 }; // held keys / sticks: -1..1
  const shift = { x: 0, y: 0 }; // where the auto sits on screen, as a fraction of the width / height
  let idle = 0;
  let first = true;
  let pos = new Vector3();
  const tgt = new Vector3();

  const setView = (name) => {
    const v = VIEWS[name] || VIEWS.wide34;
    // go the short way round, but keep the user's idle spin from winding up
    goal.az = s.az + wrap(v.az - s.az);
    goal.pitch = v.pitch;
    goal.dist = v.dist;
    goal.ty = v.ty;
    goal.fov = v.fov;
    idle = 0;
  };
  const drag = (dx, dy) => {
    goal.az -= dx * 0.0085;
    goal.pitch = clamp(goal.pitch + dy * 0.006, -0.02, 1.25);
    s.az = goal.az;
    s.pitch = goal.pitch;
    idle = 0;
  };
  const zoom = (amount) => {
    goal.dist = clamp(goal.dist * Math.exp(amount), 2.6, 13);
    idle = 0;
  };
  const poke = () => { idle = 0; };

  /** Start from wherever the game camera is now, so the hand-over from the chase camera is a glide, not a cut. */
  const begin = (camera) => {
    const dx = camera.position.x - anchor.x;
    const dz = camera.position.z - anchor.z;
    const h = Math.hypot(dx, dz);
    s.az = wrap(Math.atan2(dx, dz) - anchor.heading);
    s.pitch = clamp(Math.atan2(camera.position.y - anchor.y - 0.9, Math.max(h, 0.1)), 0.05, 1.1);
    s.dist = clamp(Math.hypot(h, camera.position.y - anchor.y - 0.9), 3, 13);
    s.ty = 0.9;
    s.fov = camera.fov;
    pos.copy(camera.position);
    Object.assign(goal, s);
    first = false;
  };

  function update(camera, dt) {
    if (first) begin(camera);
    idle += dt;
    if (input.x || input.y || input.z) {
      goal.az -= input.x * dt * 1.6;
      goal.pitch = clamp(goal.pitch + input.y * dt * 1.0, -0.02, 1.25);
      goal.dist = clamp(goal.dist * Math.exp(input.z * dt * 0.9), 2.6, 13);
      idle = 0;
    } else if (idle > 4 && !reducedMotion) {
      goal.az += dt * 0.16; // slow showroom spin when nobody is touching it
    }
    s.az = damp(s.az, goal.az, 5, dt);
    s.pitch = damp(s.pitch, goal.pitch, 5, dt);
    s.dist = damp(s.dist, goal.dist, 5, dt);
    s.ty = damp(s.ty, goal.ty, 5, dt);
    s.fov = damp(s.fov, goal.fov, 4, dt);

    const a = anchor.heading + s.az;
    const cp = Math.cos(s.pitch);
    tgt.set(anchor.x, anchor.y + s.ty, anchor.z);
    const sx = Math.sin(a) * cp;
    const sy = Math.sin(s.pitch);
    const sz = Math.cos(a) * cp;
    // pull the camera in until nothing solid is between it and the auto
    // a portrait screen is narrow: stand further back so the whole auto still fits across it
    let d = s.dist * clamp(Math.pow(1.4 / Math.max(camera.aspect, 0.3), 0.85), 1, 2.1);
    if (colliders?.blocked) for (let i = 0; i < 7 && colliders.blocked(anchor.x, anchor.z, anchor.x + sx * (d + 0.9), anchor.z + sz * (d + 0.9)); i++) d *= 0.8;
    d = Math.max(d, 2.4);
    pos.set(tgt.x + sx * d, tgt.y + sy * d, tgt.z + sz * d);
    const floor = (groundAt ? groundAt(pos.x, pos.z) : 0) + 0.35;
    if (pos.y < floor) pos.y = floor;
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(tgt);
    let proj = false;
    if (Math.abs(camera.fov - s.fov) > 0.02) { camera.fov = s.fov; proj = true; }
    if (!applyShift(camera) && proj) camera.updateProjectionMatrix();
  }

  // slide the picture (shift.x > 0: auto to the right, shift.y > 0: auto up) so the auto sits in the free part of the screen (beside the menu panel) without moving the 3D scene
  let lastShift = '';
  function applyShift(camera) {
    const key = `${shift.x.toFixed(3)}|${shift.y.toFixed(3)}|${camera.aspect.toFixed(3)}`;
    if (key === lastShift && camera.view?.enabled) return false;
    lastShift = key;
    const W = 1000;
    const H = Math.round(W / camera.aspect);
    camera.setViewOffset(W, H, -shift.x * W, shift.y * H, W, H); // +x moves the auto right on screen, +y moves it up
    return true;
  }

  const release = (camera) => {
    camera?.clearViewOffset?.();
    if (camera) camera.updateProjectionMatrix();
  };

  return {
    update, begin, setView, drag, zoom, poke, release,
    setShift(x, y) { shift.x = clamp(x, -0.4, 0.4); shift.y = clamp(y, -0.4, 0.4); },
    setInput(x, y, z) { input.x = x; input.y = y; input.z = z; },
    get state() { return s; },
    get goal() { return goal; },
  };
}
