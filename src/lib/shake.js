// Shake-to-roll: an optional phone gesture (Settings > Motion & feel, off by default).
//   createShakeDetector(opts)  pure state machine fed with accelerometer samples
//   shakeSupported()           the browser exposes DeviceMotionEvent at all (desktop Chrome does too, it just never fires)
//   motionPermission()         'granted' | 'prompt' | 'denied' | 'unsupported'  (iOS 13+ asks first, everywhere else just works)
//   requestMotionPermission()  MUST be called from a user gesture (a tap / click handler); resolves to the same states
//   startShakeListener(cb)     attaches the devicemotion listener, returns the stop function

/**
 * Detects a deliberate shake: `needed` hard jolts (the acceleration vector jumping by more than `threshold` m/s^2
 * between two samples) inside `windowMs`, with at least `minGapMs` between two counted jolts (one jolt makes
 * several samples). After a shake it stays quiet for `cooldownMs`.
 * `push({ x, y, z }, t)` returns true on the sample that completes a shake.
 */
export function createShakeDetector({ threshold = 13, needed = 3, windowMs = 900, minGapMs = 90, cooldownMs = 1500 } = {}) {
  let last = null;
  let jolts = [];
  let quietUntil = 0;
  return {
    push(a, t) {
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z) || !Number.isFinite(t)) return false;
      const prev = last;
      last = a;
      if (t < quietUntil || !prev) return false;
      const jump = Math.hypot(a.x - prev.x, a.y - prev.y, a.z - prev.z);
      if (jump < threshold) return false;
      const lastJolt = jolts[jolts.length - 1];
      if (lastJolt !== undefined && t - lastJolt < minGapMs) return false;
      jolts = jolts.filter((j) => t - j <= windowMs);
      jolts.push(t);
      if (jolts.length >= needed) {
        jolts = [];
        last = null;
        quietUntil = t + cooldownMs;
        return true;
      }
      return false;
    },
    reset() {
      last = null;
      jolts = [];
      quietUntil = 0;
    },
  };
}

export function shakeSupported() {
  return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
}

const needsPermission = () => shakeSupported() && typeof window.DeviceMotionEvent.requestPermission === 'function';

let granted = false;

export function motionPermission() {
  if (!shakeSupported()) return 'unsupported';
  if (!needsPermission() || granted) return 'granted';
  return 'prompt';
}

/** Ask iOS for motion access. Call it straight from a tap handler; everywhere else it resolves 'granted' at once. */
export async function requestMotionPermission() {
  if (!shakeSupported()) return 'unsupported';
  if (!needsPermission()) return 'granted';
  if (granted) return 'granted';
  try {
    const r = await window.DeviceMotionEvent.requestPermission();
    granted = r === 'granted';
    return granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Listens for shakes and calls `onShake()`. Returns the stop function. Does nothing without DeviceMotionEvent. */
export function startShakeListener(onShake, options) {
  if (!shakeSupported() || typeof window.addEventListener !== 'function') return () => {};
  const det = createShakeDetector(options);
  const handler = (e) => {
    const a = e.acceleration && Number.isFinite(e.acceleration.x) ? e.acceleration : e.accelerationIncludingGravity;
    if (!a) return;
    const sample = { x: Number(a.x), y: Number(a.y), z: Number(a.z) };
    const t = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : Date.now();
    if (det.push(sample, t)) onShake();
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}
