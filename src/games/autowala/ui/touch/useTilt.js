// React glue for tilt steering: permission, sensor listener, a per-frame filter that drives the steering through the bus and turns the
// (passive) wheel to mirror the phone. Pure maths is in tiltMath.js; the browser sensor is in tiltSensor.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createTilt, tiltWheelAngle } from './tiltMath.js';
import { listenTilt, requestSensorPermission, sensorSupport } from './tiltSensor.js';

/**
 * status: 'off' (not in tilt mode) | 'needs-permission' (iOS: tap the button) | 'waiting' | 'live' | 'none' (no sensor data) | 'denied'.
 * Returns { status, request(), calibrate() }. `onCalibrated(deg)` is called with the new neutral so it can be saved.
 */
export function useTilt({ enabled, settings, bus, wheelRef, onCalibrated }) {
  const tilt = useRef(null);
  if (!tilt.current) tilt.current = createTilt();
  const [perm, setPerm] = useState(() => {
    const s = sensorSupport();
    return s === 'unsupported' ? 'none' : s === 'needs-permission' ? 'needs-permission' : 'granted';
  });
  const [live, setLive] = useState('waiting');

  // settings -> filter
  tilt.current.neutral = settings.tiltNeutral;
  tilt.current.sens = settings.tiltSens;
  tilt.current.invert = settings.tiltInvert;

  useEffect(() => {
    if (!enabled || perm !== 'granted') return undefined;
    const t = tilt.current;
    t.reset();
    setLive('waiting');
    let raf = 0;
    let last = 0;
    const stop = listenTilt((beta, gamma, angle) => t.feed(beta, gamma, angle), setLive);
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      if (t.roll === null) return;
      bus.setSteer(t.step(dt));
      wheelRef?.current?.set(tiltWheelAngle(t));
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stop();
      cancelAnimationFrame(raf);
      bus.setSteer(0);
      wheelRef?.current?.set(0);
    };
  }, [enabled, perm, bus, wheelRef]);

  const request = useCallback(async () => {
    const r = await requestSensorPermission();
    setPerm(r === 'granted' ? 'granted' : r === 'unsupported' ? 'none' : 'denied');
    return r;
  }, []);
  const calibrate = useCallback(() => {
    const n = tilt.current.calibrate();
    if (n !== null && onCalibrated) onCalibrated(n);
    return n;
  }, [onCalibrated]);

  const status = !enabled ? 'off' : perm !== 'granted' ? perm : live;
  return { status, request, calibrate };
}
