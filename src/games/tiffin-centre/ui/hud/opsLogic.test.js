import { describe, it, expect } from 'vitest';
import { applyAction, createGame } from '@shared/tiffin-centre/index.js';
import { HEAT, MARKET_MAX, STOCK_CAP } from '@shared/tiffin-centre/catalog.js';
import {
  BUY_SIZES, boardMap, boardView, buyBlock, buyPrice, chitBadges, eventBanner, freshBand, fmtPortions, gasView, hasOps, opsOn, prepBlock, prepView, shortName,
  stockGroups, stockRows, tendHotkeyTarget, tendView,
} from './opsLogic.js';
import { mkCustomer } from './testState.js';

const game = (level, over = {}) => {
  const s = createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level, pace: 'normal' }, seed: 11 });
  return Object.assign(s, over);
};

describe('the layer is off on level 0 and on a hand-built state', () => {
  it('returns nothing at all in the tutorial', () => {
    const s = game(0);
    expect(opsOn(s)).toBe(false);
    expect(hasOps(s)).toBe(false);
    expect(stockGroups(s)).toEqual([]);
    expect(stockRows(s)).toEqual([]);
    expect(gasView(s)).toBeNull();
    expect(tendView(s, 'tawa1')).toBeNull();
    expect(prepView(s)).toBeNull();
    expect(boardView(s)).toBeNull();
    expect(eventBanner(s)).toEqual([]);
    expect(tendHotkeyTarget(s, 0)).toBeNull();
    expect(boardMap(s).size).toBe(0);
  });
  it('each tutorial switch turns exactly its own layer on (P, T, B and the Swap button follow the flags, not cfg.tutorial)', () => {
    const train = (s, f) => applyAction(s, { type: 'tutorial-flags', ...f }).state;
    const stock = train(game(0), { stock: true });
    expect(opsOn(stock)).toBe(true);
    expect(hasOps(stock)).toBe(true);
    expect(stockGroups(stock).length).toBeGreaterThan(0);
    expect(prepView(stock)).not.toBeNull();
    expect(boardView(stock)).not.toBeNull();
    expect(boardMap(stock).size).toBeGreaterThan(0);
    expect(gasView(stock)).toBeNull();
    expect(tendView(stock, 'tawa1')).toBeNull();
    expect(prepView(stock).market).toBe(false);
    expect(prepView(train(stock, { market: true })).market).toBe(true);

    const gas = train(game(0), { gas: true });
    expect(opsOn(gas)).toBe(false);
    expect(hasOps(gas)).toBe(true);
    expect(gasView(gas)).toMatchObject({ canSwap: expect.any(Boolean), tone: 'ok' });
    expect(prepView(gas)).toBeNull();

    const heat = train(game(0), { heat: true });
    expect(hasOps(heat)).toBe(true);
    expect(tendView(heat, 'tawa1')).toMatchObject({ verb: 'Wipe', canTend: true });
    expect(tendHotkeyTarget(heat, 0)).toBe('tawa1');
    expect(opsOn(heat)).toBe(false);
    expect(gasView(heat)).toBeNull();

    const ev = train(train(game(0), { events: true }), { stage: { event: { id: 'rain', ticks: 30 } } });
    expect(hasOps(ev)).toBe(true);
    expect(eventBanner(ev).map((e) => e.id)).toEqual(['rain']);
    expect(eventBanner(train(game(0), { events: true }))).toEqual([]);

    const off = train(stock, { stock: false });
    expect(opsOn(off)).toBe(false);
    expect(prepView(off)).toBeNull();
    expect(boardView(off)).toBeNull();
  });
  it('is defensive about missing fields', () => {
    for (const s of [null, undefined, {}, { cfg: {} }, { cfg: { stock: true } }, { cfg: { stock: true }, stock: {} }]) {
      expect(() => [stockGroups(s), gasView(s), tendView(s, 'tawa1'), prepView(s), boardView(s), eventBanner(s), chitBadges(null, s)]).not.toThrow();
    }
    expect(prepBlock({}, 'oil')).toMatchObject({ hard: true });
    expect(buyBlock({}, 'oil', 1)).toMatch(/market/);
  });
});

