// Loadout: the equipped dice / trail / board as small labelled chips (nothing when nothing is equipped).
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Loadout, { hasLegendary, loadoutItems } from './Loadout.jsx';

const html = (props) => renderToStaticMarkup(h(Loadout, props));

describe('Loadout', () => {
  it('renders nothing at all when nothing (or only junk) is equipped', () => {
    expect(html({ cosmetics: {} })).toBe('');
    expect(html({ cosmetics: null })).toBe('');
    expect(html({ cosmetics: undefined })).toBe('');
    expect(html({ cosmetics: 'frame-lake' })).toBe('');
    expect(html({ cosmetics: { dice: 'nope', trail: 7, board: {} } })).toBe('');
  });

  it('never draws the frame or the title as a chip (they have their own places)', () => {
    expect(html({ cosmetics: { frame: 'frame-aurora', title: 'title-kingpin' } })).toBe('');
  });

  it('each kind becomes a chip labelled with the item name', () => {
    const dice = html({ cosmetics: { dice: 'dice-gold' } });
    expect(dice).toContain('aria-label="Solid Gold"');
    expect(dice).toContain('lo-chip--dice');
    expect(dice).toContain('<svg');
    const trail = html({ cosmetics: { trail: 'trail-petals' } });
    expect(trail).toContain('aria-label="Rose Petals"');
    expect(trail).toContain('lo-chip--trail');
    const board = html({ cosmetics: { board: 'board-lake' } });
    expect(board).toContain('aria-label="Hussain Sagar Night"');
    expect(board).toContain('lo-chip--board');
  });

  it('keeps dice, trail, board in that order and drops unknown ids and wrong kinds', () => {
    const out = html({ cosmetics: { board: 'board-lake', dice: 'dice-ivory', trail: 'dice-gold', title: 'title-chai' } });
    expect(out.match(/data-kind="(\w+)"/g)).toEqual(['data-kind="dice"', 'data-kind="board"']);
    expect(out).not.toContain('Solid Gold');
    expect(loadoutItems({ trail: 'trail-dust', dice: 'dice-ivory', board: 'zzz' }).map((x) => x.kind)).toEqual(['dice', 'trail']);
  });

  it('tints the ring by rarity: legendary gold, epic violet', () => {
    const legend = html({ cosmetics: { dice: 'dice-gold' } });
    expect(legend).toContain('is-legendary');
    expect(legend).toContain('data-rarity="legendary"');
    expect(html({ cosmetics: { dice: 'dice-jade' } })).toContain('is-epic');
    expect(html({ cosmetics: { dice: 'dice-ivory' } })).toContain('is-common');
    expect(html({ cosmetics: { dice: 'dice-ivory' } })).not.toContain('is-legendary');
  });

  it("'chips' shows art only, 'row' shows the names and is a bit larger", () => {
    const chips = html({ cosmetics: { dice: 'dice-gold' } });
    expect(chips).toContain('lo--chips');
    expect(chips).not.toContain('lo-chip__name');
    expect(chips).toContain('--lo-px:18px');
    const row = html({ cosmetics: { dice: 'dice-gold', trail: 'trail-flame' }, variant: 'row' });
    expect(row).toContain('lo--row');
    expect(row).toContain('<span class="lo-chip__name">Solid Gold</span>');
    expect(row).toContain('<span class="lo-chip__name">Dragon Flame</span>');
    expect(row).toContain('--lo-px:22px');
    expect(html({ cosmetics: { dice: 'dice-gold' }, size: 26 })).toContain('--lo-px:26px');
  });

  it('chips are display only: no buttons, no tab stops', () => {
    const out = html({ cosmetics: { dice: 'dice-gold', trail: 'trail-flame', board: 'board-lake' }, variant: 'row' });
    expect(out).not.toMatch(/<button|<a |tabindex/);
  });

  it('showTitle adds the title chip in front, and alone is enough to render', () => {
    const out = html({ cosmetics: { title: 'title-chai', dice: 'dice-gold' }, showTitle: true });
    expect(out).toContain('Chai Connoisseur');
    expect(out.indexOf('Chai Connoisseur')).toBeLessThan(out.indexOf('Solid Gold'));
    expect(html({ cosmetics: { title: 'title-chai' }, showTitle: true })).toContain('Chai Connoisseur');
    expect(html({ cosmetics: { title: 'title-chai' } })).toBe('');
  });

  it('adds a caller class', () => {
    expect(html({ cosmetics: { dice: 'dice-ivory' }, className: 'lt-seat__loadout' })).toContain('lo lo--chips lt-seat__loadout');
  });
});

describe('hasLegendary', () => {
  it('is true when any equipped item is legendary', () => {
    expect(hasLegendary({ frame: 'frame-aurora' })).toBe(true);
    expect(hasLegendary({ title: 'title-kingpin' })).toBe(true);
    expect(hasLegendary({ dice: 'dice-gold' })).toBe(true);
    expect(hasLegendary({ frame: 'frame-nizam', title: 'title-chai' })).toBe(false);
    expect(hasLegendary(null)).toBe(false);
    expect(hasLegendary({ frame: 'nope' })).toBe(false);
  });
});
