import { describe, expect, it } from 'vitest';
import { describeEvent } from '@/lib/messages.js';
import { GROUP_TILES, TILES } from '@shared/board.js';
import { ageFade, buildFeed, chipify, feedEntry, feedItem, kindOf, mergeRollText, moneyChip, moneyOf, relativeAge, rowLabel } from './feedModel.js';

const players = [
  { id: 'me', name: 'Nithin', color: '#ff4d6d' },
  { id: 'rav', name: 'Ravi', color: '#3ddc97' },
  { id: 'sana', name: 'Sana', color: '#4cc9f0' },
];
const ctx = { players, me: 'me', owners: Array(36).fill(null) };
const tileId = TILES.findIndex((t) => t.type === 'property');

describe('feedItem wraps describeEvent', () => {
  it('keeps the words of messages.js and adds kind, label, tile and money', () => {
    const ev = { type: 'cash', player: 'rav', delta: -32000, reason: 'rent', other: 'sana' };
    const d = describeEvent(ev, ctx);
    const item = feedItem(ev, ctx);
    expect(item.text).toBe(d.text);
    expect(item.tone).toBe(d.tone);
    expect(item.kind).toBe('rent');
    expect(item.label).toBe('RENT');
    expect(item.amount).toBe(-32000);
    expect(item.amountWho).toBe('rav');
    expect(item.players).toEqual(['rav', 'sana']);
  });
  it('is null for events with no line', () => {
    expect(feedItem({ type: 'snatch_token', player: 'me' }, ctx)).toBeNull();
    expect(feedItem(null, ctx)).toBeNull();
  });
  it('a set completion points at every tile of the collection', () => {
    const group = Object.keys(GROUP_TILES)[0];
    const item = feedItem({ type: 'set_complete', player: 'rav', group }, ctx);
    expect(item.kind).toBe('set');
    expect(item.tiles).toEqual(GROUP_TILES[group]);
    expect(item.tile).toBe(GROUP_TILES[group][0]);
  });
  it('a purchase names the district and the price the buyer paid', () => {
    const item = feedItem({ type: 'own', tile: tileId, owner: 'sana', reason: 'buy' }, ctx);
    expect(item.kind).toBe('buy');
    expect(item.tile).toBe(tileId);
    expect(item.amount).toBe(-TILES[tileId].price);
    expect(item.amountWho).toBe('sana');
  });
});

describe('kinds and money', () => {
  it('classifies cash by reason and the rest by type', () => {
    expect(kindOf({ type: 'cash', reason: 'salary' })).toBe('salary');
    expect(kindOf({ type: 'cash', reason: 'traffic' })).toBe('fine');
    expect(kindOf({ type: 'cash', reason: 'whatever' })).toBe('cash');
    expect(kindOf({ type: 'level', reason: 'upgrade' })).toBe('build');
    expect(kindOf({ type: 'level', reason: 'sell' })).toBe('sell');
    expect(kindOf({ type: 'auction_end' })).toBe('auction');
    expect(kindOf({ type: 'snatch_end' })).toBe('snatch');
    expect(kindOf({ type: 'turn' })).toBe('round');
    expect(kindOf(null)).toBe('note');
  });
  it('moneyOf reads the numbers the player cares about', () => {
    expect(moneyOf({ type: 'ride', player: 'a', fare: 25000 })).toEqual({ amount: -25000, who: 'a' });
    expect(moneyOf({ type: 'mortgage', player: 'a', value: 35000 })).toEqual({ amount: 35000, who: 'a' });
    expect(moneyOf({ type: 'auction_end', winner: 'a', amount: 90000 })).toEqual({ amount: -90000, who: 'a' });
    expect(moneyOf({ type: 'auction_end', winner: null })).toBeNull();
    expect(moneyOf({ type: 'dice' })).toBeNull();
  });
  it('moneyChip shows a sign only for my own money', () => {
    expect(moneyChip({ amount: -32000, amountWho: 'me' }, 'me')).toEqual({ text: '−₹32,000', sign: -1, mine: true });
    expect(moneyChip({ amount: 80000, amountWho: 'me' }, 'me')).toEqual({ text: '+₹80,000', sign: 1, mine: true });
    expect(moneyChip({ amount: 80000, amountWho: 'rav' }, 'me')).toEqual({ text: '₹80,000', sign: 0, mine: false });
    expect(moneyChip({ amount: null }, 'me')).toBeNull();
  });
  it('rent paid TO me is my gain (the paying line carries the amount)', () => {
    expect(moneyChip({ amount: -32000, amountWho: 'rav', amountOther: 'me' }, 'me')).toEqual({ text: '+₹32,000', sign: 1, mine: true });
    expect(moneyChip({ amount: -32000, amountWho: 'rav', amountOther: 'sana' }, 'me').mine).toBe(false);
  });
});

