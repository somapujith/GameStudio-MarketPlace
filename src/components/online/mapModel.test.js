// The map choice: the picker model (cards, mini ring geometry and colours, selection and keys), the lobby copy in a map's
// words, the settings round trip (the map is stored, never a "custom rule") and the applyMap owner behind useApplyMap.
import { afterEach, describe, expect, it } from 'vitest';
import { GROUPS, TILES } from '@shared/board.js';
import { DEFAULT_MAP, MAPS, MAP_IDS, applyMap } from '@shared/maps.js';
import { customRuleCount } from '@shared/ruleSettings.js';
import { LOBBY_SETTINGS, MAPS_LINE, MAP_FIELD, SETTINGS_GROUPS, SETTINGS_SCHEMA, TABLE_RULES, settingsSummary, tableRulesFor } from '@/games/hyderabad-tycoon/settings.js';
import {
  MAP_KEY,
  groupSwatches,
  mapAccent,
  mapChoice,
  mapChoices,
  mapFieldOf,
  mapIdOf,
  mapInfo,
  mapLabel,
  mapLine,
  mapPatch,
  mapTitle,
  nextMapId,
  ringCell,
  ringCells,
  ringSide,
  ringViewSize,
  samplePlaces,
  skinGame,
  skinText,
  withMapLine,
} from './mapModel.js';
import * as server from '../../../worker/settings.js';
import { createMapOwner } from './useApplyMap.js';
import { changedFields, customCount, lobbyFields, resolveSettings, settingsMessage } from './settings.js';

afterEach(() => {
  applyMap(DEFAULT_MAP); // the display names are global: never leak a map between tests
});

describe('the maps the picker offers', () => {
  it('one card per map, in the registry order, default first', () => {
    expect(mapChoices().map((c) => c.id)).toEqual([...MAP_IDS]);
    expect(MAP_IDS[0]).toBe(DEFAULT_MAP);
  });

  it('prints the names without the rule-set word and the Telugu title only where the map has one', () => {
    expect(mapTitle('Charminar Chaos')).toBe('Charminar Chaos');
    expect(mapTitle('Andhra Aatalu')).toBe('Andhra Aatalu');
    expect(mapInfo('hyderabad')).toMatchObject({ id: 'hyderabad', name: 'Charminar Chaos', te: '' });
    expect(mapInfo('andhra')).toMatchObject({ id: 'andhra', name: 'Andhra Aatalu', te: 'ఆంధ్ర ఆటలు' });
    expect(mapLabel('andhra')).toBe('Andhra Aatalu');
    expect(mapLabel('andhra', { withTe: true })).toBe('Andhra Aatalu · ఆంధ్ర ఆటలు');
    expect(mapLabel('hyderabad', { withTe: true })).toBe('Charminar Chaos');
    for (const c of mapChoices()) {
      expect(c.tagline.length, c.id).toBeGreaterThan(5);
      expect(c.blurb.length, c.id).toBeGreaterThan(20);
    }
  });

  it('reads the map from an id, room settings or a cfg; anything unknown is the default map', () => {
    expect(mapIdOf('andhra')).toBe('andhra');
    expect(mapIdOf({ map: 'andhra', mode: 'quick' })).toBe('andhra');
    expect(mapIdOf({ cfg: { map: 'andhra' } })).toBe('andhra');
    for (const bad of [undefined, null, '', 'mars', 7, { map: 'mars' }, {}, []]) expect(mapIdOf(bad), String(bad)).toBe(DEFAULT_MAP);
  });

  it('says the map in one line for the scoreboard and the menu', () => {
    expect(mapLine({ map: 'andhra' })).toBe('Map: Andhra Aatalu');
    expect(mapLine(undefined)).toBe('Map: Charminar Chaos');
    expect(withMapLine('Standard City Hustle · 20 rounds', { map: 'andhra' })).toBe('Map: Andhra Aatalu · Standard City Hustle · 20 rounds');
    expect(withMapLine('', 'hyderabad')).toBe('Map: Charminar Chaos');
  });
});

