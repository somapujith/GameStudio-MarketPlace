// Phone / tablet layout contract of the game screen, checked on the CSS text and the pure layout helpers (no browser):
// the landscape phone is board-left + panel-right with a scrolling opponent strip, the viewport units have a dvh twin,
// tablets in portrait budget enough height, sheets stay inside a short landscape screen, desktop rules are untouched.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAND_QUERY, PHONE_QUERY, layoutMode } from './viewport.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const mobile = read('../../../styles/gamemobile.css');
const game = read('../../../styles/game.css');

/** The text of the first `@media (query) { ... }` block whose head contains `needle`. */
function mediaBlock(src, needle) {
  const at = src.indexOf(needle);
  expect(at, needle).toBeGreaterThan(-1);
  const open = src.indexOf('{', at);
  let depth = 1;
  let j = open + 1;
  while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
  return src.slice(open + 1, j - 1);
}

describe('layout mode', () => {
  it('every width / height class maps to the layout the CSS targets', () => {
    const mode = (w, h) => layoutMode({ phone: w <= 599, land: w > h && h <= 520 });
    expect(mode(360, 640)).toBe('phone');
    expect(mode(412, 915)).toBe('phone');
    expect(mode(844, 390)).toBe('land');
    expect(mode(915, 412)).toBe('land');
    expect(mode(667, 375)).toBe('land');
    expect(mode(568, 320)).toBe('land');
    expect(mode(768, 1024)).toBe('wide');
    expect(mode(1024, 768)).toBe('wide');
    expect(mode(1280, 800)).toBe('wide');
    expect(PHONE_QUERY).toContain('599px');
    expect(LAND_QUERY).toContain('520px');
  });
});

describe('landscape phone: board left, one panel right', () => {
  it('is a two-column grid whose first column is exactly the board', () => {
    expect(mobile).toMatch(/\.hg-game--land\s*\{[^}]*grid-template-columns:\s*var\(--hg-board\) minmax\(0, 1fr\)/);
    expect(mobile).toMatch(/\.hg-game--land \.hg-boardcol\s*\{[^}]*grid-column:\s*1/);
    expect(mobile).toMatch(/\.hg-game--land \.hg-table\s*\{\s*display:\s*contents/);
  });

  it('the opponents are one horizontally scrolling strip with contained overscroll', () => {
    const m = /\.hg-game--land \.hg-pods\s*\{([^}]*)\}/.exec(mobile)?.[1] || '';
    expect(m).toMatch(/flex-direction:\s*row/);
    expect(m).toMatch(/overflow-x:\s*auto/);
    expect(m).toMatch(/overscroll-behavior:\s*contain/);
    expect(m).toMatch(/scroll-snap-type:\s*x/);
  });

  it('the board size has a vh and a dvh version and respects the side safe areas', () => {
    expect(mobile).toMatch(/100vh - var\(--hg-vt\) - var\(--hg-vb\)/);
    expect(mobile).toMatch(/@supports \(height: 100dvh\)\s*\{\s*\.hg-game--land\s*\{[^}]*100dvh/);
    expect(mobile).toContain('env(safe-area-inset-left');
    expect(mobile).toContain('env(safe-area-inset-right');
  });

  it('the wallet + action dock is pinned to the bottom of the panel', () => {
    expect(mobile).toMatch(/\.hg-game--land \.hg-bottom\s*\{[^}]*align-self:\s*end/);
  });
});

describe('short landscape sheets', () => {
  const short = mediaBlock(mobile, '@media (orientation: landscape) and (max-height: 520px) {');
  it('use the whole height and a slimmer header', () => {
    expect(short).toMatch(/\.hg-sheet-root\s*\{\s*padding-top:\s*0/);
    expect(short).toMatch(/\.hg-sheet\s*\{[^}]*max-height:\s*100%/);
  });
  it('trade panes and the auction go side by side', () => {
    const wide = mediaBlock(mobile, '@media (orientation: landscape) and (max-height: 520px) and (min-width: 560px)');
    expect(wide).toMatch(/\.tx-sheet \.tx-panes\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    expect(wide).toMatch(/\.hga \.hg-sheet-body\s*\{[^}]*grid-template-columns/);
  });
});

describe('tablet portrait', () => {
  it('budgets the height around the board for pods + chat card + safe areas, scoped to the non-compact layout', () => {
    const t = mediaBlock(mobile, '@media (min-width: 600px) and (max-width: 959px) and (orientation: portrait)');
    expect(t).toMatch(/\.hg-game:not\(\.hg-game--compact\)\s*\{\s*--hg-rows:\s*calc\(392px \+ var\(--safe-bottom/);
  });
});

describe('desktop stays as it was', () => {
  it('game.css keeps its desktop board and pod rules', () => {
    expect(game).toMatch(/@media \(min-width: 960px\)/);
    expect(game).toMatch(/--hg-side: clamp\(264px, 24vw, 304px\)/);
  });
  it('none of the new mobile rules apply at >= 960px wide with a tall window', () => {
    // every added block is gated by orientation / max-height / max-width, or scoped to .hg-game--land / --phone
    const ungated = mobile.split('\n').filter((l) => /^\.hg-game(?![^ ]*--(land|phone|compact))/.test(l));
    expect(ungated).toEqual([]);
  });
});

describe('phone basics stay in place', () => {
  it('the frame is a fixed, non-scrolling, overscroll-contained viewport', () => {
    expect(mobile).toMatch(/html\.hg-playing, html\.hg-playing body\s*\{[^}]*overflow:\s*hidden/);
    expect(mobile).toMatch(/overscroll-behavior:\s*none/);
    expect(game).toMatch(/touch-action:\s*manipulation/);
  });
});
