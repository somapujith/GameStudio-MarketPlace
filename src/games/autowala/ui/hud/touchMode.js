// Shared "is the player on a touch screen?" flag, so the HUD (speedometer placement, tappable prompt) and TouchControls agree.
// True on coarse-pointer devices from the start, and for anyone who touches the screen later. It never switches back off.
import { useEffect, useSyncExternalStore } from 'react';
import { detectCoarse } from './touchMath.js';

let touch = typeof window !== 'undefined' ? detectCoarse(window.matchMedia?.bind(window)) : false;
const subs = new Set();
let watchers = 0;
let stopWatch = null;

function setTouchMode(on) {
  if (touch === on) return;
  touch = on;
  for (const fn of [...subs]) fn();
}

function startWatching() {
  if (typeof window === 'undefined') return;
  const onPointer = (e) => {
    if (e.pointerType === 'touch') setTouchMode(true);
  };
  const onTouch = () => setTouchMode(true);
  window.addEventListener('pointerdown', onPointer, { passive: true, capture: true });
  window.addEventListener('touchstart', onTouch, { passive: true, capture: true });
  stopWatch = () => {
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('touchstart', onTouch, true);
  };
}

const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
const getSnapshot = () => touch;

export const isTouchMode = () => touch;
/** The controls were switched on by a setting or ?touch=1: the HUD must lay itself out around them like on a real touch screen. */
export const enableTouchMode = () => setTouchMode(true);

/** React hook: true while the touch controls should be on screen. */
export function useTouchMode() {
  useEffect(() => {
    if (watchers++ === 0) startWatching();
    return () => {
      if (--watchers === 0 && stopWatch) {
        stopWatch();
        stopWatch = null;
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
