import { describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT, PLATE_MAX, PLATE_TEXT_PRICE, BANNER_CUSTOM_PRICE } from '../catalog.js';
import { defaultProfile } from '../profile.js';
import { CATEGORIES, TYPED_TEXT, createRepeatGuard, rowStatus, sectionRows } from './menuModel.js';

const profile = () => defaultProfile();
const rowsOf = (id) => sectionRows(CATEGORIES.flatMap((c) => c.sections).find((s) => s.id === id));
const inputOf = (id) => rowsOf(id).find((r) => r.type === 'input');

describe('what the text fields let you type', () => {
  it('the plate field takes the whole stock plate (it used to cut it at 10 characters)', () => {
    const stock = DEFAULT_LOADOUT.plate.text;
    expect(stock.length).toBeGreaterThan(10);
    expect(TYPED_TEXT['plate.text'](stock)).toBe(stock.slice(0, PLATE_MAX));
    expect(TYPED_TEXT['plate.text']('ts09 ez4040')).toBe('TS09 EZ4040');
    expect(TYPED_TEXT['plate.text']('x'.repeat(40)).length).toBe(PLATE_MAX);
    expect(inputOf('plate.text').max).toBe(PLATE_MAX); // the field's own limit and the typing filter agree
  });

  it('only plate characters survive in a plate, only letters and digits in a badge', () => {
    expect(TYPED_TEXT['plate.text']('ab-12 <x>  y')).toBe('AB-12 X Y');
    expect(TYPED_TEXT['decals.badge']('a&b+ c9!')).toBe('A&B+');
  });

  it('banner text keeps any script but drops control characters and angle brackets', () => {
    expect(TYPED_TEXT['decals.banner']('Jai <b>Hyderabad\n')).toBe('Jai bHyderabad');
    expect(TYPED_TEXT['decals.banner']('హైదరాబాద్ ఆటో')).toBe('హైదరాబాద్ ఆటో');
    expect(TYPED_TEXT['decals.banner']('y'.repeat(60)).length).toBe(inputOf('decals.banner').max);
  });
});

describe('the price on a text row follows what is typed', () => {
  it('shows the stock plate as installed and a new plate at the change fee', () => {
    const d = profile();
    const row = inputOf('plate.text');
    expect(rowStatus(d, d.loadout, row, 9999, undefined).label).toBe(`Rs ${row.price} / change`);
    expect(rowStatus(d, d.loadout, row, 9999, d.loadout.plate.text)).toMatchObject({ label: 'INSTALLED', tone: 'installed', price: 0 });
    expect(rowStatus(d, d.loadout, row, 9999, 'MY AUTO 1')).toMatchObject({ price: PLATE_TEXT_PRICE, tone: 'price' });
    expect(rowStatus(d, d.loadout, row, 10, 'MY AUTO 1')).toMatchObject({ tone: 'locked', can: false });
  });

  it('a banner preset shows its own price, custom text the custom price', () => {
    const d = profile();
    const row = inputOf('decals.banner');
    const preset = rowsOf('decals.banner').find((r) => r.type === 'item');
    expect(rowStatus(d, d.loadout, row, 9999, preset.value).price).toBe(preset.price);
    expect(rowStatus(d, d.loadout, row, 9999, 'my own words 123').price).toBe(BANNER_CUSTOM_PRICE);
  });

  it('empty or junk input falls back to the plain label and never throws', () => {
    const d = profile();
    const row = inputOf('plate.text');
    for (const t of ['', '   ', '###', null, 12]) expect(() => rowStatus(d, d.loadout, row, 100, t)).not.toThrow();
    expect(rowStatus(d, d.loadout, row, 100, '').label).toMatch(/change/);
  });
});

describe('createRepeatGuard', () => {
  it('lets the first press through and swallows a repeat of the same row within the window', () => {
    let t = 1000;
    const ok = createRepeatGuard(450, () => t);
    expect(ok('upgrade:upgrade.engine:engine')).toBe(true);
    t += 120;
    expect(ok('upgrade:upgrade.engine:engine')).toBe(false); // the double click
    for (let i = 0; i < 30; i++) {
      t += 33; // a held Enter repeats about every 33 ms: it stays blocked for as long as it is held
      expect(ok('upgrade:upgrade.engine:engine')).toBe(false);
    }
    t += 600;
    expect(ok('upgrade:upgrade.engine:engine')).toBe(true); // a deliberate second purchase later
  });

  it('never blocks a different row, so browsing and buying quickly still works', () => {
    let t = 0;
    const ok = createRepeatGuard(450, () => t);
    expect(ok('item:paint.body:red')).toBe(true);
    t += 10;
    expect(ok('item:paint.body:blue')).toBe(true);
    t += 10;
    expect(ok('item:paint.body:red')).toBe(true); // not a repeat: another row came in between
  });
});
