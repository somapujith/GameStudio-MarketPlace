import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TILES, GROUPS } from '@shared/board.js';
import { applyMap, DEFAULT_MAP } from '@shared/maps.js';
import { AndhraScene, SCENES, sceneKey } from './scenes.jsx';
import { AndhraIconGlyph, ICON_KEYS, andhraIconKey } from './icons.jsx';
import { AndhraBuilding, collectionForGroup } from './buildings.jsx';
import { AndhraCentre } from './center.jsx';
import { AndhraMascot } from './mascot.jsx';
import { ANDHRA_DRAW } from './pieces.jsx';
import { ArtMapContext, artMapId } from './artMap.js';
import { COLLECTION_TILES, collectionOf } from './collections.js';
import LocationScene from '../LocationScene.jsx';
import TileIcon from '../TileIcon.jsx';
import BuildingArt from '../BuildingArt.jsx';
import PieceArt from '../PieceArt.jsx';
import AutoMascot from '../AutoMascot.jsx';

const render = (node) => renderToStaticMarkup(node);
const inMap = (map, node) => render(h(ArtMapContext.Provider, { value: map }, node));

const DESTINATIONS = COLLECTION_TILES.flat();
const HUBS = [5, 14, 23];
const CORNERS = [0, 9, 18, 27];
const AUCTION = 32;
const CARDS = [2, 12, 21, 30];
const SCENE_BUDGET = 4096; // bytes of raw markup per scene (a small SVG each: most are 3-4 KB, hubs and corners 2-3 KB)

beforeAll(() => { applyMap('andhra'); });
afterAll(() => { applyMap(DEFAULT_MAP); }); // names are global: never leak the map into other tests

describe('Andhra art: structure', () => {
  it('knows the 24 destinations of the 8 collections, by board slot', () => {
    expect(DESTINATIONS).toHaveLength(24);
    for (const id of DESTINATIONS) expect(TILES[id].type).toBe('property');
    expect(TILES.filter((t) => t.type === 'property').map((t) => t.id).sort((a, b) => a - b)).toEqual([...DESTINATIONS].sort((a, b) => a - b));
    expect(collectionOf(31)).toBe(6);
    expect(collectionOf(5)).toBe(-1);
  });

  it('artMapId normalises ids, cfgs and states', () => {
    expect(artMapId('andhra')).toBe('andhra');
    expect(artMapId({ map: 'andhra' })).toBe('andhra');
    expect(artMapId({ cfg: { map: 'andhra' } })).toBe('andhra');
    expect(artMapId({})).toBe('hyderabad');
    expect(artMapId('nowhere')).toBe('hyderabad');
    expect(artMapId(undefined)).toBe('hyderabad');
  });
});

describe('AndhraScene', () => {
  const all = [...DESTINATIONS, ...HUBS, ...CORNERS, AUCTION, ...CARDS];

  it('has a scene for every destination, hub, corner, the auction and both decks', () => {
    for (const id of all) {
      expect(sceneKey(TILES[id]), `tile ${id}`).not.toBeNull();
      expect(SCENES[sceneKey(TILES[id])], `tile ${id}`).toBeDefined();
    }
    expect(Object.keys(SCENES).filter((k) => /^\d+$/.test(k))).toHaveLength(DESTINATIONS.length + HUBS.length + CORNERS.length + 1);
  });

  it('renders a non-empty, decorative, small SVG for each', () => {
    let max = 0;
    for (const id of all) {
      const markup = render(h(AndhraScene, { tile: TILES[id], animated: false }));
      expect(markup.startsWith('<svg'), `tile ${id}`).toBe(true);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('data-map="andhra"');
      expect(markup).toContain('viewBox="0 0 400 220"');
      expect(markup).toContain(`data-location="${id}"`);
      expect(markup).not.toContain('NaN');
      expect(markup).not.toContain('undefined');
      expect(markup).not.toMatch(/<(filter|image|foreignObject|script)/i);
      expect(markup.length, `tile ${id} markup size`).toBeLessThan(SCENE_BUDGET);
      max = Math.max(max, markup.length);
    }
    expect(max).toBeGreaterThan(500); // a real picture, not an empty shell
  });

  it('a titled scene is an image with the tile name; an untitled one is hidden from assistive tech', () => {
    const markup = render(h(AndhraScene, { tile: TILES[17], title: true }));
    expect(markup).toContain('role="img"');
    expect(markup).toContain(`aria-label="${TILES[17].name}"`);
    expect(markup).toContain(`<title>${TILES[17].name}</title>`);
    expect(markup).not.toContain('aria-hidden');
  });

  it('shows three distinct business levels on a destination and clamps odd levels', () => {
    const levels = [0, 1, 2].map((level) => render(h(AndhraScene, { tile: 31, level })));
    expect(new Set(levels).size).toBe(3);
    expect(levels[0]).not.toContain('ls-expansion');
    expect(levels[2]).toContain('ls-expansion');
    expect(render(h(AndhraScene, { tile: 31, level: 50 }))).toContain('data-level="2"');
    expect(render(h(AndhraScene, { tile: 31, level: -2 }))).toContain('data-level="0"');
  });

  it('keeps every destination visually different (scene + business)', () => {
    const sigs = DESTINATIONS.map((id) => render(h(AndhraScene, { tile: id, level: 1, animated: false })));
    expect(new Set(sigs).size).toBe(24);
  });

  it('falls back gracefully for unknown ids, missing tiles and non-property squares', () => {
    for (const tile of [999, -1, undefined, {}, { id: 77, type: 'property', group: 'nope' }]) {
      const markup = render(h(AndhraScene, { tile }));
      expect(markup.startsWith('<svg')).toBe(true);
      expect(markup).toContain('data-setting="generic"');
      expect(markup).not.toContain('NaN');
    }
    expect(render(h(AndhraScene, { tile: 0, level: 2 }))).toContain('data-level="2"'); // a corner takes no business
    expect(render(h(AndhraScene, { tile: 0, level: 2 }))).not.toContain('ls-business');
  });

  it('draws the group colour as the footer border (it follows the active map)', () => {
    const markup = render(h(AndhraScene, { tile: TILES[33] }));
    expect(markup).toContain(`fill="${GROUPS[TILES[33].group].color}"`);
  });
});

