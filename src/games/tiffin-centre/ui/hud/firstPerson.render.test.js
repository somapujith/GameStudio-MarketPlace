import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionSheet from './ActionSheet.jsx';
import EdgeIndicators from './EdgeIndicators.jsx';
import HudLayer from './HudLayer.jsx';
import { HelpCard, QuickBar } from './QuickBar.jsx';
import RecipeCard from './RecipeCard.jsx';
import { SubtitleStrip, GlossLive } from './Subtitles.jsx';
import WorldBubbles from './WorldBubbles.jsx';
import { availability } from './hudLogic.js';
import { getRecipe, fallbackRecipe } from './recipeData.js';
import { DEFAULT_PREFS } from './prefs.js';
import { createProjector } from './projector.js';
import { mkCustomer, mkSlot, mkState } from './testState.js';

const world = () => {
  const s = mkState({ level: 3, cfg: { menu: ['dosa', 'masala_dosa', 'irani_chai', 'idly'], spots: 4 } });
  s.stations.tawa1.slots = [mkSlot(), mkSlot(), mkSlot()];
  s.customers = [
    mkCustomer({ id: 7, spot: 0, name: 'Ravi anna', order: ['dosa', 'irani_chai'], got: ['irani_chai'] }),
    mkCustomer({ id: 12, spot: 1, name: 'Fatima aapa', st: 'paying', payLeft: 2, order: ['idly'], got: ['idly'], total: 30 }),
  ];
  return s;
};
const U = (o = {}) => ({ id: 'u1', customer: 7, lang: 'te', text: 'ఒక దోశ ఇవ్వండి', rom: 'oka dosa ivvandi', en: 'One dosa please', mood: 'impatient', ttlMs: 4000, ...o });
const sess = (extra = {}) => ({ meId: 'me', mode: 'practice', players: [{ id: 'me', name: 'Me' }], pause() {}, subscribe: () => () => {}, dispatch: () => true, tutorial: null, ...extra });
const hud = (s, extra = {}) => renderToStaticMarkup(createElement(HudLayer, { session: sess(extra), scene: null, state: s, tickAt: 0, status: 'playing', connection: 'open', reducedOverride: false }));

describe('order tokens', () => {
  const html = hud(world());
  it('every chit wears a big punched TOKEN number and says it in its label', () => {
    expect(html).toMatch(/tc-hud-token[^>]*aria-hidden="true"><i class="tc-hud-token-hole"><\/i><small>TOKEN<\/small><b>7<\/b>/);
    expect(html).toContain('<b>12</b>');
    expect(html).toContain('aria-label="Token 7, Ravi anna, Office-goer, waiting, needs Plain Dosa, 1 of 2 served"');
    expect(html).toContain('aria-label="Look at token 7"');
  });
  it('the collect button is about the token and still shows the money', () => {
    expect(html).toContain('aria-label="Collect ₹30 from token 12, Fatima aapa"');
    expect(html).toContain('COLLECT');
  });
  it('served chips keep a readable tick inside the chip (no overlap, no faded chip)', () => {
    expect(html).toContain('tc-hud-dishchip is-served');
    expect(html).toContain('tc-hud-tick');
  });
  it('the empty rail says tokens, not orders', () => {
    expect(hud(mkState())).toContain('No tokens yet');
  });
});

describe('head bubbles carry the token and the speech', () => {
  const s = world();
  const markup = (speech, subs = 'both', bubbleIds = null) =>
    renderToStaticMarkup(createElement(WorldBubbles, { scene: null, state: s, onTarget() {}, projector: createProjector(), speech, bubbleIds, subs }));
  it('the order bubble shows TOKEN n and the dishes; a paying customer shows the note', () => {
    const h = markup([]);
    expect(h).toContain('<small>TOKEN</small><b>7</b>');
    expect(h).toContain('<small>TOKEN</small><b>12</b>');
    expect(h).toContain('₹30');
    expect(h).not.toContain('tc-hud-say');
  });
  it('a speech bubble sits over the right customer, coloured by mood, with native text and a small English gloss', () => {
    const h = markup([{ u: U(), leaving: false }]);
    expect(h).toContain('class="tc-hud-say" data-tone="impatient" data-leaving="0" lang="te"');
    expect(h).toContain('<span class="tc-hud-say-native">ఒక దోశ ఇవ్వండి</span>');
    expect(h).toContain('<span class="tc-hud-say-english">One dosa please</span>');
    expect(h.indexOf('class="tc-hud-say"')).toBeLessThan(h.indexOf('class="tc-hud-bubble"'));
  });
  it('honours the subtitle mode, the leaving fade and the three-bubble pick', () => {
    expect(markup([{ u: U(), leaving: false }], 'english')).not.toContain('ఒక దోశ');
    expect(markup([{ u: U({ mood: 'angry' }), leaving: true }])).toContain('data-tone="angry" data-leaving="1"');
    expect(markup([{ u: U(), leaving: false }], 'both', new Set(['someone-else']))).not.toContain('tc-hud-say');
  });
});

