// Tiffin Centre: the DIFFICULTY CURVE of the twelve shifts, by player skill. The bot of bot.js is the ceiling of a fast human (one action per tick,
// no thinking time); real players are slower, so the curve is also played by a COMPETENT human (1.45x the bot's action time, 8% of free turns lost
// to looking around) and a CASUAL one (1.8x, 15%). Rule of the curve (solo, normal pace, docs/TIFFIN_CENTRE_PLAN.md section 3):
//   - the OFFERED LOAD (dishes asked for per tick of the shift) rises level by level with no cliff (level 7, Chai Time, is a deliberate breather),
//     and never reaches what the bot itself can serve, so every shift can be cleared by a fast player;
//   - a casual player gets through the first shifts, a competent one through most of the middle, and the last ones want a team.
// Before this curve existed level 4 asked for 0.197 dishes a tick (twice level 3) and levels 9 to 12 for 0.23 to 0.27, more than the bot can serve,
// so the solo practice ladder (a star on level n opens n + 1) stopped at level 8 and a casual player could never leave level 4.
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_LEVEL, LEVELS, REQUEST, applyAction, actionCost, buildSchedule, chooseAutoAction, createGame, isOver, levelOps, starTargets,
} from './index.js';

vi.setConfig({ testTimeout: 240000 });

const PROFILES = {
  expert: { slow: 1, skip: 0 },
  competent: { slow: 1.45, skip: 0.08 },
  casual: { slow: 1.8, skip: 0.15 },
};

const mulberry = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** One whole solo shift played at a skill level. Returns the final state. */
function play(level, profile, seed, players = 1, pace = 'normal') {
  const { slow, skip } = PROFILES[profile];
  const r = mulberry(seed * 31 + level);
  const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  let s = createGame({ players: ids.map((id) => ({ id, name: id })), settings: { level, pace }, seed });
  const freeAt = Object.fromEntries(ids.map((id) => [id, 0]));
  let guard = 0;
  while (!isOver(s) && guard++ < 6000) {
    for (const id of ids) {
      if (freeAt[id] > s.tick) continue;
      if (r() < skip) { freeAt[id] = s.tick + 1; continue; }
      const a = chooseAutoAction(s, id);
      if (!a) continue;
      const cost = actionCost(s, id, a);
      const res = applyAction(s, a);
      if (res.error) throw new Error(`bot made an illegal move ${JSON.stringify(a)}: ${res.error}`);
      s = res.state;
      if (cost.to) s = applyAction(s, { type: 'move', playerId: id, to: cost.to }).state;
      freeAt[id] = s.tick + Math.max(1, Math.ceil(cost.ticks * slow));
    }
    const t = applyAction(s, { type: 'tick' });
    if (t.error) break;
    s = t.state;
  }
  return s;
}

/** Dishes asked for per tick of the shift (solo, the whole schedule plus the delivery boy), averaged over seeds. */
function offered(level, seeds = 12) {
  let dishes = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    for (const e of buildSchedule({ level, pace: 'normal', players: 1, seed })) dishes += e.order.length;
    if (levelOps(level).events.includes('delivery')) dishes += REQUEST.delivery.dishes;
  }
  return dishes / seeds / LEVELS[level].shiftTicks;
}

const levels = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

describe('the offered load of the twelve shifts', () => {
  const rate = Object.fromEntries(levels.map((lv) => [lv, offered(lv)]));

  it('rises from shift to shift with no cliff; Chai Time (7) is the only breather', () => {
    for (const lv of levels.slice(1)) {
      const prev = lv === 8 ? rate[6] : rate[lv - 1]; // level 8 follows the breather: it is compared with level 6
      if (lv === 7) expect(rate[7], 'the breather').toBeLessThan(rate[6]);
      else expect(rate[lv], `level ${lv} vs the one before`).toBeGreaterThanOrEqual(prev - 0.004);
      expect(rate[lv] - prev, `no jump into level ${lv}`).toBeLessThan(0.02);
    }
  });

  it('stays below what the fast bot can serve (about 0.2 dishes a tick), so every shift can be cleared solo', () => {
    for (const lv of levels) expect(rate[lv], `level ${lv}`).toBeLessThan(0.15);
    expect(rate[1]).toBeGreaterThan(0.08);
    expect(rate[12]).toBeGreaterThan(rate[1] * 1.25); // the last shift is clearly the hardest
  });

  it('a bigger team is offered proportionally more (the arrival scale), so each cook still has a share of the work', () => {
    for (const lv of [3, 8, 12]) {
      let one = 0;
      let four = 0;
      for (let seed = 1; seed <= 8; seed++) {
        one += buildSchedule({ level: lv, pace: 'normal', players: 1, seed }).length;
        four += buildSchedule({ level: lv, pace: 'normal', players: 4, seed }).length;
      }
      expect(four / one, `level ${lv}`).toBeGreaterThan(2.2);
      expect(four / one, `level ${lv}`).toBeLessThan(3.6);
    }
  });
});

