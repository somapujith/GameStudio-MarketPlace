// Render tests for the Hustle deed: every one of the 36 squares opens, districts show their three themed businesses,
// the set bonus, city events and the owner's actions; special squares explain their rule.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TILES } from '@shared/board.js';
import { createGame } from '@shared/index.js';

// The sheet portals into document.body and the art pulls in SVG-heavy modules: render the content inline.
const captured = vi.hoisted(() => ({ footer: null }));
vi.mock('./ui/Sheet.jsx', () => ({
  default: ({ header, children, footer }) => {
    captured.footer = footer;
    return createElement('div', null, header, children, footer);
  },
}));
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => null,
  BuildingArt: () => null,
  PieceArt: ({ piece }) => createElement('i', { 'data-piece': piece }),
}));

const { default: PropertySheet, HERITAGE_NOTE, squareRule, bandTones, slotTones, contrastRatio, bestInk, mixHex, oddsMeter, countSteps } = await import('./PropertySheet.jsx');
const { tileAccent } = await import('./ui/helpers.js');

const HITEC = 31;
const sessionFor = (patch = {}) => {
  const view = createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }], seed: 7 });
  return { me: 'me', view, display: null, options: {}, busy: false, dispatch() {}, ...patch };
};
const html = (session, tileId) => renderToStaticMarkup(createElement(PropertySheet, { session, tileId, onClose() {} }));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/** First element in a React tree whose text content includes `label` and that has an onClick. */
function findButton(node, label) {
  const textOf = (n) => (n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.props?.children));
  const walk = (n) => {
    if (!n || typeof n !== 'object') return null;
    if (Array.isArray(n)) { for (const c of n) { const f = walk(c); if (f) return f; } return null; }
    if (n.props?.onClick && textOf(n).includes(label)) return n.props.onClick;
    return walk(n.props?.children);
  };
  return walk(node);
}

describe('PropertySheet: every square', () => {
  it('renders all 36 squares with their name and no snatch / trap / jail leftovers', () => {
    expect(TILES).toHaveLength(36);
    for (const t of TILES) {
      const out = text(html(sessionFor({ options: { roll: true } }), t.id));
      expect(out, t.name).toContain(t.name);
      for (const gone of ['Snatch', 'trap', 'Shield', 'jail', 'Jail']) expect(out, `${t.name}: ${gone}`).not.toContain(gone);
    }
  });
});