describe('the mini ring', () => {
  it('a 36-tile board is a 10x10 ring: side 10, viewBox 100', () => {
    expect(ringSide(36)).toBe(10);
    expect(ringViewSize(36)).toBe(100);
    expect(ringSide(40)).toBe(11);
  });

  it('START bottom-left, up the left column, right along the top, down the right, left along the bottom', () => {
    expect(ringCell(0, 36)).toEqual({ col: 0, row: 9 });
    expect(ringCell(9, 36)).toEqual({ col: 0, row: 0 }); // Traffic Jam, top-left
    expect(ringCell(18, 36)).toEqual({ col: 9, row: 0 }); // Chai Adda, top-right
    expect(ringCell(27, 36)).toEqual({ col: 9, row: 9 }); // Municipal, bottom-right
    expect(ringCell(35, 36)).toEqual({ col: 1, row: 9 }); // the last tile, next to START
    expect(ringCell(36, 36)).toEqual(ringCell(0, 36)); // wraps
  });

  it('every tile gets its own cell on the outer ring of the grid', () => {
    const cells = ringCells(MAPS.hyderabad);
    expect(cells).toHaveLength(36);
    const seen = new Set(cells.map((c) => `${c.col},${c.row}`));
    expect(seen.size).toBe(36);
    for (const c of cells) expect(c.col === 0 || c.col === 9 || c.row === 0 || c.row === 9, `tile ${c.i}`).toBe(true);
  });

  it('each cell is coloured from the group colours of ITS map, and the two maps differ', () => {
    const hyd = ringCells(MAPS.hyderabad);
    const and = ringCells(MAPS.andhra);
    for (const t of TILES.filter((x) => x.group)) {
      expect(hyd[t.id].kind).toBe('group');
      expect(hyd[t.id].color, `hyd ${t.id}`).toBe(MAPS.hyderabad.groups[t.group].color);
      expect(and[t.id].color, `and ${t.id}`).toBe(MAPS.andhra.groups[t.group].color);
    }
    expect(hyd.filter((c, i) => c.color !== and[i].color).length).toBeGreaterThan(15);
    // the corners and cards are neutral (never a group colour), and the kinds do not depend on the map
    expect(hyd.map((c) => c.kind)).toEqual(and.map((c) => c.kind));
    expect(hyd[0].kind).toBe('corner');
    expect(hyd[2].kind).toBe('card');
    expect(hyd[5].kind).toBe('transport');
  });

  it('is unaffected by the map the screen has applied (the card shows its own map, whatever the board shows)', () => {
    const before = ringCells(MAPS.hyderabad).map((c) => c.color);
    applyMap('andhra');
    expect(ringCells(MAPS.hyderabad).map((c) => c.color)).toEqual(before);
    expect(mapChoice('hyderabad').places[0]).toBe('Sultan Bazaar'); // the card never shows the board's current names
  });

  it('lists the collection colours once each, in board order, eight of them', () => {
    const sw = groupSwatches(MAPS.andhra);
    expect(sw).toHaveLength(Object.keys(GROUPS).length);
    expect(new Set(sw.map((s) => s.color)).size).toBe(8);
    expect(sw[0].id).toBe('bazaar');
    expect(sw[0].color).toBe(MAPS.andhra.groups.bazaar.color);
  });

  it('tints a card with the map palette accent', () => {
    expect(mapAccent(MAPS.andhra)).toBe(MAPS.andhra.palette.accent);
    expect(mapAccent(MAPS.hyderabad)).toBe(MAPS.hyderabad.palette.accent);
    expect(mapAccent({})).toMatch(/^#/);
  });
});

describe('sample places', () => {
  it('three places spanning the board, cheapest to priciest, in that map\'s names', () => {
    const hyd = samplePlaces(MAPS.hyderabad);
    const and = samplePlaces(MAPS.andhra);
    expect(hyd).toHaveLength(3);
    expect(and).toHaveLength(3);
    expect(hyd[0]).toBe(MAPS.hyderabad.tiles[1].short); // Sultan Bazaar: the cheapest district
    expect(and[0]).toBe(MAPS.andhra.tiles[1].short); // Chirala
    expect(hyd[2]).toBe(MAPS.hyderabad.tiles[35].short); // the priciest
    expect(and[2]).toBe(MAPS.andhra.tiles[35].short);
    expect(and.every((p) => !hyd.includes(p))).toBe(true);
  });

  it('a map may list its own samples, and a missing map has none', () => {
    expect(samplePlaces({ samples: ['A', ' B ', '', 'C', 'D'] })).toEqual(['A', 'B', 'C']);
    expect(samplePlaces(null)).toEqual(expect.any(Array));
    expect(samplePlaces({ tiles: {} }, 3, [{ id: 0, type: 'start', corner: true }])).toEqual([]);
  });
});

describe('selection', () => {
  it('picking another map patches { map }; the same map, a stranger or junk patch nothing', () => {
    expect(mapPatch({ map: 'hyderabad' }, 'andhra')).toEqual({ [MAP_KEY]: 'andhra' });
    expect(mapPatch({}, 'andhra')).toEqual({ map: 'andhra' });
    expect(mapPatch({ map: 'andhra' }, 'hyderabad')).toEqual({ map: 'hyderabad' });
    expect(mapPatch({ map: 'andhra' }, 'andhra')).toBeNull();
    expect(mapPatch({}, 'hyderabad')).toBeNull(); // absent = the default map already
    for (const bad of ['mars', '', null, undefined, 3]) expect(mapPatch({}, bad)).toBeNull();
  });

  it('the arrow keys move through the radio group and wrap; Home / End jump; other keys are ignored', () => {
    const ids = ['hyderabad', 'andhra'];
    expect(nextMapId('hyderabad', 'ArrowRight', ids)).toBe('andhra');
    expect(nextMapId('andhra', 'ArrowRight', ids)).toBe('hyderabad');
    expect(nextMapId('hyderabad', 'ArrowLeft', ids)).toBe('andhra');
    expect(nextMapId('andhra', 'ArrowDown', ids)).toBe('hyderabad');
    expect(nextMapId('andhra', 'ArrowUp', ids)).toBe('hyderabad');
    expect(nextMapId('andhra', 'Home', ids)).toBe('hyderabad');
    expect(nextMapId('hyderabad', 'End', ids)).toBe('andhra');
    expect(nextMapId({ map: 'andhra' }, 'ArrowRight', ids)).toBe('hyderabad');
    expect(nextMapId('andhra', 'Tab', ids)).toBeNull();
    expect(nextMapId('andhra', 'a', ids)).toBeNull();
    expect(nextMapId('andhra', 'ArrowRight', [])).toBeNull();
  });
});

describe('the settings round trip', () => {
  it('the schema carries the map as a picker widget with the registry options and the default map', () => {
    expect(mapFieldOf(SETTINGS_SCHEMA)).toBe(MAP_FIELD);
    expect(MAP_FIELD).toMatchObject({ key: 'map', type: 'segmented', widget: 'map', default: DEFAULT_MAP });
    expect(MAP_FIELD.options.map((o) => o.value)).toEqual([...MAP_IDS]);
    expect(SETTINGS_SCHEMA.map((f) => f.key).slice(0, 2)).toEqual(['mode', 'map']);
    expect(mapFieldOf([{ key: 'map', type: 'segmented' }])).toBeNull(); // a plain field named map is not the picker
  });

  it('picking a map sends the FULL settings with { map } and nothing else changed', () => {
    const cur = resolveSettings(SETTINGS_SCHEMA, {});
    expect(cur.map).toBe('hyderabad');
    const msg = settingsMessage(SETTINGS_SCHEMA, cur, { map: 'andhra' });
    expect(msg.t).toBe('settings');
    expect(msg.settings.map).toBe('andhra');
    expect({ ...msg.settings, map: 'hyderabad' }).toEqual(cur);
    // and back
    expect(settingsMessage(SETTINGS_SCHEMA, msg.settings, { map: 'hyderabad' }).settings.map).toBe('hyderabad');
    // the mode change does not touch the map
    expect(settingsMessage(SETTINGS_SCHEMA, msg.settings, { mode: 'classic' }).settings.map).toBe('andhra');
  });

  it('a room from before maps has no map: it reads as the default and a rematch keeps the choice', () => {
    expect(resolveSettings(SETTINGS_SCHEMA, { mode: 'quick' }).map).toBe('hyderabad');
    expect(resolveSettings(SETTINGS_SCHEMA, { map: 'andhra' }).map).toBe('andhra');
  });

  it('the map is NOT a custom rule: not counted, not shown as a plain field, not reset by "reset all"', () => {
    const game = { settings: SETTINGS_SCHEMA, lobbySettings: LOBBY_SETTINGS, settingsGroups: SETTINGS_GROUPS };
    expect(LOBBY_SETTINGS).not.toContain('map');
    expect(lobbyFields(game).map((f) => f.key)).not.toContain('map');
    // even for a game without `lobbySettings` (every field shown) the picker widget is never a plain control
    expect(lobbyFields({ settings: SETTINGS_SCHEMA }).map((f) => f.key)).not.toContain('map');
    const fields = lobbyFields(game);
    const eff = resolveSettings(SETTINGS_SCHEMA, { map: 'andhra' });
    expect(customCount(fields, eff)).toBe(0);
    expect(changedFields(fields, eff)).toEqual([]);
    expect(customRuleCount({ map: 'andhra' })).toBe(0);
    expect(customRuleCount({ map: 'andhra', turnSeconds: 90 })).toBe(1); // a real rule still counts, once
    expect(settingsSummary({ map: 'andhra' })).toBe('Andhra Aatalu · Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ map: 'andhra', turnSeconds: 90 })).toContain('Custom rules (1)');
    // the home map leads nothing: old summaries stay exactly as they were
    expect(settingsSummary({ map: 'hyderabad' })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({})).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
  });

  it('the server accepts what the picker sends and stores a map only when it is not the home map', () => {
    for (const o of MAP_FIELD.options) expect(server.sanitizeSettings({ map: o.value }).errors, o.value).toEqual([]);
    expect(server.sanitizeSettings({ map: 'mars' }).errors).toHaveLength(1);
    let room = server.normalizeSettings({});
    expect(room.map).toBeUndefined();
    // host picks Andhra, then goes back: what the room holds is what the lobby shows, round after round
    for (const pick of ['andhra', 'hyderabad', 'andhra']) {
      const sent = settingsMessage(SETTINGS_SCHEMA, resolveSettings(SETTINGS_SCHEMA, room), { map: pick }).settings;
      expect(sent.map).toBe(pick);
      const parsed = server.sanitizeSettings(sent);
      expect(parsed.errors).toEqual([]);
      room = server.normalizeSettings(server.mergeSettingsPatch(room, parsed.settings));
      expect(resolveSettings(SETTINGS_SCHEMA, room).map).toBe(pick);
      expect(room.map).toBe(pick === 'andhra' ? 'andhra' : undefined);
    }
  });

  it('the listing says which maps there are', () => {
    expect(MAPS_LINE).toBe('2 maps: Charminar Chaos · Andhra Aatalu');
  });
});

describe('lobby copy in the words of the map', () => {
  it('swaps only the words the map defines, keeping the first letter\'s case', () => {
    expect(skinText('Chai tokens a player can hold', 'andhra')).toBe('Festival tokens a player can hold');
    expect(skinText('A chai token halves a big rent.', 'andhra')).toBe('A festival token halves a big rent.');
    expect(skinText('Chai Adda', 'andhra')).toBe('Sankranti Fair');
    expect(skinText('Municipal Charges are due', { map: 'andhra' })).toBe('Road Toll are due');
    expect(skinText('Traffic Jam fine', 'andhra')).toBe('Traffic Jam fine'); // the same word on both maps
  });

  it('is the identity on the default map (and on anything that is not text)', () => {
    expect(skinText('Chai tokens a player can hold', 'hyderabad')).toBe('Chai tokens a player can hold');
    expect(skinText('Chai tokens', undefined)).toBe('Chai tokens');
    expect(skinText(undefined, 'andhra')).toBeUndefined();
    expect(skinText('', 'andhra')).toBe('');
  });

  it('re-words the lobby fields and the table rules; the default map returns the manifest itself', () => {
    const game = { settings: SETTINGS_SCHEMA, tableRules: TABLE_RULES, tableRulesFor };
    expect(skinGame(game, 'hyderabad')).toBe(game);
    expect(skinGame(null, 'andhra')).toBeNull();
    const a = skinGame(game, 'andhra');
    expect(a).not.toBe(game);
    const cap = a.settings.find((f) => f.key === 'chaiCap');
    expect(cap.label.toLowerCase()).toContain('festival token');
    expect(cap.label.toLowerCase()).not.toContain('chai');
    expect(cap.help.toLowerCase()).toContain('festival token');
    expect(a.tableRules).toBe(tableRulesFor('andhra'));
    expect(a.tableRules).not.toMatch(/chai/i);
    expect(tableRulesFor('hyderabad')).toBe(TABLE_RULES);
    expect(tableRulesFor('mars')).toBe(TABLE_RULES);
    // the fields that say nothing about the map keep their identity
    expect(a.settings.find((f) => f.key === 'mode')).toBe(SETTINGS_SCHEMA.find((f) => f.key === 'mode'));
    // the key set is untouched: the server schema is the source of truth
    expect(a.settings.map((f) => f.key)).toEqual(SETTINGS_SCHEMA.map((f) => f.key));
  });
});

describe('applying the map (useApplyMap)', () => {
  const name = (id) => TILES[id].name;

  it('switching to Andhra renames the board and switching back restores every name', () => {
    const hyd = TILES.map((t) => t.name);
    const hydGroups = Object.values(GROUPS).map((g) => g.name);
    const owner = createMapOwner();
    const a = {};
    const res = owner.claim(a, { map: 'andhra' });
    expect(res.id).toBe('andhra');
    expect(name(1)).toBe('Chirala');
    expect(Object.values(GROUPS).map((g) => g.name)).not.toEqual(hydGroups);
    owner.release(a);
    expect(TILES.map((t) => t.name)).toEqual(hyd);
    expect(Object.values(GROUPS).map((g) => g.name)).toEqual(hydGroups);
    expect(name(1)).toBe('Sultan Bazaar');
  });

  it('a screen that was replaced does not undo the screen that replaced it (lobby -> game)', () => {
    const owner = createMapOwner();
    const lobby = {};
    const game = {};
    owner.claim(lobby, { map: 'andhra' });
    owner.claim(game, { cfg: { map: 'andhra' } }); // the game page renders before the lobby unmounts
    expect(owner.release(lobby)).toBeNull(); // the old page unmounts: nothing happens
    expect(name(1)).toBe('Chirala');
    expect(owner.release(game)).toMatchObject({ id: 'hyderabad' }); // the game page goes away: the default names come back
    expect(name(1)).toBe('Sultan Bazaar');
  });

  it('the host switching the map in the lobby re-applies it; a room without a map is the default', () => {
    const owner = createMapOwner();
    const t = {};
    owner.claim(t, { map: 'andhra' });
    expect(name(1)).toBe('Chirala');
    owner.claim(t, { map: 'hyderabad' });
    expect(name(1)).toBe('Sultan Bazaar');
    owner.claim(t, {});
    expect(name(1)).toBe('Sultan Bazaar');
    owner.release(t);
  });

  it('the map version only moves when the map really changes (the board key stays stable)', () => {
    const owner = createMapOwner();
    const t = {};
    const v0 = owner.claim(t, 'hyderabad').mapVersion;
    expect(owner.claim(t, 'hyderabad').mapVersion).toBe(v0);
    const v1 = owner.claim(t, 'andhra').mapVersion;
    expect(v1).toBe(v0 + 1);
    expect(owner.claim(t, { map: 'andhra' }).mapVersion).toBe(v1);
    owner.release(t);
  });
});