describe('who gets through which shift (solo, normal pace)', () => {
  it('the fast bot clears every one of the twelve shifts with at least one star, and never loses the centre', () => {
    for (const lv of levels) {
      let cleared = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const s = play(lv, 'expert', seed);
        expect(s.status, `level ${lv} seed ${seed}`).toBe('done');
        if (s.stars >= 1) cleared += 1;
      }
      expect(cleared, `level ${lv}: shifts cleared of 5`).toBeGreaterThanOrEqual(4);
    }
  });

  it('a competent human (1.45x slower than the bot) gets through the first six shifts, and loses no heart-breaking share of them', () => {
    for (const lv of [1, 2, 3, 4, 5, 6]) {
      let cleared = 0;
      let closed = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const s = play(lv, 'competent', seed);
        if (s.stars >= 1) cleared += 1;
        if (s.status === 'closed') closed += 1;
      }
      expect(cleared, `level ${lv}: shifts cleared of 5`).toBeGreaterThanOrEqual(3);
      expect(closed, `level ${lv}: centres closed of 5`).toBeLessThanOrEqual(1);
    }
  });

  it('a casual player (1.8x slower, easily distracted) gets through the first three shifts', () => {
    for (const lv of [1, 2, 3]) {
      let cleared = 0;
      for (const seed of [1, 2, 3, 4, 5]) if (play(lv, 'casual', seed).stars >= 1) cleared += 1;
      expect(cleared, `level ${lv}: shifts cleared of 5`).toBeGreaterThanOrEqual(4);
    }
  });

  it('three stars stay rare on the last four shifts for one cook (they are team levels), and common on the first', () => {
    let early = 0;
    let late = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      if (play(1, 'expert', seed).stars === 3) early += 1;
      for (const lv of [9, 10, 11, 12]) if (play(lv, 'expert', seed).stars === 3) late += 1;
    }
    expect(early).toBeGreaterThanOrEqual(3);
    expect(late).toBeLessThanOrEqual(6); // 24 shifts
  });
});

describe('the star targets follow the curve', () => {
  it('rise with the level except the breather, and keep 1 < 2 < 3 stars', () => {
    const t1 = Object.fromEntries(levels.map((lv) => [lv, starTargets(lv, 'normal', 1)]));
    for (const lv of levels) {
      const [a, b, c] = t1[lv];
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(a * 1.4);
      expect(c).toBeGreaterThan(b * 1.25);
    }
    expect(t1[12][0]).toBeGreaterThan(t1[1][0] * 2);
    expect(t1[7][0], 'the breather asks less than the shift before').toBeLessThan(t1[6][0]);
  });

  it('a team is asked for proportionally more and so is a faster pace', () => {
    for (const lv of [2, 7, 12]) {
      const [a1] = starTargets(lv, 'normal', 1);
      const [a2] = starTargets(lv, 'normal', 2);
      const [a4] = starTargets(lv, 'normal', 4);
      expect(a2 / a1).toBeCloseTo(1.65, 1);
      expect(a4 / a1).toBeCloseTo(2.95, 1);
      expect(starTargets(lv, 'rush', 1)[0]).toBeGreaterThan(a1);
      expect(starTargets(lv, 'relaxed', 1)[0]).toBeLessThan(a1);
    }
  });
});