describe('stock grouping', () => {
  it('level 1 groups the shelf (batter, chutney, sambar, oil, tea) with a worst row per group and no gas or pan care', () => {
    const s = game(1);
    expect(opsOn(s)).toBe(true);
    const g = stockGroups(s);
    const ids = g.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['batter', 'chutney', 'sambar', 'oil', 'drinks']));
    expect(ids.indexOf('batter')).toBeLessThan(ids.indexOf('chutney'));
    expect(gasView(s)).toBeNull(); // no cylinder on level 1
    expect(tendView(s, 'tawa1')).toBeNull(); // no pan care before level 2
    expect(prepView(s).market).toBe(false);
  });

  it('the bar shows the worst item: out beats sour beats low beats ok, then fewer portions', () => {
    const s = game(3);
    s.stock = { batter_dosa: 9, batter_idly: 2, vada_batter: 0, coconut_chutney: 12, sambar: 30 };
    s.fresh = { batter_dosa: 95, batter_idly: 20, vada_batter: 90 };
    s.cfg.menu = ['dosa', 'idly', 'vada'];
    const g = stockGroups(s);
    const batter = g.find((x) => x.id === 'batter');
    expect(batter.count).toBe(3);
    expect(batter.item).toBe('vada_batter');
    expect(batter.tone).toBe('out');
    s.stock.vada_batter = 6;
    expect(stockGroups(s).find((x) => x.id === 'batter')).toMatchObject({ item: 'batter_idly', tone: 'sour', band: 'sour' }); // idly batter: 2 left and sour: sour wins over low
    s.fresh.batter_idly = 90;
    expect(stockGroups(s).find((x) => x.id === 'batter')).toMatchObject({ item: 'batter_idly', tone: 'low' });
    s.stock.batter_idly = 14;
    expect(stockGroups(s).find((x) => x.id === 'batter')).toMatchObject({ item: 'vada_batter', tone: 'ok' }); // all fine: the smallest shelf
    expect(stockGroups(s).find((x) => x.id === 'chutney').tone).toBe('ok');
  });

  it('freshness bands, portions text and bar fill', () => {
    expect(freshBand(95)).toBe('fresh');
    expect(freshBand(45)).toBe('turning');
    expect(freshBand(29)).toBe('sour');
    expect(freshBand(null)).toBeNull();
    expect(fmtPortions(2.5)).toBe('2.5');
    expect(fmtPortions(3)).toBe('3');
    expect(fmtPortions(0.25)).toBe('0.25');
    const s = game(2);
    s.stock.batter_dosa = 40;
    expect(stockRows(s).find((r) => r.item === 'batter_dosa').frac).toBe(1);
    s.stock.batter_dosa = 0;
    expect(stockRows(s).find((r) => r.item === 'batter_dosa')).toMatchObject({ frac: 0, tone: 'out' });
    expect(shortName('batter_dosa')).toBe('Dosa');
  });

  it('counts jobs under way as pending and keeps a group per unknown item', () => {
    const s = game(2);
    s.stations.prep1.slots[0] = { st: 'cooking', item: 'batter_dosa', t0: 0, readyAt: 12, by: 'me' };
    const b = stockGroups(s).find((x) => x.id === 'batter');
    expect(b.pending).toBe(12);
    expect(b.ariaLabel).toMatch(/12 being made/);
  });
});

