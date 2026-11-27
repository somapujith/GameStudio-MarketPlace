import { describe, expect, it } from 'vitest';
import { QUALITY } from '../game/config.js';
import { allocRatio, effectiveScale, fogFloorFor, gpuForTiers, mapTierCap, pixelRatioFor, prefOf, sessionMaxTier, shadedMegapixels, tierAbove, tierBelow, tierScale } from './quality.js';

const laptop = { w: 1536, h: 864, dpr: 1.25 };
const phone = { w: 844, h: 390, dpr: 3 };
const fourK = { w: 3840, h: 2160, dpr: 1 };

describe('pixel ratio per tier', () => {
  it('is the tier ratio, never above the device ratio', () => {
    expect(pixelRatioFor(QUALITY.medium, laptop)).toBeCloseTo(1.25, 6);
    expect(pixelRatioFor(QUALITY.low, laptop)).toBeCloseTo(1, 6);
    expect(pixelRatioFor(QUALITY.high, laptop)).toBeCloseTo(1.25, 6); // a 1.25 device cannot show more
    expect(pixelRatioFor(QUALITY.medium, { w: 1280, h: 720, dpr: 1 })).toBe(1);
  });

  it('a phone keeps the tier ratio (its screen density is far above what the GPU should shade)', () => {
    expect(pixelRatioFor(QUALITY.medium, phone)).toBeCloseTo(1.25, 6);
    expect(pixelRatioFor(QUALITY.low, phone)).toBe(1);
  });

  it('the pixel budget lowers the ratio of a huge window instead of shading 8 MP', () => {
    const r = pixelRatioFor(QUALITY.medium, fourK);
    expect(r).toBeLessThan(0.6);
    expect(r).toBeGreaterThanOrEqual(0.5);
    const mp = (fourK.w * r) * (fourK.h * r) / 1e6;
    expect(mp).toBeLessThanOrEqual(QUALITY.medium.pixelBudget + 0.01);
    // a 1440p laptop at dpr 1.5 (CSS 1707 x 960) stays under its budget with no cut
    expect(pixelRatioFor(QUALITY.medium, { w: 1707, h: 960, dpr: 1.5 })).toBeCloseTo(1.25, 6);
  });

  it('medium on the dev laptop shades 2.07 MP, inside its budget', () => {
    expect(shadedMegapixels('medium', 'medium', 1, laptop)).toBeCloseTo(2.07, 2);
    expect(shadedMegapixels('medium', 'medium', 1, laptop)).toBeLessThanOrEqual(QUALITY.medium.pixelBudget);
  });
});

describe('allocation and tier share', () => {
  it('allocates for the highest tier the session may reach', () => {
    expect(allocRatio('medium', laptop)).toBeCloseTo(1.25, 6);
    expect(allocRatio('low', laptop)).toBeCloseTo(1, 6);
    expect(allocRatio('high', { w: 1920, h: 1080, dpr: 2 })).toBeCloseTo(Math.sqrt(5e6 / (1920 * 1080)), 6); // the budget binds before the 1.75 cap
  });

  it('a lower tier is a share of the allocation, so a tier step re-allocates nothing', () => {
    expect(tierScale('medium', 'medium', laptop)).toBe(1);
    expect(tierScale('low', 'medium', laptop)).toBeCloseTo(0.8, 6); // 1 / 1.25
    expect(tierScale('low', 'low', laptop)).toBe(1);
    expect(tierScale('medium', 'high', { w: 1280, h: 720, dpr: 2 })).toBeCloseTo(1.25 / 1.75, 6);
  });

  it('never above 1: a tier ABOVE the allocation is clamped (the renderer re-allocates before that happens)', () => {
    expect(tierScale('high', 'low', laptop)).toBe(1);
  });

  it('effective scale multiplies the tier share by the governor scale and keeps a floor', () => {
    expect(effectiveScale(0.8, 0.9)).toBeCloseTo(0.72, 6);
    expect(effectiveScale(0.8, 0.1)).toBe(0.3);
    expect(effectiveScale(1, 1)).toBe(1);
    expect(effectiveScale(1.4, 1)).toBe(1);
  });
});

describe('tier caps of the GPU class', () => {
  it('maps the generic ladder (lite, low, medium, high) onto this game (low, medium, high)', () => {
    expect(mapTierCap('lite')).toBe('low');
    expect(mapTierCap('low')).toBe('low');
    expect(mapTierCap('medium')).toBe('medium');
    expect(mapTierCap('high')).toBe('high');
    expect(mapTierCap(undefined)).toBe('low');
    expect(mapTierCap('weird')).toBe('low');
  });

  it('a software renderer (cap lite) never starts above low', () => {
    expect(gpuForTiers({ class: 'software', tierCap: 'lite' }).tierCap).toBe('low');
    expect(gpuForTiers({ class: 'integrated', tierCap: 'medium', key: 'x' })).toMatchObject({ tierCap: 'medium', key: 'x' });
  });

  it('the session ceiling: a player choice pins it, a remembered higher tier raises the class cap', () => {
    expect(sessionMaxTier({ pref: 'low', cap: 'high' })).toBe('low');
    expect(sessionMaxTier({ pref: 'auto', cap: 'medium' })).toBe('medium');
    expect(sessionMaxTier({ pref: 'auto', cap: 'medium', remembered: 'high' })).toBe('high');
    expect(sessionMaxTier({ pref: 'auto', cap: 'high', remembered: 'low' })).toBe('high');
    expect(sessionMaxTier({ pref: 'auto', cap: 'lite' })).toBe('low');
  });

  it('turns the saved setting into the gfx layer preference', () => {
    expect(prefOf('high')).toBe('high');
    expect(prefOf(null)).toBe('auto');
    expect(prefOf('ultra')).toBe('auto');
    expect(tierBelow('low')).toBe('low');
    expect(tierBelow('high')).toBe('medium');
    expect(tierAbove('high')).toBe('high');
    expect(tierAbove('low')).toBe('medium');
  });
});

describe('the far plane and the fog that hides it', () => {
  const fogAtFar = (far) => 1 - Math.exp(-((fogFloorFor(far) * far) ** 2));
  it('leaves a far plane at least 80 % fogged whatever its distance', () => {
    for (const q of ['low', 'medium', 'high']) expect(fogAtFar(QUALITY[q].far)).toBeGreaterThan(0.8);
  });

  it('is thinner for a longer far plane, so a near view is hardly changed', () => {
    expect(fogFloorFor(1600)).toBeLessThan(fogFloorFor(1000));
    // medium at noon: the palette's own density is 0.0008; the floor is only a little above it
    expect(fogFloorFor(QUALITY.medium.far)).toBeLessThan(0.0012);
    expect(fogFloorFor(0)).toBe(0);
  });

  it('is monotone with the tiers: a better tier sees farther', () => {
    expect(QUALITY.low.far).toBeLessThan(QUALITY.medium.far);
    expect(QUALITY.medium.far).toBeLessThan(QUALITY.high.far);
    // the sun glow sprite sits 900 m out: inside the far plane of every tier
    for (const q of ['low', 'medium', 'high']) expect(QUALITY[q].far).toBeGreaterThan(900);
  });
});