describe('PropertySheet: the HITEC City deed', () => {
  it('shows the collection, identity, lore with the heritage note, price and the three businesses', () => {
    const out = text(html(sessionFor(), HITEC));
    expect(out).toContain('Cyberabad');
    expect(out).toContain('Tech and office growth');
    expect(out).toContain(TILES[HITEC].lore);
    expect(out).toContain(HERITAGE_NOTE);
    expect(out).toContain('₹3,40,000');
    expect(out).toMatch(/Startup Office ₹34,000/);
    expect(out).toMatch(/Business Centre ₹92,000/);
    expect(out).toMatch(/Tech Campus ₹1,50,000/);
    expect(out).toContain('×1.5 with the full set');
    expect(out).toContain('Upgrade ₹1,36,000 each step');
    expect(out).toContain('Mortgage value ₹1,70,000');
    expect(out).toContain('Unowned');
    expect(out).toContain('District for sale');
  });

  it('highlights the current business and names the owner with their piece', () => {
    const s = sessionFor();
    s.view.owners[HITEC] = 'me';
    s.view.levels[HITEC] = 1;
    const deed = html(s, HITEC);
    expect(deed.match(/class="is-current"/g)).toHaveLength(1);
    expect(deed).toMatch(/is-current"><th[^>]*>.*?Business Centre/);
    expect(deed).toContain(`data-piece="${s.view.players[0].piece}"`);
    expect(text(deed)).toContain('You');
    expect(text(deed)).toContain('Business Centre · next: Tech Campus');
  });

  it('applies the full set bonus to the first business only', () => {
    const s = sessionFor();
    for (const t of [28, 29, 31]) s.view.owners[t] = 'b1';
    const out = text(html(s, HITEC));
    expect(out).toContain('Full set: ×1.5 = ₹51,000');
    expect(out).toContain('Ravi owns the full set');
  });

  it('shows an active rent event on its collection', () => {
    const s = sessionFor();
    s.view.owners[HITEC] = 'b1';
    s.view.event = { id: 'rush_hour', kind: 'rent', title: 'Rush Hour: Cyberabad office traffic', group: 'cyber', mult: 1.5, round: s.view.round };
    const out = text(html(s, HITEC));
    expect(out).toContain('Rush Hour: Cyberabad office traffic : rent ×1.5 this round');
    expect(out).toContain('Rush Hour: Cyberabad office traffic: ₹51,000');
    // not on another collection
    expect(text(html(s, 1))).not.toContain('Rush Hour');
  });

  it('says when an event only lifts upgraded businesses', () => {
    const s = sessionFor();
    s.view.event = { id: 'biryani_boom', kind: 'rent', title: 'Biryani Business Boom', groups: ['oldcity', 'everyday'], mult: 2, upgradedOnly: true, round: s.view.round };
    const out = text(html(s, 7));
    expect(out).toContain('rent ×2 on upgraded businesses this round');
  });

  it('offers Upgrade / Sell / Mortgage from the options and dispatches them', () => {
    const dispatch = vi.fn();
    const s = sessionFor({
      dispatch,
      options: { upgrade: [{ tile: HITEC, cost: 136000 }], sellBuilding: [{ tile: HITEC, refund: 68000 }] },
    });
    s.view.owners[HITEC] = 'me';
    s.view.levels[HITEC] = 1;
    const out = text(html(s, HITEC));
    expect(out).toContain('Upgrade to Tech Campus · ₹1,36,000');
    expect(out).toContain('Sell Business Centre +₹68,000');
    findButton(captured.footer, 'Upgrade to Tech Campus')();
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE', tile: HITEC });
    findButton(captured.footer, 'Sell Business Centre')();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELL_BUILDING', tile: HITEC });
  });

  it('tells the owner to collect the whole collection first and disables Upgrade', () => {
    const s = sessionFor({ options: { mortgage: [{ tile: HITEC, value: 170000 }] } });
    s.view.owners[HITEC] = 'me';
    let out = text(html(s, HITEC));
    expect(out).toContain('Own all 3 districts of Cyberabad first (you have 1)');
    expect(out).toContain('Upgrade to Business Centre');
    s.view.owners[28] = 'me';
    expect(text(html(s, HITEC))).toContain('Own all 3 districts of Cyberabad first (you have 2)');
    // with the whole collection the engine offers the upgrade and the reason disappears
    s.view.owners[29] = 'me';
    s.options = { upgrade: [{ tile: HITEC, cost: 136000 }] };
    out = text(html(s, HITEC));
    expect(out).not.toContain('Own all 3 districts');
    expect(out).toContain('Upgrade to Business Centre · ₹1,36,000');
  });

  it('shows the top business and the mortgage action on level 0', () => {
    const s = sessionFor({ options: { mortgage: [{ tile: 1, value: 30000 }] } });
    s.view.owners[1] = 'me';
    expect(text(html(s, 1))).toContain('Mortgage +₹30,000');
    s.view.levels[1] = 2;
    expect(text(html(s, 1))).toContain('Top business: Trading Hub');
  });

  it('shows the mortgaged face instead of the ladder', () => {
    const s = sessionFor({ options: { unmortgage: [{ tile: 1, cost: 33000 }] } });
    s.view.owners[1] = 'me';
    s.view.mortgaged[1] = true;
    const out = text(html(s, 1));
    expect(out).toContain('Mortgaged');
    expect(out).toContain('for ₹30,000');
    expect(out).toContain('Unmortgage ₹33,000');
    expect(out).not.toContain('Trading Hub ₹');
  });

  it('keeps Buy and Skip for a pending purchase', () => {
    const s = sessionFor({ options: { buy: true, skipBuy: true } });
    s.view.pending = { type: 'buy', tile: 6, price: 100000 };
    const out = text(html(s, 6));
    expect(out).toContain('Buy for ₹1,00,000');
    expect(out).toContain('Skip');
  });
});

describe('PropertySheet: special squares', () => {
  const s = sessionFor();
  it('explains START, transport, cards, traffic, chai, municipal and the bazaar auction', () => {
    expect(text(html(s, 0))).toContain('Collect ₹2,00,000 every time you pass or land on START');
    const metro = text(html(s, 14));
    expect(metro).toContain('Pay ₹35,000 to ride ahead to MMTS Express');
    expect(metro).toContain('Meter kharab hai');
    expect(text(html(s, 2))).toContain('Draw a Nawabi Luck card');
    expect(text(html(s, 12))).toContain('Draw a City Drama card');
    expect(text(html(s, 9))).toContain('pay ₹25,000, spend a chai token, or wait');
    expect(text(html(s, 18))).toContain('Grab a chai token');
    expect(text(html(s, 27))).toContain('Pay ₹40,000 + ₹10,000 per upgrade level you own');
    expect(text(html(s, 32))).toContain('a random unowned district goes under the hammer');
  });

  it('prices Municipal Charges for my upgrades', () => {
    const v = sessionFor().view;
    v.owners[1] = 'me'; v.levels[1] = 2;
    v.owners[3] = 'me'; v.levels[3] = 1;
    expect(squareRule(TILES[27], { state: v, me: 'me' }).note).toContain('₹70,000');
  });

  it('offers the ride when I stand on the stop and the option is open', () => {
    const dispatch = vi.fn();
    const ss = sessionFor({ dispatch, options: { ride: { to: 14, fare: 25000 } } });
    ss.view.players[0].pos = 5;
    const out = text(html(ss, 5));
    expect(out).toContain('Ride to Metro Interchange · ₹25,000');
    findButton(captured.footer, 'Ride to')();
    expect(dispatch).toHaveBeenCalledWith({ type: 'RIDE' });
  });
});

describe('PropertySheet: stage, slots and meter', () => {
  it('shows what an unowned district would open as, with every set slot open and dashed', () => {
    const out = html(sessionFor(), HITEC);
    expect(text(out)).toContain('Opens as Startup Office');
    expect(out.match(/class="hg-slot[ "]/g)).toHaveLength(3);
    expect(out).not.toContain('hg-slot is-on');
    expect(out).toContain('hg-slot is-here');
    expect(text(out)).toContain('Cyberabad · 0/3 owned');
    expect(out).toContain('aria-label="0 of 3 owned"');
    expect(out).not.toContain('hg-prop-bonus');
  });

  it('fills owned slots with the owner colour and lights the set badge only with the whole set', () => {
    const s = sessionFor();
    s.view.owners[HITEC] = 'me';
    s.view.owners[28] = 'b1';
    let out = html(s, HITEC);
    expect(out.match(/hg-slot is-on/g)).toHaveLength(2);
    expect(out).toContain(`--pc:${s.view.players[0].color}`);
    expect(out).toContain(`--pc:${s.view.players[1].color}`);
    expect(out).toContain('hg-prop-bonus"'); // dim: locked
    expect(out).not.toContain('hg-prop-bonus is-on');
    expect(text(out)).toContain('Level 1 of 3');
    for (const t of [28, 29, 31]) s.view.owners[t] = 'me';
    out = html(s, HITEC);
    expect(out).toContain('hg-prop-bonus is-on');
    expect(out).toContain('hg-setstat is-full');
    expect(text(out)).toContain('Set bonus ×1.5');
  });

  it('marks the live ladder row for assistive tech and the levels around it as built / next', () => {
    const s = sessionFor();
    s.view.owners[HITEC] = 'me';
    s.view.levels[HITEC] = 1;
    const out = html(s, HITEC);
    expect(out).toContain('class="is-built"');
    expect(out).toContain('class="is-next"');
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="true"[^>]*>.*?Business Centre/);
  });

  it('renders the landing chance as a meter only when the roll is open', () => {
    expect(html(sessionFor(), HITEC)).not.toContain('hg-odds');
    const out = html(sessionFor({ options: { roll: true } }), HITEC);
    expect(out).toContain('hg-odds');
    expect(text(out)).toContain('Chance to land here next roll:');
    expect(out).toMatch(/--f:[01].?d*/);
  });

  it('names the deed by what it is: a title deed for districts, a square rule for the rest', () => {
    expect(text(html(sessionFor(), HITEC))).toContain('Title deed No. 031');
    expect(text(html(sessionFor(), 0))).toContain('Square rule Sq. 00');
  });

  it('keeps the count-up markup on the final amount', () => {
    const out = html(sessionFor(), HITEC);
    expect(out).toContain('<span class="hg-count">₹3,40,000</span>');
  });
});

