// React glue for hud/layoutLogic.js: the live HUD layout (shared viewport class + touch mode) and the writer of the `.aw` root attributes.
import { useLayoutEffect, useMemo } from 'react';
import { useViewport } from '@/lib/mobile.js';
import { hudLayout, rootAttrs } from './layoutLogic.js';
import { useTouchMode } from './touchMode.js';

/** The current HUD layout ({ kind, compact, phone, tablet, land, port, touch }); re-renders only when the layout actually changes. */
export function useHudLayout() {
  const vp = useViewport();
  const touch = useTouchMode();
  return useMemo(
    () => hudLayout(vp, touch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vp.w, vp.h, vp.class, vp.coarse, touch],
  );
}

/**
 * Write the layout attributes on the nearest `.aw` ancestor of `ref` (a layout effect, so the first paint already has them) and clear
 * them on unmount. `extra` = { trip, alerts, fare, sheet }.
 */
export function useRootAttrs(ref, layout, extra) {
  const key = JSON.stringify(rootAttrs(layout, extra));
  useLayoutEffect(() => {
    const root = ref.current && ref.current.closest ? ref.current.closest('.aw') : null;
    if (!root) return undefined;
    const attrs = JSON.parse(key);
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
    return () => {
      for (const k of Object.keys(attrs)) root.removeAttribute(k);
    };
  }, [ref, key]);
}
