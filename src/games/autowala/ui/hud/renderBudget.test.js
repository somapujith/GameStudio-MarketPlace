// The point of the snapshot store: a drive of 10 s at 10 snapshots a second, with a trip, a signal ahead, a mission and a clock that moves, and how many times each
// HUD piece would be handed a DIFFERENT view (= re-rendered by React). Before the store every piece rendered on every snapshot (the whole tree, 100 times).
import { describe, expect, it } from 'vitest';
import { createSnapshotPublisher } from '../../game/snapshot.js';
import { alertCountSelector, alertsSelector, selBadge, selCareer, selClock, selDrift, selFx, selGauge, selPrompt, selRules, selShell, selTrip, selWallet, selWaiting, selWeather } from './views.js';
import { createSnapStore, createViewReader } from './snapStore.js';
import { pickFare, pickMenu, pickQuest, pickRadio, pickWorkshop } from './picks.js';
import { same } from '../../game/snapshot.js';
import { shallowEqual } from './snapStore.js';

/** A snapshot `i` tenths of a second into a drive: speeding up to ~50 km/h, a trip with a ticking meter, a signal coming up, a mission with a clock. */
function snapshotAt(i) {
  const t = i / 10;
  const kmh = Math.round(Math.min(50, t * 12) + (t > 5 ? 3 * Math.sin(t * 2) : 0));
  const metres = (t * kmh) / 3.6;
  return {
    kmh, fuel: Math.round((0.8 - t * 0.0004) * 500) / 500, fuelLitres: Math.round((12 - t * 0.01) * 20) / 20, hour: Math.floor((17.4 + t / 240) * 60) / 60, day: 1,
    drifting: false, boosting: false, driftCharge: 0, airborne: false, menu: null, wallet: 600, rating: 4.4, rides: 3, prompt: null,
    trip: { name: 'Salma Aapa', kind: 'foodie', pax: 1, status: 'riding', fareNow: 120 + Math.floor(metres / 20), distanceLeft: 2300 - metres, timeLeft: 90 - t, mood: 0.9 - t * 0.002, dest: { name: 'Charminar', te: 'ÃƒÂ Ã‚Â°Ã…Â¡ÃƒÂ Ã‚Â°Ã‚Â¾ÃƒÂ Ã‚Â°Ã‚Â°ÃƒÂ Ã‚Â±Ã‚ÂÃƒÂ Ã‚Â°Ã‚Â®ÃƒÂ Ã‚Â°Ã‚Â¿ÃƒÂ Ã‚Â°Ã‚Â¨ÃƒÂ Ã‚Â°Ã‚Â¾ÃƒÂ Ã‚Â°Ã‚Â°ÃƒÂ Ã‚Â±Ã‚Â' } },
    route: { length: 2300 - metres, eta: (2300 - metres) / 8, nextTurn: 'left', turnDistance: Math.max(0, 140 - metres) },
    rules: { limit: 40, zone: 'city', speeding: kmh > 45, heat: 0, wanted: false, fines: 0, signalAhead: { state: 'red', dist: Math.max(1, 220 - metres), left: Math.max(0, 14 - t), watched: false }, cameraAhead: null, checkpoint: null },
    rage: { active: false }, quest: { active: { title: 'Biryani run', timeLeft: 120 - t, steps: [{ label: 'Pick up' }], stepIndex: 0, reward: { cash: 300 } } },
    career: { damage: 0.1, repairCost: 80, fatigue: 0.3, fatigueName: { en: 'Fresh', te: 'ÃƒÂ Ã‚Â°Ã‚Â¤ÃƒÂ Ã‚Â°Ã‚Â¾ÃƒÂ Ã‚Â°Ã…â€œÃƒÂ Ã‚Â°Ã‚Â¾' }, chai: { price: 15, cooldown: 0, canBuy: true }, demand: { mult: 1.2, label: 'Rush', peak: true }, today: { earned: 200 }, rent: { due: 400, owned: false, debt: 0 } },
    weather: { state: 'clear', rain: 0, wet: 0 }, radio: null, waitingCount: 12, fareChoice: null, workshopPhase: 'closed',
  };
}

describe('how often each piece of the HUD is re-rendered during a 10 s drive (100 snapshots)', () => {
  const PIECES = {
    shell: [selShell, shallowEqual], wallet: [selWallet, shallowEqual], clock: [selClock, shallowEqual], weather: [selWeather, same], trip: [selTrip, same], waiting: [selWaiting, Object.is],
    rules: [selRules, same], alertCount: [alertCountSelector(2), Object.is], alertLane: [alertsSelector(2), same], badge: [selBadge, Object.is], career: [selCareer, same], prompt: [selPrompt, same],
    drift: [selDrift, shallowEqual], gauge: [selGauge, same], effects: [selFx, shallowEqual],
    // the other overlays
    minimap: [pickMenu, shallowEqual], quest: [pickQuest, same], radio: [pickRadio, shallowEqual], workshop: [pickWorkshop, shallowEqual], fare: [pickFare, same],
  };
  const run = () => {
    const store = createSnapStore();
    const pub = createSnapshotPublisher((s) => store.set(s));
    const readers = Object.fromEntries(Object.entries(PIECES).map(([k, [sel, eq]]) => [k, createViewReader(store, sel, eq)]));
    const last = {};
    const renders = Object.fromEntries(Object.keys(PIECES).map((k) => [k, 0]));
    for (let i = 0; i < 100; i++) {
      pub.push(snapshotAt(i));
      for (const [k, r] of Object.entries(readers)) {
        const v = r.read();
        if (v !== last[k]) renders[k]++;
        last[k] = v;
      }
    }
    return { renders, published: store.version() };
  };
  const { renders, published } = run();

  it('the publisher offers a snapshot almost every tick (the speed and the ride change at once)', () => {
    expect(published).toBeGreaterThan(90);
  });
  it('the slow pieces never re-render because the speed ticked: wallet, weather, prompt, drift, career, the other overlays', () => {
    for (const k of ['wallet', 'weather', 'prompt', 'drift', 'career', 'minimap', 'radio', 'workshop', 'fare', 'waiting', 'shell', 'badge']) expect(renders[k], k).toBeLessThanOrEqual(2);
  });
  it('the clock re-renders when the game minute changes, and the gauge when fuel or the limit sign changes: a handful of times in 10 s', () => {
    expect(renders.clock).toBeLessThanOrEqual(3);
    expect(renders.gauge).toBeLessThanOrEqual(6);
  });
  it('the trip and the alert lane re-render about once per printed change (a second, 10 m): far fewer than the 100 snapshots', () => {
    expect(renders.trip).toBeLessThan(40);
    expect(renders.alertLane).toBeLessThan(40);
    expect(renders.alertCount).toBeLessThanOrEqual(2);
  });
  it('the quest overlay follows its clock (once a second), the effects follow a percent of opacity', () => {
    expect(renders.quest).toBeLessThanOrEqual(12);
    expect(renders.effects).toBeLessThan(40);
  });
  it('in total: under a quarter of what "every piece on every snapshot" cost', () => {
    const total = Object.values(renders).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(0.25 * Object.keys(PIECES).length * published);
  });
});
