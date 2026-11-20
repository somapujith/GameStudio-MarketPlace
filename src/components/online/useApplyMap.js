// Which map the screen shows. shared/maps.js `applyMap` rewrites the display names of the shared TILES / GROUPS in place
// (client only), so the screen that shows a table must apply ITS map before it renders, switch when the host switches,
// and give the names back (the default map) when it goes away, so the hub and the store never show another map's names.
//
//   const { id, ready } = useApplyMap(room.settings);   // or session.view.cfg, a map id ...
//   {ready && <GameView key={id} .../>}                  // the board remounts when the active map changes
//
// Several screens can be mounted for a moment while the router swaps pages (lobby -> game): each claims the map when it
// renders and only the LAST claimant restores the default when it unmounts, so the old page never undoes the new one.
import { useLayoutEffect, useReducer, useRef } from 'react';
import { DEFAULT_MAP, activeMapId, applyMap, mapIdOf } from '@shared/maps.js';

/**
 * A claim register over \`apply\` (applyMap): `claim(token, x)` applies the map of `x` and remembers who asked,
 * `release(token)` applies `fallback` only when `token` is still the latest claimant. Pure apart from `apply`; unit-tested.
 */
export function createMapOwner({ apply = applyMap, fallback = DEFAULT_MAP } = {}) {
  let owner = null;
  return {
    claim(token, x) {
      owner = token;
      return apply(x);
    },
    release(token) {
      if (owner !== token) return null;
      owner = null;
      return apply(fallback);
    },
    get owner() {
      return owner;
    },
  };
}

const shared = createMapOwner();

/** The map id a room / cfg / settings / id stands for (default map when it has none). */
export const mapIdFor = (x) => mapIdOf(x);

/**
 * Apply the map of `x` (a map id, a room's settings or a game cfg) while this component is mounted.
 * Returns `{ id, ready }`: the map id wanted, and whether it is the map applied right now. The map is applied in a layout
 * effect (before the browser paints; never during render, which would notify other components mid-render), so the
 * first render of a screen that shows the board must wait for `ready`:
 *
 *   const { id, ready } = useApplyMap(room.settings);
 *   return ready ? <GameView key={id} .../> : null;   // `key`: the board remounts when the map changes
 *
 * The key is the map id, not applyMap's counter, so it only changes when the map does.
 */
export function useApplyMap(x) {
  const id = mapIdOf(x);
  const token = useRef(null);
  if (token.current === null) token.current = Symbol('map');
  const [, tick] = useReducer((n) => n + 1, 0);
  // (re)claim when the map changes, and after StrictMode's simulated unmount; render again once the names are in
  useLayoutEffect(() => {
    shared.claim(token.current, id);
    tick();
  }, [id]);
  // only the last claimant gives the names back, and only when it goes away
  useLayoutEffect(() => {
    const t = token.current;
    return () => {
      shared.release(t);
    };
  }, []);
  return { id, ready: activeMapId() === id };
}
