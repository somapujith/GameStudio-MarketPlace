import { describe, expect, it } from 'vitest';
import { createProfile } from '../profile.js';
import { createEconomy } from '../economy.js';
import {
  ACCESSORIES, BADGE_PRICE, BANNER_CUSTOM_PRICE, BODY_COLORS, ENGINE_COVERS, GARLAND_PRICE, HORNS, MAX_UPGRADE, PLATE_MAX, PLATE_TEXT_PRICE, UPGRADES, DEFAULT_LOADOUT, normalizeLoadout,
} from '../catalog.js';
import { buy, ownedKey, previewLoadout, quote, rawStats, resolve, statBars } from './shop.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

function fakeCtx(wallet = 5000) {
  const events = [];
  const toasts = [];
  const ctx = { events, toasts };
  ctx.profile = createProfile('tester', memory());
  ctx.profile.data.wallet = wallet;
  ctx.emit = (type, data = {}) => events.push({ type, ...data });
  ctx.toast = (text, opts) => toasts.push({ text, ...opts });
  ctx.economy = createEconomy(ctx);
  ctx.state = { upgrades: ctx.profile.data.upgrades };
  return ctx;
}
const snapshot = (ctx) => JSON.stringify({ w: ctx.profile.data.wallet, l: ctx.profile.data.loadout, o: ctx.profile.data.owned, u: ctx.profile.data.upgrades });
const bodyPrice = (id) => BODY_COLORS.find((c) => c.id === id).price;

