import { describe, expect, it } from 'vitest';
import { TIP_MOUSE_IDLE_MS, TIP_TOUCH_MS, tipLifetime } from './tipModel.js';

describe('tile card lifetime', () => {
  it('touch, pen and keyboard cards go away after about four seconds', () => {
    for (const source of ['touch', 'pen', 'kbd', undefined]) expect(tipLifetime(source)).toBe(TIP_TOUCH_MS);
    expect(TIP_TOUCH_MS).toBeGreaterThanOrEqual(3000);
    expect(TIP_TOUCH_MS).toBeLessThanOrEqual(5000);
  });
  it('a resting mouse card also expires, but later', () => {
    expect(tipLifetime('mouse')).toBe(TIP_MOUSE_IDLE_MS);
    expect(TIP_MOUSE_IDLE_MS).toBeGreaterThan(TIP_TOUCH_MS);
    expect(Number.isFinite(TIP_MOUSE_IDLE_MS)).toBe(true);
  });
});
