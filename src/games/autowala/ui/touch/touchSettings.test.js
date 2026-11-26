import { describe, expect, it } from 'vitest';
import { DEFAULTS, TOUCH_KEY, forcedByUrl, loadTouchSettings, migrate, sanitize, saveTouchSettings } from './touchSettings.js';

const memStorage = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, data: m };
};

describe('sanitize', () => {
  it('fills every field from nothing', () => {
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize(undefined)).toEqual(DEFAULTS);
    expect(sanitize('junk')).toEqual(DEFAULTS);
    expect(sanitize([1, 2])).toEqual(DEFAULTS);
  });
  it('keeps valid choices and repairs invalid ones', () => {
    const s = sanitize({ steering: 'tilt', hand: 'left', size: 'L', opacity: 0.5, autoThrottle: true, tiltSens: 0.8, tiltNeutral: 12.34 });
    expect(s).toMatchObject({ steering: 'tilt', hand: 'left', size: 'L', opacity: 0.5, autoThrottle: true, tiltSens: 0.8, tiltNeutral: 12.3 });
    const bad = sanitize({ steering: 'joystick', hand: 'both', size: 'XXL', opacity: 'lots', tiltSens: 9, tiltNeutral: 9999, haptics: 'maybe' });
    expect(bad.steering).toBe('wheel');
    expect(bad.hand).toBe('right');
    expect(bad.size).toBe('M');
    expect(bad.opacity).toBe(DEFAULTS.opacity);
    expect(bad.tiltSens).toBe(1);
    expect(bad.tiltNeutral).toBe(180);
    expect(bad.haptics).toBe(true);
  });
  it('clamps opacity to a visible range', () => {
    expect(sanitize({ opacity: 0 }).opacity).toBe(0.35);
    expect(sanitize({ opacity: 150 }).opacity).toBe(1);
    expect(sanitize({ opacity: 70 }).opacity).toBe(0.7); // a percentage
  });
  it('is idempotent', () => {
    const once = sanitize({ steering: 'arrows', hand: 'left', size: 's', opacity: '0.7' });
    expect(sanitize(once)).toEqual(once);
  });
});

describe('migrate (older / foreign shapes)', () => {
  it('maps v0 names and values', () => {
    const s = sanitize({ mode: 'tilt', leftHanded: true, scale: 1.3, alpha: 60, autoGas: true, alwaysShow: true });
    expect(s).toMatchObject({ steering: 'tilt', hand: 'left', size: 'L', opacity: 0.6, autoThrottle: true, force: true });
  });
  it('maps the slider mode to the wheel and small scales to S', () => {
    expect(sanitize({ mode: 'slider' }).steering).toBe('wheel');
    expect(sanitize({ scale: 0.8 }).size).toBe('S');
    expect(sanitize({ scale: 1 }).size).toBe('M');
  });
  it('accepts word forms of the hand and lower-case sizes', () => {
    expect(sanitize({ hand: 'left-handed' }).hand).toBe('left');
    expect(sanitize({ hand: 'right-handed' }).hand).toBe('right');
    expect(sanitize({ size: 'l' }).size).toBe('L');
  });
  it('migrate never throws on hostile input', () => {
    expect(migrate(null)).toEqual({});
    expect(migrate(5)).toEqual({});
  });
});

describe('persistence', () => {
  it('uses the documented key', () => {
    expect(TOUCH_KEY).toBe('jalebi.autowala.touch.v1');
  });
  it('round-trips through storage', () => {
    const st = memStorage();
    const saved = saveTouchSettings({ ...DEFAULTS, steering: 'arrows', hand: 'left', size: 'S' }, st);
    expect(JSON.parse(st.data[TOUCH_KEY])).toEqual(saved);
    expect(loadTouchSettings(st)).toEqual(saved);
  });
  it('loads defaults when nothing or garbage is stored', () => {
    expect(loadTouchSettings(memStorage())).toEqual(DEFAULTS);
    expect(loadTouchSettings(memStorage({ [TOUCH_KEY]: '{not json' }))).toEqual(DEFAULTS);
    expect(loadTouchSettings(memStorage({ [TOUCH_KEY]: 'null' }))).toEqual(DEFAULTS);
  });
  it('migrates an old stored blob on load', () => {
    const st = memStorage({ [TOUCH_KEY]: JSON.stringify({ leftHanded: true, scale: 1.2 }) });
    expect(loadTouchSettings(st)).toMatchObject({ hand: 'left', size: 'L' });
  });
  it('survives a blocked / throwing storage', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadTouchSettings(boom)).toEqual(DEFAULTS);
    expect(saveTouchSettings({ steering: 'tilt' }, boom).steering).toBe('tilt');
    expect(loadTouchSettings(null)).toEqual(DEFAULTS);
  });
});

describe('forcedByUrl', () => {
  it('?touch=1 forces the controls on', () => {
    expect(forcedByUrl('?touch=1')).toBe(true);
    expect(forcedByUrl('?a=1&touch=true')).toBe(true);
    expect(forcedByUrl('?touch=0')).toBe(false);
    expect(forcedByUrl('')).toBe(false);
  });
});
