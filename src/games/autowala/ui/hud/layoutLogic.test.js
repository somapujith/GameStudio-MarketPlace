import { describe, expect, it } from 'vitest';
import { viewportInfo } from '@/lib/mobile.js';
import {
  alertCap, COLLAPSIBLE, CONTROL_FALLBACK, DESKTOP_TOASTS, alertList, collapsedPanels, controlFallback, filterRules, hudLayout, isCollapsed, moreBadge,
  rectOverlap, rootAttrs, sheetSections, toastCap, tripSlot,
} from './layoutLogic.js';
import { rageView, rulesView } from './hudLogic.js';

// a fake window for the shared viewport helper: width, height and whether the primary pointer is a finger
const win = (w, h, coarse) => ({
  innerWidth: w,
  innerHeight: h,
  matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? coarse : q === '(pointer: fine)' ? !coarse : false }),
  navigator: { maxTouchPoints: coarse ? 5 : 0 },
});
const layoutOf = (w, h, coarse = true) => hudLayout(viewportInfo(win(w, h, coarse)), coarse);

describe('hudLayout: which HUD each screen gets', () => {
  it('landscape phones', () => {
    for (const [w, h] of [[844, 390], [800, 400], [915, 412], [667, 375]]) {
      const l = layoutOf(w, h);
      expect(l.kind, `${w}x${h}`).toBe('phone-land');
      expect(l.compact).toBe(true);
      expect(l.land).toBe(true);
    }
  });
  it('portrait phones', () => {
    for (const [w, h] of [[390, 844], [360, 640], [412, 915]]) {
      const l = layoutOf(w, h);
      expect(l.kind, `${w}x${h}`).toBe('phone-port');
      expect(l.port).toBe(true);
    }
  });
  it('tablets (a touch screen with a short side under 900)', () => {
    expect(layoutOf(768, 1024).kind).toBe('tablet-port');
    expect(layoutOf(1024, 768).kind).toBe('tablet-land');
  });
  it('desktop keeps the original HUD: a mouse machine, or any screen from 900 px up', () => {
    expect(layoutOf(1280, 800, false).kind).toBe('desktop');
    expect(layoutOf(1280, 800, false).compact).toBe(false);
    expect(layoutOf(1366, 768, false).kind).toBe('desktop');
    expect(layoutOf(1280, 900, false).kind).toBe('desktop');
  });
  it('a touch screen of any size gets the compact HUD (an iPad Pro is desktop by size, but its controls need the layout)', () => {
    expect(layoutOf(1366, 1024, true).kind).toBe('tablet-land');
    expect(layoutOf(1280, 900, true).kind).toBe('tablet-land');
    expect(layoutOf(1366, 1024, true).compact).toBe(true);
  });
  it('survives a missing viewport', () => {
    expect(hudLayout(null).kind).toBe('desktop');
    expect(hudLayout(undefined, false).compact).toBe(false);
    expect(hudLayout(undefined, true).compact).toBe(true); // a touch screen of unknown size still gets the compact HUD
  });
});

describe('collapsedPanels: what folds into the More sheet', () => {
  it('everything secondary on phones and tablets: rules, job, quest, weather, radio, rating', () => {
    for (const [w, h] of [[844, 390], [390, 844], [768, 1024], [360, 640]]) {
      const l = layoutOf(w, h);
      expect(collapsedPanels(l).sort()).toEqual([...COLLAPSIBLE].sort());
      for (const p of ['rules', 'job', 'quest', 'weather', 'radio', 'rating']) expect(isCollapsed(l, p)).toBe(true);
    }
  });
  it('nothing on desktop', () => {
    const l = layoutOf(1280, 800, false);
    expect(collapsedPanels(l)).toEqual([]);
    expect(isCollapsed(l, 'job')).toBe(false);
  });
});

