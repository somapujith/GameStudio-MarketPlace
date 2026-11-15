import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, GROUPS, TILES } from '@shared/board.js';
import { CITY_EVENTS } from '@shared/events.js';
import { Board } from '../Board.jsx';
import { EVENT_EMOJI } from '../EventBanner.jsx';
import PhoneBoardContext from '../phone/PhoneBoardContext.js';
import { Tile } from '../Tile.jsx';
import EventFlag from './EventFlag.jsx';
import { TileTipLayer } from './TileTip.jsx';
import { tipModel } from './tipModel.js';
import { FLAG_CORNERS, FLAG_EMOJI, eventFlagFor, eventFlagKey, eventGroups, flagStart, flagStep } from './eventFlag.js';

const ev = (id, extra = {}) => ({ id, title: id, text: '', kind: 'rent', round: 4, ...extra });
const flagged = (event) => TILES.filter((t) => eventFlagFor(event, t)).map((t) => t.id);
const html = (tile, props = {}) => renderToString(h(Tile, { tile: TILES[tile], onSelect() {}, ...props }));
const START = TILES[0];
const MUNICIPAL = TILES.find((t) => t.type === 'municipal');

describe('eventFlagFor: which tiles raise a flag', () => {
  it('rush hour: a green boom pennant on every district of the drawn collection, x1.5', () => {
    const e = ev('rush_hour', { group: 'cyber', mult: 1.5 });
    expect(flagged(e)).toEqual(GROUPS.cyber.tiles);
    const f = eventFlagFor(e, TILES[GROUPS.cyber.tiles[0]]);
    expect(f).toMatchObject({ raised: true, tone: 'boom', shape: 'pennant', label: '×1.5', emoji: '🚦' });
    expect(f.note).toContain('rents ×1.5');
    expect(f.key).toBe('rush_hour:4');
  });

  it('monsoon: a red drooping slump pennant, x0.5 (or x0.7) on the collection', () => {
    const e = ev('monsoon', { group: 'lake', mult: 0.5 });
    expect(flagged(e)).toEqual(GROUPS.lake.tiles);
    expect(eventFlagFor(e, TILES[GROUPS.lake.tiles[0]])).toMatchObject({ tone: 'slump', label: '×0.5', emoji: '🌧️' });
    expect(eventFlagFor(ev('monsoon', { group: 'bazaar', mult: 0.7 }), TILES[1]).label).toBe('×0.7');
  });

  it('biryani boom: both food collections, x2, even when the event carries no groups', () => {
    const both = [...GROUPS.oldcity.tiles, ...GROUPS.everyday.tiles];
    expect(flagged(ev('biryani_boom', { mult: 2 }))).toEqual(both);
    expect(flagged(ev('biryani_boom', { groups: ['oldcity', 'everyday'], mult: 2, upgradedOnly: true }))).toEqual(both);
    expect(flagged(ev('biryani_boom', { groups: ['oldcity'], mult: 2 }))).toEqual(GROUPS.oldcity.tiles);
    const f = eventFlagFor(ev('biryani_boom', { mult: 2, upgradedOnly: true }), TILES[6]);
    expect(f).toMatchObject({ tone: 'boom', label: '×2', emoji: '🍛' });
    expect(f.note).toContain('upgraded businesses');
  });

  it('wedding season: a festive pennant on the lake and luxury venues with the +20k they earn', () => {
    const e = ev('wedding_season', { kind: 'cash', amount: -30000 });
    expect(flagged(e)).toEqual([...GROUPS.lake.tiles, ...GROUPS.luxury.tiles]);
    const f = eventFlagFor(e, TILES[GROUPS.lake.tiles[0]]);
    expect(f).toMatchObject({ tone: 'festival', shape: 'pennant', emoji: '💍' });
    expect(f.label).toMatch(/^\+.*20k$/i);
    expect(f.note).toMatch(/30,000/);
  });

  it('festival (a whole-city bonus): bunting on the four corners, START prints the amount, nothing on districts', () => {
    const e = ev('festival', { kind: 'cash', amount: 50000 });
    expect(flagged(e)).toEqual([0, 9, 18, 27]);
    expect(TILES.filter((t) => eventFlagFor(e, t)).map((t) => t.type)).toEqual(FLAG_CORNERS);
    expect(eventFlagFor(e, START)).toMatchObject({ tone: 'festival', shape: 'bunting', emoji: '🪔' });
    expect(eventFlagFor(e, START).label).toMatch(/50k/i);
    expect(eventFlagFor(e, MUNICIPAL).label).toBe('');
    expect(eventFlagFor(e, TILES[1])).toBeNull(); // a district
    expect(eventFlagFor(e, TILES.find((t) => t.type === 'auction'))).toBeNull(); // an edge tile, not a corner
  });

  it('a whole-city payment is one drooping banner on START', () => {
    const e = ev('festival', { kind: 'cash', amount: -30000 });
    expect(flagged(e)).toEqual([0]);
    expect(eventFlagFor(e, START)).toMatchObject({ tone: 'slump', shape: 'pennant' });
    expect(eventFlagFor(e, START).label).toMatch(/^-.*30k$/i);
  });

  it('a whole-city event without an amount still decorates the corners (something is always raised)', () => {
    expect(flagged(ev('some_new_event', { kind: 'cash' }))).toEqual([0, 9, 18, 27]);
    expect(eventFlagFor(ev('some_new_event', { kind: 'cash' }), START).emoji).toBe('🎉');
  });

  it('flags nothing without an event, without an id, or for a rent event that lost its collection', () => {
    expect(flagged(null)).toEqual([]);
    expect(flagged({})).toEqual([]);
    expect(flagged(ev('rush_hour', { mult: 1.5 }))).toEqual([]);
    expect(flagged(ev('monsoon', { mult: 0.5 }))).toEqual([]);
    expect(eventFlagFor(ev('festival', { amount: 5 }), null)).toBeNull();
    expect(flagged(ev('rush_hour', { group: 'nonexistent', mult: 1.5 }))).toEqual([]);
  });

  it('covers every event of shared/events.js, and never more than 6 districts or 4 corners at once', () => {
    for (const def of CITY_EVENTS) {
      const groups = def.pick === 'owned' ? Object.keys(GROUPS) : [undefined];
      for (const g of groups) {
        const e = ev(def.id, { kind: def.kind, group: g, groups: def.groups, mult: def.mult, amount: def.amount });
        const ids = flagged(e);
        expect(ids.length, `${def.id} ${g || ''}`).toBeGreaterThan(0);
        expect(ids.length).toBeLessThanOrEqual(6);
        expect(FLAG_EMOJI[def.id]).toBeTruthy();
        for (const id of ids) {
          const f = eventFlagFor(e, TILES[id]);
          expect(['boom', 'slump', 'festival']).toContain(f.tone);
          expect(f.note.length).toBeGreaterThan(3);
          expect(f.line.length).toBeGreaterThan(3);
        }
      }
    }
  });

  it('uses the same emoji as the news banner, a stable key per event instance, and frozen interned descriptors', () => {
    expect(FLAG_EMOJI).toEqual(EVENT_EMOJI);
    expect(eventFlagKey(ev('rush_hour', { round: 9 }))).toBe('rush_hour:9');
    expect(eventFlagKey(null)).toBeNull();
    const e = ev('rush_hour', { group: 'cyber', mult: 1.5 });
    const a = eventFlagFor(e, TILES[GROUPS.cyber.tiles[0]]);
    expect(eventFlagFor({ ...e }, TILES[GROUPS.cyber.tiles[1]])).toBe(a); // same words, same object: a memoised tile does not re-render
    expect(Object.isFrozen(a)).toBe(true);
    expect(eventFlagFor({ ...e, round: 8 }, TILES[GROUPS.cyber.tiles[0]])).not.toBe(a);
    expect(eventGroups(ev('wedding_season'))).toEqual(['lake', 'luxury']);
  });
});

