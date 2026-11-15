// Trading rules: when a trade may be offered (tradeBlock / getOptions.trade), counter-offers (TRADE_COUNTER) and the edge cases of
// a deal (mortgaged and upgraded districts, cash only, an empty side). docs/GAME_RULES.md 8.8.
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getOptions, tradeBlock, MAX_COUNTERS } from './index.js';

function game(n = 3) {
  const ids = ['a', 'b', 'c'].slice(0, n);
  return createGame({ players: ids.map((id) => ({ id, name: id.toUpperCase() })), settings: { debug: true, snatches: 0 }, seed: 7 });
}
const P = (s, id) => s.players.find((p) => p.id === id);
function act(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
const offer = (s, from, to, give, get) => applyAction(s, { type: 'TRADE_OFFER', playerId: from, to, give, get });
const side = (cash = 0, tiles = []) => ({ cash, tiles });

describe('when a trade may be offered', () => {
  it('on my own turn before the roll, after rolling (manage) and on an extra roll', () => {
    const s = game();
    s.owners[1] = 'a'; s.owners[6] = 'b';
    expect(tradeBlock(s, 'a')).toBeNull();
    expect(getOptions(s, 'a').trade.canOffer).toBe(true);
    s.phase = 'manage';
    expect(getOptions(s, 'a').trade.canOffer).toBe(true);
    s.extraRoll = true;
    expect(getOptions(s, 'a').trade.canOffer).toBe(true);
    expect(offer(s, 'a', 'b', side(0, [1]), side(0, [6])).error).toBeUndefined();
  });

  it('while deciding about the district I landed on (buy phase)', () => {
    const s = game();
    s.owners[1] = 'a'; s.owners[6] = 'b';
    s.phase = 'buy';
    s.pending = { type: 'buy', tile: 3, price: 70000 };
    expect(getOptions(s, 'a').trade.canOffer).toBe(true);
    const r = act(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: side(0, [1]), get: side(0, [6]) });
    expect(r.state.phase).toBe('buy');
    expect(r.state.pending).toMatchObject({ type: 'buy', tile: 3 });
    const done = act(r.state, { type: 'TRADE_ACCEPT', playerId: 'b' });
    expect(done.state.owners[1]).toBe('b');
    expect(done.state.phase).toBe('buy'); // the decision about the district is still mine
    expect(getOptions(done.state, 'a').buy).toBe(true);
  });

  it('says exactly why not: not my turn, debt, auction, Snatch window, a pending offer, bankrupt, alone', () => {
    const s = game();
    expect(tradeBlock(s, 'b')).toBe('You can propose a trade on your own turn');
    expect(getOptions(s, 'b').trade.canOffer).toBe(false);
    expect(tradeBlock({ ...s, phase: 'debt' }, 'a')).toMatch(/debt/);
    expect(tradeBlock({ ...s, phase: 'auction' }, 'a')).toMatch(/auction/);
    expect(tradeBlock({ ...s, phase: 'snatch' }, 'a')).toMatch(/Snatch/);
    expect(tradeBlock({ ...s, trade: { id: 1, from: 'a', to: 'b' } }, 'a')).toMatch(/waiting/);
    expect(tradeBlock({ ...s, trade: { id: 1, from: 'a', to: 'b' } }, 'b')).toMatch(/Answer the trade offer/);
    const alone = game(2);
    P(alone, 'b').bankrupt = true;
    expect(tradeBlock(alone, 'a')).toMatch(/No other active/);
    expect(tradeBlock(alone, 'b')).toMatch(/out of the game/);
  });

  it('getOptions().trade.canOffer always agrees with TRADE_OFFER being accepted', () => {
    for (const phase of ['roll', 'manage', 'buy', 'debt', 'auction', 'snatch']) {
      const s = game();
      s.owners[1] = 'a'; s.owners[6] = 'b';
      s.phase = phase;
      s.pending = phase === 'buy' ? { type: 'buy', tile: 3, price: 70000 } : phase === 'auction' || phase === 'snatch' ? { type: phase, bids: {}, eligible: [], claims: [] } : null;
      const can = getOptions(s, 'a').trade.canOffer;
      const err = offer(s, 'a', 'b', side(0, [1]), side(0, [6])).error;
      if (can) expect(err).toBeUndefined();
      else expect(err).toBeTruthy();
    }
  });
});

