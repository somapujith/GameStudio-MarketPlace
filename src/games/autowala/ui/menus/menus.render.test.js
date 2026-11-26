// Server-rendered markup of the phone-aware menus: the close / back buttons, the sticky action bars, the touch controls help page and
// the big fare-choice buttons exist in the DOM (CSS decides which are shown, see menuLayout.test.js). No browser needed.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ControlsPanel } from './PausePanels.jsx';
import { START_TOUCH, TOUCH } from './controls.js';
import JobBoard from '../quests/JobBoard.jsx';
import LogPanel from '../quests/LogPanel.jsx';
import Hisaab from '../Hisaab.jsx';
import FareChoice from '../fares/FareChoice.jsx';

const html = (el) => renderToStaticMarkup(el);
const count = (s, needle) => s.split(needle).length - 1;

describe('controls help page', () => {
  it('describes the touch controls generically: wheel on the left, pedals on the right', () => {
    const rows = TOUCH.map((r) => `${r.keys.join(' ')} ${r.what}`).join('|');
    expect(rows).toMatch(/Wheel/);
    expect(rows).toMatch(/left/);
    expect(rows).toMatch(/Pedals/);
    expect(rows).toMatch(/right/);
    expect(START_TOUCH.map((r) => r.who).join('|')).toMatch(/Wheel on the left.*Pedals on the right/);
  });
  it('leads with the touch legend on a touch screen and with the keyboard otherwise', () => {
    const t = html(createElement(ControlsPanel, { touch: true }));
    expect(t).toContain('Wheel on the left, pedals on the right');
    expect(t.indexOf('TOUCH')).toBeLessThan(t.indexOf('KEYBOARD'));
    const k = html(createElement(ControlsPanel, { touch: false }));
    expect(k).not.toContain('aw-controls-lead');
    expect(k.indexOf('KEYBOARD')).toBeLessThan(k.indexOf('TOUCH'));
  });
});

const offer = (id, extra = {}) => ({
  id, defId: id, title: `Job ${id}`, te: 'పని', blurb: 'Do the thing.', diff: 2, kind: 'delivery', reward: { cash: 300, rep: 20 }, timeLimit: 120,
  locked: false, minRep: 0, done: 0, best: 0, daily: false, unavailable: false, doneToday: false, stepList: [{ label: 'Go', te: '' }], ...extra,
});
const quest = (offers) => ({ offers, rank: { title: 'Naya Driver', te: 'కొత్త', floor: 0, next: 120 }, rep: 0, canAccept: true, completed: 0, tutorialState: 'done' });

describe('job board markup', () => {
  const game = { ctx: { quests: { accept: vi.fn(), saved: { done: {}, best: {} } }, closeMenu: vi.fn() } };
  const markup = html(createElement(JobBoard, { game, snap: { menu: 'jobs', quest: quest([offer('a'), offer('b')]) } }));
  it('has a 44 px close button in the header and an accept / close pair for each layout (the sticky bar and the detail pane)', () => {
    expect(markup).toContain('aw-sheet-x');
    expect(markup).toContain('aria-label="Close the job board"');
    expect(count(markup, 'ACCEPT JOB')).toBe(2);
    expect(markup).toContain('aw-quest-actions--bar');
    expect(markup).toContain('aw-sheet-bar');
  });
  it('exposes the layout name on the root', () => {
    expect(markup).toContain('data-layout="desktop"'); // unknown size on the server
  });
  it('shows no action bar when the board is empty', () => {
    const empty = html(createElement(JobBoard, { game, snap: { menu: 'jobs', quest: quest([]) } }));
    expect(empty).not.toContain('ACCEPT JOB');
    expect(empty).toContain('No jobs on the board');
  });
});

describe('quest log markup', () => {
  it('has a close button in the header and in the bar', () => {
    const game = { ctx: { quests: { saved: { done: {}, best: {} } }, closeMenu: vi.fn() } };
    const m = html(createElement(LogPanel, { game, snap: { menu: 'quests', quest: quest([]) } }));
    expect(m).toContain('aria-label="Close the quest log"');
    expect(m).toContain('aw-quest-actions--bar');
    expect(count(m, 'CLOSE')).toBeGreaterThanOrEqual(2);
  });
});

describe('hisaab markup', () => {
  const h = {
    reason: 'day', lifeDay: 2, fares: 300, tips: 20, earned: 320, expenses: { cng: 30, rent: 100 }, expenseTotal: 130, net: 190, rides: 3, bestFare: 150,
    stars: 4, hours: 8, history: [], rent: { owned: false, owner: 'Seth', ownerTe: 'సేఠ్', paid: 100, owed: 0 },
  };
  const game = { ctx: { career: {}, closeMenu: vi.fn(), openMenu: vi.fn() } };
  it('puts the title block, the close button and the action bar where the phone layout needs them', () => {
    const m = html(createElement(Hisaab, { game, snap: { menu: 'hisaab', wallet: 500, career: { hisaab: h } } }));
    expect(m).toContain('aw-career-head');
    expect(m).toContain('aw-sheet-x');
    expect(m).toContain('aw-career-acts aw-sheet-bar');
    expect(m).toContain('NEXT DAY');
    expect(m).toContain('aria-label="Next day"');
    expect(m.indexOf('aw-career-head')).toBeLessThan(m.indexOf('aw-career-main'));
    expect(m.indexOf('aw-career-main')).toBeLessThan(m.indexOf('aw-career-acts'));
  });
});

describe('fare choice markup', () => {
  const choice = {
    key: 1, kind: 'price', quiet: false, title: { en: 'How will you charge?', te: 'ఛార్జీ' }, note: null,
    options: [1, 2, 3].map((n) => ({ n, id: `o${n}`, label: { en: `Option ${n}`, te: '' }, sub: null, tone: null })), timeLeft: 8, total: 12,
  };
  it('has one real button per option, each with its number, so 1 / 2 / 3 work on a touch screen', () => {
    const game = { ctx: { fares: { choose: vi.fn() } } };
    const m = html(createElement(FareChoice, { game, snap: { fareChoice: choice } }));
    expect(count(m, '<button')).toBe(3);
    for (const n of [1, 2, 3]) expect(m).toContain(`<kbd class="aw-fare-key">${n}</kbd>`);
  });
});