describe('controlFallback: the wheel / pedal areas when the controls do not publish theirs', () => {
  it('landscape phones reserve 30vw / 32vw / 38dvh', () => {
    expect(controlFallback(layoutOf(844, 390))).toEqual({ left: '30vw', right: '32vw', h: '38dvh' });
    expect(controlFallback(layoutOf(844, 390))).toBe(CONTROL_FALLBACK.land);
  });
  it('portrait keeps the same widths with a shorter area', () => {
    const f = controlFallback(layoutOf(390, 844));
    expect(f.left).toBe('30vw');
    expect(f.right).toBe('32vw');
    expect(f.h).toBe('30dvh');
  });
  it('desktop, and compact layouts without a touch screen, reserve nothing', () => {
    expect(controlFallback(layoutOf(1280, 800, false))).toEqual({ left: '0px', right: '0px', h: '0px' });
    const narrowDesktop = hudLayout(viewportInfo(win(560, 800, false)), false); // a narrow mouse window is 'phone' class but has no controls
    expect(narrowDesktop.compact).toBe(true);
    expect(controlFallback(narrowDesktop).h).toBe('0px');
  });
});

describe('toastCap: how many toasts may stack', () => {
  it('4 on desktop (unchanged), 2 on a sideways phone, 3 on tablets and portrait phones, 1 on a short portrait phone', () => {
    expect(toastCap(layoutOf(1280, 800, false))).toBe(DESKTOP_TOASTS);
    expect(DESKTOP_TOASTS).toBe(4);
    expect(toastCap(layoutOf(844, 390))).toBe(2);
    expect(toastCap(layoutOf(1024, 768))).toBe(3);
    expect(toastCap(layoutOf(390, 844))).toBe(3);
    expect(toastCap(layoutOf(768, 1024))).toBe(3);
    expect(toastCap(layoutOf(360, 640))).toBe(1);
  });
});

describe('alertList: which live alerts get a chip', () => {
  const rules = (o = {}) => rulesView({ limit: 40, zone: 'city', signalAhead: null, cameraAhead: null, checkpoint: null, ...o }, 20);
  it('nothing to show', () => {
    expect(alertList(rules(), null, '')).toEqual([]);
    expect(alertList(null, null, '')).toEqual([]);
  });
  it('urgent chips come first and the list is capped', () => {
    const v = rules({ signalAhead: { state: 'green', dist: 100, left: 5 }, checkpoint: { phase: 'stopped', dist: 0 }, cameraAhead: { dist: 90, limit: 40 } });
    const rage = rageView({ active: true, heat: 0.5, escape: 0.1, caughtIn: 0.7, chasers: 2 });
    const list = alertList(v, rage, 'Biryani run', 3);
    expect(list).toHaveLength(3);
    expect(list[0].kind).toBe('checkpoint');
    expect(list.map((a) => a.kind)).toContain('rage');
    expect(alertList(v, rage, 'Biryani run', 2)).toHaveLength(2);
    expect(alertList(v, rage, 'Biryani run', 0)).toEqual([]);
  });
  it('a red signal outranks a green one; the mission chip is last', () => {
    const red = alertList(rules({ signalAhead: { state: 'red', dist: 40, left: 9 } }), null, 'Mission');
    expect(red.map((a) => a.kind)).toEqual(['signal', 'mission']);
    expect(red[0].urgent).toBe(true);
  });
  it('a camera only urgent while you are over its limit', () => {
    const over = rulesView({ limit: 40, cameraAhead: { dist: 80, limit: 40 } }, 70);
    expect(alertList(over, null, '')[0]).toEqual({ kind: 'camera', urgent: true });
    expect(alertList(rules({ cameraAhead: { dist: 80, limit: 40 } }), null, '')[0]).toEqual({ kind: 'camera', urgent: false });
  });
});

describe('alertCap', () => {
  it('2 in landscape, 2 in portrait, 1 on a short portrait phone, 0 on desktop', () => {
    expect(alertCap(layoutOf(844, 390))).toBe(2);
    expect(alertCap(layoutOf(390, 844))).toBe(2);
    expect(alertCap(layoutOf(360, 640))).toBe(1);
    expect(alertCap(layoutOf(1280, 800, false))).toBe(0);
  });
});

