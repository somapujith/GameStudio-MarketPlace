import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { buildPerson } from './autoModel.js';
import { seatPassengers, clearPassengers } from '../gameplay/customers.js';

// A merged person (the cheap one the auto uses) has no separate torso/head meshes, so passengers are recoloured through the
// materials the rig exposes. This broke boarding once: the fares code reached for userData.torso and the game loop threw.
describe('passenger rigs can be recoloured', () => {
  it('every person exposes its recolourable materials, merged or not', () => {
    for (const merged of [true, false]) {
      const p = buildPerson({ pose: 'sit', merged });
      expect(p.userData.mats?.shirt?.color).toBeInstanceOf(Color);
      expect(p.userData.mats?.skin?.color).toBeInstanceOf(Color);
    }
  });

  it('seatPassengers shows the right number of seats and recolours them without throwing', () => {
    const pax = [0, 1].map(() => buildPerson({ pose: 'sit', merged: true }));
    pax.forEach((p) => { p.visible = false; });
    const auto = { userData: { pax } };
    const customer = { pax: 2, look: { shirt: '#123456', skin: '#654321' }, look2: { shirt: '#abcdef' } };
    expect(() => seatPassengers(auto, customer)).not.toThrow();
    expect(pax.map((p) => p.visible)).toEqual([true, true]);
    expect(pax[0].userData.mats.shirt.color.getHexString()).toBe('123456');
    expect(pax[1].userData.mats.shirt.color.getHexString()).toBe('abcdef');
    seatPassengers(auto, { ...customer, pax: 1 });
    expect(pax.map((p) => p.visible)).toEqual([true, false]);
    clearPassengers(auto);
    expect(pax.every((p) => !p.visible)).toBe(true);
  });
});
