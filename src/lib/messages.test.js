import { describe, it, expect } from 'vitest';
import { describeEvent, tileName, playerName, snatchCaption, joinNames, nameList } from './messages.js';
import { createGame, applyAction, mulberry32, nextBotMove } from '@shared/index.js';

const ctx = {
  me: 'me',
  players: [{ id: 'me', name: 'Nithin' }, { id: 'b1', name: 'Chai Uncle' }],
  owners: Array(36).fill(null),
  round: 3,
  maxRounds: 20,
};
const text = (ev, c = ctx) => describeEvent(ev, c)?.text;

describe('describeEvent', () => {
  it('one die, a six rolls again', () => {
    expect(text({ type: 'dice', player: 'me', values: [1] })).toBe('You rolled 1');
    expect(text({ type: 'dice', player: 'b1', values: [6] })).toBe('Chai Uncle rolled 6: six, roll again!');
    expect(describeEvent({ type: 'dice', player: 'me', values: [3], assist: 'pity' }, ctx).extra.text).toMatch(/Lucky dice/);
  });

  it('rent is told once (the paying half), salary and municipal charges', () => {
    const pay = describeEvent({ type: 'cash', player: 'me', delta: -34000, reason: 'rent', other: 'b1' }, ctx);
    expect(pay).toMatchObject({ text: 'You paid ₹34,000 rent to Chai Uncle', tone: 'bad' });
    expect(describeEvent({ type: 'cash', player: 'b1', delta: 34000, reason: 'rent', other: 'me' }, ctx)).toBeNull();
    expect(describeEvent({ type: 'cash', player: 'b1', delta: -6000, reason: 'rent', other: 'me' }, ctx).tone).toBe('good');
    expect(text({ type: 'cash', player: 'me', delta: 200000, reason: 'salary' })).toBe('You passed START and collected ₹2,00,000');
    expect(text({ type: 'cash', player: 'b1', delta: -70000, reason: 'tax' })).toBe('Chai Uncle paid ₹70,000 in Municipal Charges');
    for (const reason of ['buy', 'upgrade', 'auction', 'card', 'fare', 'traffic', 'mortgage', 'sell', 'trade']) {
      expect(describeEvent({ type: 'cash', player: 'me', delta: -1, reason }, ctx), reason).toBeNull();
    }
  });

  it('city event cash: festival gift and wedding expense', () => {
    expect(text({ type: 'cash', player: 'me', delta: 50000, reason: 'event' })).toBe('You received ₹50,000 from the city event');
    expect(text({ type: 'cash', player: 'b1', delta: -30000, reason: 'event' })).toBe('Chai Uncle paid ₹30,000 for the city event');
    const e = describeEvent({ type: 'city_event', id: 'festival', title: 'Bonalu festive bonus', text: 'The city celebrates Bonalu together.', kind: 'cash', amount: 50000, round: 3 }, ctx);
    expect(e).toMatchObject({ text: 'Bonalu festive bonus: The city celebrates Bonalu together.', bubble: 'Bonalu festive bonus', tone: 'cheer' });
    expect(describeEvent({ type: 'city_event', id: 'wedding_season', title: 'Wedding Season', text: 'x', kind: 'cash', amount: -30000 }, ctx).tone).toBe('warn');
  });

  it('landing lines: districts, own districts, transport; corners stay quiet for their own line', () => {
    expect(text({ type: 'land', player: 'me', tile: 31 })).toBe('You landed on HITEC City');
    const owners = Array(36).fill(null);
    owners[31] = 'me';
    expect(text({ type: 'land', player: 'me', tile: 31 }, { ...ctx, owners })).toBe('You are back at your own HITEC City');
    expect(text({ type: 'land', player: 'b1', tile: 5 })).toBe('Chai Uncle reached the Auto Stand. A shortcut ride costs ₹25,000');
    expect(text({ type: 'land', player: 'me', tile: 32 })).toBe('You landed on the Bazaar Auction');
    for (const t of [9, 18, 27, 2, 12]) expect(describeEvent({ type: 'land', player: 'me', tile: t }, ctx)).toBeNull();
  });

  it('ride: fare, route and a funny auto line; its move stays quiet', () => {
    const r = describeEvent({ type: 'ride', player: 'me', from: 5, to: 14, fare: 25000 }, ctx);
    expect(r.text).toBe('You paid ₹25,000 and rode from the Auto Stand to the Metro Interchange. "Meter kharab hai, saab!"');
    expect(r.bubble).toBe('Meter kharab hai, saab!');
    expect(describeEvent({ type: 'move', player: 'me', from: 5, to: 14, path: [6], ride: true }, ctx)).toBeNull();
    expect(describeEvent({ type: 'move', player: 'me', from: 1, to: 4, path: [2, 3, 4] }, ctx)).toBeNull();
    expect(text({ type: 'ride', player: 'b1', from: 23, to: 5, fare: 45000 })).toMatch(/MMTS Express to the Auto Stand/);
  });

  it('traffic: stuck, paid, chai, waited', () => {
    expect(describeEvent({ type: 'traffic', player: 'me', stuck: true, reason: 'tile' }, ctx)).toMatchObject({ text: 'Traffic Jam! You are stuck where you stand', tone: 'bad', tile: 9 });
    expect(text({ type: 'traffic', player: 'b1', stuck: true, reason: 'card' })).toBe('Chai Uncle is stuck in traffic. Baigan!');
    // the fine is the host's setting: the event's own amount, else the cash event just before it, never a built-in number
    expect(text({ type: 'traffic', player: 'me', stuck: false, reason: 'paid', amount: 30000 })).toBe('You paid ₹30,000 and squeezed out of the jam');
    expect(text({ type: 'traffic', player: 'me', stuck: false, reason: 'paid' }, { ...ctx, lastCash: { player: 'me', delta: -45000, reason: 'traffic' } })).toBe('You paid ₹45,000 and squeezed out of the jam');
    expect(text({ type: 'traffic', player: 'me', stuck: false, reason: 'paid' }, { ...ctx, lastCash: { player: 'b1', delta: -45000, reason: 'traffic' } })).toBe('You paid the fine and squeezed out of the jam');
    expect(text({ type: 'traffic', player: 'me', stuck: false, reason: 'paid' })).toBe('You paid the fine and squeezed out of the jam');
    expect(text({ type: 'traffic', player: 'me', stuck: false, reason: 'free' })).toBe('You are out of the traffic jam, free of charge');
    expect(text({ type: 'traffic', player: 'me', stuck: false, reason: 'chai' })).toBe('You sipped a chai and the traffic melted away');
    expect(text({ type: 'traffic', player: 'b1', stuck: false, reason: 'waited' })).toBe('Chai Uncle waited out the traffic jam');
  });

  it('chai: picked up, card, saved on rent; spending it on traffic is told by the traffic line', () => {
    expect(text({ type: 'chai', player: 'me', chai: 1, change: 1, reason: 'adda' })).toBe('You picked up a chai token at the Chai Adda');
    expect(text({ type: 'chai', player: 'me', chai: 1, change: 1, reason: 'card' })).toBe('You got a free chai token');
    expect(text({ type: 'chai', player: 'b1', chai: 0, change: -1, reason: 'rent', saved: 32500 })).toBe('Chai break! Chai Uncle saved ₹32,500 on rent');
    expect(describeEvent({ type: 'chai', player: 'me', chai: 0, change: -1, reason: 'traffic' }, ctx)).toBeNull();
  });

  it('cards from both decks', () => {
    const mine = describeEvent({ type: 'card', player: 'me', cardId: 'investor', kind: 'good', deck: 'luck', title: 'An investor is impressed!', text: 'Collect ₹1,00,000.' }, ctx);
    expect(mine).toMatchObject({ text: 'An investor is impressed! Collect ₹1,00,000.', tone: 'good', icon: '🪙', title: 'An investor is impressed!' });
    const theirs = describeEvent({ type: 'card', player: 'b1', cardId: 'shaadi_season', kind: 'bad', deck: 'drama', title: 'Shaadi ka season!', text: 'Pay ₹50,000.' }, ctx);
    expect(theirs).toMatchObject({ text: 'Chai Uncle drew City Drama: "Shaadi ka season!" Pay ₹50,000.', tone: 'info', icon: '🎭' });
  });

  it('buying, upgrading and selling use the collection business names', () => {
    expect(text({ type: 'own', tile: 31, owner: 'me', reason: 'buy' })).toBe('You bought HITEC City for ₹3,40,000 and opened a Startup Office');
    expect(text({ type: 'own', tile: 6, owner: 'b1', reason: 'buy' })).toBe('Chai Uncle bought Laad Bazaar for ₹1,00,000 and opened an Irani Cafe');
    const owners = Array(36).fill(null);
    owners[31] = 'me';
    expect(text({ type: 'level', tile: 31, level: 1, reason: 'upgrade' }, { ...ctx, owners })).toBe('You grew HITEC City into a Business Centre');
    expect(describeEvent({ type: 'level', tile: 31, level: 2, reason: 'upgrade' }, { ...ctx, owners })).toMatchObject({ text: 'You turned HITEC City into a Tech Campus!', tone: 'cheer' });
    expect(text({ type: 'level', tile: 31, level: 0, reason: 'sell' }, { ...ctx, owners })).toBe('You scaled HITEC City back to a Startup Office');
    expect(describeEvent({ type: 'own', tile: 31, owner: 'b1', reason: 'auction' }, ctx)).toBeNull();
  });

  it('auctions: bazaar, declined, unaffordable, results', () => {
    expect(text({ type: 'auction_start', tile: 22, minBid: 120000, reason: 'bazaar' })).toBe('Bazaar Auction! Necklace Road goes under the hammer (min ₹1,20,000)');
    expect(text({ type: 'auction_start', tile: 4, minBid: 8000, reason: 'decline' })).toBe('Begum Bazaar was skipped, so it goes to a sealed auction (min ₹8,000)');
    expect(text({ type: 'auction_start', tile: 1, minBid: 6000, reason: 'unaffordable' })).toMatch(/too pricey/);
    expect(text({ type: 'auction_end', tile: 4, winner: 'b1', amount: 60000, bids: {} })).toBe('Chai Uncle won Begum Bazaar at auction for ₹60,000');
    expect(text({ type: 'auction_end', tile: 4, winner: null, amount: 0, bids: {} })).toBe('No bids. Begum Bazaar stays with the city');
  });

  it('sets, mortgages, debt, bankruptcy and trades', () => {
    expect(text({ type: 'set_complete', player: 'me', group: 'cyber' })).toBe('You have the whole Cyberabad collection: 1.5x rent on its first-level businesses!');
    expect(text({ type: 'mortgage', player: 'me', tile: 35, value: 200000 })).toBe('You mortgaged Financial District for ₹2,00,000');
    expect(text({ type: 'unmortgage', player: 'b1', tile: 35, cost: 220000 })).toBe('Chai Uncle paid ₹2,20,000 to lift the mortgage on Financial District');
    expect(text({ type: 'debt', player: 'me', amount: 140000, creditor: 'b1' })).toBe('You owe ₹1,40,000 to Chai Uncle. Raise cash or resign!');
    expect(text({ type: 'debt', player: 'b1', amount: 40000, creditor: null })).toBe('Chai Uncle is in debt: owes ₹40,000 to the city');
    expect(text({ type: 'bankrupt', player: 'b1' })).toBe('Chai Uncle went bankrupt');
    expect(text({ type: 'bankrupt', player: 'b1', reason: 'resign' })).toBe('Chai Uncle resigned');
    expect(text({ type: 'bankrupt', player: 'me', reason: 'resign' })).toMatch(/^You resigned/);
    expect(describeEvent({ type: 'bankrupt', player: 'b1', reason: 'resign' }, ctx).tone).toBe('warn');
    expect(text({ type: 'trade_offer', from: 'b1', to: 'me', give: { cash: 50000, tiles: [1] }, get: { tiles: [31] } })).toBe(
      'Chai Uncle offered you a trade: Sultan Bazaar + ₹50,000 for HITEC City',
    );
    expect(text({ type: 'trade_rejected', from: 'me', to: 'b1', reason: 'rejected' })).toBe('Chai Uncle turned down your trade offer');
  });

  it('rounds, the final round and the win', () => {
    expect(describeEvent({ type: 'turn', player: 'b1', round: 3 }, ctx)).toBeNull();
    expect(describeEvent({ type: 'turn', player: 'me', round: 4 }, ctx)).toMatchObject({ text: 'Round 4 of 20 begins', bubble: 'Round 4' });
    expect(describeEvent({ type: 'turn', player: 'me', round: 20 }, { ...ctx, round: 19 })).toMatchObject({ text: 'Round 20 of 20 begins. Final round!', tone: 'warn' });
    expect(text({ type: 'turn', player: 'me', round: 7 }, { ...ctx, round: 6, maxRounds: null })).toBe('Round 7 begins');
    expect(text({ type: 'win', player: 'b1', reason: 'rounds', worth: 2100000 })).toBe('The last round is over! Chai Uncle is the richest in Hyderabad with ₹21,00,000');
    expect(text({ type: 'win', player: 'me', reason: 'last_standing', worth: 1 })).toBe('You are the last one standing and own the city!');
    expect(text({ type: 'win', player: null, reason: 'last_standing' })).toMatch(/Nobody/);
    expect(text({ type: 'win', player: 'b1', reason: 'target', worth: 5120000 }, { ...ctx, targetWorth: 5000000 })).toBe(
      'Target reached! Chai Uncle is the first to hit ₹50,00,000 net worth (₹51,20,000) and owns the city!',
    );
    expect(text({ type: 'win', player: 'me', reason: 'target', worth: 5120000 })).toBe('Target reached! You are the first to hit the net worth target (₹51,20,000) and own the city!');
    expect(describeEvent({ type: 'win', player: 'b1', reason: 'target', worth: 1 }, ctx)).toMatchObject({ tone: 'cheer', bubble: 'Chai Uncle wins!', icon: '🏆' });
  });

  it('never throws and covers a whole bot game', () => {
    expect(describeEvent(null, ctx)).toBeNull();
    expect(describeEvent({ type: 'nope' }, ctx)).toBeNull();
    expect(tileName(31)).toBe('HITEC City');
    expect(playerName(ctx, 'me')).toBe('You');
    let s = createGame({ players: [{ id: 'me', name: 'N', isBot: true }, { id: 'b1', name: 'C', isBot: true }, { id: 'b2', name: 'D', isBot: true }], seed: 4 });
    const rnd = mulberry32(4);
    const seen = new Set();
    for (let i = 0; i < 3000 && s.phase !== 'over'; i++) {
      // auto-play never snatches: the room's timer closes a Snatch window (SNATCH_CLOSE), as here
      const r = applyAction(s, s.phase === 'snatch' ? { type: 'SNATCH_CLOSE' } : nextBotMove(s, rnd));
      for (const e of r.events) {
        const d = describeEvent(e, { me: 'me', players: s.players, owners: s.owners, round: s.round, maxRounds: s.cfg.maxRounds });
        if (d) {
          expect(typeof d.text).toBe('string');
          expect(d.text).not.toMatch(/undefined|NaN|\[object/);
          seen.add(e.type);
        }
      }
      s = r.state;
    }
    expect(seen.has('dice')).toBe(true);
    expect(seen.has('win')).toBe(true);
  });
});

describe('Snatch lines', () => {
  const sctx = {
    me: 'me',
    players: [{ id: 'me', name: 'Nithin' }, { id: 'b1', name: 'Chai Uncle' }, { id: 'b2', name: 'Meera' }],
    owners: Array(36).fill(null),
    round: 3,
    maxRounds: 20,
  };

  it('snatch_open names who may snatch, the window length, and tells an eligible player to go', () => {
    const open = { type: 'snatch_open', tile: 29, buyer: 'b1', price: 320000, eligible: ['me', 'b2'], ms: 5000 };
    expect(describeEvent(open, sctx)).toMatchObject({
      text: 'Snatch window open (5s): You and Meera can snatch Madhapur', bubble: 'Snatch it!', tone: 'warn', tile: 29, icon: '⚡',
    });
    const watching = describeEvent({ ...open, eligible: ['b2'] }, sctx);
    expect(watching).toMatchObject({ text: 'Snatch window open (5s): Meera can snatch Madhapur', bubble: 'Snatch window open', tone: 'info' });
    expect(text({ ...open, ms: undefined, eligible: ['b2'] }, sctx)).toContain('(5s)');
  });

  it('snatch_end: who snatched it, the bidding, and silence when nobody did', () => {
    expect(describeEvent({ type: 'snatch_end', tile: 1, buyer: 'b1', outcome: 'snatched', winner: 'b2', claimants: ['b2'] }, sctx)).toMatchObject({
      text: 'Meera snatched Sultan Bazaar!', bubble: 'Meera snatched Sultan Bazaar!', tone: 'info', tile: 1,
    });
    expect(describeEvent({ type: 'snatch_end', tile: 1, buyer: 'me', outcome: 'snatched', winner: 'b2' }, sctx).tone).toBe('bad'); // my district was taken
    expect(describeEvent({ type: 'snatch_end', tile: 1, buyer: 'b1', outcome: 'snatched', winner: 'me' }, sctx)).toMatchObject({ text: 'You snatched Sultan Bazaar!', tone: 'cheer' });
    expect(text({ type: 'snatch_end', tile: 1, buyer: 'b1', outcome: 'bidding', claimants: ['b2', 'b1'] }, sctx)).toBe('Snatch bidding: Meera and Chai Uncle');
    expect(describeEvent({ type: 'snatch_end', tile: 1, buyer: 'b1', outcome: 'bidding', claimants: ['b2', 'me'] }, sctx)).toMatchObject({ text: 'Snatch bidding: You and Meera', tone: 'warn' });
    expect(describeEvent({ type: 'snatch_end', tile: 1, buyer: 'b1', outcome: 'none' }, sctx)).toBeNull();
    expect(snatchCaption({ type: 'snatch_end', tile: 1, buyer: 'b1', outcome: 'none' }, sctx)).toBeNull();
  });

  it('a Snatch card, the token event and the snatch bidding result', () => {
    expect(describeEvent({ type: 'token_earned', player: 'b2', reason: 'card', snatches: 2 }, sctx)).toMatchObject({ text: 'Meera won a Snatch button from a card', bubble: '+1 Snatch', tone: 'info' });
    expect(describeEvent({ type: 'token_earned', player: 'me', reason: 'card', snatches: 2 }, sctx)).toMatchObject({ text: 'You won a Snatch button from a card', tone: 'good' });
    expect(describeEvent({ type: 'snatch_token', player: 'b2', snatches: 0 }, sctx)).toBeNull();
    expect(describeEvent({ type: 'auction_start', tile: 1, minBid: 10000, reason: 'snatch', eligible: ['b2'] }, sctx)).toBeNull();
    expect(text({ type: 'auction_end', tile: 1, winner: 'b2', amount: 90000, reason: 'snatch', buyer: 'b1' }, sctx)).toBe('Meera won Sultan Bazaar in the snatch bidding for ₹90,000');
    expect(text({ type: 'auction_end', tile: 1, winner: null, reason: 'snatch', buyer: 'b1' }, sctx)).toBe('Nobody bid. Sultan Bazaar stays with Chai Uncle');
    expect(text({ type: 'auction_end', tile: 1, winner: null, reason: 'snatch', buyer: 'me' }, sctx)).toBe('Nobody bid. Sultan Bazaar stays with you');
    expect(text({ type: 'auction_end', tile: 1, winner: 'b1', amount: 90000 }, sctx)).toBe('Chai Uncle won Sultan Bazaar at auction for ₹90,000');
  });

  it('joinNames / nameList read like a sentence, "You" first', () => {
    expect(joinNames([])).toBe('Nobody');
    expect(joinNames(['Meera'])).toBe('Meera');
    expect(joinNames(['Meera', 'You'])).toBe('You and Meera');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(sctx, ['b2', 'me', 'b1'])).toBe('You, Meera and Chai Uncle');
    expect(nameList(sctx, null)).toBe('Nobody');
  });
});