describe('subtitle strip and gloss', () => {
  it('shows the token and the lines in the chosen style; empty renders an inert strip', () => {
    const entry = { u: U({ mood: 'angry' }), leaving: false };
    const h = renderToStaticMarkup(createElement(SubtitleStrip, { entry, subs: 'both', token: 7 }));
    expect(h).toContain('data-tone="angry"');
    expect(h).toContain('<small>TOKEN</small><b>7</b>');
    expect(h).toContain('tc-hud-subs-native');
    expect(h).toContain('tc-hud-subs-english');
    expect(h).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(createElement(SubtitleStrip, { entry, subs: 'roman', token: 7 }))).toContain('oka dosa ivvandi');
    expect(renderToStaticMarkup(createElement(SubtitleStrip, { entry: null, subs: 'both' }))).toContain('data-empty="1"');
  });
  it('announces the English gloss politely', () => {
    const h = renderToStaticMarkup(createElement(GlossLive, { items: [{ id: 1, text: 'Token 7: One dosa please' }] }));
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('Token 7: One dosa please');
  });
});

describe('off-screen indicators', () => {
  it('one chip per customer with the token and dishes still wanted, hidden until the frame loop places it', () => {
    const h = renderToStaticMarkup(createElement(EdgeIndicators, { scene: null, state: world(), projector: createProjector(), rootRef: { current: null }, onLook() {} }));
    expect((h.match(/class="tc-hud-edge"/g) || []).length).toBe(2);
    expect(h).toContain('<small>TOKEN</small><b>7</b>');
    expect(h).toContain('data-hidden="1"');
    expect(h).toContain('aria-hidden="true"');
  });
});

describe('quick buttons and help', () => {
  const q = (o = {}) => renderToStaticMarkup(createElement(QuickBar, { prefs: DEFAULT_PREFS, onPrefs() {}, turned: false, onRecentre() {}, onHelp() {}, ...o }));
  it('voices toggle, subtitle cycle, recentre and help are all labelled 44px buttons', () => {
    const h = q();
    expect(h).toContain('aria-label="Customer voices: on"');
    expect(h).toContain('aria-pressed="true"');
    expect(h).toContain('aria-label="Subtitles: Native + English. Press to change"');
    expect(h).toContain('aria-label="Look straight ahead (V)"');
    expect(h).toContain('aria-label="Controls help (?)"');
    expect(q({ prefs: { ...DEFAULT_PREFS, voices: false } })).toContain('Customer voices: off');
    expect(q({ turned: true })).toContain('data-show="1"');
  });
  it('the help card prints the scheme that is implemented, keyboard or touch', () => {
    const k = renderToStaticMarkup(createElement(HelpCard, { touch: false, onClose() {} }));
    expect(k).toContain('Walk along the counter');
    expect(k).toContain('<kbd>Shift + arrows</kbd>');
    expect(k).toContain('tap to work');
    const t = renderToStaticMarkup(createElement(HelpCard, { touch: true, onClose() {} }));
    expect(t).toContain('Drag on empty space to look around');
    expect(t).toContain('Customers off screen');
    expect(t).toContain('Z / X look around');
  });
  it('the HUD mounts the quick bar, the subtitle slot, the bubbles and the edge layer in the first-person layout', () => {
    const h = hud(world());
    for (const c of ['tc-hud-quick', 'tc-hud-subs', 'tc-hud-bubbles', 'tc-hud-edges', 'tc-hud-utility', 'tc-hud-railbox']) expect(h).toContain(c);
  });
});

describe('recipes', () => {
  it('every dish has a card with steps and a tip, from recipes.js when it exists or from the catalogue', () => {
    for (const d of ['dosa', 'idly', 'poori', 'irani_chai', 'mirchi_bajji']) {
      const r = getRecipe(d);
      expect(r.steps.length).toBeGreaterThan(1);
      expect(r.steps.every((x) => typeof x.en === 'string' && x.en.length > 0)).toBe(true);
      expect(r.name).toBeTruthy();
    }
    expect(getRecipe('nope')).toBeNull();
    expect(fallbackRecipe('dosa').steps[2].en).toContain('7 seconds');
  });
  it('the card shows the dish, English steps, optional Telugu and Hindi, and Chotu\'s tip', () => {
    const h = renderToStaticMarkup(createElement(RecipeCard, { dish: 'masala_dosa' }));
    expect(h).toContain('Masala Dosa');
    expect(h).toContain('మసాలా దోశ');
    expect(h).toContain('<ol>');
    expect(h).toContain('tc-hud-recipe-tip');
  });
  it('the cook sheet has a ? recipe peek on every dish row', () => {
    const s = world();
    const h = renderToStaticMarkup(createElement(ActionSheet, { sheet: { station: 'tawa1', slot: 0 }, state: s, avail: availability(s, 'me'), onPick() {}, onClose() {} }));
    expect((h.match(/class="tc-hud-sheet-peek"/g) || []).length).toBe(2); // dosa + masala dosa on this menu
    expect(h).toContain('aria-label="Recipe for Plain Dosa"');
    expect(h).toContain('aria-expanded="false"');
  });
});

describe('tutorial gate in the HUD', () => {
  it('renders the same HUD when the tutorial only allows some actions', () => {
    expect(() => hud(world(), { tutorial: { allowed: ['move'], step: {} } })).not.toThrow();
  });
});
