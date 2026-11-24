// The camera rig: applies camera.js framing to the three camera, plus the breathing sway, a touch of pointer parallax and shake.
import { Vector3 } from 'three';
import { frameCamera, swayOffset, defaultInsets } from './camera.js';

export function createCameraRig(camera, { reducedMotion = false } = {}) {
  let frame = null;
  let aspect = 1.6;
  let insets = null;
  let shake = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const sway = { x: 0, y: 0, tx: 0 };
  const look = new Vector3();

  const refit = () => {
    frame = frameCamera({ aspect, insets: insets || defaultInsets(aspect) });
    camera.fov = frame.fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };
  refit();

  return {
    setAspect(a) {
      aspect = a;
      refit();
    },
    /** HUD-safe insets as fractions of the viewport height: { top, bottom }. null restores the defaults. */
    setInsets(i) {
      insets = i;
      refit();
    },
    shake(amount) {
      if (!reducedMotion) shake = Math.min(1, shake + amount);
    },
    setPointer(nx, ny) {
      pointer.tx = reducedMotion ? 0 : nx;
      pointer.ty = reducedMotion ? 0 : ny;
    },
    update(dt, t) {
      shake = Math.max(0, shake - dt * 2.4);
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
      swayOffset(t, shake * shake, reducedMotion, sway);
      const { pos, target } = frame;
      camera.position.set(pos[0] + sway.x + pointer.x * 0.35, pos[1] + sway.y - pointer.y * 0.12, pos[2]);
      look.set(target[0] + sway.tx + pointer.x * 0.12, target[1], target[2]);
      camera.lookAt(look);
      camera.updateMatrixWorld();
    },
    get frame() {
      return frame;
    },
  };
}
