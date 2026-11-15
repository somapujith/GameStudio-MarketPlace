import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GROUPS, TILES } from '@shared/board.js';
import EventBanner, { EVENT_EMOJI, eventInfo } from './EventBanner.jsx';
import ControlPanel from './ControlPanel.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const banner = (event) => html(createElement(EventBanner, { session: { view: { event } } }));

// group ids that exist on whichever board is loaded (the Hustle board names them bazaar ... newcity)
const G = Object.keys(GROUPS);
const g1 = G[0];
const g2 = G[1];

const EVENTS = {
  rush_hour: { id: 'rush_hour', title: 'Hyderabad Rush Hour', text: 'Cyberabad office traffic: rents x1.5 this round.', kind: 'group', group: g1, mult: 1.5, round: 3 },
  biryani_boom: { id: 'biryani_boom', title: 'Biryani boom', text: 'Upgraded food spots pay double this round.', kind: 'groups', groups: [g1, g2], mult: 2, round: 6 },
  wedding_season: { id: 'wedding_season', title: 'Wedding season', text: 'Everyone pays 30,000 for gifts.', kind: 'all', amount: 30000, round: 9 },
  festival: { id: 'festival', title: 'Bonalu festive bonus', text: 'Every player gets 50,000.', kind: 'gift', amount: 50000, round: 12 },
  monsoon: { id: 'monsoon', title: 'Monsoon', text: 'Half rent on the lakefront this round.', kind: 'group', group: g2, mult: 0.5, round: 15 },
};

describe('<EventBanner>', () => {
  it('keeps an empty live region and no strip while there is no event', () => {
    const out = banner(null);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).not.toContain('cp-event__title');
    expect(banner(undefined)).not.toContain('cp-event__title');
  });

  for (const [id, ev] of Object.entries(EVENTS)) {
    it(`shows ${id} with its emoji, title and one-liner`, () => {
      const out = banner(ev);
      expect(out).toContain(`data-event="${id}"`);
      expect(out).toContain(EVENT_EMOJI[id]);
      expect(out).toContain(`>${ev.title}<`);
      expect(out).toContain(ev.text);
    });
  }

  it('has a distinct emoji per Hustle event id', () => {
    expect(new Set(Object.values(EVENT_EMOJI)).size).toBe(5);
    expect(Object.keys(EVENT_EMOJI).sort()).toEqual(Object.keys(EVENTS).sort());
  });

  it('adds a colour chip (with the multiplier) per affected collection', () => {
    const rush = eventInfo(EVENTS.rush_hour);
    expect(rush.chips).toHaveLength(1);
    expect(rush.chips[0].color).toBe(GROUPS[g1].color);
    expect(rush.chips[0].mult).toBe('x1.5');
    expect(banner(EVENTS.rush_hour)).toContain(GROUPS[g1].color);
    const boom = eventInfo(EVENTS.biryani_boom);
    expect(boom.chips.map((c) => c.name)).toEqual([GROUPS[g1].name, GROUPS[g2].name]);
    expect(banner(EVENTS.monsoon)).toContain('x0.5');
  });

  it('shows the amount for money events without collections', () => {
    const w = eventInfo(EVENTS.wedding_season);
    expect(w.chips).toEqual([expect.objectContaining({ name: '₹30,000', amount: true })]);
    expect(banner(EVENTS.festival)).toContain('₹50,000');
  });

  it('keys the strip by event id + round so a new event is announced once', () => {
    expect(eventInfo(EVENTS.rush_hour).key).toBe('rush_hour:3');
    expect(eventInfo({ ...EVENTS.rush_hour, round: 6 }).key).not.toBe(eventInfo(EVENTS.rush_hour).key);
    expect(eventInfo(null)).toBeNull();
  });

  it('sits in the control panel as a slim ribbon above the die while view.event is set, and is gone without one', () => {
    const n = TILES.length;
    const view = {
      phase: 'roll', turn: 0, round: 3, players: [{ id: 'me', name: 'Nithin', cash: 1500000, pos: 0, color: '#ff4d6d', avatar: 0 }],
      owners: Array(n).fill(null), levels: Array(n).fill(0), mortgaged: Array(n).fill(false), cfg: { maxRounds: 20 }, event: EVENTS.monsoon,
    };
    const session = {
      mode: 'online', me: 'me', view, busy: false, rolling: false, result: null, options: { roll: true }, log: [], dispatch: () => {},
      display: { players: view.players, owners: view.owners, levels: view.levels, mortgaged: view.mortgaged, turn: 0, round: 3, dice: [], phase: 'roll', cfg: view.cfg },
    };
    const out = html(createElement(ControlPanel, { session, onOpenTile: () => {}, onOpenTrade: () => {} }));
    expect(out.indexOf('Monsoon')).toBeGreaterThan(-1);
    expect(out.indexOf('Monsoon')).toBeGreaterThan(out.indexOf('role="tablist"'));
    expect(out.indexOf('Monsoon')).toBeLessThan(out.indexOf('class="cp-dice'));
    delete session.view.event;
    expect(html(createElement(ControlPanel, { session }))).not.toContain('cp-event__title');
  });
});
