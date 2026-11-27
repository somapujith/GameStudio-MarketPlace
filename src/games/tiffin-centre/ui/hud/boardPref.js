// The dish chalk board has two widths: two columns (icons, and the dish names on a roomy screen) or SLIM (one column of icons and ready counts), which
// leaves the picture clear on a small phone. The player's choice is remembered on this device; with no choice, a narrow window starts slim.
import { useCallback, useEffect, useState } from 'react';

export const BOARD_KEY = 'jalebi.tiffin.board.v1';
/** A window narrower than this starts with the slim board (a 640 px phone; an 844 px phone has room for two columns). */
export const NARROW_PX = 720;

const store = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

/** 'slim' | 'open' | null (no choice yet). Anything else stored counts as no choice. */
export function readBoardPref(storage = store()) {
  try {
    const v = storage?.getItem(BOARD_KEY);
    return v === 'slim' || v === 'open' ? v : null;
  } catch {
    return null;
  }
}

export function writeBoardPref(value, storage = store()) {
  try {
    storage?.setItem(BOARD_KEY, value);
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
}

/** Is the board slim? `pref` is the stored choice, `width` the window width in px. */
export const isSlim = (pref, width) => (pref ? pref === 'slim' : Number(width) > 0 && Number(width) < NARROW_PX);

/** [slim, toggle()] for the board. Re-reads the window width when there is no stored choice. */
export function useBoardSlim() {
  const [pref, setPref] = useState(() => readBoardPref());
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    if (pref || typeof window === 'undefined') return undefined;
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [pref]);
  const slim = isSlim(pref, width);
  const toggle = useCallback(() => {
    const next = slim ? 'open' : 'slim';
    writeBoardPref(next);
    setPref(next);
  }, [slim]);
  return [slim, toggle];
}