describe('what a deal may contain', () => {
  it('cash only, either way, and a mortgaged or upgraded district travel as they are', () => {
    const s = game();
    s.owners[1] = 'a'; s.levels[1] = 2; s.mortgaged = { ...(s.mortgaged || {}), 6: true }; s.owners[6] = 'b';
    expect(offer(s, 'a', 'b', side(50000), side()).error).toBeUndefined();
    expect(offer(s, 'a', 'b', side(), side(50000)).error).toBeUndefined();
    const r = act(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: side(0, [1]), get: side(0, [6]) });
    const d = act(r.state, { type: 'TRADE_ACCEPT', playerId: 'b' });
    expect(d.state.owners[1]).toBe('b');
    expect(d.state.levels[1]).toBe(2);
    expect(d.state.owners[6]).toBe('a');
    expect(d.state.mortgaged[6]).toBe(true);
  });

  it('cash exactly equal to what the payer has is fine, one rupee more is not; an empty offer is refused', () => {
    const s = game();
    const cash = P(s, 'a').cash;
    expect(offer(s, 'a', 'b', side(cash), side()).error).toBeUndefined();
    expect(offer(s, 'a', 'b', side(cash + 1), side()).error).toMatch(/much cash/);
    expect(offer(s, 'a', 'b', side(), side()).error).toMatch(/empty/);
  });

  it('refuses a bankrupt partner and yourself', () => {
    const s = game();
    P(s, 'c').bankrupt = true;
    expect(offer(s, 'a', 'c', side(10), side()).error).toMatch(/another active player/);
    expect(offer(s, 'a', 'a', side(10), side()).error).toMatch(/another active player/);
  });
});

