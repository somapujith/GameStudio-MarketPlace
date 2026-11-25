import { describe, expect, it } from 'vitest';
import { SHARE, SHARE_ODDS, along, canOfferShare, candidateFit, detourExtra, detourMoodHit, distToSegment, effectiveDriven, shareAgrees, sharedFixedFare } from './fare-share.js';

const auto = { x: 0, z: 0 };
const drop = { x: 0, z: -800 }; // north

describe('who agrees to share', () => {
  it('never a rusher, and the odds follow the persona', () => {
    expect(shareAgrees('rusher', 0)).toBe(false);
    expect(shareAgrees('student', SHARE_ODDS.student - 0.01)).toBe(true);
    expect(shareAgrees('elder', SHARE_ODDS.elder + 0.01)).toBe(false);
  });

  it('offers only a calm, single, non-urgent ride that still has a way to go', () => {
    const ok = { pax: 1, urgent: null, kind: 'regular', shared: false };
    const s = { agreed: true, distLeft: 600, elapsed: 10 };
    expect(canOfferShare(ok, s)).toBe(true);
    expect(canOfferShare({ ...ok, pax: 2 }, s)).toBe(false);
    expect(canOfferShare({ ...ok, urgent: { id: 'train' } }, s)).toBe(false);
    expect(canOfferShare({ ...ok, shared: true }, s)).toBe(false);
    expect(canOfferShare(ok, { ...s, agreed: false })).toBe(false);
    expect(canOfferShare(ok, { ...s, distLeft: SHARE.minLeft - 1 })).toBe(false);
    expect(canOfferShare(ok, { ...s, elapsed: 1 })).toBe(false);
  });
});

describe('geometry', () => {
  it('distance to a segment, clamped at the ends', () => {
    expect(distToSegment(10, -400, 0, 0, 0, -800)).toEqual({ d: 10, t: 0.5 });
    expect(distToSegment(0, 100, 0, 0, 0, -800).d).toBe(100);
    expect(distToSegment(5, 5, 0, 0, 0, 0).d).toBeCloseTo(Math.hypot(5, 5));
  });

  it('a customer on the way costs almost nothing, one off to the side costs a lot', () => {
    expect(detourExtra(auto, { x: 5, z: -300 }, drop)).toBeLessThan(2);
    expect(detourExtra(auto, { x: 400, z: -300 }, drop)).toBeGreaterThan(300);
    expect(detourExtra(auto, { x: 0, z: -400 }, drop)).toBe(0);
  });

  it('fits a nearby customer heading the same way, rejects the wrong ones', () => {
    const base = { x: 12, z: -120, pax: 1, kind: 'regular', urgent: null, dest: { x: 20, z: -700 } };
    expect(candidateFit(auto, drop, base).ok).toBe(true);
    expect(candidateFit(auto, drop, { ...base, dest: { x: 0, z: 400 } }).ok).toBe(false); // opposite way
    expect(candidateFit(auto, drop, { ...base, x: 200 }).ok).toBe(false); // off the route
    expect(candidateFit(auto, drop, { ...base, z: -400 }).ok).toBe(false); // too far from the auto right now
    expect(candidateFit(auto, drop, { ...base, z: -400 }, Infinity).ok).toBe(true); // ... but fine for a spawn
    expect(candidateFit(auto, drop, { ...base, pax: 2 }).ok).toBe(false);
    expect(candidateFit(auto, drop, { ...base, urgent: { id: 'train' } }).ok).toBe(false);
    expect(candidateFit(auto, drop, { ...base, kind: 'rusher' }).ok).toBe(false);
  });
});

describe('money and mood', () => {
  it('sharers pay a discounted rate per metre while the auto holds two', () => {
    expect(effectiveDriven(1000, 0, 0)).toBe(1000);
    expect(effectiveDriven(1000, 0, 400)).toBe(1000 - SHARE.discount * 400);
    expect(effectiveDriven(1000, 300, 400)).toBe(700 - SHARE.discount * 400);
    expect(effectiveDriven(100, 300, 0)).toBe(0);
    // two sharers together still out-earn one solo rider
    const solo = effectiveDriven(1000, 0, 0);
    const pair = effectiveDriven(1000, 0, 1000) + effectiveDriven(1000, 0, 1000);
    expect(pair).toBeGreaterThan(solo);
  });

  it('a fixed price shrinks a little when it was shared', () => {
    expect(sharedFixedFare(200, 0)).toBe(200);
    expect(sharedFixedFare(200, 10)).toBe(200);
    expect(sharedFixedFare(200, 300)).toBe(Math.round(200 * (1 - SHARE.fixedDiscount)));
  });

  it('the detour mood hit grows with the extra metres and the temper, and is bounded', () => {
    expect(detourMoodHit('regular', 0)).toBe(0);
    expect(detourMoodHit('regular', 200)).toBeGreaterThan(0);
    expect(detourMoodHit('elder', 200)).toBeGreaterThan(detourMoodHit('student', 200));
    expect(detourMoodHit('rusher', 99999)).toBeLessThanOrEqual(0.25);
  });

  it('along() walks from a to b', () => {
    expect(along({ x: 0, z: 0 }, { x: 100, z: -200 }, 0.5)).toEqual({ x: 50, z: -100 });
  });
});