describe('quote', () => {
  const ctx = fakeCtx();
  const q = (path, value) => quote(ctx.profile.data, ctx.profile.data.loadout, path, value);

  it('stock parts are free, paid parts cost their catalogue price', () => {
    expect(q('horn', 'stock')).toMatchObject({ ok: true, price: 0, free: true, installed: true });
    expect(q('wheels', 'steel')).toMatchObject({ price: 0, free: true });
    expect(q('paint.body', 'bonalu-red')).toMatchObject({ ok: true, price: bodyPrice('bonalu-red'), free: false, reason: 'paid' });
    expect(q('paint.finish', 'chrome').price).toBe(900);
    expect(q('tint', 2).price).toBe(200);
    expect(q('lights.under', 'rainbow').price).toBe(700);
  });

  it('the stock paint, stored as a hex colour, counts as the matching catalogue item being fitted', () => {
    expect(q('paint.body', 'auto-yellow')).toMatchObject({ price: 0, installed: true });
    expect(q('paint.roof', 'night-black')).toMatchObject({ price: 0, installed: true });
    expect(q('paint.body', 'bonalu-red').installed).toBe(false);
  });

  it('a stock item that is not installed is free with reason stock', () => {
    const c = fakeCtx();
    c.profile.data.loadout.horn = 'baraat';
    expect(quote(c.profile.data, c.profile.data.loadout, 'horn', 'stock')).toMatchObject({ price: 0, free: true, reason: 'stock', installed: false });
  });

  it('anything already owned is free', () => {
    const c = fakeCtx();
    c.profile.data.owned[ownedKey('horn', 'sitar')] = true;
    expect(quote(c.profile.data, c.profile.data.loadout, 'horn', 'sitar')).toMatchObject({ price: 0, free: true, reason: 'owned', owned: true });
  });

  it('the plate text costs per change, is sanitised, and refuses empty input', () => {
    expect(q('plate.text', 'ts09 ab 12')).toMatchObject({ ok: true, price: PLATE_TEXT_PRICE, value: 'TS09 AB 12' });
    expect(q('plate.text', 'a<b>c!?')).toMatchObject({ ok: true, value: 'ABC' });
    expect(q('plate.text', 'abcdefghijklmnop').value).toHaveLength(PLATE_MAX);
    expect(DEFAULT_LOADOUT.plate.text.length).toBeLessThanOrEqual(PLATE_MAX); // the stock plate must fit (it was silently cut before)
    expect(q('plate.text', '')).toMatchObject({ ok: false, reason: 'empty-text' });
    expect(q('plate.text', '!!!  ??')).toMatchObject({ ok: false, reason: 'empty-text' });
    expect(q('plate.text', DEFAULT_LOADOUT.plate.text)).toMatchObject({ ok: true, price: 0 }); // the stock plate is always free
  });

  it('banners: presets cost their own price, custom text costs BANNER_CUSTOM_PRICE, the stock one is free', () => {
    expect(q('decals.banner', 'జై హనుమాన్')).toMatchObject({ price: 0, installed: true });
    expect(q('decals.banner', 'HYDERABADI')).toMatchObject({ ok: true, price: 120, reason: 'paid' });
    expect(q('decals.banner', 'WELCOME TO MY AUTO').price).toBe(BANNER_CUSTOM_PRICE);
    expect(q('decals.banner', '   ')).toMatchObject({ ok: false, reason: 'empty-text' });
    expect(q('decals.banner', 'x<script>y').value).toBe('xscripty');
  });

  it('the garland costs once, taking it off is free', () => {
    expect(q('interior.garland', true)).toMatchObject({ price: GARLAND_PRICE });
    expect(q('interior.garland', false)).toMatchObject({ price: 0, installed: true });
    const c = fakeCtx();
    c.profile.data.loadout.interior.garland = true;
    c.profile.data.owned[ownedKey('interior.garland', 'on')] = true;
    expect(quote(c.profile.data, c.profile.data.loadout, 'interior.garland', false).price).toBe(0);
    c.profile.data.loadout.interior.garland = false;
    expect(quote(c.profile.data, c.profile.data.loadout, 'interior.garland', true)).toMatchObject({ price: 0, reason: 'owned' });
  });

  it('upgrades are bought one level at a time, in order, up to the max', () => {
    expect(q('upgrade.engine', 1).price).toBe(UPGRADES.engine.prices[1]);
    expect(q('upgrade.engine', 2)).toMatchObject({ ok: false, reason: 'skip-level' });
    expect(q('upgrade.engine', 4)).toMatchObject({ ok: false, reason: 'skip-level' });
    expect(q('upgrade.engine', 5)).toMatchObject({ ok: false, reason: 'max-level' });
    expect(q('upgrade.engine', 0)).toMatchObject({ ok: true, price: 0, installed: true });
    const c = fakeCtx();
    c.profile.data.upgrades.engine = 2;
    const qq = (v) => quote(c.profile.data, c.profile.data.loadout, 'upgrade.engine', v);
    expect(qq(3).price).toBe(UPGRADES.engine.prices[3]);
    expect(qq(1)).toMatchObject({ price: 0, installed: true }); // no refund, no re-buy
    c.profile.data.upgrades.engine = MAX_UPGRADE;
    expect(qq(4)).toMatchObject({ ok: true, installed: true });
  });

  it('rejects hostile input: unknown paths and ids, non-string text, wrong types', () => {
    expect(q('nope', 1)).toMatchObject({ ok: false, reason: 'unknown-path' });
    expect(q('__proto__', 1)).toMatchObject({ ok: false });
    expect(q('constructor', 'x')).toMatchObject({ ok: false });
    expect(q('upgrade.__proto__', 1)).toMatchObject({ ok: false, reason: 'unknown-path' });
    expect(q('upgrade.toString', 1)).toMatchObject({ ok: false });
    expect(q('upgrade.engine', 1.5)).toMatchObject({ ok: false });
    expect(q('upgrade.engine', '1')).toMatchObject({ ok: false });
    expect(q('upgrade.engine', -1)).toMatchObject({ ok: false });
    expect(q('paint.body', 'does-not-exist')).toMatchObject({ ok: false, reason: 'unknown-item' });
    expect(q('paint.body', { id: 'bonalu-red' })).toMatchObject({ ok: false });
    expect(q('tint', '2')).toMatchObject({ ok: false });
    expect(q('plate.text', 42)).toMatchObject({ ok: false, reason: 'bad-text' });
    expect(q('plate.text', null)).toMatchObject({ ok: false, reason: 'bad-text' });
    expect(q('decals.banner', { toString: () => 'hi' })).toMatchObject({ ok: false, reason: 'bad-text' });
    expect(q('interior.garland', 'yes')).toMatchObject({ ok: false });
    expect(q(undefined, 1)).toMatchObject({ ok: false });
    expect(quote(null, null, 'horn', 'cycle')).toMatchObject({ ok: true, price: 80 });
  });
});

