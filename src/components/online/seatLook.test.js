// A lobby seat shows the player's full look: frame on the avatar, the title chip and the loadout chips under the name.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// strict art mock like the other online tests: only the avatar; frames / titles / chips come from the real cosmetics art
vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
}));

const { default: Seat } = await import('./Seat.jsx');

const FULL = { frame: 'frame-aurora', title: 'title-kingpin', dice: 'dice-gold', trail: 'trail-flame', board: 'board-goldleaf' };
const seat = (cosmetics, extra = {}) => renderToStaticMarkup(h(Seat, { player: { id: 'a', name: 'Anil', avatar: 1, connected: true, cosmetics }, color: '#ff4d6d', ...extra }));

describe('Seat: the full look', () => {
  it('a full look renders the frame, the title chip and three loadout chips', () => {
    const html = seat(FULL);
    expect(html).toContain('data-frame="frame-aurora"');
    expect(html).toContain('The Kingpin');
    expect(html).toContain('data-rarity="legendary"');
    expect(html.match(/class="lo-chip /g)).toHaveLength(3);
    for (const name of ['Solid Gold', 'Dragon Flame', 'Golconda Gilded']) expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain('lt-seat__loadout');
    expect(html.startsWith('<li')).toBe(true);
  });

  it('the title is the small chip (the seat is narrow) and sits above the loadout, which sits above the tags', () => {
    const html = seat(FULL, { isHost: true });
    expect(html.indexOf('lt-seat__title')).toBeLessThan(html.indexOf('lt-seat__loadout'));
    expect(html.indexOf('lt-seat__loadout')).toBeLessThan(html.indexOf('lt-seat__tags'));
    expect(html).toMatch(/lt-seat__title[\s\S]*font-size:11px/);
  });

  it('a seat without cosmetics renders exactly as before: no title, no chips, no empty box', () => {
    for (const none of [undefined, null, {}, { dice: 'junk' }]) {
      const html = seat(none);
      expect(html).not.toContain('lt-seat__title');
      expect(html).not.toContain('lo-chip');
      expect(html).not.toContain('class="lo');
      expect(html).toContain('Anil');
      expect(html).toContain('lt-seat__tags');
    }
  });

  it('a frame-and-title only look draws no chips', () => {
    const html = seat({ frame: 'frame-lake', title: 'title-chai' });
    expect(html).toContain('Chai Connoisseur');
    expect(html).not.toContain('lo-chip');
  });

  it('keeps the remove and add-friend buttons outside the chip row', () => {
    const html = seat(FULL, { canRemove: true, onRemove() {} });
    expect(html).toContain('Remove Anil from the room');
    expect(html.indexOf('lt-seat__loadout')).toBeLessThan(html.indexOf('lt-seat__acts'));
  });
});

describe('seat styles', () => {
  const css = readFileSync(new URL('../../styles/lobby-seats.css', import.meta.url), 'utf8');
  it('at 7-8 seats at most two chips are shown and the piece line stays hidden', () => {
    expect(css).toMatch(/data-n='7'\] \.lt-seat__loadout \.lo-chip:nth-of-type\(n \+ 3\)/);
    expect(css).toMatch(/data-n='8'\] \.lt-seat__loadout \.lo-chip:nth-of-type\(n \+ 3\)/);
    expect(css).toMatch(/data-n='7'\] \.lt-seat__pieceline/);
  });
});