describe('the LPG gauge', () => {
  it('bands: ok, low at 20%, out at 0, swapping with 6 ticks of progress; Swap only below 70%', () => {
    const s = game(3);
    expect(gasView(s)).toMatchObject({ tone: 'ok', pct: 70, canSwap: true, reason: null, cost: 90 });
    s.gas.u = 1000;
    expect(gasView(s)).toMatchObject({ tone: 'ok', canSwap: false, reason: 'The cylinder is still heavy' });
    s.gas.u = 190;
    expect(gasView(s)).toMatchObject({ tone: 'low', label: 'Low 19%', canSwap: true });
    s.gas.u = 0;
    expect(gasView(s)).toMatchObject({ tone: 'out', label: 'No gas' });
    s.gas.sw = 4;
    const v = gasView(s);
    expect(v).toMatchObject({ tone: 'swap', swapping: true, swapTicks: 6, swapDone: 2, reason: 'Already changing the cylinder' });
    expect(v.swapFrac).toBeCloseTo(2 / 6);
    expect(v.label).toBe('Changing 4s');
  });
  it('is absent on levels without a cylinder', () => {
    expect(gasView(game(1))).toBeNull();
    expect(gasView(game(2))).toBeNull();
  });
});

describe('tend gauges', () => {
  it('a clean pan is "Already clean" and does not pulse; a gunky cold pan pulses and says it needs wiping', () => {
    const s = game(3);
    const clean = tendView(s, 'tawa1');
    expect(clean).toMatchObject({ kind: 'heat', band: 'ideal', canTend: false, reason: 'Already clean', pulse: false, text: 'Clean', verb: 'Wipe', tone: 'ok' });
    s.stations.tawa1.gunk = 45;
    s.stations.tawa1.heat = 40;
    const stuck = tendView(s, 'tawa1');
    expect(stuck).toMatchObject({ canTend: true, pulse: true, text: 'Needs wiping', tone: 'warn', stuck: true, torn: false });
    s.stations.tawa1.gunk = 75;
    expect(tendView(s, 'tawa1')).toMatchObject({ text: 'Needs wiping now', tone: 'crit', torn: true });
    expect(tendView(s, 'tawa1').aria).toMatch(/Press to wipe \(T\)/);
  });
  it('heat bands cold / hot, the kadai is skimmed, the steamer is topped up', () => {
    const s = game(3);
    s.stations.tawa1.heat = HEAT.cold - 5;
    expect(tendView(s, 'tawa1')).toMatchObject({ band: 'cold', text: 'Cold pan' });
    s.stations.tawa1.heat = HEAT.hot + 5;
    expect(tendView(s, 'tawa1')).toMatchObject({ band: 'hot', text: 'Too hot' });
    expect(tendView(s, 'kadai1').verb).toBe('Skim');
    s.stations.steamer1.water = 20;
    expect(tendView(s, 'steamer1')).toMatchObject({ kind: 'water', band: 'dry', verb: 'Top up', text: 'Low water', canTend: true });
    s.stations.steamer1.water = 0;
    expect(tendView(s, 'steamer1')).toMatchObject({ text: 'Dry!', tone: 'crit', pulse: true });
    expect(tendView(s, 'chai1')).toBeNull(); // nothing to tend on the chai counter
  });
  it('T tends the nearest pan that needs it, else the nearest pan', () => {
    const s = game(3);
    expect(['tawa1', 'steamer1', 'kadai1', 'chai1'].map((id) => tendView(s, id) && id).filter(Boolean)).toEqual(['tawa1', 'steamer1', 'kadai1']);
    expect(tendHotkeyTarget(s, -2.6)).toBe('tawa1'); // everything clean: the nearest pan (the engine answers "Already clean")
    s.stations.kadai1.gunk = 50;
    expect(tendHotkeyTarget(s, -2.6)).toBe('kadai1'); // the only one that needs it
    s.stations.tawa1.gunk = 50;
    expect(tendHotkeyTarget(s, -2.6)).toBe('tawa1');
    expect(tendHotkeyTarget(s, 0.2)).toBe('kadai1');
  });
});

