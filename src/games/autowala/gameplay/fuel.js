// CNG refuelling: the four pumps (poi.front is a point ON the road, so the auto can always reach it), the low-fuel warnings, and
// Mama's rescue when the tank runs dry. Maths is in fuel-math.js (unit-tested).
//   Events: fuel:refuel { litres, cost }, fuel:low { level: 1|2 }, fuel:empty {}, fuel:rescue { kind: 'can'|'credit', litres, cost }
//   Snapshot: fuelState: 'ok' | 'low' | 'critical' | 'empty', refuelling: boolean
import { clamp } from '../game/rng.js';
import { FUEL, fuelCost, fuelLevel, refuelStep, rescueOffer } from './fuel-math.js';

const STATIONS = ['cng_old', 'cng_north', 'cng_west', 'cng_south'];
const TICK = 0.2; // the pump bills in 0.2 s strokes (a smooth gauge without a wallet event every frame)

export function installFuel(ctx, kit) {
  const { v } = ctx;
  const pumps = STATIONS.map((id) => ctx.world.city.poiById[id]).filter((p) => p?.front).map((p) => ({ id: p.id, name: p.name, x: p.front.x, z: p.front.z }));
  let filling = false;
  let acc = 0;
  let pending = 0;
  let paid = 0;
  let added = 0;
  let warned = 0;
  let lastCredit = -1e9;
  let eligible = false;
  let rescueEligible = false;
  let level = 0;
  let near = null;
  let clockT = 0;

  const tankSize = () => ctx.vehicle.params({ upgrades: ctx.state.upgrades }).tank;

  function setPrompts(atPump, tank) {
    const empty = v.fuel <= FUEL.empty;
    if (filling) {
      ctx.setPrompt('fuel', `Refuelling... ${added.toFixed(1)} L, Rs ${paid}`, 'E');
    } else if (atPump && v.fuel < tank - 0.05) {
      ctx.setPrompt('fuel', ctx.economy.wallet >= 1 ? `Hold E to refuel (Rs ${FUEL.price}/litre)` : 'Not enough money for CNG', 'E');
    } else {
      ctx.setPrompt('fuel', null);
    }
    if (empty && v.speed < 1.5 && !filling) {
      const offer = rescueOffer(ctx.economy.wallet, clockT, lastCredit);
      const text = offer.kind === 'can' ? `Press E: Mama brings a can (Rs ${offer.cost})` : offer.kind === 'credit' ? 'Press E: Mama lends 1 litre' : 'Mama is out of cans, push on!';
      ctx.setPrompt('rescue', text, 'E');
      if (!rescueEligible) {
        rescueEligible = true;
        ctx.input.pressed('interact');
      }
    } else {
      if (rescueEligible) ctx.setPrompt('rescue', null);
      rescueEligible = false;
    }
  }

  function stopFilling(reason) {
    if (!filling) return;
    filling = false;
    acc = 0;
    pending = 0;
    if (added > 0.01) {
      ctx.emit('fuel:refuel', { litres: added, cost: paid });
      ctx.toast(reason === 'broke' ? `Out of money: +${added.toFixed(1)} L for Rs ${paid}` : `Tank ${reason === 'full' ? 'full' : 'topped up'}: +${added.toFixed(1)} L for Rs ${paid}`, { tone: reason === 'broke' ? 'bad' : 'good', ms: 2600 });
    }
  }

  const system = {
    update(dt) {
      if (ctx.state.menu) {
        if (filling) stopFilling('stop');
        return;
      }
      clockT += dt;
      const tank = tankSize();
      const frac = v.fuel / tank;

      // low-fuel warnings: 15%, 5%, empty; they re-arm once the tank is back above 20%
      const lvl = fuelLevel(frac, v.fuel);
      level = lvl;
      if (lvl > warned) {
        warned = lvl;
        if (lvl === 1) {
          ctx.toast('Low CNG: 15% left', { tone: 'gold', ms: 2600 });
          ctx.emit('fuel:low', { level: 1 });
        } else if (lvl === 2) {
          ctx.toast('CNG almost gone: 5% left!', { tone: 'bad', ms: 3000 });
          ctx.emit('fuel:low', { level: 2 });
        } else {
          ctx.toast(`Out of gas! Mama can bring a can for Rs ${FUEL.canPrice}`, { tone: 'bad', ms: 4500 });
          ctx.emit('fuel:empty', {});
        }
      } else if (frac > 0.2) warned = 0;

      // the nearest pump on the road
      near = null;
      let bd = FUEL.stationRange;
      for (const p of pumps) {
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < bd) {
          bd = d;
          near = p;
        }
      }
      const atPump = !!near && v.speed < FUEL.stationSpeed;
      // ONE read of the tap per frame: `pressed` consumes it, so reading it in a condition that then fails (a broke player at the pump)
      // would swallow the press Mama's rescue below needs.
      let tap = ctx.input.pressed('interact');

      if (filling && (!atPump || v.fuel >= tank - 1e-4)) stopFilling(atPump ? 'full' : 'stop');

      if (atPump && !filling && v.fuel < tank - 0.05) {
        if (!eligible) {
          eligible = true;
          tap = false; // a stale tap must not start the pump
        } else if (tap && ctx.economy.wallet >= 1) {
          tap = false;
          filling = true;
          acc = 0;
          pending = 0;
          paid = 0;
          added = 0;
        }
      } else if (!atPump) eligible = false;
      else if (filling && tap) {
        tap = false;
        stopFilling('stop');
      }

      if (filling) {
        acc += dt;
        while (acc >= TICK && filling) {
          acc -= TICK;
          const r = refuelStep({ fuel: v.fuel, tank, wallet: ctx.economy.wallet, pending }, TICK);
          if (r.pay > 0 && !ctx.economy.spend(r.pay, 'fuel')) {
            stopFilling('broke');
            break;
          }
          v.fuel = r.fuel;
          pending = r.pending;
          paid += r.pay;
          added += r.litres;
          if (r.stop) stopFilling(r.stop);
        }
      }

      // Mama's rescue
      if (!filling && v.fuel <= FUEL.empty && v.speed < 1.5 && rescueEligible && tap) {
        const offer = rescueOffer(ctx.economy.wallet, clockT, lastCredit);
        if (offer.kind === 'can' && ctx.economy.spend(offer.cost, 'fuel-can')) {
          v.fuel = Math.min(tank, v.fuel + offer.litres);
          ctx.toast(`Mama brought a can: +${offer.litres} L (Rs ${offer.cost})`, { tone: 'good', ms: 2800 });
          ctx.emit('fuel:rescue', { kind: 'can', litres: offer.litres, cost: offer.cost });
        } else if (offer.kind === 'credit') {
          v.fuel = Math.min(tank, v.fuel + offer.litres);
          lastCredit = clockT;
          ctx.toast('Mama lent you 1 litre. Earn it back!', { tone: 'gold', ms: 2800 });
          ctx.emit('fuel:rescue', { kind: 'credit', litres: offer.litres, cost: 0 });
        } else {
          ctx.toast('Mama has no spare cans right now', { tone: 'bad', ms: 2200 });
        }
      }
      setPrompts(atPump, tank);
    },
    dispose() {
      ctx.setPrompt('fuel', null);
      ctx.setPrompt('rescue', null);
    },
  };
  ctx.addSystem(system);

  ctx.addSnapshot(() => ({ fuelState: level >= 3 ? 'empty' : level === 2 ? 'critical' : level === 1 ? 'low' : 'ok', refuelling: filling }));
  ctx.fuel = { pumps, get refuelling() { return filling; }, cost: fuelCost };

  // pump markers: a green ring on the road in front of each station and a pole of light, visible from afar
  kit.addPainter((k, time) => {
    for (const p of pumps) {
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      const active = near === p;
      const fade = clamp((900 - d) / 500, 0.4, 1);
      const pulse = 0.88 + 0.12 * Math.sin(time * 2.6 + p.x * 0.1);
      const kk = fade * pulse * (active ? 1.25 : 1.0);
      k.ring(p.x, 0.07, p.z, 6.5 * (1 + 0.02 * Math.sin(time * 2.6)), 0.15 * kk, 1.0 * kk, 0.5 * kk);
      k.beam(p.x, 0.07, p.z, 0.45 + d * 0.0016, 22 + d * 0.03, 0.12 * kk, 0.9 * kk, 0.45 * kk);
    }
  });
}

export { fuelCost };
