// The menus and the operations layer: stars are profit, the galla books, what each shift brings, what a briefing teaches.
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createGame, applyAction, result } from '@shared/tiffin-centre/index.js';
import { LEVELS, LEVEL_OPS, MAX_LEVEL } from '@shared/tiffin-centre/catalog.js';
import { SoloHome, Results, LevelBriefing } from './index.js';
import { briefingModel, levelCardModel, levelFeatures, levelHighlights, levelMapModel, mechanicsIntroduced, resultViewModel, starThresholds } from './menuModels.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const standing = (id, score, extra = {}) => ({ id, rank: 1, score, stats: { served: 5, tips: 10, ...extra } });

describe('results: stars compare PROFIT, not money', () => {
  const [t1, t2] = LEVELS[3].stars;
  const base = { reason: 'cleared', level: 3, standings: [standing('a', t2 + 100)] };

  it('cash above a target but profit below it does not earn the star', () => {
    // cash is above the 2-star target, but the stall spent 200 to get it: profit is below
    const vm = resultViewModel({ ...base, money: t2 + 100, cost: 200, profit: t2 - 100, stars: undefined }, 3, 'normal');
    expect(vm.money).toBe(t2 + 100);
    expect(vm.profit).toBe(t2 - 100);
    expect(vm.stars).toBe(1);
    expect(vm.bar.marks.map((m) => m.reached)).toEqual([true, false, false]);
    expect(vm.nextStar).toEqual({ star: 2, target: t2, need: 100 });
  });

  it('profit comes from result.profit, else cost, else cash (an older result)', () => {
    expect(resultViewModel({ ...base, money: 900, cost: 100 }, 3, 'normal').profit).toBe(800);
    expect(resultViewModel({ ...base, money: 900 }, 3, 'normal').profit).toBe(900);
    expect(resultViewModel({ ...base, money: 900, profit: 650, stats: { cost: 250 } }, 3, 'normal').profit).toBe(650);
    expect(resultViewModel({ ...base, money: t1 + 5 }, 3, 'normal').stars).toBe(1);
  });

  it('a loss is shown as a negative profit and closes the day', () => {
    const vm = resultViewModel({ reason: 'closed', level: 3, money: 120, cost: 300, standings: [standing('a', 120)] }, 3, 'normal');
    expect(vm).toMatchObject({ profit: -180, kind: 'closed', stars: 0 });
    expect(vm.bar.fill).toBe(0);
    expect(vm.thresholds).toEqual(starThresholds(3, 'normal', 1));
  });

  it('the books and the work behind the cooking come from the engine result (team and stats shape)', () => {
    let s = createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level: 5 }, seed: 3 });
    for (const a of [{ type: 'prep', station: 'prep1', slot: 0, item: 'oil' }, { type: 'buy', item: 'oil', n: 2 }, { type: 'swapGas' }]) {
      const r = applyAction(s, { playerId: 'me', ...a });
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    const res = result(s);
    const vm = resultViewModel(res, 5, 'normal', { players: [{ id: 'me', name: 'Me' }] });
    expect(vm.books.show).toBe(true);
    expect(vm.books).toMatchObject({ cost: res.cost, waste: res.waste, fines: res.fines, profit: res.profit, revenue: res.revenue, tips: res.tips });
    expect(vm.cost).toBe(res.cost);
    expect(vm.ops).toMatchObject({ show: true, prepped: 1, tended: 0, gasSwaps: 1, bought: 1 });
    expect(vm.profit).toBe(res.profit);
    expect(vm.stats).toHaveProperty('bestCombo'); // the old chit rows are still there
  });

  it('the tutorial and a bare result show neither books nor work', () => {
    const t = resultViewModel({ reason: 'tutorial', level: 0, money: 100, standings: [standing('a', 100)] }, 0, 'normal');
    expect(t.books.show).toBe(false);
    expect(t.ops.show).toBe(false);
    const bare = resultViewModel({ reason: 'cleared', stars: 1, money: 400, standings: [] }, 1, 'normal');
    expect(bare.books.show).toBe(false);
    expect(bare.ops.show).toBe(false);
  });
});

describe('results screen', () => {
  const full = {
    reason: 'cleared', stars: 2, level: 5, money: 1400, revenue: 1250, tips: 150, cost: 330, waste: 40, fines: 68, carry: 20, profit: 1070, served: 40, lost: 1, unpaid: 2, bestCombo: 6,
    winnerId: 'a', standings: [standing('a', 1400)], stats: { tips: 150, served: 40, lost: 1, unpaid: 2, combo: 6, prepped: 5, tended: 7, gasSwaps: 1, bought: 3 },
  };
  const s = html(h(Results, { result: full, level: 5, pace: 'normal', mode: 'practice', onRetry: noop, onNext: noop, onExit: noop, players: [{ id: 'a', name: 'Asha' }] }));
  it('shows revenue, tips, cost, waste, fines and profit in the galla, with the tape about profit', () => {
    expect(s).toContain('Money earned: ₹1,400');
    expect(s).toContain('Profit: ₹1,070');
    for (const w of ['Takings', 'Tips', 'Cost', 'Wasted', 'Fines', 'Profit', '₹1,250', '₹150', '₹330', '₹40', '₹68', '₹1,070']) expect(s).toContain(w);
    expect(s).toContain('₹1,070 profit. Star targets');
    expect(s).toMatch(/₹80 more profit for star 2/);
  });
  it('the chit has served, lost, unpaid, best combo and the stall work: prepped, tended, gas swaps, market buys', () => {
    for (const w of ['Plates served', 'Customers lost', 'Walked away unpaid', 'Best combo', 'Batches prepped', 'Pans tended', 'Gas swaps', 'Market buys']) expect(s).toContain(w);
    expect(s).toContain('x6');
    expect((s.match(/Tips/g) || []).length).toBe(1); // not twice: the books carry it
  });
  it('an older result with no books keeps the old chit', () => {
    const o = html(h(Results, { result: { reason: 'cleared', stars: 2, money: 350, level: 1, standings: [standing('a', 350)], stats: { tips: 33, served: 20 } }, level: 1, pace: 'normal', mode: 'practice', onRetry: noop }));
    expect(o).toContain('Tips');
    expect(o).not.toContain('The books');
    expect(o).not.toContain('Batches prepped');
  });
});

