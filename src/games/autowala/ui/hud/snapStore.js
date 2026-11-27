// The HUD snapshot (published ~10 Hz by game/snapshot.js) as an EXTERNAL store, so the React shell no longer re-renders on every publish.
//
// It used to be `useState` in AutowalaGame: every publish re-rendered the whole overlay tree (the HUD, the minimap, the quest log, the radio, the menus ...),
// each of which diffed `snap` again to find that nothing it shows had changed. Now each piece reads the store through `useSnapView(store, select)`: `select`
// projects the snapshot into the small VIEW the piece shows (a few fields, or a view model from hudLogic), and the piece re-renders only when that view changed.
// Unchanged parts of a snapshot keep their identity (game/snapshot.js `reuse`), so most selectors are a handful of `===` checks.
//
// Pure (no React) except the two hooks at the bottom; the store itself is unit-tested in snapStore.test.js.
import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import { same } from '../../game/snapshot.js';

/** Shallow equality of two plain objects (every own key `===`): the cheap check for a view whose values are primitives or identity-stable parts. */
export function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.hasOwn(b, k) || a[k] !== b[k]) return false;
  return true;
}

/** { get, set, subscribe, version }: `set(next)` stores the snapshot and calls every subscriber once. */
export function createSnapStore(initial = null) {
  let snap = initial;
  let version = 0;
  const subs = new Set();
  return {
    get: () => snap,
    /** How many snapshots were stored (a counter for the perf probes). */
    version: () => version,
    set(next) {
      if (next === snap) return;
      snap = next;
      version++;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get size() {
      return subs.size;
    },
  };
}

/**
 * The memo behind `useSnapView`, without React: `read()` returns the same object while the snapshot is unchanged AND while the new view equals the old one,
 * so a subscriber is only told about a different view. `select` runs once per stored snapshot per subscriber (it must be pure and cheap).
 */
export function createViewReader(store, select, equal = same) {
  let snap;
  let view;
  let has = false;
  return {
    read() {
      const now = store.get();
      if (has && now === snap) return view;
      const next = now == null ? null : select(now); // no snapshot yet: no view (selectors never see null)
      snap = now;
      if (has && equal(view, next)) return view;
      has = true;
      view = next;
      return view;
    },
  };
}

const StoreContext = createContext(null);
export const SnapStoreProvider = StoreContext.Provider;
export const useSnapStore = () => useContext(StoreContext);

/**
 * The view of the snapshot a component shows. `select` should be a module-level function (a new one every render only costs a re-select), `equal` defaults to
 * the deep compare the publisher uses (use `shallowEqual` for a view of primitives and identity-stable parts, `Object.is` for a single value).
 * Without a store (a unit test rendering a component on its own) the view of `null` is returned.
 */
export function useSnapView(store, select, equal = same) {
  const reader = useRef(null);
  if (!reader.current || reader.current.store !== store || reader.current.select !== select || reader.current.equal !== equal) reader.current = { store, select, equal, r: store ? createViewReader(store, select, equal) : null };
  const read = () => (reader.current.r ? reader.current.r.read() : null);
  return useSyncExternalStore(store ? store.subscribe : noSubscribe, read, read);
}
const noSubscribe = () => () => {};

/** useSnapView on the store the nearest SnapStoreProvider holds (null view when there is none). */
export const useView = (select, equal = same) => useSnapView(useSnapStore(), select, equal);
