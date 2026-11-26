import { describe, expect, it } from 'vitest';
import { BOARD_KEY, NARROW_PX, isSlim, readBoardPref, writeBoardPref } from './boardPref.js';

const mem = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
};
const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

describe('the dish board width choice', () => {
  it('reads only the two known values; anything else is "no choice"', () => {
    expect(readBoardPref(mem())).toBe(null);
    expect(readBoardPref(mem({ [BOARD_KEY]: 'slim' }))).toBe('slim');
    expect(readBoardPref(mem({ [BOARD_KEY]: 'open' }))).toBe('open');
    expect(readBoardPref(mem({ [BOARD_KEY]: 'huge' }))).toBe(null);
    expect(readBoardPref(null)).toBe(null);
  });
  it('writes the choice, and blocked storage never throws', () => {
    const s = mem();
    writeBoardPref('slim', s);
    expect(s.m[BOARD_KEY]).toBe('slim');
    expect(() => writeBoardPref('open', boom)).not.toThrow();
    expect(readBoardPref(boom)).toBe(null);
  });
  it('with no choice a narrow window starts slim and a wide one starts open; a stored choice wins at any width', () => {
    expect(isSlim(null, NARROW_PX - 1)).toBe(true);
    expect(isSlim(null, 640)).toBe(true);
    expect(isSlim(null, 844)).toBe(false);
    expect(isSlim(null, 1920)).toBe(false);
    expect(isSlim(null, 0)).toBe(false); // width unknown (server render, first paint): open
    expect(isSlim('open', 640)).toBe(false);
    expect(isSlim('slim', 1920)).toBe(true);
  });
});
