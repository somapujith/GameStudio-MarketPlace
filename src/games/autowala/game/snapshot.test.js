import { describe, expect, it } from 'vitest';
import { createSnapshotPublisher, reuse, same } from './snapshot.js';

const base = () => ({
  kmh: 40, fuel: 0.5, hour: 12, x: 10, z: 20, heading: 1,
  session: { earned: 100, fares: 2 },
  trip: { name: 'Salma', dest: { name: 'Charminar' }, riders: 1 },
  route: null,
  prompt: { text: 'Pick up', key: 'E' },
  reviews: [{ stars: 5 }, { stars: 4 }],
});

describe('same', () => {
  it('compares plain data deeply', () => {
    expect(same(base(), base())).toBe(true);
    expect(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(same({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false); // a new key is a change
    expect(same({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(same([1, 2], [1, 2, 3])).toBe(false);
    expect(same(null, {})).toBe(false);
    expect(same([], {})).toBe(false);
    expect(same(NaN, NaN)).toBe(false); // snapshots never carry NaN on purpose; a NaN counts as a change rather than hiding one
  });
});

describe('reuse', () => {
  it('hands back the previous object for every part that did not change', () => {
    const a = base();
    const b = { ...base(), kmh: 41 };
    const out = reuse(a, b);
    expect(out).toBe(b);
    expect(out.session).toBe(a.session);
    expect(out.trip).toBe(a.trip);
    expect(out.reviews).toBe(a.reviews);
    expect(out.kmh).toBe(41);
  });
  it('keeps the new object for a part that changed', () => {
    const a = base();
    const b = base();
    b.trip.riders = 2;
    const out = reuse(a, b);
    expect(out.trip).toBe(b.trip);
    expect(out.session).toBe(a.session);
  });
});

describe('createSnapshotPublisher', () => {
  it('publishes the first snapshot, then only when something the UI shows changed', () => {
    const seen = [];
    const p = createSnapshotPublisher((s) => seen.push(s));
    expect(p.push(base())).toBe(true);
    expect(p.push(base())).toBe(false); // nothing changed
    expect(p.push({ ...base(), x: 99, z: -4, heading: 2.2 })).toBe(false); // only the position moved: nobody reads it
    expect(seen).toHaveLength(1);
    expect(p.push({ ...base(), kmh: 41 })).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it('shares unchanged parts between published snapshots', () => {
    const seen = [];
    const p = createSnapshotPublisher((s) => seen.push(s));
    p.push(base());
    p.push({ ...base(), hour: 12.02 });
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1].session).toBe(seen[0].session);
    expect(seen[1].trip).toBe(seen[0].trip);
    expect(seen[1].hour).toBe(12.02);
  });

  it('publishes when a key appears or disappears', () => {
    const seen = [];
    const p = createSnapshotPublisher((s) => seen.push(s));
    p.push(base());
    const withExtra = { ...base(), rage: { active: true } };
    expect(p.push(withExtra)).toBe(true);
    const { rage, ...without } = withExtra; // eslint-disable-line no-unused-vars
    expect(p.push(without)).toBe(true);
  });

  it('publishes the moved position along with the next real change', () => {
    const seen = [];
    const p = createSnapshotPublisher((s) => seen.push(s));
    p.push(base());
    p.push({ ...base(), x: 500 });
    p.push({ ...base(), x: 600, kmh: 50 });
    expect(seen).toHaveLength(2);
    expect(seen[1].x).toBe(600);
  });
});