describe('the prep sheet', () => {
  it('two job slots, every ingredient with recipe, cost and yield, no block when the counter is free', () => {
    const s = game(2);
    const v = prepView(s);
    expect(v.slots).toHaveLength(2);
    expect(v.free).toBe(0);
    const dosa = v.items.find((i) => i.item === 'batter_dosa');
    expect(dosa).toMatchObject({ ticks: 12, yield: 12, cost: 60, needs: 'power', block: null, disabled: false });
    expect(dosa.how).toMatch(/Grind/);
    expect(v.items.every((i) => i.how && i.ticks > 0)).toBe(true);
  });

  it('shows a running job with progress, a ready job with Collect, and why a job is paused', () => {
    const s = game(5);
    s.tick = 10;
    s.stations.prep1.slots[0] = { st: 'cooking', item: 'batter_dosa', t0: 4, readyAt: 16, by: 'me' };
    s.stations.prep1.slots[1] = { st: 'ready', item: 'sambar', t0: 0, readyAt: 9, by: 'me' };
    let v = prepView(s);
    expect(v.slots[0]).toMatchObject({ st: 'cooking', name: 'Dosa batter', secs: 6, paused: null });
    expect(v.slots[0].progress).toBeCloseTo(0.5);
    expect(v.slots[1]).toMatchObject({ ready: true, yield: 14, progress: 1 });
    expect(v.ready).toBe(1);
    s.events = [{ id: 'power', until: 30 }];
    v = prepView(s);
    expect(v.slots[0].paused).toBe('Power cut');
    expect(v.power).toBe(false);
  });

  it('disabled reasons: Slot busy, Shelf full (hard) and Power cut / No gas (soft: the job waits)', () => {
    const s = game(5);
    expect(prepBlock(s, 'batter_dosa')).toBeNull();
    s.stations.prep1.slots[0] = { st: 'cooking', item: 'oil', t0: 0, readyAt: 3, by: 'me' };
    s.stations.prep1.slots[1] = { st: 'ready', item: 'oil', t0: 0, readyAt: 3, by: 'me' };
    expect(prepBlock(s, 'batter_dosa')).toEqual({ reason: 'Slot busy', hard: true });
    expect(prepView(s).items.every((i) => i.disabled && i.blockText === 'Slot busy')).toBe(true);
    s.stations.prep1.slots[1] = { st: 'empty', item: null };
    s.stock.coconut_chutney = STOCK_CAP - 5;
    expect(prepBlock(s, 'coconut_chutney')).toEqual({ reason: 'Shelf full', hard: true });
    s.stock.coconut_chutney = 4;
    s.stations.prep1.slots[0] = { st: 'empty', item: null };
    s.events = [{ id: 'power', until: 99 }];
    expect(prepBlock(s, 'batter_dosa')).toEqual({ reason: 'Power cut', hard: false });
    expect(prepBlock(s, 'coconut_chutney')).toBeNull(); // by hand: no power needed
    s.events = [];
    s.gas.u = 0;
    expect(prepBlock(s, 'sambar')).toEqual({ reason: 'No gas', hard: false });
    s.gas.sw = 3;
    s.gas.u = 500;
    expect(prepBlock(s, 'sambar')).toEqual({ reason: 'Changing cylinder', hard: false });
    expect(prepView(s).items.find((i) => i.item === 'sambar')).toMatchObject({ disabled: false, blockText: 'Changing cylinder' });
  });
});

describe('the market runner', () => {
  it('prices are 40% dearer and rounded up; only on market levels; 1..10 portions; the shelf must have room', () => {
    expect(BUY_SIZES).toEqual([1, 5, 10]);
    expect(buyPrice('batter_dosa', 5)).toBe(35); // 5 x 5 x 1.4
    expect(buyPrice('mirchi', 1)).toBe(5); // ceil(4.2)
    expect(buyPrice('nope', 3)).toBe(0);
    expect(prepView(game(4)).market).toBe(false);
    expect(buyBlock(game(4), 'batter_dosa', 5)).toMatch(/market/);
    const s = game(5);
    expect(prepView(s).market).toBe(true);
    expect(buyBlock(s, 'batter_dosa', 5)).toBeNull();
    expect(buyBlock(s, 'batter_dosa', MARKET_MAX + 1)).toMatch(/Buy 1 to 10/);
    s.stock.batter_dosa = STOCK_CAP - 2;
    expect(buyBlock(s, 'batter_dosa', 5)).toBe('Shelf full');
    expect(buyBlock(s, 'tea_decoction_milk', 1)).toBeNull();
    expect(buyBlock(s, 'biscuits', 1)).toBe('Not needed today'); // level 5 sells no Osmania biscuits
  });
});

