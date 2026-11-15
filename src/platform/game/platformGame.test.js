import { afterEach, describe, expect, it } from 'vitest';
import { alpha, hexToRgb, readableOn, themeVars } from './color.js';
import { defaultSettings, roomRequest } from './useHostRoom.js';
import { playersLabel } from './GameHero.jsx';
import { defaultSeats, seatOptions } from './seats.js';
import { isNotified, setNotified } from './notify.js';
import { detailRows, formatReleased, galleryItems, highlightList, idToQuery, metaDescription, sectionList, gameJsonLd } from './detailModel.js';
import { applyPageMeta } from './useDocTitle.js';
import { GAMES, getGame, relatedGames } from '@/games/registry.js';

describe('colour helpers', () => {
  it('parses hex and picks readable text', () => {
    expect(hexToRgb('#ffc857')).toEqual([255, 200, 87]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('nope')).toBeNull();
    expect(readableOn('#ffc857')).toBe('#0b1021');
    expect(readableOn('#1b1340')).toBe('#ffffff');
    expect(alpha('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });
  it('builds theme variables with fallbacks', () => {
    const v = themeVars({ accent: '#ffc857', accent2: '#ff8a3d', bg: '#1b1340' });
    expect(v['--g-accent']).toBe('#ffc857');
    expect(v['--g-on']).toBe('#0b1021');
    expect(themeVars(undefined)['--g-accent']).toMatch(/^#/);
  });
});

describe('hosting defaults', () => {
  it('collects defaults from the manifest settings schema', () => {
    const game = { settings: [{ key: 'goal', default: 70000 }, { key: 'rounds', default: 50 }, { key: 'x' }, null] };
    expect(defaultSettings(game)).toEqual({ goal: 70000, rounds: 50 });
    expect(defaultSettings({})).toEqual({});
    expect(defaultSettings(null)).toEqual({});
  });

  it('builds the create-table request: private, default settings, the chosen seats', () => {
    const game = { id: 'g', players: { min: 2, max: 6 }, settings: [{ key: 'goal', default: 70000 }] };
    expect(roomRequest(game, { maxPlayers: 3 })).toEqual({ gameId: 'g', visibility: 'private', settings: { goal: 70000 }, maxPlayers: 3 });
    expect(roomRequest(game, 'private')).toEqual({ gameId: 'g', visibility: 'private', settings: { goal: 70000 } }); // older call form
    expect(roomRequest(game)).toEqual({ gameId: 'g', visibility: 'private', settings: { goal: 70000 } });
    expect(roomRequest(game, 'public').visibility).toBe('public');
  });

  it('leaves out seat counts the game does not allow', () => {
    const game = { id: 'g', players: { min: 2, max: 6 } };
    for (const maxPlayers of [1, 7, 2.5, '4', NaN, null]) expect(roomRequest(game, { maxPlayers })).not.toHaveProperty('maxPlayers');
    expect(roomRequest(game, { maxPlayers: 6 }).maxPlayers).toBe(6);
  });
});

describe('seat choices', () => {
  it('lists min..max and preselects 4', () => {
    expect(seatOptions({ min: 2, max: 6 })).toEqual([2, 3, 4, 5, 6]);
    expect(defaultSeats(seatOptions({ min: 2, max: 6 }))).toBe(4);
  });
  it('falls back to the nearest allowed count and survives junk', () => {
    expect(defaultSeats(seatOptions({ min: 2, max: 3 }))).toBe(3);
    expect(defaultSeats(seatOptions({ min: 5, max: 8 }))).toBe(5);
    expect(seatOptions({ min: 3, max: 3 })).toEqual([3]);
    expect(seatOptions(undefined)).toEqual([2]);
    expect(seatOptions({ min: 4, max: 2 })).toEqual([4]);
  });
});

describe('labels', () => {
  it('formats player counts', () => {
    expect(playersLabel({ min: 2, max: 6 })).toBe('2–6 players');
    expect(playersLabel({ min: 4, max: 4 })).toBe('4 players');
    expect(playersLabel(undefined)).toBe('');
  });
});

describe('notify me flag', () => {
  afterEach(() => setNotified('zz-test', false));
  it('works without browser storage (falls back to memory)', () => {
    expect(isNotified('zz-test')).toBe(false);
    setNotified('zz-test', true);
    expect(isNotified('zz-test')).toBe(true);
    setNotified('zz-test', false);
    expect(isNotified('zz-test')).toBe(false);
  });
});

describe('listing model', () => {
  it('hides detail rows without a value and keeps order', () => {
    expect(detailRows({ status: 'live' }).map((r) => r.label)).toEqual(['Status']);
    const rows = detailRows({ status: 'live', category: 'board', publisher: 'GameHub', ageRating: '12+', languages: ['English', 'Hindi'], players: { min: 2, max: 6 }, duration: '20 min', tags: ['a', 'b'], released: '2026-03-04' });
    expect(rows.map((r) => r.label)).toEqual(['Publisher', 'Status', 'Released', 'Age rating', 'Languages', 'Players', 'Duration', 'Category', 'Tags']);
    expect(rows.find((r) => r.label === 'Languages').value).toBe('English, Hindi');
    expect(detailRows(null)).toEqual([]);
  });
  it('formats release dates and drops junk', () => {
    expect(formatReleased('2026-03-04')).toMatch(/4 Mar(ch)? 2026/);
    expect(formatReleased('nope')).toBe('');
    expect(formatReleased(undefined)).toBe('');
  });
  it('builds gallery slides from the manifest, or falls back to the cover', () => {
    const items = galleryItems({ art: { cover: () => null }, gallery: [{ kind: 'cover', caption: 'A' }, { kind: 'nope' }, { kind: 'scene', focus: 'left' }, null] });
    expect(items.map((i) => i.kind)).toEqual(['cover', 'scene']);
    expect(items[1].origin).toBe('18% 52%');
    expect(galleryItems({ art: { cover: () => null } })).toHaveLength(1);
    expect(galleryItems({})).toEqual([]);
  });
  it('lists only the sections that will render', () => {
    expect(sectionList(null)).toEqual([]);
    const live = sectionList(getGame('hyderabad-tycoon'), { live: true }).map((s) => s.id);
    expect(live).toEqual(['gd-about', 'gd-maps', 'gd-how', 'gd-gallery', 'gd-live', 'gd-board', 'gd-details']);
    const soon = sectionList(getGame('carrom-club'), { live: false }).map((s) => s.id);
    expect(soon).toEqual(['gd-about', 'gd-gallery', 'gd-details']);
    expect(sectionList({ id: 'x', status: 'live' }, { live: true }).map((s) => s.id)).toEqual(['gd-live', 'gd-board', 'gd-details']);
  });
  it('cleans highlights', () => {
    expect(highlightList({ highlights: [{ title: ' A ', text: 'b', icon: 'users' }, { text: 'no title' }, null] })).toEqual([{ title: 'A', text: 'b', icon: 'users' }]);
    expect(highlightList({})).toEqual([]);
  });
  it('meta description stays under 160 characters and has no ratings', () => {
    for (const g of GAMES) {
      const d = metaDescription(g);
      expect(d.length).toBeGreaterThan(20);
      expect(d.length).toBeLessThanOrEqual(160);
    }
    const ld = gameJsonLd(getGame('hyderabad-tycoon'), 'https://x.test/games/hyderabad-tycoon');
    expect(ld['@type']).toBe('VideoGame');
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld.numberOfPlayers).toMatchObject({ minValue: 2, maxValue: 6 });
  });
  it('turns a bad id into search words', () => {
    expect(idToQuery('hyderbad-tycoon')).toBe('hyderbad tycoon');
    expect(idToQuery('<script>x_y')).toBe('scriptx y');
    expect(idToQuery(undefined)).toBe('');
  });
});

describe('related games', () => {
  it('same category first, live before soon, never itself', () => {
    const tycoon = getGame('hyderabad-tycoon');
    const ids = relatedGames(tycoon).map((g) => g.id);
    expect(ids[0]).toBe('ludo-lanes'); // the other board game
    expect(ids).not.toContain('hyderabad-tycoon');
    const carrom = relatedGames(getGame('carrom-club')).map((g) => g.id);
    expect(carrom[0]).toBe('hyderabad-tycoon'); // live games beat same-category teasers only within a category: carrom has no live peer
    expect(carrom).not.toContain('carrom-club');
    expect(relatedGames(null)).toEqual([]);
    expect(relatedGames(tycoon, 2)).toHaveLength(2);
  });
});

describe('page meta tags', () => {
  // a tiny stand-in for the DOM: the tests run in node
  function fakeDom(initial = []) {
    const els = [...initial];
    const make = (tag) => {
      const attrs = {};
      const el = {
        tag,
        attrs,
        textContent: '',
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: (k) => (k in attrs ? attrs[k] : null),
        removeAttribute: (k) => { delete attrs[k]; },
        remove: () => { const i = els.indexOf(el); if (i >= 0) els.splice(i, 1); },
      };
      Object.defineProperty(el, 'type', { set: (v) => { attrs.type = v; }, get: () => attrs.type });
      return el;
    };
    const head = {
      appendChild: (el) => els.push(el),
      querySelector: (sel) => {
        const m = /^(\w+)\[(\w+)="([^"]+)"\]$/.exec(sel);
        return els.find((e) => e.tag === m[1] && e.attrs[m[2]] === m[3]) || null;
      },
    };
    return { els, head, make };
  }
  it('sets and restores description, canonical and Open Graph tags', () => {
    const dom = fakeDom();
    const old = dom.make('meta');
    old.setAttribute('name', 'description');
    old.setAttribute('content', 'old');
    dom.els.push(old);
    globalThis.document = { head: dom.head, title: '', createElement: dom.make };
    globalThis.window = { location: { origin: 'https://x.test' } };
    try {
      const undo = applyPageMeta({ title: 'T', description: 'New  text', path: '/games/x', jsonLd: { '@type': 'VideoGame' } });
      expect(old.getAttribute('content')).toBe('New text');
      expect(dom.head.querySelector('meta[property="og:title"]').getAttribute('content')).toBe('T');
      expect(dom.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe('https://x.test/games/x');
      expect(dom.els.some((e) => e.attrs.type === 'application/ld+json')).toBe(true);
      undo();
      expect(old.getAttribute('content')).toBe('old');
      expect(dom.head.querySelector('meta[property="og:title"]')).toBeNull();
      expect(dom.head.querySelector('link[rel="canonical"]')).toBeNull();
      expect(dom.els).toEqual([old]);
    } finally {
      delete globalThis.document;
      delete globalThis.window;
    }
  });
});
