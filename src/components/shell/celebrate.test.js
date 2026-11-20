import { describe, expect, it, vi } from 'vitest';
import { checkLevelUp, createCelebrationQueue, normalizeCelebration, QUEUE_MAX } from './celebrationQueue.js';
import { celebrate, celebrations, dismissCelebration } from './celebrate.js';

describe('celebration queue', () => {
  const make = () => {
    let t = 0;
    const q = createCelebrationQueue({ now: () => t });
    return { q, tick: (ms) => (t += ms) };
  };

  it('shows one at a time, in order, and promotes the next on dismiss', () => {
    const { q, tick } = make();
    const a = q.push({ kind: 'level', title: 'Level 2!' });
    tick(10);
    const b = q.push({ kind: 'coins', title: '+250' });
    expect(q.current()).toMatchObject({ id: a, kind: 'level', title: 'Level 2!' });
    expect(q.pending().map((x) => x.id)).toEqual([b]);
    expect(q.dismiss(b)).toBe(false); // only the visible one can be dismissed by id
    expect(q.dismiss(a)).toBe(true);
    expect(q.current()?.id).toBe(b);
    q.dismiss();
    expect(q.current()).toBeNull();
    expect(q.dismiss()).toBe(false);
  });

  it('notifies subscribers with the new head', () => {
    const { q } = make();
    const seen = [];
    const off = q.subscribe((h) => seen.push(h?.title ?? null));
    q.push({ kind: 'badge', title: 'Landlord' });
    q.push({ kind: 'badge', title: 'Tycoon' });
    q.dismiss();
    q.dismiss();
    off();
    q.push({ kind: 'badge', title: 'ignored' });
    expect(seen).toEqual(['Landlord', 'Landlord', 'Tycoon', null]);
  });

  it('ignores an identical celebration within the dedupe window, accepts it later', () => {
    const { q, tick } = make();
    expect(q.push({ kind: 'coins', title: '+100' })).not.toBeNull();
    expect(q.push({ kind: 'coins', title: '+100' })).toBeNull();
    expect(q.size()).toBe(1);
    tick(5000);
    expect(q.push({ kind: 'coins', title: '+100' })).not.toBeNull();
    expect(q.size()).toBe(2);
  });

  it('caps the waiting list but never drops the visible one', () => {
    const { q, tick } = make();
    for (let i = 0; i < QUEUE_MAX + 4; i++) {
      q.push({ kind: 'badge', title: `B${i}` });
      tick(1);
    }
    expect(q.size()).toBe(QUEUE_MAX);
    expect(q.current().title).toBe('B0');
    expect(q.pending().at(-1).title).toBe(`B${QUEUE_MAX + 3}`);
  });

  it('normalises input: unknown kind -> badge, default titles, trimmed text, bad input -> null', () => {
    expect(normalizeCelebration(null)).toBeNull();
    expect(normalizeCelebration({ kind: 'weird' })).toMatchObject({ kind: 'badge', title: 'Badge unlocked' });
    expect(normalizeCelebration({ kind: 'level' })).toMatchObject({ title: 'Level up!', icon: null, duration: 2500 });
    expect(normalizeCelebration({ kind: 'purchase', title: '  Neon   frame ', icon: 'star' })).toMatchObject({ title: 'Neon frame', icon: 'star' });
    expect(normalizeCelebration({ kind: 'coins', text: 'x'.repeat(300) }).text).toHaveLength(140);
  });
});

describe('celebrate() (app-wide queue)', () => {
  it('pushes into the shared queue and never throws', () => {
    dismissCelebration({ all: true });
    const spy = vi.fn();
    const off = celebrations.subscribe(spy);
    const id = celebrate({ kind: 'purchase', title: 'Gold dice' });
    expect(id).toBeTypeOf('number');
    expect(celebrations.current()).toMatchObject({ kind: 'purchase', title: 'Gold dice' });
    expect(celebrate(undefined)).toBeNull();
    dismissCelebration();
    expect(celebrations.current()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('checkLevelUp', () => {
  it('records the first sighting without celebrating', () => {
    expect(checkLevelUp({}, 'u1', 4)).toEqual({ up: false, from: null, to: 4, seen: { u1: 4 } });
  });
  it('celebrates a rise, per user', () => {
    const r = checkLevelUp({ u1: 4, u2: 9 }, 'u1', 6);
    expect(r).toMatchObject({ up: true, from: 4, to: 6 });
    expect(r.seen).toEqual({ u1: 6, u2: 9 });
    expect(checkLevelUp(r.seen, 'u2', 9).up).toBe(false);
  });
  it('does not celebrate the same or a lower level; ignores bad input', () => {
    expect(checkLevelUp({ 7: 5 }, 7, 5).up).toBe(false);
    expect(checkLevelUp({ 7: 5 }, 7, 3)).toMatchObject({ up: false, seen: { 7: 3 } });
    expect(checkLevelUp(null, null, 3)).toMatchObject({ up: false, seen: {} });
    expect(checkLevelUp({ a: 2 }, 'a', 'x')).toMatchObject({ up: false, seen: { a: 2 } });
  });
});