describe('buy', () => {
  it('charges, fits, remembers, saves, announces and toasts', () => {
    const ctx = fakeCtx(1000);
    const res = buy(ctx, 'paint.body', 'bonalu-red');
    expect(res).toMatchObject({ ok: true, price: 260 });
    expect(ctx.profile.data.wallet).toBe(740);
    expect(ctx.profile.data.loadout.paint.body).toBe('bonalu-red');
    expect(ctx.profile.data.owned['paint.body:bonalu-red']).toBe(true);
    const ev = ctx.events.filter((e) => e.type === 'loadout');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ preview: false });
    expect(ev[0].loadout.paint.body).toBe('bonalu-red');
    expect(ctx.events.find((e) => e.type === 'workshop:buy')).toMatchObject({ path: 'paint.body', value: 'bonalu-red', price: 260 });
    expect(ctx.events.find((e) => e.type === 'wallet')).toMatchObject({ delta: -260, reason: 'workshop' });
    expect(ctx.toasts[0].text).toMatch(/^Installed Bonalu Red\s+-Rs 260$/);
  });

  it('survives a reload: the stored profile has the part, the ownership and the new wallet', () => {
    const storage = memory();
    const ctx = fakeCtx(1000);
    ctx.profile.dispose();
    ctx.profile = createProfile('reload', storage);
    ctx.profile.data.wallet = 1000;
    ctx.economy = createEconomy(ctx);
    expect(buy(ctx, 'horn', 'shehnai').ok).toBe(true);
    ctx.profile.flush();
    const again = createProfile('reload', storage);
    expect(again.data.wallet).toBe(600);
    expect(again.data.loadout.horn).toBe('shehnai');
    expect(again.data.owned['horn:shehnai']).toBe(true);
  });

  it('insufficient funds changes nothing and says why (money and loadout move together)', () => {
    const ctx = fakeCtx(100);
    const before = snapshot(ctx);
    const res = buy(ctx, 'paint.finish', 'chrome');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('funds');
    expect(res.reason).toMatch(/Not enough rupees/);
    expect(res.short).toBe(800);
    expect(snapshot(ctx)).toBe(before);
    expect(ctx.events.filter((e) => e.type === 'loadout' || e.type === 'workshop:buy')).toHaveLength(0);
    expect(ctx.toasts).toHaveLength(0);
  });

  it('exactly enough money works and leaves zero', () => {
    const ctx = fakeCtx(80);
    expect(buy(ctx, 'horn', 'cycle').ok).toBe(true);
    expect(ctx.profile.data.wallet).toBe(0);
    expect(buy(ctx, 'horn', 'cuckoo').ok).toBe(false);
    expect(ctx.profile.data.loadout.horn).toBe('cycle');
  });

  it('re-applying something owned is free, in both directions', () => {
    const ctx = fakeCtx(1000);
    expect(buy(ctx, 'horn', 'sitar').price).toBe(450);
    expect(buy(ctx, 'horn', 'stock')).toMatchObject({ ok: true, price: 0 });
    expect(ctx.profile.data.wallet).toBe(550);
    expect(ctx.profile.data.loadout.horn).toBe('stock');
    expect(buy(ctx, 'horn', 'sitar')).toMatchObject({ ok: true, price: 0 });
    expect(ctx.profile.data.wallet).toBe(550);
    expect(ctx.profile.data.loadout.horn).toBe('sitar');
  });

  it('buying what is already fitted is a no-op', () => {
    const ctx = fakeCtx(1000);
    const before = snapshot(ctx);
    expect(buy(ctx, 'horn', 'stock')).toMatchObject({ ok: true, already: true, price: 0 });
    expect(snapshot(ctx)).toBe(before);
    expect(ctx.events).toHaveLength(0);
  });

  it('plate text: paid per change, sanitised, saved; empty is refused', () => {
    const ctx = fakeCtx(1000);
    expect(buy(ctx, 'plate.text', 'ts 10 hy 1').ok).toBe(true);
    expect(ctx.profile.data.loadout.plate.text).toBe('TS 10 HY 1');
    expect(ctx.profile.data.wallet).toBe(1000 - PLATE_TEXT_PRICE);
    expect(buy(ctx, 'plate.text', 'ts 10 hy 1')).toMatchObject({ already: true });
    expect(buy(ctx, 'plate.text', '   ')).toMatchObject({ ok: false, code: 'empty-text' });
    expect(ctx.profile.data.wallet).toBe(1000 - PLATE_TEXT_PRICE);
    expect(normalizeLoadout(ctx.profile.data.loadout).plate.text).toBe('TS 10 HY 1');
  });

  it('banners: preset then custom text; ownership of a preset keeps the saved profile valid', () => {
    const ctx = fakeCtx(1000);
    expect(buy(ctx, 'decals.banner', 'RAJA RAANI').price).toBe(120);
    expect(ctx.profile.data.loadout.decals.banner).toBe('RAJA RAANI');
    expect(buy(ctx, 'decals.banner', 'my own auto').price).toBe(BANNER_CUSTOM_PRICE);
    expect(ctx.profile.data.loadout.decals.banner).toBe('my own auto');
    expect(buy(ctx, 'decals.banner', 'RAJA RAANI').price).toBe(0); // owned preset
    expect(buy(ctx, 'decals.banner', 'మా అమ్మ ఆశీర్వాదం').price).toBe(120);
    for (const k of Object.keys(ctx.profile.data.owned)) expect(k).toMatch(/^[\w.\-:]{1,80}$/); // profile keeps only these
  });

  it('the garland: bought once, then toggled for free', () => {
    const ctx = fakeCtx(500);
    expect(buy(ctx, 'interior.garland', true).price).toBe(GARLAND_PRICE);
    expect(ctx.profile.data.loadout.interior.garland).toBe(true);
    expect(buy(ctx, 'interior.garland', false).price).toBe(0);
    expect(buy(ctx, 'interior.garland', true).price).toBe(0);
    expect(ctx.profile.data.wallet).toBe(500 - GARLAND_PRICE);
  });

  it('upgrades mutate the live physics object and announce workshop:upgrade', () => {
    const ctx = fakeCtx(10000);
    expect(buy(ctx, 'upgrade.engine', 2)).toMatchObject({ ok: false, code: 'skip-level' });
    expect(buy(ctx, 'upgrade.engine', 1).ok).toBe(true);
    expect(ctx.state.upgrades.engine).toBe(1); // same object as profile.data.upgrades
    expect(ctx.state.upgrades).toBe(ctx.profile.data.upgrades);
    expect(buy(ctx, 'upgrade.engine', 2).price).toBe(UPGRADES.engine.prices[2]);
    expect(ctx.events.filter((e) => e.type === 'workshop:upgrade').map((e) => e.level)).toEqual([1, 2]);
    expect(ctx.events.filter((e) => e.type === 'loadout')).toHaveLength(0); // physics only
    expect(ctx.profile.data.wallet).toBe(10000 - UPGRADES.engine.prices[1] - UPGRADES.engine.prices[2]);
  });

  it('walks every engine level to the max and then refuses', () => {
    const ctx = fakeCtx(100000);
    for (let l = 1; l <= MAX_UPGRADE; l++) expect(buy(ctx, 'upgrade.turbo', l).ok).toBe(true);
    expect(ctx.profile.data.upgrades.turbo).toBe(MAX_UPGRADE);
    expect(buy(ctx, 'upgrade.turbo', MAX_UPGRADE + 1)).toMatchObject({ ok: false, code: 'max-level' });
    expect(ctx.profile.data.wallet).toBe(100000 - UPGRADES.turbo.prices.reduce((a, b) => a + b, 0));
  });

  it('hostile input never moves money or the loadout', () => {
    const ctx = fakeCtx(5000);
    const before = snapshot(ctx);
    for (const [p, v] of [['nope', 1], ['paint.body', 'x'], ['plate.text', 5], ['decals.banner', null], ['upgrade.constructor', 1], [null, null], ['__proto__.polluted', 'yes'], ['interior.garland', 1]]) {
      expect(buy(ctx, p, v).ok).toBe(false);
    }
    expect(snapshot(ctx)).toBe(before);
    expect({}.polluted).toBeUndefined();
  });

  it('returns an error rather than throwing when there is no profile', () => {
    expect(buy({}, 'horn', 'cycle')).toMatchObject({ ok: false });
    expect(buy(null, 'horn', 'cycle')).toMatchObject({ ok: false });
  });
});

