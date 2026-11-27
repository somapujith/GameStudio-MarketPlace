import { describe, expect, it, vi } from 'vitest';
import { createAdaptiveQuality, readBattery, readDeviceHints, watchDeviceHints } from './adaptive.js';
import { createGovernor } from './governor.js';
import * as gfx from './index.js';

const RADEON = 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const fakeStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
};
const VIEW = { w: 1536, h: 864, dpr: 1.25 };
const TIERS = ['lite', 'low', 'medium', 'high'];
const mk = (o = {}) => createAdaptiveQuality({ game: 'test', tiers: TIERS, viewport: VIEW, renderer: RADEON, storage: fakeStorage(), ...o });

describe('createAdaptiveQuality: the start tier', () => {
  it('an integrated GPU with no history and no calibration starts on medium, never high', () => {
    const aq = mk();
    expect(aq.initial).toMatchObject({ tier: 'medium', source: 'class' });
    expect(aq.governor.tier).toBe('medium');
    expect(aq.gpu.class).toBe('integrated');
  });
  it('a discrete GPU starts on high', () => expect(mk({ renderer: RTX }).initial.tier).toBe('high'));
  it('a calibration result is used, capped by the GPU class', () => {
    const calibration = { recommended: { tier: 'high', scale: 1, reasons: ['high fits'] }, refreshHz: 120 };
    const aq = mk({ calibration });
    expect(aq.initial).toMatchObject({ tier: 'medium', source: 'calibration' });
    expect(aq.governor.refreshHz).toBe(120);
    expect(mk({ renderer: RTX, calibration }).initial.tier).toBe('high');
  });
  it('an explicit preference wins, locks the tier, and is never remembered', () => {
    const st = fakeStorage();
    const aq = mk({ storage: st, pref: 'low' });
    expect(aq.initial).toMatchObject({ tier: 'low', source: 'pref', lock: true });
    expect(aq.governor.locked).toBe(true);
    // run a stable session: nothing stored
    for (let i = 0; i < 900; i++) aq.governor.frame(16.7, 4);
    expect(st.m.size).toBe(0);
  });
});

