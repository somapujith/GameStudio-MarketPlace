import { describe, it, expect } from 'vitest';
import { combineFpsCap, createGovernorFeed, startTier } from './adapt.js';
import { createGovernor } from '../../../platform/gfx/governor.js';
import { GOVERNOR_OPTIONS, QUALITY_ORDER, SCALE_LADDER, SCALE_MIN, TIER_COST } from './quality.js';

describe('combineFpsCap', () => {
  it('takes the lower of the tier cap and the hint cap, whichever are set; 0 is uncapped', () => {
    expect(combineFpsCap(0, 0)).toBe(0);
    expect(combineFpsCap(30, 0)).toBe(30);
    expect(combineFpsCap(0, 30)).toBe(30);
    expect(combineFpsCap(30, 24)).toBe(24);
    expect(combineFpsCap(60, 30)).toBe(30);
    expect(combineFpsCap(undefined, undefined)).toBe(0);
  });
});

describe('startTier', () => {
  it('keeps an explicit choice (the capability ceiling IS the choice)', () => {
    expect(startTier({ auto: false, initial: 'low', ceiling: 'high' })).toBe('high');
  });
  it('on Auto uses the lower of the shared layer\'s start and the capability gate\'s ceiling', () => {
    expect(startTier({ auto: true, initial: 'medium', ceiling: 'high' })).toBe('medium');
    expect(startTier({ auto: true, initial: 'high', ceiling: 'low' })).toBe('low'); // a phone: the legacy cap wins
    expect(startTier({ auto: true, initial: 'lite', ceiling: 'medium' })).toBe('lite');
  });
});

describe('createGovernorFeed', () => {
  const fakeGov = () => {
    const seen = [];
    return { budgetMs: 16.67, seen, frame: (...a) => (seen.push(a), 7), discontinuity: (ms) => seen.push(['disc', ms]) };
  };

  it('passes ordinary frames through and returns what the governor returns', () => {
    const g = fakeGov();
    let progs = 100;
    const feed = createGovernorFeed(g, () => progs, { none: 0 });
    expect(feed.frame(16, 8, 170, 9)).toBe(7);
    expect(g.seen[0]).toEqual([16, 8, 170, 9]);
    expect(feed.stalls).toBe(0);
  });

  it('keeps a compile stall (a new program and a frame over three budgets) from the governor, but not the normal frames next to it', () => {
    const g = fakeGov();
    let progs = 100;
    const feed = createGovernorFeed(g, () => progs, { none: 0 });
    feed.frame(16, 8, 170, 9); // prime the program count
    progs = 101; // a program appeared
    expect(feed.frame(400, 390, 170, -1)).toBe(0); // the first draw of a program that was still linking: 400 ms
    expect(feed.frame(17, 8, 170, 9)).toBe(7); // a normal frame inside the hold still counts
    expect(feed.stalls).toBe(1);
    expect(g.seen.length).toBe(2);
  });

  it('does not hide a slow device: long frames with NO new program reach the governor', () => {
    const g = fakeGov();
    const feed = createGovernorFeed(g, () => 100, { none: 0 });
    for (let i = 0; i < 5; i++) expect(feed.frame(70, 60, 170, 50)).toBe(7);
    expect(feed.stalls).toBe(0);
  });

  it('with the real governor: a slow device is seen (the scale steps down), the same slow frames in the middle of a compile storm are not', () => {
    const mk = () => {
      const changes = [];
      const gov = createGovernor({ tiers: QUALITY_ORDER, tier: 'medium', refreshHz: 60, lockTier: true, ladder: SCALE_LADDER, scaleMin: SCALE_MIN, onScale: (s) => changes.push(s) });
      return { gov, changes };
    };
    const slow = mk();
    const feed = createGovernorFeed(slow.gov, () => 250);
    for (let i = 0; i < 400; i++) feed.frame(40, -1, 170, -1);
    expect(slow.changes.length).toBeGreaterThan(0);
    // 40 ms frames that are all compile stalls (a program appears every frame, the warm-up ramp)
    const storm = mk();
    let programs = 100;
    const feed2 = createGovernorFeed(storm.gov, () => programs++);
    for (let i = 0; i < 400; i++) feed2.frame(160, -1, 170, -1);
    expect(storm.changes).toEqual([]);
    expect(feed2.stalls).toBeGreaterThan(300);
  });

  it('forwards discontinuities', () => {
    const g = fakeGov();
    const feed = createGovernorFeed(g, () => 0);
    feed.discontinuity(500);
    expect(g.seen[0]).toEqual(['disc', 500]);
  });
});

// the real governor with Tiffin's tables: what the wiring promises (scale steps before tier steps, the ladder, the hold after a change)
describe('the governor with the Tiffin tables', () => {
  const make = (over = {}) => {
    const events = [];
    const gov = createGovernor({
      tiers: QUALITY_ORDER, tier: 'medium', maxTier: 'medium', scale: 1, ladder: SCALE_LADDER, scaleMin: SCALE_MIN, tierCost: TIER_COST,
      refreshHz: 60, ...GOVERNOR_OPTIONS, ...over,
      onScale: (s) => events.push(['scale', s]),
      onTier: (t, info) => events.push(['tier', t, info.scale]),
    });
    return { gov, events };
  };
  const run = (gov, ms, dt, cpu = -1, calls = -1) => {
    for (let t = 0; t < ms; t += dt) gov.frame(dt, cpu, calls);
  };

  it('a GPU-bound overload steps the SCALE down (not the tier) and settles above the floor', () => {
    const { gov, events } = make();
    // a frame that costs 30 ms at scale 1 and scales with area (fill bound)
    let guard = 0;
    while (guard++ < 400 && !(events.length && events.at(-1)[0] === 'scale' && 30 * events.at(-1)[1] ** 2 < 16)) {
      const s = gov.scale;
      gov.frame(Math.max(16.67, 30 * s * s), -1, 170, -1);
    }
    expect(events.filter((e) => e[0] === 'tier')).toEqual([]);
    expect(gov.tier).toBe('medium');
    expect(gov.scale).toBeGreaterThanOrEqual(SCALE_MIN.medium);
    expect(gov.scale).toBeLessThan(1);
  });

  it('a frame that fits the budget changes nothing for a minute', () => {
    const { gov, events } = make();
    run(gov, 60000, 16.67, 6, 170);
    expect(events).toEqual([]);
    expect(gov.scale).toBe(1);
  });

  it('an explicit tier is never changed by the governor', () => {
    const { gov, events } = make({ lockTier: true });
    for (let i = 0; i < 2000; i++) gov.frame(60, 50, 900);
    expect(events.filter((e) => e[0] === 'tier')).toEqual([]);
    expect(gov.tier).toBe('medium');
  });

  it('hold() makes it ignore a stretch of terrible frames (the load, a tier rebuild)', () => {
    const { gov, events } = make();
    gov.hold(3000);
    for (let t = 0; t < 2500; t += 100) gov.frame(100, 90, 170);
    expect(events).toEqual([]);
  });
});