describe('rear and exterior parts', () => {
  it('lists, quotes and buys the new catalogue lists', () => {
    const ctx = fakeCtx(5000);
    const q = (p, v) => quote(ctx.profile.data, ctx.profile.data.loadout, p, v);
    expect(q('rear.cover', 'louver')).toMatchObject({ price: 0, installed: true });
    expect(q('rear.cover', 'led-rainbow').price).toBe(ENGINE_COVERS.find((c) => c.id === 'led-rainbow').price);
    expect(q('rear.bumper', 'spiked').price).toBe(500);
    expect(q('rear.flaps', 'peacock').price).toBe(300);
    expect(q('decals.stripe', 'rainbow-swish').price).toBe(320);
    expect(q('paint.body', 'bottle-green').price).toBe(240);
    expect(q('paint.roof', 'silver').price).toBe(220);
    expect(q('decals.rearWindowFrame', 'gold').price).toBe(80);
    expect(buy(ctx, 'rear.cover', 'jali').ok).toBe(true);
    expect(ctx.profile.data.loadout.rear.cover).toBe('jali');
    expect(buy(ctx, 'rear.flaps', 'eyes').ok).toBe(true);
    expect(ctx.profile.data.loadout.rear.flaps).toBe('eyes');
    expect(buy(ctx, 'rear.cover', 'louver').price).toBe(0);
    expect(buy(ctx, 'rear.cover', 'jali').price).toBe(0); // owned
  });

  it('rear-window lettering: stock and presets by price, custom text costs BANNER_CUSTOM_PRICE, sanitised', () => {
    const ctx = fakeCtx(1000);
    const q = (v) => quote(ctx.profile.data, ctx.profile.data.loadout, 'decals.rearWindow', v);
    expect(q('AUTO RAJA')).toMatchObject({ price: 0, installed: true });
    expect(q('BADSHAH').price).toBe(120);
    expect(q('MY KING').price).toBe(BANNER_CUSTOM_PRICE);
    expect(q('  ')).toMatchObject({ ok: false, reason: 'empty-text' });
    expect(q(12)).toMatchObject({ ok: false, reason: 'bad-text' });
    expect(buy(ctx, 'decals.rearWindow', 'BADSHAH').ok).toBe(true);
    expect(ctx.profile.data.loadout.decals.rearWindow).toBe('BADSHAH');
    expect(buy(ctx, 'decals.rearWindow', 'AUTO RAJA').price).toBe(0);
    expect(buy(ctx, 'decals.rearWindow', 'BADSHAH').price).toBe(0);
    expect(ctx.profile.data.wallet).toBe(880);
    for (const k of Object.keys(ctx.profile.data.owned)) expect(k).toMatch(/^[\w.\-:]{1,80}$/);
  });

  it('roof badge: 2-4 letters, BADGE_PRICE per change, the stock badge is free', () => {
    const ctx = fakeCtx(1000);
    const q = (v) => quote(ctx.profile.data, ctx.profile.data.loadout, 'decals.badge', v);
    expect(q('HA')).toMatchObject({ price: 0, installed: true });
    expect(q('raj')).toMatchObject({ price: BADGE_PRICE, value: 'RAJ' });
    expect(q('a!b?c-d-e').value).toBe('ABCD');
    expect(q('!!')).toMatchObject({ ok: false, reason: 'empty-text' });
    expect(buy(ctx, 'decals.badge', 'raj').ok).toBe(true);
    expect(ctx.profile.data.loadout.decals.badge).toBe('RAJ');
    expect(buy(ctx, 'decals.badge', 'HA').price).toBe(0);
    expect(buy(ctx, 'decals.badge', 'RAJ').price).toBe(BADGE_PRICE); // text is paid per change
  });

  it('accessories are yes/no toggles: bought once, then free to take off and put back', () => {
    const ctx = fakeCtx(2000);
    for (const [path, a] of Object.entries(ACCESSORIES)) {
      expect(quote(ctx.profile.data, ctx.profile.data.loadout, path, false)).toMatchObject({ price: 0, installed: true });
      const before = ctx.profile.data.wallet;
      expect(buy(ctx, path, true)).toMatchObject({ ok: true, price: a.price });
      expect(buy(ctx, path, false).price).toBe(0);
      expect(buy(ctx, path, true).price).toBe(0);
      expect(ctx.profile.data.wallet).toBe(before - a.price);
    }
    expect(ctx.profile.data.loadout.rear).toMatchObject({ ladder: true, antenna: true, sideGuards: true });
    expect(buy(ctx, 'rear.ladder', 'yes').ok).toBe(false);
    expect(buy(ctx, 'rear.nope', true).ok).toBe(false);
  });
});

