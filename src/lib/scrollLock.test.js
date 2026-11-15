import { describe, expect, it } from 'vitest';
import { createScrollLock } from './scrollLock.js';

function fakeEnv({ scrollY = 0, innerWidth = 390, clientWidth = 390 } = {}) {
  const attrs = new Set();
  const scrolls = [];
  const body = { style: { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '' } };
  const root = { clientWidth, style: { scrollBehavior: '' }, setAttribute: (k) => attrs.add(k), removeAttribute: (k) => attrs.delete(k) };
  const win = { scrollY, scrollX: 0, innerWidth, scrollTo: (x, y) => scrolls.push([x, y, root.style.scrollBehavior]) };
  return { win, doc: { body, documentElement: root }, body, root, attrs, scrolls };
}

describe('scroll lock', () => {
  it('pins the body at the current offset and restores the scroll position', () => {
    const e = fakeEnv({ scrollY: 640 });
    const lock = createScrollLock(e);
    const release = lock.lock();
    expect(e.body.style.position).toBe('fixed');
    expect(e.body.style.top).toBe('-640px');
    expect(e.body.style.overflow).toBe('hidden');
    expect(e.attrs.has('data-scroll-locked')).toBe(true);
    release();
    expect(e.body.style.position).toBe('');
    expect(e.body.style.top).toBe('');
    expect(e.attrs.has('data-scroll-locked')).toBe(false);
    // restored instantly (smooth scrolling is switched off for the jump) and smooth scrolling comes back
    expect(e.scrolls).toEqual([[0, 640, 'auto']]);
    expect(e.root.style.scrollBehavior).toBe('');
  });

  it('is reference counted: stacked overlays release the page only when the last one closes', () => {
    const e = fakeEnv({ scrollY: 10 });
    const lock = createScrollLock(e);
    const a = lock.lock();
    const b = lock.lock();
    expect(lock.count()).toBe(2);
    a();
    expect(e.body.style.position).toBe('fixed');
    expect(e.scrolls).toHaveLength(0);
    b();
    expect(e.body.style.position).toBe('');
    expect(e.scrolls).toHaveLength(1);
  });

  it('release functions are idempotent', () => {
    const e = fakeEnv();
    const lock = createScrollLock(e);
    const a = lock.lock();
    const b = lock.lock();
    a();
    a();
    expect(lock.count()).toBe(1);
    b();
    expect(lock.count()).toBe(0);
  });

  it('keeps the width of a vanishing desktop scrollbar so the layout does not shift', () => {
    const e = fakeEnv({ innerWidth: 1280, clientWidth: 1265 });
    const release = createScrollLock(e).lock();
    expect(e.body.style.paddingRight).toBe('15px');
    release();
    expect(e.body.style.paddingRight).toBe('');
  });

  it('is a no-op without a DOM', () => {
    const lock = createScrollLock({});
    expect(lock.lock()()).toBeUndefined();
    expect(lock.count()).toBe(0);
  });
});
