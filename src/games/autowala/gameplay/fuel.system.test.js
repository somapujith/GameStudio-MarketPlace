// installFuel driven by a fake game: a tap on E at a pump, billing, and Mama's rescue (the soft-lock when broke at a pump).
import { describe, expect, it } from 'vitest';
import { installFuel } from './fuel.js';
import { FUEL } from './fuel-math.js';

const PUMP = { x: 100, z: 50 };

function rig({ wallet = 500, fuel = 6, x = PUMP.x, z = PUMP.z, speed = 0 } = {}) {
  const systems = [];
  const prompts = new Map();
  const events = [];
  const toasts = [];
  const taps = new Set();
  let w = wallet;
  const ctx = {
    v: { fuel, x, z, speed },
    state: { menu: null, upgrades: {} },
    vehicle: { params: () => ({ tank: 12 }) },
    world: { city: { poiById: { cng_old: { id: 'cng_old', name: 'Old CNG', front: { ...PUMP } } } } },
    input: { pressed: (k) => (taps.delete(k) ? true : false) },
    economy: {
      get wallet() { return w; },
      spend(n) { if (n > w) return false; w -= n; return true; },
    },
    emit: (type, d = {}) => events.push({ type, ...d }),
    toast: (t) => toasts.push(t),
    setPrompt: (id, text) => (text ? prompts.set(id, text) : prompts.delete(id)),
    addSystem: (s) => systems.push(s),
    addSnapshot: () => {},
  };
  installFuel(ctx, { addPainter() {} });
  const step = (dt = 0.1) => systems.forEach((s) => s.update(dt));
  const run = (sec) => { for (let t = 0; t < sec; t += 0.1) step(0.1); };
  const tap = () => taps.add('interact');
  return { ctx, run, step, tap, events, toasts, prompts, wallet: () => w };
}

describe('refuelling at a pump', () => {
  it('a tap on E starts the pump, it bills whole rupees, and it stops when the tank is full', () => {
    const r = rig({ fuel: 8, wallet: 500 });
    r.step(); // arrives: the pump arms itself
    r.tap();
    r.step();
    r.run(3);
    expect(r.ctx.v.fuel).toBeCloseTo(12, 1);
    expect(r.wallet()).toBe(500 - Math.floor(4 * FUEL.price));
    expect(r.events.some((e) => e.type === 'fuel:refuel')).toBe(true);
  });

  it('never charges more than the wallet holds', () => {
    const r = rig({ fuel: 2, wallet: 30 });
    r.step();
    r.tap();
    r.run(4);
    expect(r.wallet()).toBeGreaterThanOrEqual(0);
    expect(r.ctx.v.fuel).toBeLessThan(2 + 30 / FUEL.price + 0.1);
  });

  it('drives off mid-fill: the pump stops', () => {
    const r = rig({ fuel: 2, wallet: 500 });
    r.step();
    r.tap();
    r.run(0.6);
    r.ctx.v.x = 400;
    r.run(0.4);
    expect(r.ctx.v.fuel).toBeLessThan(5);
    expect(r.prompts.has('fuel')).toBe(false);
  });
});

describe('the E tap belongs to whoever needs it', () => {
  it('is left alone when there is no pump and no rescue to make (the workshop door and the job board read it after fuel)', () => {
    const r = rig({ fuel: 8, wallet: 500, x: 900, z: 900 });
    r.tap();
    r.run(0.5);
    expect(r.ctx.input.pressed('interact')).toBe(true); // still there for the next system
  });

  it('is also left alone at a pump with a full tank', () => {
    const r = rig({ fuel: 12, wallet: 500 });
    r.step();
    r.tap();
    r.step();
    expect(r.ctx.input.pressed('interact')).toBe(true);
  });

  it('is left for the rescue when the player is broke at the pump (and the rescue then takes it)', () => {
    const r = rig({ fuel: 0, wallet: 0 });
    r.run(0.5);
    r.tap();
    r.step();
    expect(r.events.some((e) => e.type === 'fuel:rescue')).toBe(true);
  });
});

describe("Mama's rescue", () => {
  it('lends a litre to a broke driver with an empty tank, also when stuck right at a pump', () => {
    for (const where of [{ x: 900, z: 900 }, { x: PUMP.x, z: PUMP.z }]) {
      const r = rig({ fuel: 0, wallet: 0, ...where });
      r.run(0.5); // the rescue offer arms itself
      r.tap();
      r.step();
      expect(r.events.some((e) => e.type === 'fuel:rescue' && e.kind === 'credit'), JSON.stringify(where)).toBe(true);
      expect(r.ctx.v.fuel).toBeGreaterThan(0.5);
    }
  });

  it('brings a paid can when the wallet allows it', () => {
    const r = rig({ fuel: 0, wallet: 400, x: 900, z: 900 });
    r.run(0.5);
    r.tap();
    r.step();
    expect(r.events.find((e) => e.type === 'fuel:rescue')).toMatchObject({ kind: 'can', cost: FUEL.canPrice });
    expect(r.wallet()).toBe(400 - FUEL.canPrice);
  });

  it('a frame with no tap does not rescue', () => {
    const r = rig({ fuel: 0, wallet: 0, x: 900, z: 900 });
    r.run(1);
    expect(r.events.some((e) => e.type === 'fuel:rescue')).toBe(false);
  });
});