describe('what each shift brings (level cards)', () => {
  it('lists gas and the events from LEVEL_OPS, loud ones first, then the stock note', () => {
    expect(levelFeatures(1).map((f) => f.id)).toEqual(['stock']);
    expect(levelFeatures(3).map((f) => f.id)).toEqual(['gas', 'rain', 'stock', 'heat', 'requests']);
    expect(levelFeatures(5).filter((f) => f.kind !== 'feature').map((f) => f.id)).toEqual(['gas', 'power', 'inspector']);
    expect(levelFeatures(12).filter((f) => f.kind === 'event')).toHaveLength(6);
    expect(levelFeatures(0)).toEqual([]);
    for (let n = 1; n <= MAX_LEVEL; n += 1) {
      const ev = LEVEL_OPS[n].events;
      expect(levelFeatures(n).filter((f) => f.kind === 'event').map((f) => f.id)).toEqual(ev);
      expect(levelFeatures(n).some((f) => f.id === 'gas')).toBe(LEVEL_OPS[n].gas > 0);
    }
  });
  it('highlights: at most four chips, the rest counted; a quiet level shows its stock note', () => {
    expect(levelHighlights(1)).toMatchObject({ chips: [{ id: 'stock' }], more: 0 });
    const h12 = levelHighlights(12);
    expect(h12.chips).toHaveLength(4);
    expect(h12.chips[0].id).toBe('gas');
    expect(h12.more).toBeGreaterThan(0);
    expect(h12.line).toMatch(/Rain/);
    expect(levelHighlights(3).line).toBe('LPG gas, Rain, Stock and prep, Pan care, Special requests');
  });
  it('the card model carries them and the map keeps its shape', () => {
    expect(levelCardModel(5).highlights.chips.map((c) => c.label)).toEqual(['LPG gas', 'Power cut', 'Inspector']);
    expect(levelMapModel({}).flatMap((g) => g.cards).every((c) => Array.isArray(c.features))).toBe(true);
  });
  it('renders the chips on the home screen with the full list for screen readers', () => {
    const s = html(h(SoloHome, { progress: null, tutorialDone: true, unlockedLevel: 12, onStartTutorial: noop, onStartLevel: noop, onInvite: noop, onBack: noop }));
    expect(s).toContain('LPG gas');
    expect(s).toContain('Power cut');
    expect(s).toContain('Inspector');
    expect(s).toContain('Rain');
    expect(s).toContain('Expect: LPG gas, Rain, Stock and prep, Pan care, Special requests'); // level 3
    expect((s.match(/class="tc-menu-lvl /g) || []).length).toBe(12);
  });
});

describe('what a briefing teaches (the mechanics a shift introduces)', () => {
  it('a mechanic is listed once, on the shift where it first appears', () => {
    expect(mechanicsIntroduced(0)).toEqual([]);
    expect(mechanicsIntroduced(1).map((m) => m.id)).toEqual(['stock']);
    expect(mechanicsIntroduced(2).map((m) => m.id)).toEqual(['heat', 'requests']);
    expect(mechanicsIntroduced(3).map((m) => m.id)).toEqual(['gas', 'rain']);
    expect(mechanicsIntroduced(4).map((m) => m.id)).toEqual(['regulars', 'delivery']);
    expect(mechanicsIntroduced(5).map((m) => m.id)).toEqual(['market', 'power', 'inspector']);
    expect(mechanicsIntroduced(6).map((m) => m.id)).toEqual(['big']);
    expect(mechanicsIntroduced(7)).toEqual([]); // rain came back, but it is not new
    expect(mechanicsIntroduced(9).map((m) => m.id)).toEqual(['festival']);
    expect(mechanicsIntroduced(10).map((m) => m.id)).toEqual(['cricket']);
    const all = Array.from({ length: MAX_LEVEL }, (_, i) => mechanicsIntroduced(i + 1).map((m) => m.id)).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(13);
  });
  it('the briefing model carries them with the texts, and what to expect', () => {
    const b = briefingModel(3, 'normal');
    expect(b.mechanics.map((m) => m.title)).toEqual(['LPG cylinder', 'Rain']);
    expect(b.mechanics[0].text).toMatch(/₹90/);
    expect(b.features.map((f) => f.id)).toContain('gas');
    expect(briefingModel(7).mechanics).toEqual([]);
    expect(briefingModel(0).mechanics).toEqual([]);
  });
  it('the card shows them and waits for "Open the stall" instead of closing after two seconds', () => {
    const s = html(h(LevelBriefing, { level: 5, pace: 'normal', onGo: noop }));
    expect(s).toContain('New at the stall today');
    for (const w of ['Market runner', 'Power cut', 'Food-safety inspector', 'LPG gas', 'Expect']) expect(s).toContain(w);
    expect(s).not.toContain('tc-menu-brief__timer');
    const q = html(h(LevelBriefing, { level: 7, pace: 'normal', onGo: noop }));
    expect(q).not.toContain('New at the stall today');
    expect(q).toContain('tc-menu-brief__timer'); // nothing new: the quick card
  });
});
