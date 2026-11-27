import { describe, expect, it } from 'vitest';
import { buyAction, purchaseNote } from './buyAction.js';
import { rowStatus } from '../../gameplay/workshop/menuModel.js';
import { DEFAULT_LOADOUT, DEFAULT_UPGRADES } from '../../gameplay/catalog.js';

const data = () => ({ loadout: JSON.parse(JSON.stringify(DEFAULT_LOADOUT)), upgrades: { ...DEFAULT_UPGRADES }, owned: {}, wallet: 0 });
const paint = { type: 'item', path: 'paint.body', value: 'bonaluRed', name: 'Bonalu Red', price: 260 };

describe('buyAction', () => {
  it('has nothing to say without a highlighted row', () => {
    expect(buyAction(null, null, 100)).toBeNull();
  });

  it('says Install with the price when the wallet covers it', () => {
    const st = { label: 'Rs 260', tone: 'price', price: 260, can: true };
    expect(buyAction(paint, st, 600)).toEqual({ label: 'Install', price: 'Rs 260', off: false, poor: false });
  });

  it('turns poor, and says by how much, when the wallet cannot cover it', () => {
    const st = { label: 'Rs 260', tone: 'locked', price: 260, can: false };
    expect(buyAction(paint, st, 80)).toEqual({ label: 'Need more', price: 'Rs 180 short', off: false, poor: true });
  });

  it('is poor for a typed change and an upgrade too (every priced row that is unaffordable)', () => {
    expect(buyAction({ type: 'input', path: 'plate.text' }, { label: 'Rs 250 / change', tone: 'price', price: 250, can: false }, 100).poor).toBe(true);
    expect(buyAction({ type: 'upgrade', key: 'engine' }, { label: 'Rs 600', tone: 'locked', price: 600, can: false, level: 0 }, 100).price).toBe('Rs 500 short');
  });

  it('is switched off for an installed item and a maxed upgrade, but a fitted toggle offers Take off', () => {
    expect(buyAction(paint, { label: 'INSTALLED', tone: 'installed', price: 0, can: true }, 0)).toMatchObject({ label: 'Installed', off: true, poor: false });
    expect(buyAction({ type: 'upgrade', key: 'engine' }, { label: 'MAX', tone: 'max', price: 0, can: false }, 9999)).toMatchObject({ label: 'Maxed', off: true });
    expect(buyAction({ type: 'toggle', path: 'interior.garland' }, { label: 'INSTALLED', tone: 'installed', price: 0, can: true }, 0)).toMatchObject({ label: 'Take off', off: false });
  });

  it('says Owned for a part already bought and Fit next level for an upgrade', () => {
    expect(buyAction(paint, { label: 'OWNED', tone: 'owned', price: 0, can: true }, 0).price).toBe('Owned');
    expect(buyAction({ type: 'upgrade', key: 'tyres' }, { label: 'Rs 450', tone: 'price', price: 450, can: true, level: 1 }, 5000).label).toBe('Fit next level');
  });

  it('agrees with the real catalogue: Bonalu Red costs money in the stock garage and a poor wallet makes it poor', () => {
    const d = data();
    const row = { type: 'item', path: 'paint.body', value: 'bonaluRed', name: 'Bonalu Red' };
    const rich = rowStatus(d, d.loadout, row, 5000);
    const poor = rowStatus(d, d.loadout, row, 10);
    expect(buyAction(row, rich, 5000).poor).toBe(false);
    if (poor.price > 0) expect(buyAction(row, poor, 10)).toMatchObject({ poor: true, label: 'Need more' });
  });
});

describe('purchaseNote', () => {
  it('confirms a paid install with the price and a free fit without one', () => {
    expect(purchaseNote({ ok: true, price: 260, name: 'Bonalu Red' }, paint)).toEqual({ tone: 'good', text: 'Installed Bonalu Red  -Rs 260' });
    expect(purchaseNote({ ok: true, price: 0, name: 'Auto Yellow' }, paint)).toEqual({ tone: 'good', text: 'Fitted Auto Yellow' });
  });

  it('says Took off for a toggle that was fitted and Already fitted for a repeat', () => {
    expect(purchaseNote({ ok: true, price: 0, name: 'No garland' }, { name: 'Marigold garland' }, true).text).toBe('Took off Marigold garland');
    expect(purchaseNote({ ok: true, already: true, price: 0 }, paint)).toEqual({ tone: 'info', text: 'Already fitted' });
  });

  it('refuses a poor purchase with the amount missing, and passes any other reason through', () => {
    expect(purchaseNote({ ok: false, code: 'funds', short: 140, reason: 'x' }, paint)).toEqual({ tone: 'bad', text: 'Not enough rupees: Rs 140 short' });
    expect(purchaseNote({ ok: false, code: 'funds' }, paint).text).toBe('Not enough rupees');
    expect(purchaseNote({ ok: false, code: 'empty-text', reason: 'Type a plate number first' }, paint)).toEqual({ tone: 'bad', text: 'Type a plate number first' });
    expect(purchaseNote(undefined, paint)).toBeNull();
  });
});
