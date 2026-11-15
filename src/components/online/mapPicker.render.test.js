// The map picker and everywhere the map shows (server-side render, node env): the picker cards for the host and for
// everyone else, the lobby panel (the map is never a "custom rule"), the table header, the join preview, the store
// section and panel, the hub card, the game menu and the scoreboard.
import { createElement as h } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILES } from '@shared/board.js';
import { DEFAULT_MAP, MAPS, applyMap } from '@shared/maps.js';

vi.mock('@/components/game/ui/Sheet.jsx', () => ({ default: () => null, hasOpenSheet: () => false }));
vi.mock('../game/ui/Sheet.jsx', () => ({
  default: ({ title, children }) => h('div', null, title ? h('h2', null, title) : null, children),
  hasOpenSheet: () => false,
}));
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => null,
  BuildingArt: () => null,
  PieceArt: () => null,
  AvatarFrame: ({ children, size }) => h('b', null, typeof children === 'function' ? children(size) : children),
  TitleChip: () => null,
  Logo: () => null,
  Scene: () => null,
  AVATAR_PRESETS: [],
}));

const { default: MapPicker, MapCard, MapRing, TeText } = await import('./MapPicker.jsx');
const { default: MapTag } = await import('./MapTag.jsx');
const { default: SettingsPanel } = await import('./SettingsPanel.jsx');
const { default: TableHeader } = await import('./TableHeader.jsx');
const { default: RoomPreview, previewFacts } = await import('./RoomPreview.jsx');
const { default: MapsSection } = await import('@/platform/game/MapsSection.jsx');
const { LivePanel } = await import('@/platform/game/ActionPanel.jsx');
const { default: GameCard } = await import('@/platform/home/GameCard.jsx');
const { default: MoneyBar } = await import('../game/MoneyBar.jsx');
const { default: MenuSheet } = await import('../game/MenuSheet.jsx');
const { default: manifest } = await import('@/games/hyderabad-tycoon/manifest.js');
const { hasMaps, sectionList } = await import('@/platform/game/detailModel.js');
const { roomRequest } = await import('@/platform/game/useHostRoom.js');

const strip = (s) => s.replace(/<!-- -->/g, '');
const render = (el) => strip(renderToString(el));
const inRouter = (el) => h(MemoryRouter, null, el);
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) || [];
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

afterEach(() => {
  applyMap(DEFAULT_MAP);
  delete globalThis.window;
});

