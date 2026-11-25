// readLive reads the second drop-off of a shared ride (ctx.fares.riders()[1].dest) about every sixth call, never allocating otherwise.
import { describe, expect, it, vi } from 'vitest';
import { newLive, readLive } from './draw.js';

const dest = (x, z) => ({ x, z, name: 'Stop', front: { x, z } });
const ctxWith = (riders, trip = riders[0]) => ({ v: { x: 1, z: 2, heading: 0, speed: 3 }, fares: { waiting: [], trip, riders: vi.fn(() => riders) } });
const settle = (ctx, live) => { for (let i = 0; i < 6; i++) readLive(ctx, live); return live; };

describe('minimap second drop-off', () => {
  it('has none on a single ride or without fares', () => {
    const live = newLive();
    expect(settle(ctxWith([{ dest: dest(10, 10) }]), live).dest2).toBeNull();
    expect(settle({ v: {} }, newLive()).dest2).toBeNull();
  });
  it('picks the second rider destination on a shared ride, and drops it when the ride ends', () => {
    const live = newLive();
    const a = { dest: dest(10, 10) };
    const b = { dest: dest(-40, 25) };
    settle(ctxWith([a, b]), live);
    expect(live.dest).toBe(a.dest);
    expect(live.dest2).toBe(b.dest);
    settle(ctxWith([b], b), live);
    expect(live.dest2).toBeNull();
    expect(live.dest).toBe(b.dest);
  });
  it('ignores a malformed destination and does not call riders() on every frame', () => {
    const live = newLive();
    const ctx = ctxWith([{ dest: dest(1, 1) }, { dest: { x: 'a' } }]);
    settle(ctx, live);
    expect(live.dest2).toBeNull();
    ctx.fares.riders.mockClear();
    for (let i = 0; i < 12; i++) readLive(ctx, live);
    expect(ctx.fares.riders.mock.calls.length).toBe(2);
  });
});
