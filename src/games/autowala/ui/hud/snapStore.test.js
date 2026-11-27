import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SnapStoreProvider, createSnapStore, createViewReader, shallowEqual, useSnapStore, useSnapView } from './snapStore.js';

describe('shallowEqual', () => {
  it('equal when every own key is ===, different otherwise', () => {
    const part = { a: 1 };
    expect(shallowEqual({ x: 1, p: part }, { x: 1, p: part })).toBe(true);
    expect(shallowEqual({ x: 1, p: part }, { x: 1, p: { a: 1 } })).toBe(false); // identity, not structure
    expect(shallowEqual({ x: 1 }, { x: 1, y: undefined })).toBe(false);
    expect(shallowEqual({ x: undefined }, { y: undefined })).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual({}, null)).toBe(false);
    expect(shallowEqual(1, 1)).toBe(true);
  });
});

describe('createSnapStore', () => {
  it('stores the latest snapshot, counts them and tells each subscriber once per set', () => {
    const store = createSnapStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    const off = store.subscribe(b);
    expect(store.get()).toBeNull();
    const s1 = { kmh: 10 };
    store.set(s1);
    expect(store.get()).toBe(s1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    off();
    store.set({ kmh: 11 });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(store.version()).toBe(2);
    expect(store.size).toBe(1);
  });
  it('setting the same snapshot again is a no-op', () => {
    const store = createSnapStore({ k: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set(store.get());
    expect(fn).not.toHaveBeenCalled();
    expect(store.version()).toBe(0);
  });
  it('a subscriber that unsubscribes while being called does not break the round', () => {
    const store = createSnapStore();
    const seen = [];
    const offA = store.subscribe(() => {
      seen.push('a');
      offA();
    });
    store.subscribe(() => seen.push('b'));
    store.set({});
    store.set({});
    expect(seen).toEqual(['a', 'b', 'b']);
  });
});

describe('createViewReader: a view is handed out again while it is equal', () => {
  const pickSpeed = (s) => ({ kmh: s?.kmh ?? 0, menu: s?.menu ?? null });
  it('same snapshot: the same view and no second select', () => {
    const store = createSnapStore({ kmh: 20, menu: null, wallet: 5 });
    const select = vi.fn(pickSpeed);
    const r = createViewReader(store, select);
    const v1 = r.read();
    expect(r.read()).toBe(v1);
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('a new snapshot with the same view keeps the old object (so React does not re-render); a different view replaces it', () => {
    const store = createSnapStore({ kmh: 20, menu: null, wallet: 5 });
    const r = createViewReader(store, pickSpeed);
    const v1 = r.read();
    store.set({ kmh: 20, menu: null, wallet: 6 }); // the wallet is not part of this view
    expect(r.read()).toBe(v1);
    store.set({ kmh: 21, menu: null, wallet: 6 });
    const v2 = r.read();
    expect(v2).not.toBe(v1);
    expect(v2.kmh).toBe(21);
  });
  it('a custom equality decides what counts as a change (Object.is for one value)', () => {
    const store = createSnapStore({ trip: { fare: 10 } });
    const r = createViewReader(store, (s) => s.trip, Object.is);
    const t1 = r.read();
    store.set({ trip: { fare: 10 } }); // a different object: identity says changed
    expect(r.read()).not.toBe(t1);
  });
  it('deep equality by default: a rebuilt but equal nested view is not a change', () => {
    const store = createSnapStore({ a: 1 });
    const r = createViewReader(store, (s) => ({ list: [s.a, { n: 2 }] }));
    const v = r.read();
    store.set({ a: 1, extra: true });
    expect(r.read()).toBe(v);
    store.set({ a: 2 });
    expect(r.read()).not.toBe(v);
  });
  it('before the first snapshot there is no view, and the selector never sees null', () => {
    const store = createSnapStore();
    const select = vi.fn(pickSpeed);
    const r = createViewReader(store, select);
    expect(r.read()).toBeNull();
    expect(select).not.toHaveBeenCalled();
    store.set({ kmh: 3 });
    expect(r.read()).toEqual({ kmh: 3, menu: null });
  });
});

describe('useSnapView (server render: no DOM, no subscriptions needed)', () => {
  const pick = (s) => ({ kmh: s?.kmh ?? -1 });
  function Probe({ store }) {
    const v = useSnapView(store, pick, undefined);
    return createElement('span', null, v ? `kmh=${v.kmh}` : 'none');
  }
  it('renders the view of the current snapshot, and null without a store', () => {
    const store = createSnapStore({ kmh: 42 });
    expect(renderToStaticMarkup(createElement(Probe, { store }))).toContain('kmh=42');
    expect(renderToStaticMarkup(createElement(Probe, { store: null }))).toContain('none');
  });
  it('the provider hands the store to children', () => {
    const store = createSnapStore({ kmh: 7 });
    function Child() {
      const s = useSnapStore();
      return createElement('i', null, s ? String(s.get().kmh) : 'no store');
    }
    expect(renderToStaticMarkup(createElement(SnapStoreProvider, { value: store }, createElement(Child)))).toContain('7');
    expect(renderToStaticMarkup(createElement(Child))).toContain('no store');
  });
});