describe('PropertySheet helpers', () => {
  it('contrastRatio follows WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
    expect(contrastRatio('#ffffff', '#767676')).toBeGreaterThan(4.5);
  });

  it('mixHex blends and clamps', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#ff0000', 0.7)).toBe('#ff0000');
    expect(mixHex('#102030', '#ffffff', 0)).toBe('#102030');
  });

  it('bandTones keeps the title ink at AA across the whole header for every square colour', () => {
    const colors = new Set(TILES.map((t) => tileAccent(t).color));
    expect(colors.size).toBeGreaterThan(8);
    for (const c of [...colors, '#ffffff', '#000000', '#7f7f7f', 'oops']) {
      const t = bandTones(c);
      expect(contrastRatio(t.ink, t.from), `${c} from`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.ink, t.to), `${c} to`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('slotTones keeps the chip text at AA from edge to edge for every player colour', () => {
    for (const c of ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b794f6', '#ff9f43', '#c77dff', '#ff9f1c', '#6a5cff', '#7f7f7f', '#404040']) {
      const t = slotTones(c);
      expect(contrastRatio(t.ink, t.from), `${c} from`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.ink, t.to), `${c} to`).toBeGreaterThanOrEqual(4.5);
      expect(bestInk(c)).toBe(t.ink);
    }
  });

  it('oddsMeter fills the bar at a quarter chance and labels tiny odds', () => {
    expect(oddsMeter(null)).toBeNull();
    expect(oddsMeter(undefined)).toBeNull();
    expect(oddsMeter(0)).toEqual({ fill: 0, pct: '0' });
    expect(oddsMeter(0.003)).toEqual({ fill: 0.012, pct: '<1' });
    expect(oddsMeter(1 / 6)).toEqual({ fill: 1 / 6 * 4, pct: '17' });
    expect(oddsMeter(0.5)).toEqual({ fill: 1, pct: '50' });
  });

  it('countSteps eases to the target in round numbers', () => {
    const up = countSteps(0, 320000);
    expect(up).toHaveLength(12);
    expect(up[up.length - 1]).toBe(320000);
    expect(up.every((v, i) => i === 0 || v >= up[i - 1])).toBe(true);
    expect(up.slice(0, -1).every((v) => v % 1000 === 0)).toBe(true);
    const down = countSteps(320000, 61000);
    expect(down[down.length - 1]).toBe(61000);
    expect(down.every((v, i) => i === 0 || v <= down[i - 1])).toBe(true);
    expect(countSteps(0, 0)).toEqual(Array(12).fill(0));
  });
});