describe('buildFeed', () => {
  const entry = (id, text, ev, extra) => ({ id, text, tone: 'info', icon: '*', player: ev && ev.player, ev, at: 1000 + id, ...extra });
  it('is newest first and capped', () => {
    const log = [1, 2, 3, 4].map((i) => entry(i, `line ${i}`, { type: 'chai', player: 'a' }));
    expect(buildFeed(log, { max: 2 }).map((r) => r.id)).toEqual([4, 3]);
    expect(buildFeed([], {})).toEqual([]);
    expect(buildFeed(null, {})).toEqual([]);
  });
  it('only looks at the tail of a long log: same rows as the whole log, a fraction of the work', () => {
    const log = [];
    for (let i = 1; i <= 200; i += 1) {
      log.push(entry(i * 2 - 1, `Sana rolled ${(i % 5) + 1}`, { type: 'dice', player: 'sana', values: [(i % 5) + 1] }));
      log.push(entry(i * 2, 'Sana landed on Madhapur', { type: 'land', player: 'sana', tile: tileId }, { tile: tileId }));
    }
    const full = buildFeed(log, { max: 400 }); // the whole log (400 entries -> 200 joined rows)
    expect(full).toHaveLength(200);
    for (const max of [1, 3, 14, 60]) {
      expect(buildFeed(log, { max })).toEqual(full.slice(0, max));
    }
  });
  it('joins "rolled 5" and "landed on X" into one row that keeps the roll id and time', () => {
    const log = [
      entry(1, 'Sana rolled 5', { type: 'dice', player: 'sana', values: [5] }),
      entry(2, 'Sana landed on Madhapur', { type: 'land', player: 'sana', tile: tileId }, { tile: tileId }),
    ];
    const rows = buildFeed(log);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Sana rolled 5 and landed on Madhapur');
    expect(rows[0].id).toBe(1);
    expect(rows[0].at).toBe(1001);
    expect(rows[0].tile).toBe(tileId);
  });
  it('does not join different players, or a six (roll again)', () => {
    const a = [entry(1, 'Sana rolled 5', { type: 'dice', player: 'sana' }), entry(2, 'Ravi landed on Madhapur', { type: 'land', player: 'rav', tile: tileId }, { tile: tileId })];
    expect(buildFeed(a)).toHaveLength(2);
    const b = [entry(1, 'Sana rolled 6: six, roll again!', { type: 'dice', player: 'sana' }), entry(2, 'Sana landed on Madhapur', { type: 'land', player: 'sana', tile: tileId }, { tile: tileId })];
    expect(buildFeed(b)).toHaveLength(2);
  });
  it('mergeRollText', () => {
    expect(mergeRollText('You rolled 3', 'You landed on START')).toBe('You rolled 3 and landed on START');
    expect(mergeRollText('You rolled 3', 'Sana landed on START')).toBeNull();
    expect(mergeRollText('', 'x')).toBeNull();
  });
  it('entries without an engine event (heads-up notes) still make rows', () => {
    const rows = buildFeed([{ id: 'n1', text: 'Sana is close to the target', tone: 'warn' }]);
    expect(rows[0]).toMatchObject({ kind: 'note', tone: 'warn', at: null });
    expect(feedEntry(null)).toBeNull();
  });
});

