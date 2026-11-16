// Pure helpers behind the power-card surfaces: public count, armed chips with rounds left, copy.
import { describe, expect, it } from 'vitest';
import {
  ARMED, GUIDE_RULES, SHEET_NOTE_ME, armedChips, goneChips, handCount, powerOf, powerOn, powerWords, roundsLeft, roundsText, sheetNote, stackLabel,
} from './powerView.js';

describe('handCount', () => {
  it('is the length of the masked hand of another player', () => {
    expect(handCount([{ hidden: true }, { hidden: true }])).toBe(2);
    expect(handCount([{ hidden: true }])).toBe(1);
  });
  it('is the length of your own real hand', () => {
    expect(handCount([{ uid: 'a', id: 'shield', exp: 5 }])).toBe(1);
  });
  it('is 0 for a missing or odd hand (stored games, old servers)', () => {
    for (const h of [undefined, null, [], 'x', 3, {}]) expect(handCount(h)).toBe(0);
  });
});

describe('roundsLeft', () => {
  it('counts the round it is in: until - round + 1', () => {
    expect(roundsLeft(5, 3)).toBe(3);
    expect(roundsLeft(5, 5)).toBe(1);
  });
  it('is never negative and 0 means none', () => {
    expect(roundsLeft(5, 9)).toBe(0);
    expect(roundsLeft(0, 3)).toBe(0);
    expect(roundsLeft(undefined, 3)).toBe(0);
    expect(roundsLeft(-2, 3)).toBe(0);
    expect(roundsLeft(NaN, 3)).toBe(0);
  });
  it('treats an unknown round as round 1', () => {
    expect(roundsLeft(3, undefined)).toBe(3);
  });
});

describe('armedChips', () => {
  it('lists Shield before Double rent, with the rounds left', () => {
    const c = armedChips({ shield: 6, doubleRent: 4 }, 4);
    expect(c.map((x) => x.id)).toEqual(['shield', 'double']);
    expect(c.map((x) => x.rounds)).toEqual([3, 1]);
    expect(c[0]).toMatchObject({ label: 'Shield', text: '3 rounds left', title: 'Shield armed, 3 rounds left' });
    expect(c[1]).toMatchObject({ label: 'Double rent', text: 'last round' });
  });
  it('drops an effect that has lapsed or was never armed', () => {
    expect(armedChips({ shield: 2, doubleRent: 0 }, 3)).toEqual([]);
    expect(armedChips({}, 3)).toEqual([]);
    expect(armedChips(null, 3)).toEqual([]);
    expect(armedChips({ shield: 3 }, 3).map((x) => x.id)).toEqual(['shield']);
  });
  it('has exactly the two public effects', () => {
    expect(ARMED.map((a) => a.field)).toEqual(['shield', 'doubleRent']);
  });
});

describe('goneChips', () => {
  it('finds the chips that vanished between two renders', () => {
    const a = armedChips({ shield: 5, doubleRent: 5 }, 3);
    const b = armedChips({ shield: 5, doubleRent: 0 }, 3);
    expect(goneChips(a, b).map((c) => c.id)).toEqual(['double']);
    expect(goneChips(b, a)).toEqual([]);
    expect(goneChips(a, a)).toEqual([]);
    expect(goneChips(undefined, a)).toEqual([]);
  });
});

describe('copy', () => {
  it('stack label', () => {
    expect(stackLabel('Ravi', 2)).toBe('Ravi holds 2 power cards');
    expect(stackLabel('Ravi', 1)).toBe('Ravi holds 1 power card');
    expect(stackLabel('Asha', 2, true)).toBe('You hold 2 power cards');
    expect(stackLabel(undefined, 0)).toBe('A player holds 0 power cards');
  });
  it('rounds text', () => {
    expect(roundsText(1)).toBe('last round');
    expect(roundsText(3)).toBe('3 rounds left');
  });
  it('sheet note says the count is public and the identity is not', () => {
    expect(SHEET_NOTE_ME).toBe('Others can see how many cards you hold, not which.');
    expect(sheetNote('Ravi', false)).toBe('You can see how many cards Ravi holds, not which.');
    expect(sheetNote('Asha', true)).toBe(SHEET_NOTE_ME);
  });
  it('guide rules carry every rule of the spec', () => {
    const t = GUIDE_RULES.join(' ');
    for (const s of ['one card per turn', '2 cards at most', '3 rounds', 'not which', 'shield beats double rent', 'before you roll']) expect(t.toLowerCase(), s).toContain(s);
  });
});

describe('powerOf', () => {
  const players = [
    { id: 'me', name: 'Asha', hand: [{ uid: 'u1', id: 'shield', exp: 6 }], shield: 5, doubleRent: 0 },
    { id: 'r', name: 'Ravi', hand: [{ hidden: true }, { hidden: true }], shield: 0, doubleRent: 4 },
    { id: 'out', name: 'Gone', bankrupt: true, hand: [{ hidden: true }] },
  ];
  const sess = (cfg = { powerCards: true }, extra = {}) => ({ me: 'me', view: { cfg, round: 3, players }, display: null, ...extra });

  it('is null when the rule is off or missing (nothing renders)', () => {
    expect(powerOf(sess({ powerCards: false }), players[1])).toBeNull();
    expect(powerOf(sess({}), players[1])).toBeNull();
    expect(powerOf({ me: 'me', view: {} }, players[1])).toBeNull();
    expect(powerOn(undefined)).toBe(false);
  });
  it('is null for a player who is out or a missing player', () => {
    expect(powerOf(sess(), players[2])).toBeNull();
    expect(powerOf(sess(), null)).toBeNull();
  });
  it('reads count and chips for a rival and for you', () => {
    const r = powerOf(sess(), players[1]);
    expect(r).toMatchObject({ count: 2, isMe: false, name: 'Ravi' });
    expect(r.chips.map((c) => [c.id, c.rounds])).toEqual([['double', 2]]);
    const me = powerOf(sess(), players[0]);
    expect(me).toMatchObject({ count: 1, isMe: true });
    expect(me.chips.map((c) => [c.id, c.rounds])).toEqual([['shield', 3]]);
  });
  it('falls back to the live view for what the display copy does not carry, and uses the display round', () => {
    const display = { cfg: { powerCards: true }, round: 5, players: [{ id: 'r', name: 'Ravi' }] };
    const r = powerOf(sess(undefined, { display }), display.players[0]);
    expect(r.count).toBe(2);
    expect(r.chips).toEqual([]); // the double rent lasted until round 4: lapsed in round 5
  });
  it('words for the button label', () => {
    expect(powerWords(powerOf(sess(), players[1]))).toBe('holds 2 power cards, Double rent armed, 2 rounds left');
    expect(powerWords(powerOf(sess(), players[0]))).toBe('you hold 1 power card, Shield armed, 3 rounds left');
    expect(powerWords(null)).toBe('');
  });
});
