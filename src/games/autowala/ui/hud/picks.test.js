import { describe, expect, it } from 'vitest';
import { shallowEqual, createSnapStore, createViewReader } from './snapStore.js';
import { SLICES, pickFare, pickHisaab, pickMenu, pickMenus, pickQuest, pickRadio, pickWorkshop } from './picks.js';
import { reuse, same } from '../../game/snapshot.js';

const trip = { name: 'Salma', fareNow: 120, distanceLeft: 2300, timeLeft: 40, terms: { mode: 'meter' }, modifiers: [{ id: 'rain', label: 'Rain', mul: 1.2 }], urgent: null, shared: null };
const snap = (o = {}) => ({ kmh: 30, menu: null, wallet: 500, trip, quest: { active: null }, radio: { on: true, name: 'Mirchi' }, career: { damage: 0.2 }, fareChoice: null, workshopPhase: 'closed', ...o });

describe('a slice changes only when something its piece shows changed', () => {
  const changed = (pick, a, b, equal = shallowEqual) => {
    const store = createSnapStore(a);
    const r = createViewReader(store, pick, equal);
    const v = r.read();
    store.set(b);
    return r.read() !== v;
  };
  it('the speed ticking does not touch the minimap, the quest log, the radio, the garage, the book or the menus', () => {
    const a = snap();
    const b = reuse(a, snap({ kmh: 31 }));
    for (const [name, pick] of Object.entries({ menu: pickMenu, quest: pickQuest, radio: pickRadio, hisaab: pickHisaab, workshop: pickWorkshop, menus: pickMenus })) {
      expect(changed(pick, a, b), name).toBe(false);
    }
    expect(changed(pickFare, a, b, same)).toBe(false);
  });
  it('a ride that ticks (the trip part is a new object every snapshot) does not re-render the fare question: only its facts count', () => {
    const a = snap();
    const b = snap({ trip: { ...trip, distanceLeft: 2290, timeLeft: 39, terms: { mode: 'meter' }, modifiers: [{ id: 'rain', label: 'Rain', mul: 1.2 }] } });
    expect(changed(pickFare, a, b, same)).toBe(false);
    expect(changed(pickFare, a, snap({ trip: { ...trip, terms: { mode: 'fixed', fixedFare: 180 } } }), same)).toBe(true);
    expect(changed(pickFare, a, snap({ fareChoice: { key: 'k', options: [] } }), same)).toBe(true);
  });
  it('a menu opening reaches the minimap, the quest log, the radio and the menus', () => {
    const a = snap();
    const b = reuse(a, snap({ menu: 'pause' }));
    for (const pick of [pickMenu, pickQuest, pickRadio, pickWorkshop, pickMenus]) expect(changed(pick, a, b)).toBe(true);
  });
  it('the quest log follows the quest part, the radio widget the radio part', () => {
    const a = snap();
    expect(changed(pickQuest, a, reuse(a, snap({ quest: { active: { title: 'Biryani run' } } })))).toBe(true);
    expect(changed(pickRadio, a, reuse(a, snap({ radio: { on: false, name: 'Mirchi' } })))).toBe(true);
  });
  it('the book and the garage only read the career part while they are open', () => {
    const a = snap();
    const worse = reuse(a, snap({ career: { damage: 0.5 } }));
    expect(changed(pickHisaab, a, worse)).toBe(false);
    expect(changed(pickWorkshop, a, worse)).toBe(false);
    const open = snap({ menu: 'workshop', workshopPhase: 'open' });
    expect(changed(pickWorkshop, open, reuse(open, snap({ menu: 'workshop', workshopPhase: 'open', career: { damage: 0.5 } })))).toBe(true);
    const book = snap({ menu: 'hisaab' });
    expect(changed(pickHisaab, book, reuse(book, snap({ menu: 'hisaab', career: { damage: 0.5 } })))).toBe(true);
  });
  it('the wallet reaches the garage (the price tags) but not the minimap', () => {
    const a = snap();
    const b = reuse(a, snap({ wallet: 650 }));
    expect(changed(pickWorkshop, a, b)).toBe(true);
    expect(changed(pickMenu, a, b)).toBe(false);
  });
  it('the menus see the whole snapshot while one is open and nothing otherwise', () => {
    const open = snap({ menu: 'pause' });
    expect(pickMenus(open)).toBe(open);
    expect(pickMenus(snap()).menu).toBeNull();
  });
});

describe('SLICES', () => {
  it('lists every piece AutowalaGame mounts', () => {
    expect(Object.keys(SLICES).sort()).toEqual(['fare', 'hisaab', 'menu', 'menus', 'quest', 'radio', 'workshop']);
  });
  it('every pick survives a snapshot with nothing but the core keys', () => {
    for (const pick of Object.values(SLICES)) expect(() => pick({ kmh: 0 })).not.toThrow();
  });
});
