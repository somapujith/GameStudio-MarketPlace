import { describe, it, expect } from 'vitest';
import { LEVELS, MAX_LEVEL, PACE, coopScale } from '@shared/tiffin-centre/catalog.js';
import {
  hourRange, shiftLength, levelSky, unlockedLevelOf, starsOfLevel, levelCardModel, levelMapModel, starThresholds, resultViewModel,
  briefingModel, coachViewModel, statusCopy, STATUS_KINDS, DEFAULT_HINT_MS, tipOfLevel, totalStars,
} from './menuModels.js';

describe('hourRange', () => {
  it('formats the shifts', () => {
    expect(hourRange([6, 9])).toBe('6:00-9:00 AM');
    expect(hourRange([12, 14])).toBe('12:00-2:00 PM');
    expect(hourRange([11, 13.5])).toBe('11:00 AM-1:30 PM');
    expect(hourRange([22, 24])).toBe('10:00 PM-12:00 AM');
    expect(hourRange([6, 24])).toBe('6:00 AM-12:00 AM');
    expect(hourRange([9, 9.5])).toBe('9:00-9:30 AM');
  });
  it('shift length is m:ss', () => {
    expect(shiftLength(150)).toBe('2:30');
    expect(shiftLength(600)).toBe('10:00');
  });
});

describe('level map', () => {
  it('groups the 12 levels by day-part with Festival last', () => {
    const groups = levelMapModel({});
    expect(groups.map((g) => g.id)).toEqual(['morning', 'noon', 'evening', 'night', 'festival']);
    expect(groups.flatMap((g) => g.cards.map((c) => c.level))).toEqual(Array.from({ length: MAX_LEVEL }, (_, i) => i + 1));
    expect(groups.map((g) => g.cards.length)).toEqual([4, 2, 3, 2, 1]);
    expect(levelSky(12)).toBe('festival');
    expect(levelSky(1)).toBe('morning');
    expect(levelSky(9)).toBe('evening');
  });
  it('level n+1 opens after one star on n; level 1 is always open', () => {
    expect(unlockedLevelOf(null)).toBe(1);
    expect(unlockedLevelOf({ best: { 1: { stars: 0 } } })).toBe(1);
    expect(unlockedLevelOf({ best: { 1: { stars: 1 }, 2: { stars: 3 } } })).toBe(3);
    expect(unlockedLevelOf({ best: { 1: { stars: 1 }, 3: { stars: 3 } } })).toBe(2); // gaps do not count
    expect(unlockedLevelOf({ best: {}, unlocked: 5 })).toBe(5);
    expect(unlockedLevelOf({ best: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { stars: 3 }])) })).toBe(MAX_LEVEL);
  });
  it('cards carry stars, lock state and the current level', () => {
    const progress = { best: { 1: { stars: 2, earned: 410 }, 2: { stars: 0 } } };
    const g = levelMapModel({ progress });
    const [c1, c2, c3] = g[0].cards;
    expect(c1).toMatchObject({ level: 1, stars: 2, best: 410, locked: false, current: false, hours: '6:00-9:00 AM', menuCount: 3 });
    expect(c2).toMatchObject({ level: 2, locked: false, current: true, stars: 0 });
    expect(c3.locked).toBe(true);
    expect(c3.lockNote).toMatch(/level 2/);
    expect(c3.label).toMatch(/locked/);
    expect(starsOfLevel({ best: { 1: { stars: 9 } } }, 1)).toBe(3);
    expect(totalStars(progress)).toBe(2);
  });
  it('an explicit unlockedLevel overrides progress', () => {
    expect(levelCardModel(5, { unlockedLevel: 5 }).locked).toBe(false);
    expect(levelCardModel(6, { unlockedLevel: 5 }).locked).toBe(true);
    expect(levelCardModel(1, { unlockedLevel: 0 }).locked).toBe(false);
  });
});

