// The night-market polish of the phone table: caption headline/detail split, tile-face helpers, the in-play callout,
// the level pips, the target micro-bar and the buy card's affordability numbers.
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { buyCardData, calloutFor, faceTones, isLightInk, pipStates, splitCaption, targetProgress } from './phoneModel.js';

describe('splitCaption', () => {
  it('splits the status lines into a headline and a detail', () => {
    expect(splitCaption('Your turn — roll!')).toEqual({ head: 'Your turn', detail: 'Roll!', text: 'Your turn — roll!' });
    expect(splitCaption('Stuck in traffic — your move')).toMatchObject({ head: 'Stuck in traffic', detail: 'Your move' });
    expect(splitCaption('Six! Roll again')).toMatchObject({ head: 'Six!', detail: 'Roll again' });
    expect(splitCaption('Auction — place your bid')).toMatchObject({ head: 'Auction', detail: 'Place your bid' });
  });

  it('keeps who-paid-whom together: the rent is the headline, the receiver the detail', () => {
    expect(splitCaption('Paid ₹34,000 rent to Sana')).toMatchObject({ head: 'Paid ₹34,000 rent', detail: 'To Sana' });
    expect(splitCaption('Ravi paid ₹34,000 rent to Sana')).toMatchObject({ head: 'Ravi paid ₹34,000 rent', detail: 'To Sana' });
    expect(splitCaption('Sana landed on Madhapur')).toMatchObject({ head: 'Sana landed on', detail: 'Madhapur' });
  });

  it('short lines stay one big headline and the full sentence is always kept for screen readers', () => {
    expect(splitCaption('You bought')).toEqual({ head: 'You bought', detail: '', text: 'You bought' });
    expect(splitCaption('Sana is playing…')).toMatchObject({ head: 'Sana is playing…', detail: '' });
    expect(splitCaption('')).toEqual({ head: '', detail: '', text: '' });
    expect(splitCaption(null).text).toBe('');
    for (const t of ['Your turn — roll!', 'Paid ₹5,000 rent to Ravi', 'Six! Roll again']) expect(splitCaption(t).text).toBe(t);
  });
});

describe('isLightInk', () => {
  it('tells light text colours from dark ones', () => {
    expect(isLightInk('#ffffff')).toBe(true);
    expect(isLightInk('#fff')).toBe(true);
    expect(isLightInk('#f5f7f7')).toBe(true);
    expect(isLightInk('#1d2128')).toBe(false);
    expect(isLightInk('#000')).toBe(false);
    expect(isLightInk('red')).toBe(false);
    expect(isLightInk(undefined)).toBe(false);
  });

  it('agrees with the ink every collection face gets', () => {
    for (const g of ['cyber', 'lake']) {
      const t = faceTones(g === 'cyber' ? '#4f7cff' : '#2fb8a6');
      expect(typeof isLightInk(t.ink)).toBe('boolean');
    }
  });
});

describe('pipStates', () => {
  it('one pip per level up to the max, lit up to the current level', () => {
    expect(pipStates(0, 2).map((p) => p.on)).toEqual([false, false]);
    expect(pipStates(1, 2).map((p) => p.on)).toEqual([true, false]);
    expect(pipStates(2, 2).map((p) => p.on)).toEqual([true, true]);
    expect(pipStates(9, 2).map((p) => p.on)).toEqual([true, true]);
    expect(pipStates(-3, 3)).toHaveLength(3);
  });

  it('only the pips that lit since the last render are fresh (the first render pops nothing)', () => {
    expect(pipStates(2, 2).some((p) => p.fresh)).toBe(false);
    expect(pipStates(2, 2, 2).some((p) => p.fresh)).toBe(false);
    expect(pipStates(1, 2, 0).map((p) => p.fresh)).toEqual([true, false]);
    expect(pipStates(2, 2, 0).map((p) => p.fresh)).toEqual([true, true]);
    expect(pipStates(2, 2, 1).map((p) => p.fresh)).toEqual([false, true]);
    expect(pipStates(0, 2, 2).some((p) => p.fresh)).toBe(false); // a sold building lights nothing
  });
});

describe('calloutFor', () => {
  it('quotes the price of a district for sale and the rent of an owned one', () => {
    expect(calloutFor(TILES[29])).toEqual({ name: 'MADHAPUR', amount: '₹3.2L', kind: 'price' });
    expect(calloutFor(TILES[29], { owned: true, rent: 32000 })).toEqual({ name: 'MADHAPUR', amount: '₹32k', kind: 'rent' });
    expect(calloutFor(TILES[29], { owned: true, rent: 32000, mortgaged: true })).toMatchObject({ amount: 'Mortgaged', kind: 'mortgaged' });
  });

  it('a stop quotes its fare, corners and cards just their name', () => {
    const stop = TILES.find((t) => t.type === 'transport');
    expect(calloutFor(stop).kind).toBe('fare');
    const card = TILES.find((t) => t.type === 'card');
    expect(calloutFor(card)).toMatchObject({ amount: '', kind: '' });
    expect(calloutFor(TILES[0]).name).toBe('START');
    expect(calloutFor(null)).toBeNull();
  });
});

describe('targetProgress', () => {
  const players = [{ id: 'me', name: 'Nithin' }, { id: 'rav', name: 'Ravi' }, { id: 'sana', name: 'Sana' }];
  it('my share of the target, the best rival and the hot flag', () => {
    const g = targetProgress({ worths: { me: 1000000, rav: 2000000, sana: 500000 }, me: 'me', target: 5000000, players });
    expect(g.mine).toBeCloseTo(0.2);
    expect(g.rival).toBeCloseTo(0.4);
    expect(g.pct).toBe(20);
    expect(g.hot).toBe(false);
    expect(g.sr).toBe('You are at 20% of the target; Ravi is ahead at 40%');
  });

  it('goes hot when anybody is within a fifth of the target; out-of-game rivals do not count', () => {
    expect(targetProgress({ worths: { me: 4200000, rav: 100 }, me: 'me', target: 5000000, players }).hot).toBe(true);
    const hotRival = targetProgress({ worths: { me: 1, rav: 4500000 }, me: 'me', target: 5000000, players });
    expect(hotRival.hot).toBe(true);
    const out = targetProgress({ worths: { me: 1, rav: 4500000 }, me: 'me', target: 5000000, players: [{ id: 'me' }, { id: 'rav', bankrupt: true }] });
    expect(out.rival).toBe(0);
    expect(out.hot).toBe(false);
  });

  it('clamps at 100% and says nothing without a target or without me', () => {
    expect(targetProgress({ worths: { me: 9000000 }, me: 'me', target: 5000000, players }).mine).toBe(1);
    expect(targetProgress({ worths: { me: 1 }, me: 'me', target: null, players })).toBeNull();
    expect(targetProgress({ worths: { rav: 1 }, me: 'me', target: 5000000, players })).toBeNull();
    expect(targetProgress({ worths: null, me: 'me', target: 5000000, players })).toBeNull();
  });
});

describe('buyCardData affordability', () => {
  it('carries the cash and what is left after buying', () => {
    expect(buyCardData(TILES[29], { cash: 1115000, price: 320000 })).toMatchObject({ cash: 1115000, left: 795000, canBuy: true });
    expect(buyCardData(TILES[29], { cash: 20000 })).toMatchObject({ cash: 20000, left: 0, canBuy: false, short: 300000 });
  });
});
