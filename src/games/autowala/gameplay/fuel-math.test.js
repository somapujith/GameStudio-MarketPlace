import { describe, expect, it } from 'vitest';
import { FUEL, fuelCost, fuelLevel, litresAffordable, refuelStep, rescueOffer } from './fuel-math.js';

const fill = (state, dt = 1 / 30) => {
  let s = { ...state };
  let paid = 0;
  let litres = 0;
  let stop = null;
  for (let i = 0; i < 5000 && !stop; i++) {
    const r = refuelStep(s, dt);
    paid += r.pay;
    litres += r.litres;
    s = { ...s, fuel: r.fuel, wallet: s.wallet - r.pay, pending: r.pending };
    stop = r.stop;
  }
  return { s, paid, litres, stop };
};

describe('refuel maths', () => {
  it('prices litres at Rs 22', () => {
    expect(FUEL.price).toBe(22);
    expect(fuelCost(5)).toBe(110);
    expect(fuelCost(0.5)).toBe(11);
    expect(litresAffordable(110)).toBe(5);
  });

  it('fills at 2.5 L/s up to the tank and stops when full', () => {
    const one = refuelStep({ fuel: 2, tank: 12, wallet: 1000, pending: 0 }, 1);
    expect(one.litres).toBeCloseTo(2.5, 6);
    expect(one.fuel).toBeCloseTo(4.5, 6);
    const r = fill({ fuel: 2, tank: 12, wallet: 1000, pending: 0 });
    expect(r.stop).toBe('full');
    expect(r.s.fuel).toBeCloseTo(12, 5);
    expect(r.litres).toBeCloseTo(10, 4);
    expect(r.paid).toBeGreaterThanOrEqual(219);
    expect(r.paid).toBeLessThanOrEqual(220);
  });

  it('never charges more than the wallet and stops "broke" with the litres it could buy', () => {
    const r = fill({ fuel: 1, tank: 12, wallet: 55, pending: 0 });
    expect(r.stop).toBe('broke');
    expect(r.paid).toBeLessThanOrEqual(55);
    expect(r.paid).toBeGreaterThanOrEqual(54);
    expect(r.litres).toBeCloseTo(55 / 22, 1);
    expect(r.s.wallet).toBeGreaterThanOrEqual(0);
  });

  it('with an empty wallet, nothing is delivered', () => {
    const r = refuelStep({ fuel: 1, tank: 12, wallet: 0, pending: 0 }, 1);
    expect(r.stop).toBe('broke');
    expect(r.pay).toBe(0);
    expect(r.fuel).toBeCloseTo(1, 2);
  });

  it('does nothing with a full tank', () => {
    const r = refuelStep({ fuel: 12, tank: 12, wallet: 500, pending: 0 }, 1);
    expect(r.litres).toBe(0);
    expect(r.stop).toBe('full');
  });

  it('works with an upgraded, larger tank', () => {
    const r = fill({ fuel: 0, tank: 15, wallet: 1000, pending: 0 });
    expect(r.s.fuel).toBeCloseTo(15, 5);
    expect(r.paid).toBeLessThanOrEqual(330);
  });
});

describe('low-fuel levels', () => {
  it('warns at 15% and 5% and flags empty', () => {
    expect(fuelLevel(0.5, 6)).toBe(0);
    expect(fuelLevel(0.15, 1.8)).toBe(1);
    expect(fuelLevel(0.05, 0.6)).toBe(2);
    expect(fuelLevel(0, 0)).toBe(3);
  });
});

describe('Mama\'s rescue', () => {
  it('sells a can for Rs 150 when affordable, else one free litre once per cooldown', () => {
    expect(rescueOffer(500, 100, -1e9)).toEqual({ kind: 'can', cost: 150, litres: 3 });
    expect(rescueOffer(149, 100, -1e9)).toEqual({ kind: 'credit', cost: 0, litres: 1 });
    expect(rescueOffer(149, 150, 100).kind).toBe('none');
    expect(rescueOffer(149, 100 + FUEL.creditCooldown, 100).kind).toBe('credit');
  });
});