describe('starThresholds', () => {
  it('scales by pace and by table size', () => {
    const base = LEVELS[1].stars;
    const scaled = (k) => base.map((v) => Math.ceil(Number((v * k).toFixed(6))));
    expect(starThresholds(1, 'normal', 1)).toEqual(base);
    expect(starThresholds(1, 'relaxed', 1)).toEqual(scaled(PACE.relaxed.stars));
    expect(starThresholds(1, 'rush', 1)).toEqual(scaled(PACE.rush.stars));
    expect(starThresholds(1, 'rush', 1)[0]).toBeGreaterThan(base[0]);
    expect(starThresholds(1, 'relaxed', 1)[0]).toBeLessThan(base[0]);
    const k = PACE.rush.stars * coopScale(3);
    expect(starThresholds(2, 'rush', 3)).toEqual(LEVELS[2].stars.map((v) => Math.ceil(Number((v * k).toFixed(6)))));
    expect(starThresholds(1, 'normal', 2)[0]).toBe(Math.ceil(Number((LEVELS[1].stars[0] * 1.65).toFixed(6))));
  });
  it('unknown pace falls back to normal', () => {
    expect(starThresholds(1, 'warp', 1)).toEqual(LEVELS[1].stars);
  });
});

const standing = (id, score, extra = {}) => ({ id, rank: 1, score, stats: { served: 5, tips: 10, ...extra } });