describe('flagStep: raise once per event, never on first paint', () => {
  const f4 = eventFlagFor(ev('rush_hour', { group: 'cyber', mult: 1.5 }), TILES[31]);
  const f7 = eventFlagFor(ev('rush_hour', { group: 'cyber', mult: 1.5, round: 7 }), TILES[31]);

  it('first paint with an event running stands still; with none shows nothing', () => {
    expect(flagStart(f4)).toMatchObject({ mode: 'up', n: 0 });
    expect(flagStart(null)).toMatchObject({ mode: 'none', n: 0 });
    const s = flagStart(f4);
    expect(flagStep(s, f4)).toBe(s);
  });

  it('an event that arrives while mounted raises; the next round raises again; the end lowers', () => {
    let s = flagStart(null);
    s = flagStep(s, f4);
    expect(s).toMatchObject({ mode: 'raise', n: 1 });
    expect(flagStep(s, f4)).toBe(s); // re-render, nothing replays
    s = flagStep(s, f7);
    expect(s).toMatchObject({ mode: 'raise', n: 2 });
    s = flagStep(s, null);
    expect(s).toMatchObject({ mode: 'lower', flag: f7 });
    expect(flagStep(s, null)).toBe(s);
    expect(flagStep(flagStart(null), null)).toMatchObject({ mode: 'none' });
  });
});

