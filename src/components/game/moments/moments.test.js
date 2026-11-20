import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LUCK_CARDS, DRAMA_CARDS } from '@shared/cards.js';
import { cardEffect, countAt, districtCount, newlyOut, outCopy, recapTiles, shareText, sixCopy, sixStep } from './momentsModel.js';
import { POOL_MAX, blank, clampCount, spawn, step } from './particles.js';
import { kickerOf, stepDelay } from '../GameOverModal.jsx';
import { setHeadline } from '../SetCelebration.jsx';
import MomentBanner from './MomentBanner.jsx';
import CountUp from './CountUp.jsx';
import Confetti from './Confetti.jsx';

const html = (n) => renderToString(n).replaceAll('<!-- -->', '');
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('cardEffect', () => {
  it('reads every real card into a signed chip', () => {
    for (const c of [...LUCK_CARDS, ...DRAMA_CARDS]) {
      const e = cardEffect({ cardId: c.id, kind: c.kind, text: c.text });
      expect(e, c.id).toBeTruthy();
      expect(['up', 'down', 'snatch', 'move']).toContain(e.tone);
      expect(e.label.length).toBeGreaterThan(2);
    }
  });
  it('colours money up green and down red, snatch gold with a bolt', () => {
    expect(cardEffect({ cardId: 'investor' })).toEqual({ tone: 'up', label: '+₹1,00,000' });
    const down = DRAMA_CARDS.find((c) => c.effect.type === 'cash' && c.effect.amount < 0);
    expect(cardEffect({ cardId: down.id })).toMatchObject({ tone: 'down' });
    expect(cardEffect({ cardId: down.id }).label.startsWith('−')).toBe(true);
    const sn = LUCK_CARDS.find((c) => c.effect.type === 'snatch');
    expect(cardEffect({ cardId: sn.id })).toMatchObject({ tone: 'snatch', bolt: true, label: '+1 Snatch button' });
    expect(cardEffect({ cardId: sn.id, capped: true })).toMatchObject({ tone: 'up' });
  });
  it('falls back to the first rupee amount in the text, else nothing', () => {
    expect(cardEffect({ kind: 'bad', text: 'Pay ₹50,000 for gifts.' })).toEqual({ tone: 'down', label: '−₹50,000' });
    expect(cardEffect({ kind: 'good', text: 'Collect ₹8,000.' })).toEqual({ tone: 'up', label: '+₹8,000' });
    expect(cardEffect({ kind: 'neutral', text: 'Go somewhere.' })).toBeNull();
    expect(cardEffect(null)).toBeNull();
  });
});

describe('six ribbon', () => {
  it('shows once per six, after the roll settled, never on resume', () => {
    let s = sixStep({ armed: false, extraRoll: true, busy: false }); // resume with a six pending
    expect(s).toEqual({ show: false, armed: false });
    s = sixStep({ armed: s.armed, extraRoll: true, busy: true }); // the roll plays
    expect(s).toEqual({ show: false, armed: true });
    s = sixStep({ armed: s.armed, extraRoll: true, busy: false }); // settled
    expect(s).toEqual({ show: true, armed: false });
    expect(sixStep({ armed: s.armed, extraRoll: true, busy: false }).show).toBe(false);
    expect(sixStep({ armed: false, extraRoll: false, busy: false }).armed).toBe(true);
  });
  it('words it for me and for others', () => {
    expect(sixCopy(true, 'Me')).toEqual({ kicker: 'You rolled a six', title: 'Roll again!' });
    expect(sixCopy(false, 'Ravi').kicker).toBe('Ravi rolled a six');
  });
});

describe('out stamp', () => {
  const players = [{ id: 'a', name: 'A', bankrupt: false }, { id: 'b', name: 'B', bankrupt: true, color: '#fff' }, { id: 'c', name: 'C', bankrupt: true }];
  it('finds only players who went out since last time', () => {
    const r = newlyOut(players, new Set(['b']));
    expect(r.out.map((p) => p.id)).toEqual(['c']);
    expect([...r.now].sort()).toEqual(['b', 'c']);
    expect(newlyOut(players, null).out).toEqual([]);
  });
  it('knows a forfeit from a bankruptcy, for me too', () => {
    const view = { players: [{ id: 'c', resigned: true }] };
    expect(newlyOut(players, new Set(['b']), { view }).out[0].resigned).toBe(true);
    expect(newlyOut(players, new Set(['b', 'c']), { me: 'c', resigned: true }).out).toEqual([]);
    expect(newlyOut([{ id: 'me', bankrupt: true }], new Set(), { me: 'me', resigned: true }).out[0].resigned).toBe(true);
    expect(outCopy({ name: 'Ravi', resigned: true }, false)).toMatchObject({ title: 'Ravi is out', word: 'FORFEIT' });
    expect(outCopy({ name: 'Ravi', resigned: false }, true)).toMatchObject({ title: 'You are out', word: 'BANKRUPT' });
  });
});