describe('<MapPicker> for the host', () => {
  const html = render(h(MapPicker, { value: { map: 'hyderabad' }, isHost: true, onPick() {} }));

  it('is a labelled radio group with one radio per map, the room\'s map checked', () => {
    expect(html).toMatch(/role="radiogroup" aria-labelledby="[^"]+"/);
    const radios = tags(html, 'button').filter((t) => t.includes('role="radio"'));
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('aria-checked="true"');
    expect(radios[0]).toContain('data-map="hyderabad"');
    expect(radios[1]).toContain('aria-checked="false"');
    expect(radios[1]).toContain('data-map="andhra"');
  });

  it('roving tabindex: only the chosen card is a tab stop', () => {
    const radios = tags(html, 'button').filter((t) => t.includes('role="radio"'));
    expect(radios[0]).toContain('tabindex="0"');
    expect(radios[1]).toContain('tabindex="-1"');
    const other = render(h(MapPicker, { value: { map: 'andhra' }, isHost: true }));
    const r = tags(other, 'button').filter((t) => t.includes('role="radio"'));
    expect(r[0]).toContain('tabindex="-1"');
    expect(r[1]).toContain('tabindex="0"');
    expect(r[1]).toContain('aria-checked="true"');
  });

  it('every card shows the name, the tagline, the blurb and three sample places', () => {
    const t = text(html);
    for (const id of ['hyderabad', 'andhra']) {
      const m = MAPS[id];
      expect(t).toContain(m.tagline);
      expect(t).toContain(m.blurb);
    }
    expect(t).toContain('Andhra Aatalu');
    expect(t).toMatch(/\bCharminar Chaos\b/);
    expect(html.match(/class="mp-place"/g)).toHaveLength(6);
    expect(html).toContain('Chirala');
    expect(html).toContain('Sultan Bazaar');
  });

  it('the Telugu title is lang="te"; the English text is not', () => {
    expect(html).toContain('<span class="mp-te mp-card__te" lang="te">ఆంధ్ర ఆటలు</span>');
    expect(html.match(/lang="te"/g)).toHaveLength(1); // Charminar Chaos has no Telugu title
  });

  it('draws a 36-cell ring per card in the colours of that map\'s collections, hidden from assistive tech', () => {
    const rings = html.match(/<svg class="mp-ring"[\s\S]*?<\/svg>/g);
    expect(rings).toHaveLength(2);
    for (const svg of rings) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('viewBox="0 0 100 100"');
      expect(svg.match(/class="mp-ring__cell/g)).toHaveLength(36);
    }
    expect(rings[1]).toContain(`fill="${MAPS.andhra.groups.twin.color}"`);
    expect(rings[0]).toContain(`fill="${MAPS.hyderabad.groups.twin.color}"`);
    expect(rings[0]).not.toContain(`fill="${MAPS.andhra.groups.twin.color}"`);
  });

  it('disabled while the table is busy (connection lost / starting)', () => {
    const d = render(h(MapPicker, { value: 'hyderabad', isHost: true, disabled: true }));
    expect(tags(d, 'button').filter((t) => t.includes('role="radio"') && t.includes('disabled'))).toHaveLength(2);
  });

  it('a compact choice (the store panel) is a radio group of two small options', () => {
    const c = render(h(MapPicker, { compact: true, isHost: true, value: 'andhra', onPick() {} }));
    expect(c).toContain('role="radiogroup"');
    expect(tags(c, 'button').filter((t) => t.includes('role="radio"'))).toHaveLength(2);
    expect(c).toContain('mp-opt is-on');
    expect(c).toContain('lang="te"');
    expect(c).not.toContain('mp-place');
  });
});

describe('<MapPicker> for everyone else', () => {
  it('shows the chosen map read-only: no radios, no buttons, who chose it', () => {
    const html = render(h(MapPicker, { value: { map: 'andhra' }, isHost: false }));
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('<button');
    expect(html).toContain('Chosen by the host');
    expect(html).toContain('Andhra Aatalu');
    expect(html).toContain('lang="te"');
    expect(html).not.toContain('Sultan Bazaar');
    expect(html.match(/<svg class="mp-ring"/g)).toHaveLength(1);
  });
});

describe('<MapTag>', () => {
  it('"Map: Andhra Aatalu" with the Telugu title (lang="te") and the mini ring', () => {
    const html = render(h(MapTag, { value: { map: 'andhra' } }));
    expect(text(html)).toContain('Map: Andhra Aatalu');
    expect(html).toContain('lang="te"');
    expect(html).toContain('class="mp-ring"');
    expect(html).toContain('data-map="andhra"');
  });

  it('the default map has no Telugu title; the in-game line variant is quiet', () => {
    const html = render(h(MapTag, { value: undefined, variant: 'line' }));
    expect(text(html)).toContain('Map: Charminar Chaos');
    expect(html).not.toContain('lang="te"');
    expect(html).toContain('mp-chip--line');
  });

  it('exports the parts the store reuses', () => {
    expect(render(h(TeText, { text: '' }))).toBe('');
    expect(render(h(MapCard, { id: 'andhra' }))).toContain('Andhra Aatalu');
    expect(render(h(MapCard, { id: 'mars' }))).toBe('');
    expect(render(h(MapRing, { cells: [], size: 100 }))).toContain('<svg');
  });
});

describe('the lobby settings panel with the Tycoon manifest', () => {
  const panel = (props) => render(h(SettingsPanel, { game: manifest, settings: {}, isHost: true, onSend() {}, errorId: 0, ...props }));

  it('the host gets the picker above the mode presets', () => {
    const html = panel({});
    expect(html).toContain('role="radiogroup"');
    expect(html.indexOf('mp__grid')).toBeGreaterThan(-1);
    expect(html.indexOf('mp__grid')).toBeLessThan(html.indexOf('xl-preset'));
    expect(html).toContain('You are the host');
  });

  it('a map choice is NOT a custom rule: no badge, "nothing changed" stays', () => {
    const html = panel({ settings: { map: 'andhra' } });
    expect(html).toContain('Nothing changed from the defaults');
    expect(html).not.toMatch(/Custom rules \(\d+\)/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-map="andhra"/);
    // a real rule next to it counts once
    const one = panel({ settings: { map: 'andhra', turnSeconds: 90 } });
    expect(one).toMatch(/Custom rules \(1\)/);
  });

  it('the summary leads with the map when it is not the home map, and the rules speak its words', () => {
    const html = panel({ settings: { map: 'andhra' } });
    expect(html).toContain('Andhra Aatalu · Standard City Hustle');
    expect(html).toContain('Festival tokens');
    expect(html).not.toContain('Chai token limit');
    expect(html).toContain('Festival tokens, Port, Junction and Airport shortcuts');
    const home = panel({});
    expect(home).toContain('Chai, Auto shortcuts and city rush hours');
  });

  it('everyone else sees the map read-only, in the same card as the rules', () => {
    const html = panel({ isHost: false, settings: { map: 'andhra' } });
    expect(html).toContain('Chosen by the host');
    expect(html).not.toContain('role="radio"');
    expect(html).toContain('Set by the host');
    expect(html).toContain('ఆంధ్ర ఆటలు');
  });
});

describe('the map in the lobby header and on the join page', () => {
  it('the table header names the map under the title', () => {
    const html = render(h(TableHeader, { game: manifest, gName: 'Kingpin', code: 'ABC234', hostName: 'Ravi', map: { map: 'andhra' } }));
    expect(text(html)).toContain("Ravi's table");
    expect(text(html)).toContain('Map: Andhra Aatalu');
    expect(html).toContain('lang="te"');
    // a game without maps passes nothing
    expect(render(h(TableHeader, { game: manifest, gName: 'X', code: 'ABC234' }))).not.toContain('Map:');
  });

  it('the join preview says which map the table found plays on (and a room from before maps is the home map)', () => {
    const info = { gameId: 'hyderabad-tycoon', game: 'hyderabad-tycoon', hostName: 'Ravi', players: 1, maxPlayers: 4, settings: { map: 'andhra', mode: 'standard' } };
    expect(previewFacts(info, manifest).map).toBe('andhra');
    expect(previewFacts({ ...info, settings: { mode: 'standard' } }, manifest).map).toBe('hyderabad');
    expect(previewFacts({ ...info, settings: undefined }, manifest).map).toBe('hyderabad');
    expect(previewFacts(info, { id: 'other', settings: [] }).map).toBeNull();
    const html = render(h(RoomPreview, { info }));
    expect(text(html)).toContain('Map: Andhra Aatalu');
    expect(html).toContain('lang="te"');
  });
});

describe('the store listing', () => {
  it('the manifest says it has two maps and its listing gets a Maps section', () => {
    expect(manifest.mapsLine).toBe('2 maps: Charminar Chaos · Andhra Aatalu');
    expect(hasMaps(manifest)).toBe(true);
    expect(hasMaps({ settings: [{ key: 'mode' }] })).toBe(false);
    expect(hasMaps({})).toBe(false);
    expect(sectionList(manifest).map((s) => s.id)).toContain('gd-maps');
    expect(sectionList({ ...manifest, settings: [] }).map((s) => s.id)).not.toContain('gd-maps');
    expect(manifest.description).toMatch(/Andhra Aatalu/);
    expect(manifest.name).toBe('Kingpin'); // the game keeps its name
  });

  it('the Maps section shows both maps with their art, names and sample places', () => {
    const html = render(inRouter(h(MapsSection, { game: manifest })));
    expect(html).toContain('id="gd-maps"');
    expect(html).toContain('2 maps: Charminar Chaos · Andhra Aatalu');
    expect(html.match(/class="mp-card is-readonly/g)).toHaveLength(2);
    expect(html).toContain('ఆంధ్ర ఆటలు');
    expect(render(h(MapsSection, { game: { settings: [] } }))).toBe('');
  });

  it('the start-a-table panel has a map choice that the room request carries', () => {
    const props = { game: manifest, options: [2, 3, 4], seats: 4, setSeats() {}, host() {}, busy: false, user: { id: 1 }, authLoading: false, reachable: true, onJoinCode() {} };
    const html = render(inRouter(h(LivePanel, { ...props, mapId: 'andhra', setMapId() {} })));
    expect(html).toContain('mp--compact');
    expect(html).toMatch(/aria-checked="true"[^>]*data-map="andhra"/);
    expect(render(inRouter(h(LivePanel, props)))).not.toContain('mp--compact'); // nobody wired a map: no picker
    expect(roomRequest(manifest, { maxPlayers: 3, map: 'andhra' }).settings.map).toBe('andhra');
    expect(roomRequest(manifest, { maxPlayers: 3 }).settings.map).toBe('hyderabad'); // the schema default
    expect(roomRequest({ id: 'x', settings: [] }, { map: 'andhra' }).settings.map).toBeUndefined();
  });

  it('the hub card mentions both maps', () => {
    const html = render(inRouter(h(GameCard, { game: { ...manifest, art: undefined } })));
    expect(html).toContain('2 maps: Charminar Chaos · Andhra Aatalu');
    expect(render(inRouter(h(GameCard, { game: { ...manifest, mapsLine: undefined, art: undefined } })))).not.toContain('hh2-gcard__maps');
  });
});

describe('in the game', () => {
  const view = (map) => ({
    phase: 'roll', turn: 0, round: 3, turnCount: 5, extraRoll: false,
    players: [{ id: 'me', name: 'Asha', avatar: 0, color: '#ff4d6d', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false }],
    owners: Array(TILES.length).fill(null), levels: Array(TILES.length).fill(0), mortgaged: Array(TILES.length).fill(false),
    cfg: { mode: 'standard', maxRounds: 20, startCash: 1500000, passStart: 200000, dice: 'lucky', ...(map ? { map } : {}) },
    pending: null, trade: null, debt: null, event: null, dice: [],
  });
  const session = (map) => ({ me: 'me', view: view(map), display: view(map), options: {}, busy: false, dispatch() {} });

  it('the scoreboard leads with the map', () => {
    const andhra = render(h(MoneyBar, { session: session('andhra') }));
    expect(text(andhra)).toContain('Map: Andhra Aatalu');
    expect(text(render(h(MoneyBar, { session: session(null) })))).toContain('Map: Charminar Chaos');
  });

  it('the menu shows "Map: Andhra Aatalu" with the Telugu title, and the home map without one', () => {
    const m = render(h(MenuSheet, { open: true, onClose() {}, onRules() {}, onQuit() {}, session: session('andhra') }));
    expect(text(m)).toContain('Map: Andhra Aatalu');
    expect(m).toContain('lang="te"');
    const home = render(h(MenuSheet, { open: true, onClose() {}, onRules() {}, onQuit() {}, session: session(null) }));
    expect(text(home)).toContain('Map: Charminar Chaos');
    expect(home).not.toContain('lang="te"');
  });
});
