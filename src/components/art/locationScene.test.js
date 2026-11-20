import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TILES } from '@shared/board.js';
import LocationScene, { LOCATION_ART } from './LocationScene.jsx';

const render = (props) => renderToStaticMarkup(h(LocationScene, props));

describe('LocationScene', () => {
  it('gives all 24 districts an explicit location illustration', () => {
    const districts = TILES.filter(t => t.type === 'property');
    expect(districts).toHaveLength(24);
    for (const tile of districts) {
      expect(LOCATION_ART[tile.id], tile.name).toBeDefined();
      const markup = render({ tile, title: true });
      expect(markup).toContain(`data-location="${tile.id}"`);
      expect(markup).toContain(`<title>${tile.name}</title>`);
      expect(markup).toContain(LOCATION_ART[tile.id].sign.replace(/&/g, '&amp;'));
    }
    expect(new Set(districts.map(t => LOCATION_ART[t.id].sign)).size).toBe(24);
  });

  it('renders every special square with a safe, decorative SVG', () => {
    for (const tile of TILES.filter(t => t.type !== 'property')) {
      const markup = render({ tile: tile.id, animated: false, compact: true });
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('viewBox="0 0 400 220"');
      expect(markup).not.toContain('is-animated');
      expect(markup).not.toContain('NaN');
    }
  });

  it('shows three distinct business levels and clamps invalid levels', () => {
    const levels = [0, 1, 2].map(level => render({ tile: 31, level }));
    expect(new Set(levels).size).toBe(3);
    expect(levels[0]).not.toContain('class="ls-expansion"');
    expect(levels[2].match(/class="ls-expansion"/g)).toHaveLength(2);
    expect(render({ tile: 31, level: 50 })).toContain('data-level="2"');
    expect(render({ tile: 31, level: -2 })).toContain('data-level="0"');
  });

  it('handles missing locations and separates gradient IDs in repeated scenes', () => {
    expect(render({ tile: 999 })).toContain('CITY CORNER');
    expect(render({})).not.toContain('NaN');
    const markup = renderToStaticMarkup(h('div', null, h(LocationScene, { tile: 7 }), h(LocationScene, { tile: 7 })));
    const ids = [...markup.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