describe('preview', () => {
  it('builds a look without charging or touching the saved loadout', () => {
    const ctx = fakeCtx(1000);
    const before = snapshot(ctx);
    const p = previewLoadout(ctx.profile.data.loadout, 'paint.body', 'neon-pink');
    expect(p.paint.body).toBe('neon-pink');
    expect(p.paint.roof).toBe(ctx.profile.data.loadout.paint.roof);
    expect(snapshot(ctx)).toBe(before);
    expect(previewLoadout(ctx.profile.data.loadout, 'plate.text', 'abc 1').plate.text).toBe('ABC 1');
    expect(previewLoadout(ctx.profile.data.loadout, 'interior.garland', true).interior.garland).toBe(true);
    expect(previewLoadout(ctx.profile.data.loadout, 'tint', 3).tint).toBe(3);
  });

  it('ignores invalid previews and upgrade paths', () => {
    const base = fakeCtx().profile.data.loadout;
    expect(previewLoadout(base, 'horn', 'nope')).toEqual(base);
    expect(previewLoadout(base, 'upgrade.engine', 1)).toEqual(base);
    expect(previewLoadout(base, 'plate.text', 7)).toEqual(base);
    expect(previewLoadout(base, 'x', 1)).not.toBe(base);
  });
});

describe('stats', () => {
  it('more engine means more top speed and acceleration, bars scale from stock to max', () => {
    const stock = rawStats({});
    const maxed = rawStats({ engine: 4, tyres: 4, brakes: 4, tank: 4, turbo: 4 });
    expect(maxed.top).toBeGreaterThan(stock.top);
    expect(maxed.accel).toBeGreaterThan(stock.accel);
    expect(maxed.grip).toBeGreaterThan(stock.grip);
    expect(maxed.braking).toBeGreaterThan(stock.braking);
    expect(maxed.range).toBeGreaterThan(stock.range);
    expect(maxed.boost).toBeGreaterThan(stock.boost);
    const bars = statBars({}, 'engine');
    expect(bars.map((b) => b.id)).toEqual(['top', 'accel', 'grip', 'braking', 'range', 'boost']);
    for (const b of bars) expect(b.frac).toBeCloseTo(0.25);
    expect(bars.find((b) => b.id === 'top').nextFrac).toBeGreaterThan(0.25);
    expect(bars.find((b) => b.id === 'grip').nextFrac).toBeCloseTo(0.25); // the engine does not change grip
    const full = statBars({ engine: 4, tyres: 4, brakes: 4, tank: 4, turbo: 4 }, 'engine');
    for (const b of full) expect(b.frac).toBeCloseTo(1);
    expect(full[0].nextValue).toBeNull();
  });
});

describe('resolve', () => {
  it('names what it understands', () => {
    expect(resolve('horn', HORNS[2].id)).toMatchObject({ ok: true, kind: 'item', name: 'Cuckoo Clock' });
    expect(resolve('upgrade.tank', 1)).toMatchObject({ ok: true, kind: 'upgrade', key: 'tank' });
  });
});