describe('ages', () => {
  it('relativeAge', () => {
    expect(relativeAge(0)).toBe('now');
    expect(relativeAge(7000)).toBe('now');
    expect(relativeAge(12000)).toBe('12s');
    expect(relativeAge(3 * 60000)).toBe('3m');
    expect(relativeAge(2 * 3600000)).toBe('2h');
    expect(relativeAge(-5)).toBe('now');
  });
  it('ageFade is 0 while fresh and grows to 1', () => {
    expect(ageFade(5000)).toBe(0);
    expect(ageFade(20000)).toBe(0);
    expect(ageFade(130000)).toBeGreaterThan(0.4);
    expect(ageFade(130000)).toBeLessThan(0.6);
    expect(ageFade(10 * 60000)).toBe(1);
  });
});

describe('chipify', () => {
  const text = (parts) => parts.map((p) => p.s).join('');
  it('turns names, "You", tiles and amounts into chips and loses nothing', () => {
    const s = 'Sana paid ₹32,000 rent to You';
    const parts = chipify(s, { players, me: 'me' });
    expect(text(parts)).toBe(s);
    expect(parts.filter((p) => p.t === 'player').map((p) => [p.s, p.color])).toEqual([['Sana', '#4cc9f0'], ['You', '#ff4d6d']]);
    expect(parts.find((p) => p.t === 'amount').s).toBe('₹32,000');
  });
  it('names a tile', () => {
    const name = TILES[tileId].name;
    const parts = chipify(`Ravi landed on ${name}`, { players, me: 'me' });
    expect(parts.find((p) => p.t === 'tile').s).toBe(name);
  });
  it('matches whole words only and handles possessives', () => {
    const parts = chipify("Ravina saw Ravi's Sanatorium", { players, me: 'me' });
    expect(parts.filter((p) => p.t === 'player').map((p) => p.s)).toEqual(['Ravi']);
  });
  it('"you" in lower case is the local player too; without a local player it stays text', () => {
    expect(chipify('gave this to you', { players, me: 'me' }).some((p) => p.t === 'player' && p.s === 'you')).toBe(true);
    expect(chipify('gave this to you', { players, me: 'zzz' }).some((p) => p.t === 'player')).toBe(false);
  });
  it('survives odd input', () => {
    expect(chipify('', { players })).toEqual([]);
    expect(chipify('plain text', {})).toEqual([{ t: 'text', s: 'plain text' }]);
    const weird = [{ id: 'x', name: 'A+B (x)', color: '#fff' }];
    expect(text(chipify('A+B (x) wins', { players: weird }))).toBe('A+B (x) wins');
  });
  it('rowLabel names the tile a tap shows', () => {
    expect(rowLabel({ text: 'Ravi bought it', tile: tileId })).toContain(TILES[tileId].name);
    expect(rowLabel({ text: 'Plain', tile: null })).toBe('Plain');
  });
});

describe('power card rows', () => {
  it('the four events are one kind with their own label and icon', () => {
    for (const type of ['power_draw', 'power_play', 'power_trigger', 'power_expire']) expect(kindOf({ type }), type).toBe('power');
    const item = feedItem({ type: 'power_play', player: 'rav', card: 'shield' }, ctx);
    expect(item).toMatchObject({ text: 'Ravi played Shield', kind: 'power', label: 'POWER', players: ['rav'] });
    expect(item.icon).toBeTruthy();
  });
  it('a swap row lists both players; a trigger row keeps the rent amount in its words for the chips', () => {
    expect(feedItem({ type: 'power_play', player: 'sana', card: 'swap', target: 'rav' }, ctx).text).toBe('Sana swapped places with Ravi');
    const trig = feedItem({ type: 'power_trigger', player: 'rav', card: 'shield', amount: 42000, other: 'sana' }, ctx);
    expect(trig.text).toMatch(/Ravi's Shield blocked .*42,000 of rent/);
    expect(trig.players).toEqual(['rav', 'sana']);
  });
  it('an expiry row is not about anyone in particular but still renders', () => {
    expect(feedItem({ type: 'power_expire', player: 'rav', count: 2 }, ctx).text).toBe('2 power cards expired');
  });
});
