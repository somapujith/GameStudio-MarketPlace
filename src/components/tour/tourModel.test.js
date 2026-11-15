import { describe, expect, it } from 'vitest';
import {
  applyLayout, nextIndex, padRect, placeCard, prevIndex, progressOf, resolveStep, sameRect, spotlightPath, visibleSteps,
} from './tourModel.js';

// a fake DOM: targets are plain objects, "present" means the resolver knows them
const dom = (present) => ({ resolve: (t) => (typeof t === 'string' && present.includes(t) ? { id: t } : null), renderable: () => true });
const STEPS = [
  { id: 'welcome', title: 'Hi', body: 'x' },
  { id: 'roll', target: '#roll', title: 'Roll', body: 'r' },
  { id: 'snatch', target: '#snatch', title: 'Snatch', body: 's' },
  { id: 'pods', target: '#pods', phone: { target: '#phone-pods', body: 'phone body', placement: 'bottom' }, title: 'Players', body: 'p' },
  { id: 'hidden', target: '#roll', when: () => false, title: 'No', body: 'n' },
];

describe('visibleSteps', () => {
  it('skips steps whose target is missing and steps whose when() is false', () => {
    const ids = (o) => visibleSteps(STEPS, o).map((s) => s.id);
    expect(ids({ ...dom(['#roll', '#pods']) })).toEqual(['welcome', 'roll', 'pods']);
    expect(ids({ ...dom(['#roll', '#snatch', '#pods']) })).toEqual(['welcome', 'roll', 'snatch', 'pods']);
    expect(ids({ ...dom([]) })).toEqual(['welcome']);
  });

  it('a step without a target is a centred card', () => {
    const [s] = visibleSteps([STEPS[0]], dom([]));
    expect(s.center).toBe(true);
    expect(s.el).toBe(null);
    expect(s.placement).toBe('center');
  });

  it('uses the phone overrides on phones and the desktop target otherwise', () => {
    const phone = visibleSteps([STEPS[3]], { ...dom(['#phone-pods']), phone: true })[0];
    expect(phone.body).toBe('phone body');
    expect(phone.placement).toBe('bottom');
    expect(phone.el).toEqual({ id: '#phone-pods' });
    expect(visibleSteps([STEPS[3]], { ...dom(['#phone-pods']), phone: false })).toEqual([]);
    expect(applyLayout(STEPS[3], false).body).toBe('p');
  });

  it('a throwing when() hides the step instead of breaking the tour', () => {
    const bad = [{ id: 'a', when: () => { throw new Error('x'); }, title: 't', body: 'b' }];
    expect(visibleSteps(bad, dom([]))).toEqual([]);
  });

  it('a target that is present but not renderable is skipped', () => {
    expect(visibleSteps([STEPS[1]], { resolve: () => ({}), renderable: () => false })).toEqual([]);
  });

  it('tolerates a non-array', () => {
    expect(visibleSteps(null)).toEqual([]);
    expect(resolveStep(null)).toBe(null);
  });
});

describe('next / prev / progress', () => {
  const shown = (s) => s.id !== 'snatch';
  it('moves over skipped steps', () => {
    expect(nextIndex(STEPS, -1)).toBe(0);
    expect(nextIndex(STEPS, 1, shown)).toBe(3);
    expect(nextIndex(STEPS, 4)).toBe(-1);
    expect(prevIndex(STEPS, 3, shown)).toBe(1);
    expect(prevIndex(STEPS, 0)).toBe(-1);
  });
  it('counts only the steps that can be shown', () => {
    expect(progressOf(STEPS, 3, (s) => s.id !== 'snatch' && s.id !== 'hidden')).toEqual({ pos: 2, total: 3 });
    expect(progressOf(STEPS, 0, () => false)).toEqual({ pos: 0, total: 1 });
  });
});

