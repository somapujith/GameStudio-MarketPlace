// The browser side of tilt steering: permission (iOS needs a button tap), a deviceorientation listener, a "is data really coming?" check.
// Everything takes an injectable window so the status logic is testable in node (tiltSensor.test.js).
import { screenAngleOf } from './tiltMath.js';

/** 'unsupported' | 'needs-permission' | 'ready' (events may flow without asking). */
export function sensorSupport(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.DeviceOrientationEvent === 'undefined') return 'unsupported';
  if (typeof win.DeviceOrientationEvent.requestPermission === 'function') return 'needs-permission';
  return 'ready';
}

/** Call from a tap handler. Resolves 'granted' | 'denied' | 'unsupported'. */
export async function requestSensorPermission(win = typeof window !== 'undefined' ? window : null) {
  const s = sensorSupport(win);
  if (s === 'unsupported') return 'unsupported';
  if (s === 'ready') return 'granted';
  try {
    const r = await win.DeviceOrientationEvent.requestPermission();
    return r === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Listen to the sensor. `onSample(beta, gamma, screenAngle)` for each reading; `onStatus('waiting' | 'live' | 'none')`: 'live' on the
 * first real (non-null) reading, 'none' when nothing arrived within `waitMs` (a desktop, or the browser blocks sensors on plain http).
 * Returns stop().
 */
export function listenTilt(onSample, onStatus, { win = typeof window !== 'undefined' ? window : null, waitMs = 1800 } = {}) {
  if (!win || !win.addEventListener) {
    onStatus?.('none');
    return () => {};
  }
  let live = false;
  let timer = null;
  const handler = (e) => {
    if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return; // desktop Chrome fires one all-null event
    if (!live) {
      live = true;
      if (timer) clearTimeout(timer);
      onStatus?.('live');
    }
    onSample(e.beta, e.gamma, screenAngleOf(win));
  };
  win.addEventListener('deviceorientation', handler);
  onStatus?.('waiting');
  timer = setTimeout(() => {
    if (!live) onStatus?.('none');
  }, waitMs);
  return () => {
    if (timer) clearTimeout(timer);
    win.removeEventListener('deviceorientation', handler);
  };
}
