// The single die on the Hustle board: fair vs lucky weights, the disclosed rules, sampling and landing odds.
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, diceCtx, diceWeights, diceOdds, landingOdds, rollDice, sampleCombo, rawMultipliers,
  DICE_RULES, FACES, BOARD_SIZE, TRAFFIC_TILE,
} from './index.js';

const game = (settings = {}, seed = 1) =>
  createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], settings, seed });
const sum = (xs) => xs.reduce((x, y) => x + y, 0);
const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('fair dice', () => {
  it('every face has 1/6 and no assist', () => {
    const s = game({ dice: 'fair' });
    const w = diceWeights(s, 'a', diceCtx);
    expect(w.weights).toHaveLength(6);
    for (const x of w.weights) close(x, 1 / 6);
    expect(w.assist).toBeNull();
    expect(w.shift).toBe(0);
  });

  it('a fair die is roughly uniform over many seeded rolls', () => {
    const s = game({ dice: 'fair' }, 99);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[rollDice(s, 'a', diceCtx).values[0] - 1]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });
});

describe('lucky dice', () => {
  it('a fresh game is fair (no rule applies yet)', () => {
    const w = diceWeights(game(), 'a', diceCtx);
    for (const x of w.weights) close(x, 1 / 6);
    expect(w.assist).toBeNull();
  });

  it('pity six: after 6 non-sixes a six gets x1.5 (before normalising)', () => {
    const s = game();
    s.players[0].rollsSinceSix = DICE_RULES.pity.rolls;
    const { raw } = rawMultipliers(s, 'a', diceCtx);
    expect(raw[5]).toBe(1.5);
    const w = diceWeights(s, 'a', diceCtx);
    expect(w.weights[5]).toBeGreaterThan(1 / 6);
    expect(w.assist).toBe('pity');
  });

  it('anti-streak: after 2 sixes in a turn a six is less likely (clamped at 0.6)', () => {
    const s = game();
    s.players[0].sixes = 2;
    const { clamped } = rawMultipliers(s, 'a', diceCtx);
    expect(clamped[5]).toBe(DICE_RULES.clamp[0]);
    expect(diceWeights(s, 'a', diceCtx).assist).toBe('antibust');
  });

  it('comeback: a player far behind gets more weight on useful landings', () => {
    const s = game();
    s.players[0].cash = 200000; // a is far behind b and c (15 lakh each)
    s.players[0].pos = 0; // faces 1, 3, 4 reach unowned districts
    const w = diceWeights(s, 'a', diceCtx);
    expect(w.assist).toBe('comeback');
    expect(w.weights[0]).toBeGreaterThan(w.weights[1]); // 1 -> Sultan Bazaar (good) vs 2 -> Nawabi Luck (other)
  });

  it('mercy: after two rent-paying turns, landings on big opponent rents are less likely', () => {
    const s = game();
    s.owners[3] = 'b';
    s.levels[3] = 2; // Monda Market Trading Hub: 25,000 rent >= mercy.minRent
    s.players[0].rentStreak = DICE_RULES.mercy.streak;
    const { rules } = rawMultipliers(s, 'a', diceCtx);
    expect(rules.mercy[2]).toBe(DICE_RULES.mercy.mult); // face 3 -> tile 3
    expect(rules.mercy[0]).toBe(1);
  });

  it('every face stays within the disclosed clamp', () => {
    const s = game();
    s.players[0].rollsSinceSix = 9;
    s.players[0].cash = 1000;
    s.players[0].rentStreak = 5;
    for (let t = 1; t <= 6; t++) s.owners[t] = 'b';
    const { clamped } = rawMultipliers(s, 'a', diceCtx);
    for (const m of clamped) expect(m >= DICE_RULES.clamp[0] && m <= DICE_RULES.clamp[1]).toBe(true);
  });
});

describe('sampling, odds and the engine roll', () => {
  it('sampleCombo picks by cumulative weight and never a zero face', () => {
    const w = [0, 0.5, 0, 0.5, 0, 0];
    expect(sampleCombo(w, 0)).toBe(1);
    expect(sampleCombo(w, 0.49)).toBe(1);
    expect(sampleCombo(w, 0.51)).toBe(3);
    expect(sampleCombo(w, 0.9999999)).toBe(3);
    expect(sampleCombo(w, 1)).toBe(3);
  });

  it('diceOdds and landingOdds sum to 1 and wrap around START', () => {
    const s = game();
    s.players[0].pos = 33;
    const odds = diceOdds(s, 'a', diceCtx);
    close(sum(Object.values(odds.totals)), 1);
    const land = landingOdds(s, 'a', diceCtx);
    expect(land).toHaveLength(BOARD_SIZE);
    close(sum(land), 1);
    expect(land[34]).toBeGreaterThan(0);
    expect(land[3]).toBeGreaterThan(0); // 33 + 6 = 39 -> tile 3
    expect(land[33]).toBe(0);
  });

  it('a player stuck in traffic stays put', () => {
    const s = game();
    s.players[0].pos = TRAFFIC_TILE;
    s.players[0].stuck = true;
    const land = landingOdds(s, 'a', diceCtx);
    expect(land[TRAFFIC_TILE]).toBe(1);
    expect(sum(land)).toBe(1);
  });

  it('the engine draws one die from the seeded rng (same seed, same roll)', () => {
    const a = applyAction(game({}, 5), { type: 'ROLL', playerId: 'a' });
    const b = applyAction(game({}, 5), { type: 'ROLL', playerId: 'a' });
    expect(a.events[0]).toEqual(b.events[0]);
    expect(a.events[0].type).toBe('dice');
    expect(a.events[0].values).toHaveLength(1);
    expect(FACES.map((f) => f[0])).toContain(a.events[0].values[0]);
  });
});
