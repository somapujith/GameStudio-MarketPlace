// The avatar token: classes for turn / leader / mood / presence, the frame swap, and the blink stagger.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AvatarToken, { blinkDelay } from './AvatarToken.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const player = { id: 'p1', name: 'Asha', avatar: 3, color: '#ff4d6d', bankrupt: false };
const session = { me: 'p1', clock: null };

describe('blinkDelay', () => {
  it('is stable per id, within one blink cycle, and differs between players', () => {
    expect(blinkDelay('p1')).toBe(blinkDelay('p1'));
    for (const id of ['p1', 'p2', 'p3', 'a-very-long-id-0001', '']) {
      const d = blinkDelay(id);
      expect(d).toBeLessThanOrEqual(0);
      expect(d).toBeGreaterThan(-5.4);
    }
    expect(new Set(['p1', 'p2', 'p3', 'p4'].map(blinkDelay)).size).toBeGreaterThan(1);
  });
});

describe('<AvatarToken>', () => {
  it('draws the rim in the player colour and the face, with a footprint of size + 8', () => {
    const out = html(createElement(AvatarToken, { session, player, size: 40 }));
    expect(out).toContain('class="avt"');
    expect(out).toContain('avt__rim');
    expect(out).toContain('avt__face');
    expect(out).toContain('--sz:40px');
    expect(out).toContain('--pc:#ff4d6d');
  });

  it('shows the turn ripple, the leader crown, a reaction and the presence dot only when asked', () => {
    const quiet = html(createElement(AvatarToken, { session, player }));
    expect(quiet).not.toMatch(/avt__ripple|avt__crown|avt__dot|is-turn|is-up/);
    const loud = html(createElement(AvatarToken, { session, player, turn: true, leader: true, mood: 'up', offline: true }));
    expect(loud).toContain('avt__ripple');
    expect(loud).toContain('avt__crown');
    expect(loud).toContain('is-up');
    expect(loud).toContain('avt__dot');
  });

  it('opts in to the idle blink with `live` and drops the crown for a bankrupt player', () => {
    expect(html(createElement(AvatarToken, { session, player, live: true }))).toContain('av-live');
    expect(html(createElement(AvatarToken, { session, player })).includes('av-live')).toBe(false);
    const out = html(createElement(AvatarToken, { session, player: { ...player, bankrupt: true }, leader: true }));
    expect(out).toContain('is-out');
    expect(out).not.toContain('avt__crown');
  });

  it('falls back to a neutral colour for a bad colour value', () => {
    expect(html(createElement(AvatarToken, { session, player: { ...player, color: 'red; background:url(x)' } }))).toContain('--pc:#8aa09b');
  });
});
