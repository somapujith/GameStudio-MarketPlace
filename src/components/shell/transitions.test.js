import { afterEach, describe, expect, it, vi } from 'vitest';
import { canViewTransition } from './transitions.js';

/** A minimal browser: the View Transitions API, a visible tab, an <html> element with a dataset. */
function browser({ perf, visibility = 'visible', api = true } = {}) {
  const documentElement = { dataset: perf ? { perf } : {} };
  vi.stubGlobal('document', { documentElement, visibilityState: visibility, ...(api ? { startViewTransition: () => {} } : {}) });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
}

afterEach(() => vi.unstubAllGlobals());

describe('canViewTransition', () => {
  it('runs between hub screens', () => {
    browser();
    expect(canViewTransition('/', '/games')).toBe(true);
  });
  it('is off without the API, in a hidden tab and around game screens', () => {
    browser({ api: false });
    expect(canViewTransition('/', '/games')).toBe(false);
    browser({ visibility: 'hidden' });
    expect(canViewTransition('/', '/games')).toBe(false);
    browser();
    expect(canViewTransition('/', '/play/hyderabad-tycoon/online/ABC234')).toBe(false);
    expect(canViewTransition('/play/hyderabad-tycoon/online/ABC234', '/')).toBe(false);
  });
  it('is off when the slow-render switch is set on <html>', () => {
    browser({ perf: 'low' });
    expect(canViewTransition('/', '/games')).toBe(false);
    browser({ perf: 'high' });
    expect(canViewTransition('/', '/games')).toBe(true);
  });
});