describe('filterRules keeps exactly the chosen alert kinds', () => {
  const v = rulesView({ limit: 40, signalAhead: { state: 'red', dist: 50, left: 4 }, cameraAhead: { dist: 90, limit: 40 }, checkpoint: { phase: 'near', dist: 30 } }, 20);
  it('subsets', () => {
    const f = filterRules(v, ['signal']);
    expect(f.signal).toBeTruthy();
    expect(f.camera).toBeNull();
    expect(f.checkpoint).toBeNull();
    expect(f.sign).toBeNull();
  });
  it('null when nothing is left, or without a view', () => {
    expect(filterRules(v, ['rage', 'mission'])).toBeNull();
    expect(filterRules(null, ['signal'])).toBeNull();
    expect(filterRules(v, null)).toBeNull();
  });
});

describe('moreBadge and sheetSections', () => {
  it('urgent when the chai matters or the quest is about to end', () => {
    expect(moreBadge({ career: { chai: { urgent: true }, damage: { show: false }, rent: { due: 0, debt: 0 } } })).toBe('urgent');
    expect(moreBadge({ career: { chai: { urgent: false }, damage: { show: true, tone: 'bad' }, rent: { due: 0, debt: 0 } } })).toBe('urgent');
    expect(moreBadge({ quest: { active: { timeLeft: 12 } } })).toBe('urgent');
  });
  it('info for a running mission, nothing otherwise', () => {
    expect(moreBadge({ quest: { active: { timeLeft: 90 } } })).toBe('info');
    expect(moreBadge({ quest: { active: { timeLeft: null } } })).toBe('info');
    expect(moreBadge({})).toBeNull();
    expect(moreBadge({ career: { chai: { urgent: false }, damage: { show: false }, rent: { due: 0, debt: 0 } } })).toBeNull();
  });
  it('the sheet lists only the sections that have content, in a fixed order', () => {
    expect(sheetSections({})).toEqual(['rating']);
    expect(sheetSections({ career: true, quest: true, weather: true, rules: true, radio: true })).toEqual(['rating', 'job', 'quest', 'weather', 'rules', 'radio']);
    expect(sheetSections({ radio: true, career: true })).toEqual(['rating', 'job', 'radio']);
  });
});

describe('rootAttrs: the data-attributes the stylesheets key on', () => {
  it('describes a landscape phone with a trip, two alerts and the sheet open', () => {
    const a = rootAttrs(layoutOf(844, 390), { trip: tripSlot(true), alerts: 2, fare: false, sheet: true });
    expect(a).toEqual({
      'data-aw-layout': 'phone-land', 'data-aw-compact': '1', 'data-aw-touch': '1', 'data-aw-trip': 'trip', 'data-aw-alerts': '2', 'data-aw-fare': '0', 'data-aw-sheet': '1',
    });
  });
  it('desktop is not compact and has no touch controls', () => {
    const a = rootAttrs(layoutOf(1280, 800, false));
    expect(a['data-aw-layout']).toBe('desktop');
    expect(a['data-aw-compact']).toBe('0');
    expect(a['data-aw-touch']).toBe('0');
    expect(a['data-aw-alerts']).toBe('0');
  });
  it('a fare question is flagged so the prompt can step aside', () => {
    expect(rootAttrs(layoutOf(390, 844), { fare: true })['data-aw-fare']).toBe('1');
  });
  it('tripSlot', () => {
    expect(tripSlot(true)).toBe('trip');
    expect(tripSlot(false)).toBe('find');
    expect(tripSlot(false, false)).toBe('');
  });
});

describe('rectOverlap', () => {
  it('touching edges do not overlap, crossing ones do', () => {
    expect(rectOverlap({ x: 0, y: 0, r: 10, b: 10 }, { x: 10, y: 0, r: 20, b: 10 })).toBe(false);
    expect(rectOverlap({ x: 0, y: 0, r: 10, b: 10 }, { x: 9, y: 9, r: 20, b: 20 })).toBe(true);
  });
});