describe('resultViewModel', () => {
  it('a cleared solo shift', () => {
    const [t1, t2, t3] = LEVELS[1].stars;
    const money = t2 + 10;
    const vm = resultViewModel({ reason: 'cleared', stars: 2, money, level: 1, winnerId: 'a', standings: [standing('a', money)], stats: { tips: 40, served: 22, lost: 1, unpaid: 2, combo: 6 } }, 1, 'normal', { mode: 'practice' });
    expect(vm).toMatchObject({ kind: 'cleared', stars: 2, money, thresholds: [t1, t2, t3], headline: 'Great shift!', coop: false, nextLevel: 2, nextLevelName: LEVELS[2].name });
    expect(vm.stats).toEqual({ tips: 40, served: 22, lost: 1, unpaid: 2, bestCombo: 6 });
    expect(vm.nextStar).toEqual({ star: 3, target: t3, need: t3 - money });
    expect(vm.bar.marks.map((m) => m.reached)).toEqual([true, true, false]);
    expect(vm.mvp).toBe(null);
  });
  it('a failed shift is "Closed for the day" with no next level', () => {
    const vm = resultViewModel({ reason: 'closed', stars: 0, money: 80, level: 3, winnerId: null, standings: [standing('a', 80)] }, 3, 'rush');
    expect(vm).toMatchObject({ kind: 'closed', stars: 0, headline: 'Closed for the day', nextLevel: null });
    expect(vm.nextStar.star).toBe(1);
  });
  it('thresholds use the pace and the number of players', () => {
    const vm = resultViewModel({ reason: 'cleared', stars: 1, money: 900, standings: [standing('a', 500), standing('b', 400)] }, 1, 'normal');
    expect(vm.thresholds).toEqual(starThresholds(1, 'normal', 2));
    expect(vm.paceLabel).toBe('Normal');
  });
  it('co-op: sorted contributions, names from players, MVP is the winner', () => {
    const vm = resultViewModel(
      { reason: 'cleared', stars: 3, money: 1000, winnerId: 'b', standings: [standing('a', 300), standing('b', 700, { served: 12 })] },
      2,
      'normal',
      { players: [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bilal' }], mode: 'online' },
    );
    expect(vm.coop).toBe(true);
    expect(vm.rows.map((r) => r.name)).toEqual(['Bilal', 'Asha']);
    expect(vm.rows[0]).toMatchObject({ collected: 700, mvp: true, share: 1, pct: 70, served: 12 });
    expect(vm.rows[1]).toMatchObject({ mvp: false });
    expect(vm.rows[1].share).toBeCloseTo(300 / 700);
    expect(vm.mvp.id).toBe('b');
    expect(vm.stats.served).toBe(17); // summed from the standings when the team block is missing
  });
  it('no MVP on a failed co-op shift', () => {
    const vm = resultViewModel({ reason: 'closed', stars: 0, money: 50, winnerId: null, standings: [standing('a', 30), standing('b', 20)] }, 4, 'normal');
    expect(vm.mvp).toBe(null);
  });
  it('the tutorial is its own kind and unlocks co-op', () => {
    const vm = resultViewModel({ reason: 'tutorial', stars: 0, money: 120, level: 0, standings: [standing('a', 120)] }, 0, 'normal');
    expect(vm).toMatchObject({ kind: 'tutorial', headline: 'Tutorial complete!', unlockedCoop: true, hasBar: false, nextLevel: 1 });
    expect(vm.sub).toMatch(/Co-op with friends unlocked/);
  });
  it('survives an empty or missing result', () => {
    const vm = resultViewModel(null, 1, 'normal');
    expect(vm.money).toBe(0);
    expect(vm.kind).toBe('closed');
    expect(vm.rows).toEqual([]);
    expect(() => resultViewModel(undefined, undefined, undefined)).not.toThrow();
  });
  it('derives stars from money when the engine omits them', () => {
    expect(resultViewModel({ reason: 'cleared', money: LEVELS[1].stars[1], standings: [] }, 1, 'normal').stars).toBe(2);
  });
});

describe('briefingModel', () => {
  it('flags dishes and stations that are new compared with the previous level', () => {
    const b = briefingModel(2, 'normal');
    expect(b.menu.filter((m) => m.isNew).map((m) => m.id)).toEqual(['idly']);
    expect(b.stations.filter((s) => s.isNew).map((s) => s.id)).toEqual(['steamer1']);
    expect(b.hours).toBe('6:00-9:30 AM');
    expect(b.name).toBe(LEVELS[2].name);
    expect(b.newDishes).toBe(1);
  });
  it('level 5 adds a second tawa and two dishes', () => {
    const b = briefingModel(5, 'rush');
    expect(b.menu.filter((m) => m.isNew).map((m) => m.id).sort()).toEqual(['pesarattu', 'set_dosa']);
    expect(b.stations.find((s) => s.id === 'tawa2')).toMatchObject({ isNew: true, name: 'Second dosa tawa' });
    expect(b.paceLabel).toBe('Rush hour');
  });
  it('level 1 has nothing new, every level has a tip, the festival has the full menu', () => {
    expect(briefingModel(1).newDishes).toBe(0);
    for (let n = 0; n <= MAX_LEVEL; n += 1) expect(tipOfLevel(n).length).toBeGreaterThan(10);
    expect(briefingModel(12).menu).toHaveLength(13);
    expect(briefingModel(12).sky).toBe('festival');
  });
});

describe('coachViewModel', () => {
  it('builds dots, position and hint timing', () => {
    const vm = coachViewModel({ id: 's2', text: 'Tap the tawa', te: 'పెనం', hint: 'It is on the left' }, 1, 4);
    expect(vm.dots).toEqual(['done', 'active', 'todo', 'todo']);
    expect(vm).toMatchObject({ position: 'Step 2 of 4', hint: 'It is on the left', hintMs: DEFAULT_HINT_MS, last: false });
    expect(coachViewModel({ text: 'x', hint: { text: 'h', ms: 4000 } }, 3, 4)).toMatchObject({ hintMs: 4000, last: true, hint: 'h' });
    expect(coachViewModel({ text: 'x', hintMs: 100 }, 0, 1).hintMs).toBe(1500);
  });
  it('clamps a bad index and tolerates no step', () => {
    expect(coachViewModel(null, 9, 3).position).toBe('Step 3 of 3');
    expect(coachViewModel(undefined).dots).toEqual(['active']);
  });
});

describe('statusCopy', () => {
  it('has friendly copy for each kind and falls back to error', () => {
    expect(STATUS_KINDS).toEqual(['loading', 'error', 'disconnected', 'lost', 'webgl']);
    expect(statusCopy('lost').body).toMatch(/comes back by itself/);
    expect(statusCopy('lost').retry).toBe('Try again');
    expect(statusCopy('loading').title).toMatch(/Lighting the stove/);
    expect(statusCopy('webgl').body).toMatch(/WebGL/);
    expect(statusCopy('disconnected').retry).toBe('Reconnect');
    expect(statusCopy('??')).toBe(statusCopy('error'));
  });
});
