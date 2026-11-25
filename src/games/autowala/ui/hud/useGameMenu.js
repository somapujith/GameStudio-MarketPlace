// Small hooks that listen to the game's event bus. Every subscription is removed on unmount.
import { useEffect, useRef, useState } from 'react';

/** The name of the open menu (or null), updated from `menu` events: for components that are not handed `snap`. */
export function useGameMenu(game) {
  const [menu, setMenu] = useState(() => game?.state?.menu ?? null);
  useEffect(() => {
    if (!game) return undefined;
    setMenu(game.state?.menu ?? null);
    return game.on((e) => {
      if (e.type === 'menu') setMenu(e.name ?? null);
    });
  }, [game]);
  return menu;
}

/** Calls `fn(event)` for every event of one of `types` (fn may change between renders). */
export function useGameEvent(game, types, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = Array.isArray(types) ? types.join('|') : String(types);
  useEffect(() => {
    if (!game) return undefined;
    const list = key.split('|');
    return game.on((e) => {
      if (list.includes(e.type)) ref.current(e);
    });
  }, [game, key]);
}

/** True when the OS asks for less motion (re-read when the setting changes). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}