describe('Andhra icons, buildings, centrepiece, mascot and tokens', () => {
  it('has an icon for every destination, hub, corner, the auction and both decks', () => {
    for (const id of [...DESTINATIONS, ...HUBS, ...CORNERS, AUCTION]) expect(ICON_KEYS, `tile ${id}`).toContain(String(id));
    expect(ICON_KEYS).toEqual(expect.arrayContaining(['luck', 'drama']));
    for (const key of ICON_KEYS) {
      const markup = render(h('svg', null, h(AndhraIconGlyph, { tile: /^\d+$/.test(key) ? Number(key) : key })));
      expect(markup, key).toContain('data-andhra-icon');
      expect(markup.length, key).toBeGreaterThan(120);
      expect(markup.length, key).toBeLessThan(2400);
      expect(markup).not.toContain('NaN');
    }
    expect(andhraIconKey({ type: 'card', deck: 'drama' })).toBe('drama');
    expect(andhraIconKey('chai')).toBe(18);
    expect(andhraIconKey({ id: 999 })).toBeNull();
  });

  it('renders three levels of building art for every collection', () => {
    for (const group of Object.keys(GROUPS)) {
      const marks = [0, 1, 2].map((level) => render(h(AndhraBuilding, { group, level, size: 64 })));
      expect(new Set(marks).size, group).toBe(3);
      for (const m of marks) {
        expect(m).toContain('aria-hidden="true"');
        expect(m).toContain('data-map="andhra"');
        expect(m).not.toContain('NaN');
        expect(m.length).toBeLessThan(4200);
      }
    }
    expect(collectionForGroup('bazaar')).toBe(0);
    expect(collectionForGroup('newcity')).toBe(7);
    expect(collectionForGroup(undefined, 'tech')).toBe(7);
  });

  it('draws the centrepiece: decorative, id-safe, with the rivers and the Kalamkari border', () => {
    const markup = render(h(AndhraCentre));
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="ah-centre"');
    expect(markup).toContain('<symbol');
    expect(markup).not.toMatch(/<(filter|image|foreignObject)|mix-blend|backdrop/);
    expect(markup).not.toContain('animation');
    const two = render(h('div', null, h(AndhraCentre), h(AndhraCentre)));
    const ids = [...two.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('re-skins the six piece ids as the concept tokens', () => {
    expect(Object.keys(ANDHRA_DRAW).sort()).toEqual(['auto', 'bat', 'camera', 'chai', 'handi', 'pearl']);
    for (const p of Object.keys(ANDHRA_DRAW)) {
      const hyd = inMap('hyderabad', h(PieceArt, { piece: p, color: '#3ddc97' }));
      const and = inMap('andhra', h(PieceArt, { piece: p, color: '#3ddc97' }));
      expect(and).not.toBe(hyd);
      expect(and).toContain('<svg');
      expect(and).not.toContain('NaN');
    }
  });

  it('the Andhra guide keeps the mascot moods and classes the motion CSS animates', () => {
    for (const mood of ['welcome', 'waiting', 'roll', 'buy', 'earn', 'traffic', 'win', 'nonsense']) {
      const m = render(h(AndhraMascot, { mood }));
      expect(m).toContain('auto-mascot');
      expect(m).toContain('am-body');
      expect(m).toContain('aria-hidden="true"');
    }
    expect(inMap('andhra', h(AutoMascot, { mood: 'win' }))).toContain('data-map="andhra"');
    expect(inMap('hyderabad', h(AutoMascot, { mood: 'win' }))).not.toContain('data-map');
  });
});

describe('the map switch picks the art; Hyderabad stays as it was', () => {
  it('LocationScene / TileIcon / BuildingArt follow ArtMapContext', () => {
    const tile = TILES[20];
    expect(inMap('andhra', h(LocationScene, { tile }))).toContain('data-map="andhra"');
    expect(inMap('hyderabad', h(LocationScene, { tile }))).not.toContain('data-map="andhra"');
    expect(inMap('andhra', h(TileIcon, { tile }))).toContain('data-andhra-icon="20"');
    expect(inMap('hyderabad', h(TileIcon, { tile }))).not.toContain('data-andhra-icon');
    expect(inMap('andhra', h(BuildingArt, { theme: 'venue', group: 'lake', level: 1 }))).toContain('data-map="andhra"');
    expect(inMap('hyderabad', h(BuildingArt, { theme: 'venue', group: 'lake', level: 1 }))).not.toContain('data-map="andhra"');
  });

  it('with no context it follows the active client map (applyMap)', () => {
    expect(render(h(LocationScene, { tile: TILES[20] }))).toContain('data-map="andhra"'); // beforeAll applied andhra
    applyMap('hyderabad');
    expect(render(h(LocationScene, { tile: TILES[20] }))).not.toContain('data-map="andhra"');
    applyMap('andhra');
  });
});
