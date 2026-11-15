import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AutoMascot, { MASCOT_MOODS } from './AutoMascot.jsx';
import PieceArt, { PIECE_IDS } from './PieceArt.jsx';

const render = (Component, props) => renderToStaticMarkup(h(Component, props));

describe('AutoMascot', () => {
  it('has distinct readable poses and props for every supported gameplay mood', () => {
    const drawings = MASCOT_MOODS.map(mood => render(AutoMascot, { mood, animated: false }));
    expect(new Set(drawings.map(svg => svg.replace(/auto[^" ]*/g, 'auto'))).size).toBe(MASCOT_MOODS.length);
    for (const mood of MASCOT_MOODS) {
      const svg = render(AutoMascot, { mood, title: 'Your city guide' });
      expect(svg).toContain(`data-mood="${mood}"`);
      expect(svg).toContain('role="img"');
      expect(svg).toContain('<title>Your city guide</title>');
      expect(svg).not.toMatch(/NaN|undefined/);
    }
    expect(render(AutoMascot, { mood: 'buy' })).toContain('am-key');
    expect(render(AutoMascot, { mood: 'traffic' })).toContain('am-traffic');
    expect(render(AutoMascot, { mood: 'earn' })).toContain('am-coins');
  });
  it('is decorative unless named and can render without animation or a known mood', () => {
    const svg = render(AutoMascot, { mood: 'unknown', animated: false });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('data-mood="welcome"');
    expect(svg).not.toContain('is-animated');
  });
});

describe('Articulated player pieces', () => {
  const parts = { pearl: 'piece-gleam', auto: 'piece-wheel', handi: 'piece-lid', chai: 'piece-steam', bat: 'piece-bat', camera: 'piece-reel' };
  it('gives each token independent moving parts without forcing thumbnail motion', () => {
    for (const piece of PIECE_IDS) {
      const svg = render(PieceArt, { piece });
      expect(svg).toContain(parts[piece]);
      expect(svg).not.toContain('is-animated');
    }
  });
});