describe('EventFlag render', () => {
  const boom = eventFlagFor(ev('rush_hour', { group: 'cyber', mult: 1.5 }), TILES[31]);
  const slump = eventFlagFor(ev('monsoon', { group: 'lake', mult: 0.5 }), TILES[GROUPS.lake.tiles[0]]);
  const fest = eventFlagFor(ev('festival', { kind: 'cash', amount: 50000 }), START);

  it('is empty without a flag, and a standing pole + pennant (no raise class, no burst) on first paint', () => {
    expect(renderToString(h(EventFlag, { flag: null }))).toBe('');
    const out = renderToString(h(EventFlag, { flag: boom }));
    expect(out).toContain('hb-flag--pennant');
    expect(out).toContain('hb-flag--boom');
    expect(out).toContain('is-up');
    expect(out).not.toContain('is-raise');
    expect(out).not.toContain('hb-flag__burst');
    expect(out).toContain('<i class="hb-flag__t">×</i>1.5');
    expect(out).toContain('🚦');
    expect(out).toContain('aria-hidden="true"');
  });

  it('a slump is the drooping red flag, a festival corner is bunting with a tag', () => {
    expect(renderToString(h(EventFlag, { flag: slump }))).toContain('hb-flag--slump');
    const out = renderToString(h(EventFlag, { flag: fest }));
    expect(out).toContain('hb-flag--bunting');
    expect(out.match(/<i style="--i:/g)).toHaveLength(5);
    expect(out).toContain('hb-flag__tag');
  });
});

describe('flags on the tiles', () => {
  const e = ev('rush_hour', { group: 'cyber', mult: 1.5 });
  const mark = { tone: 'rush', text: 'x1.5', note: 'rush hour, rent x1.5 this round' };

  it('a desktop district: has-flag, the flag inside the button, the aria-label says the city event', () => {
    const out = html(31, { flag: eventFlagFor(e, TILES[31]), event: mark });
    expect(out).toContain('has-flag');
    expect(out).toMatch(/<button[^>]*aria-label="[^"]*city event: rush hour, rents ×1.5 this round/);
    expect(out).toContain('hb-flag--boom');
    expect(out).toContain('hb-tile__glow'); // the existing glow stays
    expect(out.indexOf('hb-flag')).toBeGreaterThan(out.indexOf('hb-tile__body'));
    expect(out.indexOf('hb-flag')).toBeLessThan(out.lastIndexOf('</button>'));
    // the tile's own name, price, owner mark and building are still there
    expect(out).toContain(TILES[31].name.split(' ')[0]);
    expect(out).toContain('hb-tile__price');
  });

  it('a phone district: the same flag inside the phone face tile', () => {
    const out = renderToString(h(PhoneBoardContext.Provider, { value: true }, h(Tile, { tile: TILES[31], flag: eventFlagFor(e, TILES[31]), event: mark, onSelect() {} })));
    expect(out).toContain('hb-tile--phone');
    expect(out).toContain('has-flag--pennant');
    expect(out).toContain('hb-flag--boom');
    expect(out).toContain('city event: rush hour, rents ×1.5');
    expect(out).toContain('pt--prop'); // the phone face (name / price band) is untouched
  });

  it('a corner of a festival: bunting and the aria-label', () => {
    const fe = ev('festival', { kind: 'cash', amount: 50000 });
    const out = html(0, { flag: eventFlagFor(fe, START), salary: 200000 });
    expect(out).toContain('has-flag--bunting');
    expect(out).toContain('hb-flag--bunting');
    expect(out).toContain('city event: festive bonus, every player receives');
  });

  it('no flag, no event: no flag markup and no city event in the label', () => {
    const out = html(31);
    expect(out).not.toContain('hb-flag');
    expect(out).not.toContain('city event');
  });

  it('the board flags exactly the affected tiles from the live view event, and none after the event is gone', () => {
    const view = { owners: Array(BOARD_SIZE).fill(null), levels: Array(BOARD_SIZE).fill(0), mortgaged: Array(BOARD_SIZE).fill(false), players: [], turn: 0, phase: 'roll', event: e };
    const out = renderToString(h(Board, { session: { view, display: { ...view, event: null } } }));
    expect(out.match(/hb-flag--pennant/g)).toHaveLength(3);
    const festView = { ...view, event: ev('festival', { kind: 'cash', amount: 50000 }) };
    expect(renderToString(h(Board, { session: { view: festView, display: festView } })).match(/hb-flag--bunting/g)).toHaveLength(4);
    expect(renderToString(h(Board, { session: { view: { ...view, event: null }, display: view } }))).not.toContain('hb-flag');
  });
});

describe('the hover card tells about the city event', () => {
  it('a marked district already shows the "This round" row; a corner of a whole-city event gets a "City event" row', () => {
    const e = ev('rush_hour', { group: 'cyber', mult: 1.5 });
    const m = tipModel(TILES[31], { event: { text: 'x1.5', note: '' }, flag: eventFlagFor(e, TILES[31]) });
    expect(m.rows.filter((r) => r.label === 'This round')).toHaveLength(1);
    expect(m.rows.some((r) => r.label === 'City event')).toBe(false);
    const fe = eventFlagFor(ev('festival', { kind: 'cash', amount: 50000, title: 'Bonalu festive bonus' }), START);
    const c = tipModel(START, { flag: fe });
    expect(c.rows.find((r) => r.label === 'City event').value).toContain('Bonalu festive bonus');
    expect(tipModel(START, {}).rows.some((r) => r.label === 'City event')).toBe(false);
  });

  it('the layer still renders (the card opens on hover, client side)', () => {
    expect(renderToString(h(TileTipLayer, { event: ev('festival', { kind: 'cash', amount: 50000 }) }))).toContain('hb-tipwrap');
  });
});

describe('eventflag.css', () => {
  const css = readFileSync(new URL('../../../styles/eventflag.css', import.meta.url), 'utf8');

  it('animates transform and opacity only', () => {
    const frames = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
    expect(frames.length).toBeGreaterThanOrEqual(8);
    for (const [, name, body] of frames) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['transform', 'opacity'], `${name}: ${p}`).toContain(p);
    }
  });

  it('has no flutter on phones or narrow boards, and fades under every reduced-motion switch', () => {
    expect(css).toMatch(/\.hb-tile--phone \.hb-flag--pennant \.hb-flag__wave/);
    expect(css).toMatch(/@container \(max-width: 520px\)/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(":root[data-motion='reduced']");
    expect(css).toContain('.hg-game[data-rm]');
    expect(css).toMatch(/hb-flag-appear 220ms/);
    expect(css).toMatch(/\.hb-flag__burst \{ display: none; \}/);
  });
});