describe('counter-offers', () => {
  function pending() {
    const s = game();
    s.owners[1] = 'a'; s.owners[4] = 'a'; s.owners[6] = 'b'; s.owners[7] = 'b';
    return act(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: side(10000, [1]), get: side(0, [6]) }).state;
  }
  const counter = (s, who, give, get) => applyAction(s, { type: 'TRADE_COUNTER', playerId: who, give, get });

  it('replaces the pending offer in one step: from = recipient, to = proposer, a fresh id, the original kept as `replaces`', () => {
    const s = pending();
    const old = s.trade;
    expect(getOptions(s, 'b').tradeOffer).toMatchObject({ id: old.id, counters: 0, canCounter: true });
    const r = act(s, { type: 'TRADE_COUNTER', playerId: 'b', give: side(0, [6, 7]), get: side(0, [1]) });
    expect(r.state.trade).toMatchObject({ from: 'b', to: 'a', give: side(0, [6, 7]), get: side(0, [1]), counters: 1 });
    expect(r.state.trade.id).not.toBe(old.id);
    expect(r.state.trade.replaces).toEqual({ id: old.id, give: old.give, get: old.get });
    expect(r.events.map((e) => e.type)).toEqual(['trade_countered', 'trade_offer']);
    expect(r.events[0]).toMatchObject({ id: old.id, from: 'a', to: 'b', by: 'b', newId: r.state.trade.id });
    expect(r.events[1]).toMatchObject({ from: 'b', to: 'a', counter: true });
    expect(r.events.some((e) => e.type === 'trade_rejected')).toBe(false); // never a moment without an offer
    // the old proposer now answers: the incoming view is theirs, the recipient sees their own offer waiting
    expect(getOptions(r.state, 'a').tradeOffer).toMatchObject({ from: 'b', counters: 1 });
    expect(getOptions(r.state, 'b').tradeSent).toMatchObject({ to: 'a' });
    expect(getOptions(r.state, 'b').tradeOffer).toBeNull();
  });

  it('only the recipient, only while an offer is pending, with the same rules as an offer', () => {
    const s = pending();
    expect(counter(s, 'a', side(10), side()).error).toMatch(/not for you/);
    expect(counter(s, 'c', side(10), side()).error).toMatch(/not for you/);
    expect(counter({ ...s, trade: null }, 'b', side(10), side()).error).toMatch(/no trade offer/i);
    expect(counter(s, 'b', side(), side()).error).toMatch(/empty/);
    expect(counter(s, 'b', side(0, [1]), side()).error).toMatch(/do not own/); // 1 is a's, not b's
    expect(counter(s, 'b', side(0, [6]), side(0, [7])).error).toMatch(/does not own/); // 7 is b's, not a's
    expect(counter(s, 'b', side(P(s, 'b').cash + 1), side()).error).toMatch(/much cash/);
    expect(counter(s, 'b', side(0, [6]), side(P(s, 'a').cash + 1)).error).toMatch(/much cash/);
    expect(counter(s, 'b', side(0, [5]), side()).error).toMatch(/districts|do not own/);
    expect(counter(s, 'b', { cash: -1, tiles: [] }, side(5)).error).toBe('Invalid offer');
  });

  it('the new offer can be accepted by the old proposer (cash and districts go the right way), rejected or cancelled', () => {
    const s = pending();
    const c = act(s, { type: 'TRADE_COUNTER', playerId: 'b', give: side(5000, [6]), get: side(0, [4]) }).state;
    expect(applyAction(c, { type: 'TRADE_ACCEPT', playerId: 'b' }).error).toMatch(/not for you/);
    const cashA = P(c, 'a').cash;
    const cashB = P(c, 'b').cash;
    const done = act(c, { type: 'TRADE_ACCEPT', playerId: 'a' });
    expect(done.state.trade).toBeNull();
    expect(done.state.owners[6]).toBe('a');
    expect(done.state.owners[4]).toBe('b');
    expect(P(done.state, 'a').cash).toBe(cashA + 5000);
    expect(P(done.state, 'b').cash).toBe(cashB - 5000);
    expect(act(c, { type: 'TRADE_REJECT', playerId: 'a' }).events[0]).toMatchObject({ type: 'trade_rejected', reason: 'rejected', from: 'b', to: 'a' });
    expect(act(c, { type: 'TRADE_CANCEL', playerId: 'b' }).events[0]).toMatchObject({ reason: 'cancelled' });
    expect(applyAction(c, { type: 'TRADE_CANCEL', playerId: 'a' }).error).toMatch(/Only the player who made/);
  });

  it('the game stays frozen while a counter-offer waits (nobody but the answerer acts)', () => {
    const c = act(pending(), { type: 'TRADE_COUNTER', playerId: 'b', give: side(0, [6]), get: side(0, [1]) }).state;
    expect(applyAction(c, { type: 'ROLL', playerId: 'a' }).error).toMatch(/trade/i);
    expect(applyAction(c, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: side(5), get: side() }).error).toMatch(/waiting/i);
  });

  it('a chain stops after MAX_COUNTERS counters: then only accept / reject', () => {
    let s = pending();
    let who = 'b';
    for (let i = 0; i < MAX_COUNTERS; i++) {
      s = act(s, { type: 'TRADE_COUNTER', playerId: who, give: side(1000 * (i + 1)), get: side() }).state;
      who = who === 'b' ? 'a' : 'b';
    }
    expect(s.trade.counters).toBe(MAX_COUNTERS);
    expect(getOptions(s, who).tradeOffer).toMatchObject({ counters: MAX_COUNTERS, canCounter: false });
    expect(counter(s, who, side(5), side()).error).toMatch(/used up/);
    expect(applyAction(s, { type: 'TRADE_REJECT', playerId: who }).error).toBeUndefined();
  });

  it('bankruptcy of either side cancels the pending counter like any offer', () => {
    const c = act(pending(), { type: 'TRADE_COUNTER', playerId: 'b', give: side(0, [6]), get: side(0, [1]) }).state;
    const r = act(c, { type: 'RESIGN', playerId: 'a' });
    expect(r.state.trade).toBeNull();
    expect(r.events.some((e) => e.type === 'trade_rejected' && e.reason === 'bankrupt')).toBe(true);
  });

  it('a counter whose districts changed hands meanwhile is rejected as invalid on accept (never half applied)', () => {
    const c = act(pending(), { type: 'TRADE_COUNTER', playerId: 'b', give: side(0, [6]), get: side(0, [1]) }).state;
    c.owners[6] = 'c'; // simulated corruption: b no longer owns 6
    const r = act(c, { type: 'TRADE_ACCEPT', playerId: 'a' });
    expect(r.events[0]).toMatchObject({ type: 'trade_rejected', reason: 'invalid' });
    expect(r.state.owners[1]).toBe('a');
  });
});
