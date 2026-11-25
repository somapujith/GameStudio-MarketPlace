// CNG refuelling maths: price, flow, who pays what. Pure and unit-tested; fuel.js drives it from the game loop.
import { ECON } from '../game/config.js';

export const FUEL = {
  price: ECON.fuelPrice, // rupees per litre (22)
  rate: 2.5, // litres per second at the pump
  stationRange: 12, // metres from the pump's road point
  stationSpeed: 2, // m/s: slower than this to refuel
  lowWarn: 0.15, // toast at 15% and 5% of the tank
  critWarn: 0.05,
  empty: 0.02, // litres: below this the engine is dead
  canPrice: 150, // Mama's rescue can
  canLitres: 3,
  creditLitres: 1, // the free litre when the player is broke
  creditCooldown: 120, // seconds before another free litre
};

/** Rupees for a number of litres. */
export const fuelCost = (litres, price = FUEL.price) => Math.round(litres * price);

/** How many litres a wallet can buy (whole-rupee billing never charges for litres that were not delivered). */
export const litresAffordable = (wallet, price = FUEL.price) => Math.max(0, wallet) / price;

/**
 * One tick of pumping. state = { fuel, tank, wallet, pending } (pending = rupees owed from earlier ticks, 0..1).
 * Returns { fuel, litres, pay (whole rupees to take now), pending, stop: null | 'full' | 'broke' }.
 * Total charged over a whole fill = litres * price rounded down, never more than the wallet held.
 */
export function refuelStep(state, dt, price = FUEL.price, rate = FUEL.rate) {
  const room = Math.max(0, state.tank - state.fuel);
  let litres = Math.min(rate * dt, room);
  let stop = null;
  // the most we can pay is the wallet plus the fraction of a rupee we already owe (so the last litres are not wasted)
  const maxLitres = (state.wallet + (state.wallet > 0 ? 0.999 : 0) - state.pending) / price;
  if (litres > maxLitres) {
    litres = Math.max(0, maxLitres);
    stop = 'broke';
  }
  const owed = state.pending + litres * price;
  const pay = Math.floor(owed + 1e-9);
  const fuel = Math.min(state.tank, state.fuel + litres);
  if (!stop && fuel >= state.tank - 1e-6) stop = 'full';
  return { fuel, litres, pay, pending: owed - pay, stop };
}

/** The low-fuel toast level for a fuel fraction: 0 (fine), 1 (15%), 2 (5%), 3 (empty). */
export function fuelLevel(frac, litres) {
  if (litres <= FUEL.empty) return 3;
  if (frac <= FUEL.critWarn) return 2;
  if (frac <= FUEL.lowWarn) return 1;
  return 0;
}

/** What Mama's rescue does: a paid can if the wallet allows it, else one free litre (once per cooldown). */
export function rescueOffer(wallet, now, lastCredit) {
  if (wallet >= FUEL.canPrice) return { kind: 'can', cost: FUEL.canPrice, litres: FUEL.canLitres };
  if (now - lastCredit >= FUEL.creditCooldown) return { kind: 'credit', cost: 0, litres: FUEL.creditLitres };
  return { kind: 'none', cost: 0, litres: 0 };
}
