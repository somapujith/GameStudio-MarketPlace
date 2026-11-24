import { describe, it, expect } from 'vitest';
import { createFrameBus } from './frameBus.js';

describe('frame bus', () => {
  const rig = () => {
    const q = new Map();
    let next = 1;
    const bus = createFrameBus({
      raf: (fn) => {
        q.set(next, fn);
        return next++;
      },
      caf: (id) => q.delete(id),
      now: () => 5,
    });
    const frame = () => {
      const fns = [...q.values()];
      q.clear();
      fns.forEach((f) => f());
    };
    return { bus, frame, q };
  };
  it('runs one loop for many listeners and stops when the last one leaves', () => {
    const { bus, frame, q } = rig();
    const seen = [];
    const off1 = bus.add((t) => seen.push(['a', t]));
    const off2 = bus.add(() => seen.push(['b']));
    expect(q.size).toBe(1);
    frame();
    frame();
    expect(seen.filter((s) => s[0] === 'a')).toHaveLength(2);
    off1();
    expect(q.size).toBe(1);
    off2();
    expect(q.size).toBe(0);
    expect(bus.size()).toBe(0);
  });
  it('a listener may remove itself mid-frame', () => {
    const { bus, frame } = rig();
    let n = 0;
    const off = bus.add(() => {
      n += 1;
      off();
    });
    frame();
    frame();
    expect(n).toBe(1);
  });
});