describe('placeCard', () => {
  const vp = { width: 1000, height: 700 };
  const card = { w: 300, h: 200 };

  it('puts the card below a target near the top, centred on it, with an arrow on its top edge', () => {
    const p = placeCard({ x: 400, y: 50, w: 200, h: 60 }, card, vp, 'auto');
    expect(p.placement).toBe('bottom');
    expect(p.top).toBe(50 + 60 + 14);
    expect(p.left).toBe(500 - 150);
    expect(p.arrow).toEqual({ edge: 'top', offset: 150 });
  });

  it('flips to the top when there is no room below', () => {
    const p = placeCard({ x: 400, y: 600, w: 200, h: 60 }, card, vp, 'bottom');
    expect(p.placement).toBe('top');
    expect(p.top).toBe(600 - 14 - 200);
    expect(p.arrow.edge).toBe('bottom');
  });

  it('honours the wanted side when it fits', () => {
    expect(placeCard({ x: 100, y: 300, w: 100, h: 100 }, card, vp, 'right').placement).toBe('right');
    expect(placeCard({ x: 700, y: 300, w: 100, h: 100 }, card, vp, 'left').placement).toBe('left');
    const l = placeCard({ x: 700, y: 300, w: 100, h: 100 }, card, vp, 'left');
    expect(l.left).toBe(700 - 14 - 300);
  });

  it('clamps into the viewport horizontally and keeps the arrow on the target', () => {
    const p = placeCard({ x: 0, y: 100, w: 40, h: 40 }, card, vp, 'bottom');
    expect(p.left).toBe(12);
    expect(p.arrow.offset).toBe(18);
    const q = placeCard({ x: 960, y: 100, w: 40, h: 40 }, card, vp, 'bottom');
    expect(q.left + q.w).toBe(1000 - 12);
  });

  it('centres for center placement or no rect', () => {
    expect(placeCard(null, card, vp)).toMatchObject({ placement: 'center', left: 350, top: 250, arrow: null });
    expect(placeCard({ x: 1, y: 1, w: 1, h: 1 }, card, vp, 'center').placement).toBe('center');
  });

  it('shrinks a card bigger than a 320x568 phone and keeps it inside', () => {
    const phone = { width: 320, height: 568 };
    const p = placeCard({ x: 20, y: 500, w: 280, h: 52 }, { w: 360, h: 700 }, phone, 'auto');
    expect(p.w).toBe(296);
    expect(p.h).toBe(544);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + p.w).toBeLessThanOrEqual(308);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + p.h).toBeLessThanOrEqual(556);
  });

  it('tucks the card inside the screen when the target is huge', () => {
    const p = placeCard({ x: 8, y: 60, w: 304, h: 400 }, { w: 296, h: 220 }, { width: 320, height: 568 }, 'auto');
    expect(p.placement).toBe('inside');
    expect(p.arrow).toBe(null);
    expect(p.top + p.h).toBeLessThanOrEqual(568 - 12);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it('works on a 4K viewport', () => {
    const p = placeCard({ x: 3000, y: 1000, w: 300, h: 120 }, card, { width: 3840, height: 2160 }, 'auto');
    expect(['top', 'bottom', 'left', 'right']).toContain(p.placement);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + p.w).toBeLessThanOrEqual(3840 - 12);
  });

  it('auto picks the roomiest side', () => {
    expect(placeCard({ x: 20, y: 300, w: 60, h: 60 }, card, vp, 'auto').placement).toBe('right');
  });
});

describe('rect helpers', () => {
  it('sameRect / padRect', () => {
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })).toBe(true);
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 5 })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(null, { x: 0, y: 0, w: 0, h: 0 })).toBe(false);
    expect(padRect({ x: 10, y: 10, w: 20, h: 20 }, 8)).toEqual({ x: 2, y: 2, w: 36, h: 36 });
  });
  it('spotlightPath cuts a hole and clips to the screen', () => {
    const vp = { width: 400, height: 300 };
    expect(spotlightPath(null, vp)).toBe('M0 0H400V300H0Z');
    expect(spotlightPath({ x: 50, y: 50, w: 100, h: 80 }, vp)).toContain('M64 50H136');
    expect(spotlightPath({ x: 500, y: 50, w: 10, h: 10 }, vp)).toBe('M0 0H400V300H0Z');
    expect(spotlightPath({ x: -20, y: -20, w: 60, h: 60 }, vp)).toContain('M14 0');
  });
});
