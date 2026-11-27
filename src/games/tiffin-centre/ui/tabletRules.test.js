// Small tablets (842x618, 800x600): the Tiffin Centre rules that keep text whole where the phone and desktop rules both miss. The pixel proof is the measurement run
// (scripts/perf/ui-touch.mjs --game tiffin); these keep the contract from silently regressing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('./hud/hud.css', import.meta.url), 'utf8');
const menus = readFileSync(new URL('./menus/menus.css', import.meta.url), 'utf8');
/** The body of the first `@media <query> { ... }` block whose query contains `needle` (brace-balanced). */
function mediaBody(css, needle) {
  const at = css.indexOf(needle);
  expect(at, `@media ${needle}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

describe('a small tablet (761-900 px wide, 481 px tall and up)', () => {
  it('the banner takes 37 vw, so a level name + its Telugu name + the Shift chip fit', () => {
    const b = mediaBody(hud, '@media (min-height: 481px) and (min-width: 761px) and (max-width: 900px)');
    expect(b).toContain('.tc-hud-banner { width: clamp(calc(224 * var(--u)), 37vw, calc(360 * var(--u))); }');
  });
  it('a long dish name on the chalk board wraps to two lines instead of ending in an ellipsis', () => {
    const roomy = mediaBody(hud, '@media (min-height: 481px) {');
    expect(roomy).toMatch(/\.tc-hud-chip-name \.tc-hud-en \{[^}]*white-space: normal[^}]*-webkit-line-clamp: 2/);
  });
  it('the pause card and the shift briefing use their two-column layout up to 640 px tall', () => {
    expect(menus).toContain('@media (max-height: 640px) and (min-width: 600px)');
    expect(menus).toContain('@media ((max-height: 480px) and (min-width: 640px)), ((max-height: 640px) and (min-width: 780px))');
  });
});
