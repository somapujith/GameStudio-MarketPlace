import { describe, expect, it, vi } from 'vitest';
import { listenTilt, requestSensorPermission, sensorSupport } from './tiltSensor.js';

function fakeWin(extra = {}) {
  const handlers = {};
  return {
    handlers,
    addEventListener: (t, h) => {
      handlers[t] = h;
    },
    removeEventListener: (t) => {
      delete handlers[t];
    },
    screen: { orientation: { angle: 90 } },
    ...extra,
  };
}
const withPermission = (fn) => {
  const E = function E() {};
  E.requestPermission = fn;
  return fakeWin({ DeviceOrientationEvent: E });
};

describe('sensor support and permission', () => {
  it('unsupported without DeviceOrientationEvent; ready when it needs no permission; needs-permission on iOS', () => {
    expect(sensorSupport(fakeWin())).toBe('unsupported');
    expect(sensorSupport(fakeWin({ DeviceOrientationEvent: function E() {} }))).toBe('ready');
    expect(sensorSupport(withPermission(async () => 'granted'))).toBe('needs-permission');
  });
  it('requestSensorPermission maps granted / denied / thrown / unsupported', async () => {
    expect(await requestSensorPermission(withPermission(async () => 'granted'))).toBe('granted');
    expect(await requestSensorPermission(withPermission(async () => 'denied'))).toBe('denied');
    expect(
      await requestSensorPermission(
        withPermission(async () => {
          throw new Error('no gesture');
        }),
      ),
    ).toBe('denied');
    expect(await requestSensorPermission(fakeWin())).toBe('unsupported');
    expect(await requestSensorPermission(fakeWin({ DeviceOrientationEvent: function E() {} }))).toBe('granted');
  });
});

describe('listenTilt', () => {
  it('reports live on the first real sample, passes the screen angle, ignores all-null events, and stops cleanly', () => {
    const win = fakeWin();
    const samples = [];
    const status = [];
    const stop = listenTilt((b, g, a) => samples.push([b, g, a]), (s) => status.push(s), { win });
    expect(status).toEqual(['waiting']);
    win.handlers.deviceorientation({ beta: null, gamma: null });
    expect(samples.length).toBe(0);
    win.handlers.deviceorientation({ beta: 80, gamma: -10 });
    expect(status).toEqual(['waiting', 'live']);
    expect(samples).toEqual([[80, -10, 90]]);
    stop();
    expect(win.handlers.deviceorientation).toBeUndefined();
  });
  it('reports none when nothing arrives (a desktop)', () => {
    vi.useFakeTimers();
    const win = fakeWin();
    const status = [];
    listenTilt(() => {}, (s) => status.push(s), { win, waitMs: 500 });
    vi.advanceTimersByTime(600);
    expect(status).toEqual(['waiting', 'none']);
    vi.useRealTimers();
  });
  it('no window gives none', () => {
    const status = [];
    listenTilt(() => {}, (s) => status.push(s), { win: null });
    expect(status).toEqual(['none']);
  });
});
