// The first-person camera rig: binds camera.js (pure maths) to the three camera. The eye follows the local cook's walker along the cook
// line (stride-synced bob, a little roll), the head turns by itself towards the work, can be turned freely, and is clamped to LAYOUT.view.
// Nothing is allocated per frame.
import { LAYOUT } from '../../../../shared/tiffin-centre/catalog.js';
import { HOME_X } from '../../../../shared/tiffin-centre/movement.js';
import {
  REST_PITCH, MANUAL_HOLD_S, MANUAL_RELAX, FOLLOW_RATE, LOOK_RATE, PIN_RATE, BREATH,
  viewFov, lensShift, clampLook, aimAt, autoGoal, stepLook, addManual, advancePhase, walkBob, speed01Of, damp, shakeAngles, VIEW, VIEW_TURN,
  turnYaw, turnAmount, TURN_SPEED, TURN_ACCEL,
} from './camera.js';

export function createCameraRig(camera, { reducedMotion = false } = {}) {
  let reduced = !!reducedMotion;
  let aspect = 1.6;
  let viewW = 0;
  let viewH = 0;
  let insets = null;
  let shift = 0;
  let appliedShift = null;
  let bodyX = HOME_X; // where the walker is (the HUD runner's x)
  let bodyDir = 0;
  let snap = true;
  let eyeX = HOME_X;
  let phase = 0;
  let speed = 0; // smoothed 0..1
  let shake = 0;
  let idleT = 99; // seconds since the last free-look input
  let autoOn = false;
  let pinnedOn = false;
  let viewmodelOn = true;
  let turn = 0; // 0..1: how far round the body is turned (see place())
  let yawVel = 0; // rad/s while the head swings round (see update)
  let wasWide = false;
  const look = { yaw: 0, pitch: REST_PITCH };
  const prevLook = { yaw: 0, pitch: REST_PITCH };
  const manual = { yaw: 0, pitch: 0 };
  const pin = { x: 0, y: 0, z: 0 };
  const autoPt = { x: 0, y: 0, z: 0 };
  const goal = { yaw: 0, pitch: REST_PITCH };
  const bob = { x: 0, y: 0, roll: 0 };
  const sh = { pitch: 0, yaw: 0, roll: 0 };
  const delta = { yaw: 0, pitch: 0 };

  camera.rotation.order = 'YXZ';
  camera.near = 0.05;
  camera.far = Math.max(camera.far || 0, 160);

  const refit = () => {
    camera.fov = viewFov(aspect);
    camera.aspect = aspect;
    shift = lensShift(insets, aspect);
    applyLens();
  };
  function applyLens() {
    if (viewW > 1 && viewH > 1 && Math.abs(shift) * viewH > 1) {
      const off = Math.round(shift * viewH);
      if (appliedShift !== off || camera.view?.fullWidth !== viewW || camera.view?.fullHeight !== viewH) {
        camera.setViewOffset(viewW, viewH, 0, off, viewW, viewH);
        appliedShift = off;
      }
    } else if (appliedShift !== null || camera.view?.enabled) {
      camera.clearViewOffset();
      appliedShift = null;
    }
    camera.updateProjectionMatrix();
  }
  refit();

  function place() {
    // turned round to the back counter / the gas stand: the shoulders come round with the head (a small lean back, a dip, the shoulder line tilts)
    const tn = reduced ? turnAmount(look.yaw) * 0.4 : turnAmount(look.yaw);
    const side = look.yaw < 0 ? -1 : 1;
    turn = tn;
    camera.position.set(eyeX + bob.x - side * 0.05 * tn, LAYOUT.eyeHeight + bob.y - 0.045 * tn, LAYOUT.cookZ + 0.07 * tn);
    camera.rotation.set(look.pitch + sh.pitch, -(look.yaw + sh.yaw), bob.roll + sh.roll + side * 0.05 * tn, 'YXZ');
    camera.updateMatrixWorld();
  }

  const rig = {
    setAspect(a, w, h) {
      aspect = a > 0 ? a : aspect;
      if (w > 0 && h > 0) {
        viewW = w;
        viewH = h;
      }
      refit();
    },
    /** HUD-safe insets as fractions of the viewport height: { top, bottom }. null restores the defaults. */
    setInsets(i) {
      insets = i && Number.isFinite(i.top) && Number.isFinite(i.bottom) ? { top: i.top, bottom: i.bottom } : null;
      refit();
    },
    setReducedMotion(b) {
      reduced = !!b;
      if (reduced) bob.x = bob.y = bob.roll = 0;
    },
    shake(amount) {
      if (!reduced) shake = Math.min(1, shake + amount);
    },
    /** The walker (the local cook along the line): x and walking direction (-1 | 0 | 1). */
    setBody(x, dir) {
      bodyX = x;
      bodyDir = dir;
    },
    /** Where the work is (world point) or null: the head leads there while walking / working. */
    setAuto(pt) {
      autoOn = !!pt;
      if (pt) {
        autoPt.x = pt.x;
        autoPt.y = pt.y;
        autoPt.z = pt.z;
      }
    },
    /** Hold the head on a world point (lookAt), or null to release (free look recentres). */
    setPinned(pt) {
      pinnedOn = !!pt;
      if (pt) {
        pin.x = pt.x;
        pin.y = pt.y;
        pin.z = pt.z;
      } else idleT = Math.max(idleT, MANUAL_HOLD_S - 0.4);
    },
    /** Free look: turn the head by (dYaw, dPitch) radians (yaw > 0 right, pitch > 0 up). Clamped to LAYOUT.view. */
    lookBy(dYaw, dPitch) {
      goalFor(goal);
      addManual(manual, dYaw, dPitch, goal, VIEW);
      idleT = 0;
    },
    /** Let go of free look now: the head eases back to where the work (or rest) says. */
    recentre() {
      idleT = 99;
    },
    /** Snap the head (tests / scene start). */
    reset() {
      manual.yaw = manual.pitch = 0;
      look.yaw = 0;
      look.pitch = REST_PITCH;
      prevLook.yaw = look.yaw;
      prevLook.pitch = look.pitch;
      yawVel = 0;
      wasWide = false;
      snap = true;
    },
    getLook(out = { yaw: 0, pitch: 0 }) {
      out.yaw = look.yaw;
      out.pitch = look.pitch;
      return out;
    },
    setViewmodelOn(b) {
      viewmodelOn = !!b;
    },
    update(dt, t) {
      const d = Math.min(0.1, Math.max(0, dt));
      shake = Math.max(0, shake - d * 2.4);
      if (snap) {
        eyeX = bodyX;
        snap = false;
        phase = 0;
        speed = 0;
        goalFor(goal);
        look.yaw = goal.yaw;
        look.pitch = goal.pitch;
        prevLook.yaw = look.yaw;
        prevLook.pitch = look.pitch;
      }
      // eye: follow the walker (glide), stride phase from the distance really covered, smoothed speed for the bob amplitude
      const x0 = eyeX;
      eyeX = damp(eyeX, bodyX, FOLLOW_RATE, d);
      if (Math.abs(bodyX - eyeX) < 0.0005) eyeX = bodyX;
      const moved = eyeX - x0;
      phase = advancePhase(phase, moved);
      const mps = d > 1e-5 ? moved / d : 0;
      speed = damp(speed, speed01Of(mps) * (bodyDir !== 0 ? 1 : 0.6), 10, d);
      walkBob(phase, speed, reduced ? 0 : bodyDir, reduced, bob);
      if (!reduced) bob.y += Math.sin(t * 1.25) * BREATH * (1 - speed);
      shakeAngles(t, shake * shake, reduced, sh);
      // head
      idleT += d;
      if (idleT > MANUAL_HOLD_S || pinnedOn) {
        const k = 1 - Math.exp(-MANUAL_RELAX * d);
        manual.yaw -= manual.yaw * k;
        manual.pitch -= manual.pitch * k;
      }
      goalFor(goal);
      goal.yaw += manual.yaw;
      goal.pitch += manual.pitch;
      // turning round (the back counter, the gas stand) is a swing of the whole body, not a glance: its speed ramps up and is capped, so it eases in and out
      const wide = Math.abs(goal.yaw) > VIEW.yawMax || Math.abs(look.yaw) > VIEW.yawMax;
      if (wide) {
        if (!wasWide && d > 1e-5) yawVel = (look.yaw - prevLook.yaw) / d;
        const rate = pinnedOn ? PIN_RATE : LOOK_RATE;
        const goalYaw = Math.max(-VIEW_TURN.yawMax, Math.min(VIEW_TURN.yawMax, goal.yaw));
        const want = Math.max(-TURN_SPEED, Math.min(TURN_SPEED, (goalYaw - look.yaw) * rate * 0.8));
        yawVel += Math.max(-TURN_ACCEL * d, Math.min(TURN_ACCEL * d, want - yawVel));
        look.yaw = Math.max(-VIEW_TURN.yawMax, Math.min(VIEW_TURN.yawMax, look.yaw + yawVel * d));
        look.pitch = damp(look.pitch, Math.max(VIEW.pitchMin, Math.min(VIEW.pitchMax, goal.pitch)), rate, d);
      } else {
        stepLook(look, goal, pinnedOn ? PIN_RATE : LOOK_RATE, d, VIEW_TURN);
        yawVel = 0;
      }
      wasWide = wide;
      delta.yaw = look.yaw - prevLook.yaw;
      delta.pitch = look.pitch - prevLook.pitch;
      prevLook.yaw = look.yaw;
      prevLook.pitch = look.pitch;
      place();
    },
    /** Change of the head's look over the last frame (feeds the viewmodel's sway). */
    get lookDelta() {
      return delta;
    },
    get eyeX() {
      return eyeX;
    },
    get walkPhase() {
      return phase;
    },
    get walkSpeed() {
      return speed;
    },
    get viewmodelOn() {
      return viewmodelOn;
    },
    get lensShift() {
      return shift;
    },
    /** 0..1: how far round the body is turned (looking at the back counter / the gas stand). */
    get turn() {
      return turn;
    },
  };

  /** The head's goal WITHOUT the manual offset, written into `out`. */
  function goalFor(out) {
    if (pinnedOn) {
      aimAt(eyeX, LAYOUT.eyeHeight, LAYOUT.cookZ, pin.x, pin.y, pin.z, out);
      out.yaw = turnYaw(out.yaw, look.yaw);
    } else if (autoOn) autoGoal(eyeX, autoPt, out, look.yaw);
    else {
      out.yaw = 0;
      out.pitch = REST_PITCH;
    }
    return clampLook(out, VIEW_TURN);
  }
  return rig;
}
