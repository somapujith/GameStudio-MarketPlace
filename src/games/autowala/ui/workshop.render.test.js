// The garage menu's Repair button (wave 3): pinned above the list only while the auto is dented, quotes ctx.career.repairCost(),
// and a part job is offered when the wallet is short. Server-side markup only; the click path is covered by the career tests.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Workshop from './Workshop.jsx';
import { DEFAULT_LOADOUT, DEFAULT_UPGRADES } from '../gameplay/catalog.js';

const make = ({ quote = 140, damage = 0.4, wallet = 500, menu = 'workshop' } = {}) => {
  const ws = { camera: { setView: vi.fn(), setShift: vi.fn(), setInput: vi.fn(), drag: vi.fn(), zoom: vi.fn() }, preview: vi.fn(), clearPreview: vi.fn(), stats: () => [], buy: vi.fn(), close: vi.fn() };
  const career = { damage, repairCost: () => quote, repair: vi.fn(() => ({ ok: true, cost: quote, repaired: damage })) };
  const profile = { data: { loadout: DEFAULT_LOADOUT, upgrades: DEFAULT_UPGRADES, wallet } };
  const game = { ctx: { workshop: ws, profile, career, toast: vi.fn() } };
  const snap = { menu, workshopPhase: 'open', wallet, career: { damage } };
  return { game, snap, career };
};
const html = ({ game, snap }) => renderToStaticMarkup(createElement(Workshop, { game, snap }));

describe('garage Repair button', () => {
  it('is pinned above the list with the damage and the quote', () => {
    const h = html(make());
    expect(h).toContain('Repair');
    expect(h).toContain('మరమ్మత్తు');
    expect(h).toContain('40% dented');
    expect(h).toContain('Rs 140');
    expect(h).toContain('aw-ws-fix');
  });
  it('is hidden when the auto has no damage to fix', () => {
    const h = html(make({ quote: 0, damage: 0 }));
    expect(h).not.toContain('aw-ws-fix');
    expect(h).not.toContain('dented');
  });
  it('renders nothing unless the workshop menu is open', () => {
    expect(html(make({ menu: null }))).toBe('');
  });
  it('survives a game without the career system', () => {
    const m = make();
    delete m.game.ctx.career;
    m.snap.career = undefined;
    expect(html(m)).not.toContain('aw-ws-fix');
  });
});

describe('garage Repair button, short of cash', () => {
  it('offers a part repair when the wallet cannot cover the quote', () => {
    const h = html(make({ quote: 140, wallet: 60 }));
    expect(h).toContain('Part repair');
    expect(h).toContain('is-part');
  });
});
