// The client's view of the bankruptcy rule must be the engine's: the same exact amounts, in plain words.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, mortgageValue, TILES } from '@shared/index.js';
import { bankruptcySummary, bankruptcyText } from './bankruptcy.js';
import { resignText, RESIGN_TEXT } from '../turn/resign.js';

const players = [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }, { id: 'c2', name: 'Zoya' }];
const game = () => createGame({ players, settings: { debug: true, snatches: 0 }, seed: 3 });
const P = (s, id) => s.players.find((p) => p.id === id);

/** me owes Ravi 1,76,000 (Financial District level 2) holding Sultan, Monda and Begum Bazaar and 1,20,000 in cash */
function inDebt() {
  const s = game();
  s.owners[35] = 'b1'; s.levels[35] = 2;
  s.owners[1] = 'me'; s.owners[3] = 'me'; s.owners[4] = 'me';
  P(s, 'me').cash = 120000; P(s, 'me').pos = 33;
  const r = applyAction(s, { type: 'ROLL', playerId: 'me', dice: [2] });
  expect(r.state.phase).toBe('debt');
  return r.state;
}

describe('bankruptcySummary / bankruptcyText', () => {
  it('the creditor is paid exactly the debt when the assets are worth more', () => {
    const s = inDebt();
    const sum = bankruptcySummary(s, 'me');
    expect(sum).toMatchObject({ owed: 176000, paid: 176000, capped: false, bank: false });
    expect(sum.estate).toBe(120000 + [1, 3, 4].reduce((n, t) => n + mortgageValue(TILES[t]), 0));
    expect(sum.payouts).toEqual([{ to: 'b1', name: 'Ravi', amount: 176000 }]);
    expect(bankruptcyText(s, 'me')).toBe('If you go bankrupt, the bank takes ALL your cash and districts. Ravi is paid the ₹1,76,000 you owe (up to what your assets are worth).');
  });

  it('says so when the assets are worth less than the debt (and matches what the engine really pays)', () => {
    const s = inDebt();
    P(s, 'me').cash = 50000;
    s.debt.amount = 200000; // the engine would not have opened this debt, but the text must still tell the cap
    const sum = bankruptcySummary(s, 'me');
    expect(sum.paid).toBe(50000 + 30000 + 35000 + 40000);
    expect(sum.capped).toBe(true);
    expect(bankruptcyText(s, 'me')).toBe('If you go bankrupt, the bank takes ALL your cash and districts. Ravi is paid ₹1,55,000 of the ₹2,00,000 you owe (up to what your assets are worth).');
  });

  it('is exactly what the engine pays on RESIGN', () => {
    const s = inDebt();
    const before = P(s, 'b1').cash;
    const sum = bankruptcySummary(s, 'me');
    const r = applyAction(s, { type: 'RESIGN', playerId: 'me' });
    expect(P(r.state, 'b1').cash - before).toBe(sum.paid);
  });

  it('a debt to the bank, or no debt: nobody is paid', () => {
    const s = game();
    expect(bankruptcySummary(s, 'me')).toMatchObject({ owed: 0, paid: 0, bank: true });
    expect(bankruptcyText(s, 'me')).toBe('If you go bankrupt, the bank takes ALL your cash and districts. Nobody else is paid.');
    s.phase = 'debt';
    s.debt = { player: 'me', amount: 40000, creditor: null, reason: 'tax', rest: [] };
    expect(bankruptcyText(s, 'me')).toContain('Nobody else is paid');
  });

  it('several creditors are listed in order', () => {
    const s = game();
    s.phase = 'debt';
    s.debt = { player: 'me', amount: 10000, creditor: 'b1', reason: 'card', rest: [{ from: 'me', to: 'c2', amount: 10000, reason: 'card' }] };
    P(s, 'me').cash = 15000;
    expect(bankruptcyText(s, 'me')).toBe('If you go bankrupt, the bank takes ALL your cash and districts. Ravi is paid ₹10,000 and Zoya is paid ₹5,000 of the ₹20,000 you owe (up to what your assets are worth).');
  });

  it('survives a thin view (no owners yet) and an unknown player', () => {
    expect(bankruptcySummary({ players: [{ id: 'me', cash: 10 }] }, 'me')).toMatchObject({ estate: 10, paid: 0, bank: true });
    expect(bankruptcySummary(null, 'me').bank).toBe(true);
    expect(bankruptcySummary(game(), 'nobody').bank).toBe(true);
  });
});

describe('resignText', () => {
  it('is the plain text without a debt and adds who is paid when you owe a player', () => {
    expect(resignText({ me: 'me', view: game() })).toBe(RESIGN_TEXT);
    expect(RESIGN_TEXT).toMatch(/districts go back to the bank/);
    const t = resignText({ me: 'me', view: inDebt() });
    expect(t).toContain(RESIGN_TEXT);
    expect(t).toContain('Ravi is paid ₹1,76,000');
    expect(resignText({ me: 'me', view: null })).toBe(RESIGN_TEXT);
  });
});
