// QA-C B2/B3 and QA-B B1/B3/B4: the phone-portrait compact HUD (checked as CSS text: there is no browser in the node run), the caps that keep the
// centre of the screen free, the bubble bounds that include the subtitle and top bands, and the world bubble that yields to the subtitle bar.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createGame } from '@shared/tiffin-centre/index.js';
import WorldBubbles from './WorldBubbles.jsx';
import { createProjector } from './projector.js';
import { freeBounds } from './EdgeIndicators.jsx';
import { stockGroups, stockRows } from './opsLogic.js';
import { mkCustomer, mkState } from './testState.js';

const css = readFileSync(new URL('./hud.css', import.meta.url), 'utf8');
const start = css.indexOf('B3 (docs/TIFFIN_CENTRE_PROOF_C.md)');
const portrait = css.slice(css.indexOf('@media (max-width: 520px) and (orientation: portrait) {', start));
const portraitBlock = portrait.slice(0, portrait.indexOf('/* small phones'));
const px = (name) => Number(new RegExp(`--${name}: (\\d+)px`).exec(portraitBlock)?.[1]);

describe('B3: phone portrait compact layout', () => {
  it('the rules exist behind a width <= 520 portrait media query', () => {
    expect(start).toBeGreaterThan(0);
    expect(portraitBlock.length).toBeGreaterThan(2000);
    // the old stacked layout stays for tablets and wide windows: the compact one is NOT the default
    expect(css.slice(0, start)).not.toContain('--tcp-gap');
  });
  it('top bar: one block (banner + vitals over takings, buttons beside), shift name and cost folded away', () => {
    expect(portraitBlock).toMatch(/\.tc-hud-top \{[^}]*grid-template-areas: 'banner vitals btns' 'tin tin btns'/);
    expect(portraitBlock).toMatch(/\.tc-hud-grommet, \.tc-hud-shift, \.tc-hud-daypart \{ display: none; \}/);
    expect(portraitBlock).toMatch(/\.tc-hud-book\.is-cost \{ display: none; \}/);
    expect(portraitBlock).toMatch(/\.tc-hud-top \{[^}]*max-height: var\(--tcp-top\)/);
  });
  it('availability: one row, the Stall button shown and the status unfolding as a popover; counts only on the chips', () => {
    expect(portraitBlock).toMatch(/\.tc-hud-board \{ flex-direction: row;[^}]*max-height: var\(--tcp-board\)/);
    expect(portraitBlock).toMatch(/\.tc-hud-status-toggle \{[^}]*display: flex/);
    expect(portraitBlock).toMatch(/\.tc-hud-status\[data-open='0'\] \.tc-hud-status-body \{ display: none; \}/);
    expect(portraitBlock).toMatch(/\.tc-hud-status-body \{ position: absolute;[^}]*top: calc\(100% \+ 4px\)/);
    expect(portraitBlock).toMatch(/\.tc-hud-ready small, \.tc-hud-chip-meta, \.tc-hud-chip-name[^{]*\{ display: none; \}/);
  });
  it('order chits: one horizontal scrollable strip of compact chits (no stretching, no names, no blank paper)', () => {
    expect(portraitBlock).toMatch(/\.tc-hud-railbox \{[^}]*max-height: var\(--tcp-rail\)/);
    expect(portraitBlock).toMatch(/\.tc-hud-rail \{[^}]*align-items: flex-start;[^}]*overflow-y: hidden/);
    expect(portraitBlock).toMatch(/\.tc-hud-chit \{ width: auto; display: flex;/);
    expect(portraitBlock).toMatch(/\.tc-hud-who, \.tc-hud-badges, \.tc-hud-dishname, \.tc-hud-chit\[data-st='paying'\] \.tc-hud-dishes \{ display: none; \}/);
    expect(portraitBlock).toMatch(/\.tc-hud-collect \{ width: auto; min-height: 44px; margin-top: 0;/);
    // the stretch bug itself (a short chit grown to the tallest one's ~330 px) is fixed for every portrait-ish layout, tablets included
    expect(css).toMatch(/@media \(max-width: 899px\) and \(min-height: 521px\), \(max-width: 599px\) \{\s*\.tc-hud-rail \{ align-items: flex-start; \}/);
  });
  it('the dock is one row of 44 px slots that scrolls; every portrait control keeps a 44 px target', () => {
    expect(portraitBlock).toMatch(/\.tc-hud-slot \{ width: 44px; height: 44px; \}/);
    expect(portraitBlock).toMatch(/\.tc-hud-dock \{[^}]*max-height: var\(--tcp-dock\)/);
    expect(portraitBlock).toMatch(/\.tc-hud-chip \{ min-width: 54px; min-height: 44px;/);
    expect(portraitBlock).toMatch(/\.tc-hud-status-toggle \{[^}]*min-height: 44px/);
    expect(portraitBlock).toMatch(/\.tc-hud-collect \{[^}]*min-height: 44px/);
    expect(portraitBlock).toMatch(/\.tc-hud-chit-main, \.tc-hud-chit-main\[data-badges='1'\] \{[^}]*min-height: 44px/);
    // nothing in the block shrinks a tap target below 44 px
    for (const m of portraitBlock.matchAll(/\.tc-hud-(?:btn|slot|chip|hand|trash)\s*\{[^}]*?(?<![-\w])(?:min-)?(?:width|height): (\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(44);
  });
  it('keeps reduced motion and keyboard focus (no rule here turns them off; the global ones above still apply)', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.tc-hud \*, \.tc-hud \*::before, \.tc-hud \*::after \{ animation: none !important/);
    expect(portraitBlock).not.toMatch(/outline: none|:focus-visible/);
  });
  it('CAPS: with any number of orders the centre keeps at least half the height on a 390 x 844 phone (and most of it on smaller ones)', () => {
    const gap = px('tcp-gap');
    const free = (h, g = gap) => {
      // 5 gaps = between the 6 grid rows' bands (top, board, mid, rail, bottom + the outer paddings are 2 x 6)
      const bands = px('tcp-top') + px('tcp-board') + px('tcp-rail') + px('tcp-hands') + 4 + px('tcp-dock');
      return h - bands - 4 * g - 12;
    };
    expect(px('tcp-top')).toBeLessThanOrEqual(56);
    expect(px('tcp-rail')).toBeLessThanOrEqual(88);
    expect(px('tcp-dock')).toBeLessThanOrEqual(88);
    expect(free(844) / 844).toBeGreaterThanOrEqual(0.5); // iPhone 12-15, Pixel 7
    expect(free(812) / 812).toBeGreaterThanOrEqual(0.5);
    expect(free(740) / 740).toBeGreaterThanOrEqual(0.48);
    // 360 x 640 uses the small-phone tier (gap 3 px)
    expect(css).toMatch(/@media \(max-width: 520px\) and \(orientation: portrait\) and \(max-height: 700px\) \{\s*\.tc-hud \{ --tcp-gap: 3px/);
    expect(free(640, 3) / 640).toBeGreaterThanOrEqual(0.44);
  });
});

describe('B1 (QA B): the status block never hides the Board tile behind the dish list', () => {
  const tail = css.slice(css.indexOf('B1 (QA B)'));
  it('caps the status block, lets it scroll with a visible thin scrollbar, and lets the dish list shrink', () => {
    expect(tail).toMatch(/@media \(min-width: 900px\) and \(min-height: 521px\) \{\s*\.tc-hud-status \{ max-height: 62%;/);
    expect(tail).toMatch(/scrollbar-width: thin/);
    expect(tail).toMatch(/\.tc-hud-status::-webkit-scrollbar \{ display: block/);
    // the base wide rule is the overflow container the cap relies on
    expect(css).toMatch(/\.tc-hud-status \{ flex: none; max-height: 52%; overflow-y: auto;/);
    expect(css).toMatch(/\.tc-hud-chips \{ flex: 1 1 auto; min-height: 0; max-height: none; \}/);
  });
});

describe('B3 (QA B): no freshness next to "Out"', () => {
  it('an ingredient at zero shows no freshness figure or band; one in stock still does', () => {
    const s = createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level: 12, pace: 'normal' }, seed: 3 });
    const ferment = stockRows(s).find((r) => r.fresh !== null);
    expect(ferment).toBeTruthy();
    expect(ferment.fresh).not.toBeNull();
    s.stock[ferment.item] = 0;
    const after = stockRows(s).find((r) => r.item === ferment.item);
    expect(after.tone).toBe('out');
    expect(after.fresh).toBeNull();
    expect(after.band).toBeNull();
    const grp = stockGroups(s).find((g) => g.rows.some((r) => r.item === ferment.item));
    expect(grp.ariaLabel).not.toMatch(new RegExp(`${after.name} [^;]*percent fresh`));
  });
});

describe('B2 (QA C): bubbles keep clear of the top, board, subtitle and team bands', () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const rootOf = (parts, w = 390, h = 844) => ({ getBoundingClientRect: () => rect(0, 0, w, h), querySelector: (sel) => (parts[sel] ? { getBoundingClientRect: () => parts[sel] } : null) });
  it('the subtitle bar caps the free rectangle from below', () => {
    const b = freeBounds(rootOf({ '.tc-hud-top': rect(0, 0, 390, 56), '.tc-hud-board': rect(0, 62, 390, 114), '.tc-hud-railbox': rect(0, 700, 390, 770), '.tc-hud-bottom': rect(0, 776, 390, 844), '.tc-hud-subs': rect(20, 600, 370, 660) }), 390, 844);
    expect(b.top).toBe(114);
    expect(b.bottom).toBe(600);
  });
  it('an empty subtitle bar (display: none, zero size) changes nothing', () => {
    const b = freeBounds(rootOf({ '.tc-hud-top': rect(0, 0, 390, 56), '.tc-hud-railbox': rect(0, 700, 390, 770), '.tc-hud-subs': rect(0, 0, 0, 0) }), 390, 844);
    expect(b.bottom).toBe(700);
  });
  it('the online team bar in portrait pushes the top edge down', () => {
    const b = freeBounds(rootOf({ '.tc-hud-top': rect(0, 0, 390, 56), '.tc-hud-coop': rect(0, 60, 390, 100), '.tc-hud-railbox': rect(0, 700, 390, 770) }), 390, 844);
    expect(b.top).toBe(100);
  });
  it('a bubble source measures again when a speech bubble appears (its anchor grows taller)', () => {
    const src = readFileSync(new URL('./WorldBubbles.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/rec\.say !== sayNow/);
    expect(src).toMatch(/data-say=\{s \? '1' : '0'\}/);
  });
});

describe('B2/B4: the world speech bubble yields to the subtitle bar showing the same line', () => {
  const s = mkState({ level: 3, cfg: { menu: ['dosa', 'idly'], spots: 4 } });
  s.customers = [mkCustomer({ id: 7, spot: 0, name: 'Ravi anna', order: ['dosa'] })];
  const U = (over = {}) => ({ id: 'u1', customer: 7, lang: 'te', text: 'ఒక దోశ ఇవ్వండి', en: 'One dosa please', mood: 'impatient', ...over });
  const markup = (subId) =>
    renderToStaticMarkup(createElement(WorldBubbles, { scene: null, state: s, onTarget() {}, projector: createProjector(), speech: [{ u: U(), leaving: false }], subs: 'both', subId }));
  it('shows the speech bubble when the subtitle bar shows another line (or none)', () => {
    expect(markup(null)).toContain('tc-hud-say');
    expect(markup('other')).toContain('tc-hud-say');
  });
  it('hides it when the subtitle bar shows this very line, and keeps the order bubble', () => {
    const h = markup('u1');
    expect(h).not.toContain('tc-hud-say');
    expect(h).toContain('tc-hud-bubble');
  });
});