describe('the sold-out board', () => {
  it('lists every dish with its switch, flags dishes the shelf cannot make and offers to switch them off', () => {
    const s = game(2);
    s.stock.batter_dosa = 0;
    const v = boardView(s);
    expect(v.rows.map((r) => r.dish)).toEqual(s.cfg.menu);
    const dosa = v.rows.find((r) => r.dish === 'dosa');
    expect(dosa).toMatchObject({ on: true, suggest: true });
    expect(dosa.short).toEqual({ item: 'batter_dosa', name: 'Dosa batter' });
    expect(v.suggestCount).toBeGreaterThanOrEqual(2); // dosa and masala dosa both need it
    expect(v.rows.find((r) => r.dish === 'irani_chai').suggest).toBe(false);
    s.off = ['dosa'];
    const w = boardView(s);
    expect(w.offCount).toBe(1);
    expect(w.rows.find((r) => r.dish === 'dosa')).toMatchObject({ on: false, suggest: false });
    expect(boardMap(s).get('dosa').on).toBe(false);
  });
});

describe('the events banner', () => {
  it('names the running events (Telugu too) with their countdown, the inspector as a notice', () => {
    const s = game(9);
    s.tick = 40;
    s.events = [{ id: 'rain', until: 70 }, { id: 'inspector', until: 49 }, { id: 'delivery', until: 45, w: 1 }];
    const b = eventBanner(s);
    expect(b.map((e) => e.id)).toEqual(['rain', 'inspector', 'delivery']);
    expect(b[0]).toMatchObject({ name: 'Rain', te: 'వర్షం', left: 30, icon: 'rain', headline: 'Rain 30s' });
    expect(b[1]).toMatchObject({ headline: 'Inspector in 9s', tone: 'warn' });
    expect(b[2]).toMatchObject({ waiting: true });
    s.events = [{ id: 'power', until: 55 }, { id: 'festival', until: 80 }, { id: 'cricket', until: 80 }];
    expect(eventBanner(s).map((e) => e.te)).toEqual(['కరెంట్ కట్', 'పండుగ రద్దీ', 'క్రికెట్ మ్యాచ్']);
  });
});

describe('chit badges', () => {
  it('request icons, regular star with loyalty, big office order and delivery boy with timers', () => {
    const s = game(6);
    const c = mkCustomer({ parcel: true, extra: 'coconut_chutney', spice: 'more', regular: true, loyal: 2, big: true, patience: 41 });
    const ids = chitBadges(c, s).map((b) => b.id);
    expect(ids).toEqual(['big', 'parcel', 'extra', 'spice', 'regular']);
    const big = chitBadges(c, s)[0];
    expect(big).toMatchObject({ label: 'BIG OFFICE ORDER', secs: 41 });
    expect(chitBadges(c, s).find((b) => b.id === 'extra').label).toBe('Extra chutney');
    expect(chitBadges(c, s).find((b) => b.id === 'spice').label).toBe('Spice more');
    expect(chitBadges(c, s).find((b) => b.id === 'regular')).toMatchObject({ pips: 2, label: 'REGULAR' });
    const d = chitBadges(mkCustomer({ delivery: true, patience: 30 }), s, 0.5);
    expect(d[0]).toMatchObject({ id: 'delivery', label: 'DELIVERY BOY', secs: 30 });
    expect(chitBadges(mkCustomer({ spice: 'less' }), s)[0].label).toBe('Spice less');
    expect(chitBadges(mkCustomer({ big: true, st: 'eating' }), s)[0].secs).toBeNull(); // the timer is the patience: not while eating
    expect(chitBadges(mkCustomer(), s)).toEqual([]);
  });
});