describe('game over helpers', () => {
  it('builds recap tiles from what the player actually did', () => {
    const view = { owners: ['me', null, 'me', 'x'], players: [{ id: 'me', stats: { rentEarned: 240000, upgrades: 1 } }, { id: 'x', stats: { biggestRent: 9 } }] };
    const moments = [{ id: 'x', icon: 'i', label: 'Biggest rent', who: 'X', value: '₹9' }];
    const t = recapTiles(view, 'me', moments);
    expect(t.map((x) => x.key)).toEqual(['rent', 'districts', 'upgrades', 'best']);
    expect(t.find((x) => x.key === 'districts').value).toBe('2');
    expect(t.find((x) => x.key === 'rent').value).toBe('₹2.4L');
    expect(districtCount(view.owners, 'x')).toBe(1);
    expect(recapTiles({ owners: [], players: [{ id: 'me' }] }, 'me').map((x) => x.key)).toEqual(['districts']);
    expect(recapTiles({ owners: [], players: [{ id: 'me', stats: { snatches: 3 } }] }, 'me').map((x) => x.key)).toContain('snatches');
  });
  it('words the share text', () => {
    expect(shareText({ won: true, worth: 1000000, rounds: 20 })).toBe('I won Nawabi Raj! net worth ₹10,00,000, 20 rounds.');
    expect(shareText({ won: false, rank: 2, total: 4, winnerName: 'Sana' })).toBe('I finished 2nd of 4 in Nawabi Raj. Sana took the city.');
  });
  it('counts up with an ease-out and lands exactly', () => {
    expect(countAt(1000, 0)).toBe(0);
    expect(countAt(1000, 0.5)).toBeGreaterThan(500);
    expect(countAt(1000, 1)).toBe(1000);
    expect(countAt(1000, 7)).toBe(1000);
  });
  it('raises the podium 3rd, 2nd, then 1st; kicker by result', () => {
    expect(stepDelay(3)).toBeLessThan(stepDelay(2));
    expect(stepDelay(2)).toBeLessThan(stepDelay(1));
    expect(kickerOf(true, 1)).toBe('Victory');
    expect(kickerOf(false, 3)).toBe('On the podium');
    expect(kickerOf(false, 5)).toBe('Game over');
  });
  it('headlines a completed set with the rent bonus', () => {
    expect(setHeadline({ name: 'Cyberabad' })).toMatch(/^Cyberabad complete! Rents ×/);
  });
});

describe('particle pool', () => {
  it('never exceeds 60 and clamps bad input', () => {
    expect(POOL_MAX).toBe(60);
    expect(clampCount(500)).toBe(60);
    expect(clampCount(-3)).toBe(0);
    expect(clampCount('x')).toBe(0);
    expect(clampCount(30.9)).toBe(30);
  });
  it('recycles one particle through burst, sparkle and rain until it dies', () => {
    for (const kind of ['burst', 'sparkle', 'rain']) {
      const p = spawn(blank(), kind, { rand: seeded(3), origin: { x: 50, y: 50 }, w: 300, h: 300 });
      expect(p.alive).toBe(true);
      let t = 0;
      while (step(p, 0.05) && t < 20) t += 0.05;
      expect(p.alive, kind).toBe(false);
      expect(t).toBeLessThan(10);
    }
  });
});

describe('components', () => {
  it('MomentBanner is aria-hidden, carries its life and copy', () => {
    const out = html(createElement(MomentBanner, { tone: 'player', color: '#3ddc97', kicker: 'Round 7', title: 'Ravi’s turn', life: 1700 }));
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('--mo-life:1700ms');
    expect(out).toContain('Ravi’s turn');
    expect(out).toContain('mo-rib--player');
  });
  it('CountUp keeps the final number for screen readers', () => {
    const out = html(createElement(CountUp, { value: 1260000, format: (n) => `n${n}`, delay: 100 }));
    expect(out).toContain('hg-sr');
    expect(out).toContain('n1260000');
  });
  it('Confetti renders only a hidden canvas (server render)', () => {
    expect(html(createElement(Confetti, { count: 99 }))).toContain('<canvas');
  });
});
