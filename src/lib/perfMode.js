// Slow-render detection for the table. Browsers without hardware acceleration (Brave with it switched off, Linux
// Chromium, old Androids, blocklisted GPUs) draw every frame on the CPU: a decorative loop that is free on a GPU
// (a twinkling lantern string, a floating die, breathing glows) then costs tens of milliseconds a frame.
//
//   judgeFrames(deltas)            pure: 'low' | 'high' | null from a window of requestAnimationFrame frame times
//   startPerfMonitor(opts)         samples a few short rAF windows after the table opens (never while the tab is hidden)
//   usePerfMode()                  GameView: applies the Settings > "Table effects" choice or the measured verdict
//   usePerfLevel()                 -> 'low' | 'high' | '' (not measured yet): what the screen is doing right now
//
// The verdict lands on <html data-perf="low|high"> (styles/perf.css). 'low' switches the decorative loops off; one-shot
// animations, the dice, the pawns and everything that tells the player what happens are untouched. 'low' is remembered
// for a few days so the next game starts smooth instead of stuttering for the first seconds.
import { useEffect, useSyncExternalStore } from 'react';
import { useSettings } from './storage.js';

/** A median frame time above this (about 35 fps) is "slow"; at or below FAST_MS (about 45 fps) it is fine. */
export const SLOW_MS = 28;
export const FAST_MS = 22;
/** Frames at or above this are stalls (a hidden tab, a long task), not rendering speed: they are left out. */
const STALL_MS = 400;
const MIN_FRAMES = 18;
const STORE_KEY = 'hg:perf';
const STORE_TTL_MS = 3 * 24 * 3600 * 1000;

/** The median of the frame times, or null when there are too few usable frames. Pure. */
export function medianFrame(deltas, { minFrames = MIN_FRAMES } = {}) {
  const f = (Array.isArray(deltas) ? deltas : []).filter((d) => Number.isFinite(d) && d > 0 && d < STALL_MS);
  if (f.length < minFrames) return null;
  f.sort((a, b) => a - b);
  return f[Math.floor(f.length / 2)];
}

/** 'low' (slow), 'high' (fast) or null (not enough frames, or in between: keep what we have). Pure. */
export function judgeFrames(deltas, opts) {
  const m = medianFrame(deltas, opts);
  if (m == null) return null;
  if (m > SLOW_MS) return 'low';
  if (m <= FAST_MS) return 'high';
  return null;
}

/**
 * Samples `windowMs` of frames, then calls `done(deltas | null)` (null when the tab was hidden meanwhile). Returns cancel().
 * `env` is injectable for tests: { raf, caf, now, hidden }.
 */
export function sampleFrames(windowMs, done, env = {}) {
  const raf = env.raf || ((cb) => requestAnimationFrame(cb));
  const caf = env.caf || ((id) => cancelAnimationFrame(id));
  const hidden = env.hidden || (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const deltas = [];
  let id = 0;
  let last = null;
  let start = null;
  let stopped = false;
  const tick = (t) => {
    if (stopped) return;
    if (hidden()) { stopped = true; done(null); return; }
    if (start == null) start = t;
    if (last != null) deltas.push(t - last);
    last = t;
    if (t - start >= windowMs) { stopped = true; done(deltas); return; }
    id = raf(tick);
  };
  id = raf(tick);
  return () => { stopped = true; caf(id); };
}

/**
 * Waits (ms) before each sample window: the first once the first paint has settled; the second right after the first
 * 'high' verdict, because a still board proves little (rAF fires at vsync even when nothing is drawn): the real test is the
 * window with the twinkle running. Later ones catch a slow patch.
 */
const SCHEDULE = [1800, 400, 8000, 20000, 40000];

/**
 * Runs the sample windows and calls `onVerdict('low' | 'high')` after each decisive one. Stops after the first 'low'
 * (it is sticky for the session). Returns stop(). `env` is injectable: { setTimer, clearTimer, raf, caf, hidden, schedule (waits in ms), windowMs }.
 */
export function startPerfMonitor(onVerdict, env = {}) {
  const setT = env.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearT = env.clearTimer || ((id) => clearTimeout(id));
  const schedule = env.schedule || SCHEDULE;
  const windowMs = env.windowMs || 2500;
  let timer = 0;
  let cancel = null;
  let stopped = false;
  let i = 0;
  const next = () => {
    if (stopped || i >= schedule.length) return;
    const wait = Math.max(0, schedule[i]);
    i += 1;
    timer = setT(() => {
      cancel = sampleFrames(windowMs, (deltas) => {
        const v = deltas ? judgeFrames(deltas) : null;
        if (v) onVerdict(v);
        if (v === 'low') { stopped = true; return; }
        next();
      }, env);
    }, wait);
  };
  next();
  return () => { stopped = true; clearT(timer); if (cancel) cancel(); };
}

/* ---------------------------------------------------------------- the one shared level */

let level = ''; // '' (unknown) | 'low' | 'high'
const subs = new Set();

function readStored(now = Date.now()) {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_KEY);
    if (!raw) return '';
    const o = JSON.parse(raw);
    return o && o.v === 'low' && now - Number(o.t) < STORE_TTL_MS ? 'low' : '';
  } catch { return ''; }
}

function writeStored(v) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (v === 'low') localStorage.setItem(STORE_KEY, JSON.stringify({ v: 'low', t: Date.now() }));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* private mode: the verdict just is not remembered */ }
}

/** Sets the level, mirrors it on <html data-perf> and tells subscribers. */
export function setPerfLevel(v) {
  const next = v === 'low' || v === 'high' ? v : '';
  if (next === level) return;
  level = next;
  try {
    if (typeof document !== 'undefined') {
      if (next) document.documentElement.dataset.perf = next;
      else delete document.documentElement.dataset.perf;
    }
  } catch { /* optional */ }
  subs.forEach((cb) => cb());
}

export const getPerfLevel = () => level;
const subscribe = (cb) => { subs.add(cb); return () => subs.delete(cb); };

/** 'low' | 'high' | '' - re-renders when the level changes (the Menu's "Light graphics" switch reads it). */
export function usePerfLevel() {
  return useSyncExternalStore(subscribe, getPerfLevel, () => '');
}

/**
 * Call once from the table. Settings > graphics: 'lite' = always low, 'full' = always full, 'auto' = remembered 'low'
 * (a few days) or the frame-time monitor.
 */
export function usePerfMode() {
  const [settings] = useSettings();
  const pref = settings?.graphics || 'auto';
  useEffect(() => {
    if (pref === 'lite') { setPerfLevel('low'); return () => setPerfLevel(''); }
    if (pref === 'full') { setPerfLevel('high'); return () => setPerfLevel(''); }
    if (readStored() === 'low') { setPerfLevel('low'); return () => setPerfLevel(''); }
    setPerfLevel('');
    const stop = startPerfMonitor((v) => {
      setPerfLevel(v);
      if (v === 'low') writeStored('low');
    });
    return () => { stop(); setPerfLevel(''); };
  }, [pref]);
}