describe('createAdaptiveQuality: memory', () => {
  it('the governor saves the stable tier and scale; the next session starts there', () => {
    const st = fakeStorage();
    const first = mk({ storage: st });
    // a load that needs scale ~0.7 at 60 Hz vsync: the first session adapts...
    const cost = (scale) => 2 + 26 * scale * scale;
    for (let i = 0; i < 3000; i++) {
      const w = cost(first.governor.scale);
      first.governor.frame(Math.max(16.667, Math.ceil(w / 16.667) * 16.667), 4);
    }
    expect(first.governor.scale).toBe(0.7);
    expect(first.memory.get(first.gpu.key, first.vp)).toMatchObject({ tier: 'medium', scale: 0.7 });
    // ...and the second starts at 0.7 at once
    const second = mk({ storage: st });
    expect(second.initial).toMatchObject({ source: 'memory', tier: 'medium', scale: 0.7 });
    expect(second.governor.scale).toBe(0.7);
  });
  it('a failed tier-up is recorded and the next session never tries that tier', () => {
    const st = fakeStorage();
    const first = mk({ storage: st, renderer: RTX, pref: 'auto', governor: {} });
    first.governor.setTier('medium', { scale: 1, lock: false });
    first.governor.setMaxTier('high');
    // headroom shows on the timer, the real tier is too heavy
    const real = (tier, scale) => 1 + (tier === 'high' ? 40 : 6) * scale * scale;
    for (let i = 0; i < 12000; i++) {
      const w = real(first.governor.tier, first.governor.scale);
      first.governor.frame(Math.max(16.667, Math.ceil(w / 16.667) * 16.667), 2, -1, 4);
    }
    expect(first.memory.isFailed(first.gpu.key, first.vp, 'high')).toBe(true);
    const second = mk({ storage: st, renderer: RTX });
    expect(second.governor.stats().tierFailures[3]).toBeGreaterThan(0);
  });
  it('callbacks reach the game: onScale and onTier', () => {
    const onScale = vi.fn();
    const onTier = vi.fn();
    const aq = mk({ onScale, onTier });
    for (let i = 0; i < 400; i++) aq.governor.frame(40, 5); // a 25 fps machine
    expect(onScale.mock.calls.length + onTier.mock.calls.length).toBeGreaterThan(0);
  });
  it('forget() drops the remembered result', () => {
    const st = fakeStorage();
    const aq = mk({ storage: st });
    aq.memory.set(aq.gpu.key, aq.vp, { tier: 'low', scale: 0.9 });
    expect(mk({ storage: st }).initial.source).toBe('memory');
    aq.forget();
    expect(mk({ storage: st }).initial.source).toBe('class');
  });
  it('describe() is one readable line', () => expect(mk().describe()).toMatch(/^gfx: integrated AMD Radeon Graphics cap:medium -> start medium@1 \(class/));
  it('survives hostile storage (private mode): still works for the session', () => {
    const boom = new Proxy({}, { get() { throw new Error('SecurityError'); } });
    const aq = mk({ storage: boom });
    expect(aq.initial.tier).toBe('medium');
    for (let i = 0; i < 900; i++) aq.governor.frame(16.7, 4);
    expect(aq.governor.tier).toBe('medium');
  });
});

describe('device hints', () => {
  it('readDeviceHints: save-data and reduced motion', () => {
    expect(readDeviceHints({ nav: { connection: { saveData: true } }, win: {}, mm: () => false })).toMatchObject({ saveData: true, slowNet: false });
    expect(readDeviceHints({ nav: { connection: { effectiveType: 'slow-2g' } }, win: {}, mm: (q) => /reduced-motion/.test(q) })).toMatchObject({ slowNet: true, reducedMotion: true, saveData: false });
    expect(readDeviceHints({ nav: {}, win: {}, mm: () => false })).toEqual({ saveData: false, slowNet: false, reducedMotion: false });
  });
  it('readBattery: guarded and bounded', async () => {
    expect(await readBattery({})).toBeNull();
    expect(await readBattery({ getBattery: () => Promise.reject(new Error('denied')) })).toBeNull();
    const b = await readBattery({ getBattery: () => Promise.resolve({ level: 0.5, charging: true }) });
    expect(b).toMatchObject({ level: 0.5, charging: true });
  });
  it('watchDeviceHints: low battery caps the governor at 30 fps; charging lifts it; unsubscribe stops it', async () => {
    const gov = createGovernor({});
    const listeners = {};
    const bat = { level: 0.15, charging: false, addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: (n) => { delete listeners[n]; } };
    const conn = { saveData: false, addEventListener: (n, f) => { listeners[`conn-${n}`] = f; }, removeEventListener: (n) => { delete listeners[`conn-${n}`]; } };
    const stop = watchDeviceHints(gov, { nav: { getBattery: () => Promise.resolve(bat), connection: conn }, win: {}, mm: () => false });
    await new Promise((r) => setTimeout(r, 5));
    expect(gov.fpsCap).toBe(30);
    bat.charging = true;
    listeners.chargingchange();
    expect(gov.fpsCap).toBe(0);
    conn.saveData = true;
    listeners['conn-change']();
    expect(gov.fpsCap).toBe(30);
    stop();
    expect(Object.keys(listeners)).toEqual([]);
  });
});

describe('index barrel', () => {
  it('exports every module of the engine', () => {
    for (const name of [
      'classifyGpu', 'createTierMemory', 'createCalibration', 'createGovernor', 'warmShaders', 'programCensus', 'mergeByMaterial', 'freezeStatic', 'createLoop', 'createFrameRing',
      'createDynamicRes', 'rewriteSamples', 'createAdaptiveQuality', 'createGpuTimer', 'chooseInitialTier', 'disposeTree', 'tileInstances',
    ]) expect(typeof gfx[name]).toBe('function');
    expect(gfx.DYNRES_GLSL).toContain('dynUv');
    expect(gfx.CHANGE_TIER).toBe(2);
  });
});
