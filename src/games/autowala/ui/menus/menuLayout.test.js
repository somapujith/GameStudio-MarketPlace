// The phone layouts of the full-screen menus: the pure layout rule, and checks on the style sheets' text (jsdom has no layout engine,
// so what a phone sees is guarded by asserting the rules that make it: dvh, safe-area insets, 44 px targets, sticky bars,
// scroll containment, and that every phone rule sits inside one of the two phone media queries so the desktop look cannot move).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANDSCAPE_QUERY, MIN_GAP, MIN_TAP, PORTRAIT_QUERY, isCompact, menuLayout } from './menuLayout.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');
const sheet = read('sheet.css');
const workshop = read('../workshop.css');
const fares = read('../fares/fares.css');

/** Split CSS into top-level blocks: [{ head, body }]. Brace-aware, comments removed. */
function blocks(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let depth = 0;
  let start = 0;
  let head = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) {
        head = src.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push({ head, body: src.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return out;
}
const rulesOf = (body) => blocks(body);
const declsOf = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]);
const px = (v) => {
  const m = /^(-?[\d.]+)px$/.exec(v);
  return m ? Number(m[1]) : null;
};

describe('menuLayout', () => {
  it('knows the phone, tablet and desktop sizes the menus are checked at', () => {
    for (const [w, h] of [[844, 390], [800, 400], [915, 412], [667, 375]]) expect(menuLayout({ w, h, coarse: true })).toBe('phone-landscape');
    for (const [w, h] of [[390, 844], [360, 640], [412, 915]]) expect(menuLayout({ w, h, coarse: true })).toBe('phone-portrait');
    expect(menuLayout({ w: 768, h: 1024, coarse: true })).toBe('tablet');
    expect(menuLayout({ w: 1024, h: 768, coarse: true })).toBe('tablet');
    expect(menuLayout({ w: 1280, h: 800, coarse: false })).toBe('desktop');
    expect(menuLayout({ w: 1280, h: 800, coarse: true })).toBe('tablet'); // a big tablet: desktop layout, 44 px targets
    expect(menuLayout({ w: 1920, h: 1080, coarse: true })).toBe('desktop');
  });
  it('treats an unknown size (server render) as desktop', () => {
    expect(menuLayout({})).toBe('desktop');
    expect(menuLayout({ w: 0, h: 0, coarse: true })).toBe('desktop');
  });
  it('lets a short wide window be a sideways phone and a narrow tall window be an upright one, desktop pointer or not', () => {
    expect(menuLayout({ w: 1200, h: 500, coarse: false })).toBe('phone-landscape');
    expect(menuLayout({ w: 700, h: 900, coarse: false })).toBe('phone-portrait');
    expect(menuLayout({ w: 761, h: 900, coarse: false })).toBe('desktop');
  });
  it('compact means one of the two phone layouts', () => {
    expect(isCompact('phone-portrait')).toBe(true);
    expect(isCompact('phone-landscape')).toBe(true);
    expect(isCompact('tablet')).toBe(false);
    expect(isCompact('desktop')).toBe(false);
  });
  it('keeps the tap and gap minimums', () => {
    expect(MIN_TAP).toBe(44);
    expect(MIN_GAP).toBeGreaterThanOrEqual(8);
  });
});

describe('sheet.css', () => {
  const top = blocks(sheet);
  const media = top.filter((b) => b.head.startsWith('@media'));
  const plain = top.filter((b) => !b.head.startsWith('@media'));

  it('uses the two phone queries (the ones menuLayout.js names) and the coarse-pointer one, nothing else', () => {
    const heads = media.map((b) => b.head.replace(/^@media\s*/, ''));
    const allowed = [PORTRAIT_QUERY, LANDSCAPE_QUERY, `${PORTRAIT_QUERY}, ${LANDSCAPE_QUERY}`, '(pointer: coarse)'];
    for (const h of heads) expect(allowed).toContain(h);
    expect(heads).toContain(PORTRAIT_QUERY);
    expect(heads).toContain(LANDSCAPE_QUERY);
    expect(heads).toContain(`${PORTRAIT_QUERY}, ${LANDSCAPE_QUERY}`);
  });

  it('changes nothing for the desktop: outside a media query it only hides phone chrome, flattens wrappers and defines tokens', () => {
    const okProps = new Set(['display', '--aw-sl', '--aw-sr', '--aw-st', '--aw-sb', '--aw-sheet']);
    expect(plain.length).toBeGreaterThan(0);
    for (const b of plain) {
      for (const [prop, val] of declsOf(b.body)) {
        expect(okProps.has(prop), `${b.head} sets ${prop}`).toBe(true);
        if (prop === 'display') expect(['contents', 'none', 'block'], `${b.head} display ${val}`).toContain(val);
      }
    }
    // the wrappers that exist only for the phone columns are flattened on desktop
    const flat = plain.find((b) => /aw-sum__head/.test(b.head));
    expect(flat.body).toMatch(/display:\s*contents/);
    // the phone-only chrome (close button, pause bar, bottom action bar of the job board) is hidden on desktop
    const hidden = plain.filter((b) => /display:\s*none/.test(b.body)).map((b) => b.head).join(',');
    for (const sel of ['.aw-sheet-x', '.aw-pm__bar', '.aw-quest-menu .aw-quest-actions--bar']) expect(hidden).toContain(sel);
  });

  it('makes every menu a sheet: safe-area insets on all four edges, scroll containment and momentum', () => {
    for (const edge of ['left', 'right', 'top', 'bottom']) expect(sheet).toContain(`env(safe-area-inset-${edge}`);
    expect(sheet).toMatch(/overscroll-behavior:\s*contain/);
    expect(sheet).toMatch(/-webkit-overflow-scrolling:\s*touch/);
    expect(sheet).toMatch(/touch-action:\s*pan-y/);
    expect(sheet).toMatch(/position:\s*sticky;\s*bottom:\s*0/); // the action bar
    expect(sheet).toMatch(/position:\s*sticky;\s*top:\s*0/); // the header
  });

  it('gives the close / back button a 44 px square and the sticky bar 52 px buttons', () => {
    const compact = media.find((b) => b.head.includes(',') && b.head.includes(PORTRAIT_QUERY));
    const rules = rulesOf(compact.body);
    const x = rules.find((r) => r.head === '.aw .aw-sheet-x');
    const d = Object.fromEntries(declsOf(x.body));
    expect(px(d.width)).toBe(44);
    expect(px(d.height)).toBe(44);
    const barKids = rules.find((r) => r.head === '.aw .aw-sheet-bar > *');
    expect(px(Object.fromEntries(declsOf(barKids.body))['min-height'])).toBeGreaterThanOrEqual(48);
  });

  it('never sets a tap target below 44 px inside a phone layout', () => {
    const tapSel = /(btn|aw-mrow|card|aw-sheet-x|aw-seg|soundbtn|aw-slider(?!\s+u)|aw-quest-actions)/;
    for (const b of media) {
      for (const r of rulesOf(b.body)) {
        if (!tapSel.test(r.head) || / u$/.test(r.head)) continue;
        for (const [prop, val] of declsOf(r.body)) {
          if (prop !== 'min-height') continue;
          const n = px(val);
          if (n != null) expect(n, `${r.head} min-height ${val}`).toBeGreaterThanOrEqual(MIN_TAP - 0.001);
        }
      }
    }
  });

  it('keeps text readable: no font-size under 12 px in the phone layouts, body copy 14 px', () => {
    for (const b of media) {
      for (const r of rulesOf(b.body)) {
        for (const [prop, val] of declsOf(r.body)) {
          if (prop !== 'font-size') continue;
          const n = px(val);
          if (n != null) expect(n, `${r.head} font-size ${val}`).toBeGreaterThanOrEqual(12);
        }
      }
    }
    const body = rulesOf(media.find((b) => b.head.includes(',') && b.head.includes(PORTRAIT_QUERY)).body).find((r) => /\.aw-keys li/.test(r.head));
    expect(px(Object.fromEntries(declsOf(body.body))['font-size'])).toBeGreaterThanOrEqual(14);
  });

  it('puts the list left and the detail right on a sideways phone, stacked on an upright one', () => {
    const land = media.find((b) => b.head === `@media ${LANDSCAPE_QUERY}`);
    const port = media.find((b) => b.head === `@media ${PORTRAIT_QUERY}`);
    // the pause menu: the body wrapper dissolves so the list owns the whole left column and the title + panel stack on the right
    expect(land.body).toMatch(/\.aw \.aw-pm\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(262px, 42%\) minmax\(0, 1fr\)/);
    expect(land.body).toMatch(/\.aw-pm__body\s*{\s*display:\s*contents/);
    expect(land.body).toMatch(/\.aw-pm__list\s*{[^}]*grid-row:\s*1 \/ -1/);
    expect(land.body).toMatch(/\.aw-quest-board\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1\.1fr\)/);
    expect(port.body).toMatch(/\.aw-pm__body\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(port.body).toMatch(/\.aw-quest-board,\s*\.aw \.aw-quest-menu \.aw-quest-cols\s*{[^}]*gap/);
  });

  it('shows exactly one copy of the job board / pause actions per layout', () => {
    const land = media.find((b) => b.head === `@media ${LANDSCAPE_QUERY}`);
    const port = media.find((b) => b.head === `@media ${PORTRAIT_QUERY}`);
    expect(land.body).toMatch(/\.aw-pm__bar,\s*\.aw \.aw-quest-menu \.aw-quest-actions--bar\s*{\s*display:\s*none/);
    expect(port.body).toMatch(/\.aw-quest-menu \.aw-quest-actions\s*{\s*display:\s*none/);
    expect(port.body).toMatch(/\.aw-quest-menu \.aw-quest-actions--bar\s*{[^}]*display:\s*flex/);
  });
});

describe('landscape.css', () => {
  const css = read('landscape.css');
  const all = blocks(css);
  const top = all.filter((b) => b.head.startsWith('@media (min-width: 560px)'));
  it('makes the start screen two columns in every landscape window from 560 px wide, and only there', () => {
    expect(top).toHaveLength(1);
    expect(top[0].head).toBe('@media (min-width: 560px) and (orientation: landscape)');
    expect(top[0].body).toMatch(/\.aw-start__card\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  });
  it('outranks the display: contents wrappers of sheet.css (three classes against two)', () => {
    expect(sheet).toMatch(/\.aw \.aw-start__hero,/); // the flattened wrapper
    expect(top[0].body).toMatch(/\.aw \.aw-start \.aw-start__hero,\s*\.aw \.aw-start \.aw-start__side\s*{[^}]*display:\s*flex/);
  });
  it('sizes the title from the viewport height too, so it never outgrows a 360 px tall phone', () => {
    expect(top[0].body).toMatch(/\.aw-title__en\s*{\s*font-size:\s*clamp\(40px, min\(6\.4vw, 14vh\), 100px\)/);
  });
  it('scales the menus with the HUD only on big screens, never on a phone or a small window', () => {
    const big = all.find((b) => b.head.startsWith('@media (min-height: 800px)'));
    expect(big.head).toBe('@media (min-height: 800px) and (min-width: 1000px)');
    expect(big.body).toMatch(/\.aw \.aw-menu,\s*\.aw \.aw-career-hisaab\s*{\s*zoom:\s*var\(--aw-ui-scale, 1\)/);
    expect(all).toHaveLength(2);
  });
});

describe('the menus keep the GPU free and the key caps visible on touch screens', () => {
  const files = ['sheet.css', 'menus.css', 'landscape.css', '../workshop.css', '../career/career.css', '../quests/quests.css', '../radio.css', '../minimap.css'];
  const styles = files.map((f) => [f, read(f).replace(/\/\*[\s\S]*?\*\//g, '')]);
  it('uses no backdrop-filter, no filter: blur and no mix-blend-mode in the menu style sheets', () => {
    for (const [f, css] of styles) {
      expect(css, `${f} has a backdrop-filter`).not.toMatch(/backdrop-filter/);
      expect(css, `${f} has a blur filter`).not.toMatch(/filter:\s*[^;]*blur\(/);
      expect(css, `${f} has mix-blend-mode`).not.toMatch(/mix-blend-mode/);
    }
  });
  it('never animates a box-shadow (it repaints every frame over the live 3D view)', () => {
    for (const [f, css] of styles) {
      for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*{((?:[^{}]|{[^{}]*})*)}/g)) {
        expect(m[2], `${f} @keyframes ${m[1]} animates box-shadow`).not.toMatch(/box-shadow/);
      }
    }
  });
  it('draws key caps with span.aw-key, because the hub hides every <kbd> on a coarse pointer', () => {
    for (const f of ['PauseMenu.jsx', 'PausePanels.jsx', 'StartScreen.jsx']) expect(read(f).replace(/\/\/.*$/gm, ''), `${f} uses <kbd>`).not.toMatch(/<kbd[\s>]/);
  });
});

describe('workshop.css', () => {
  it('has three layouts: desktop, an upright-phone sheet and a sideways-phone column', () => {
    expect(workshop).toContain('.aw .aw-ws.is-port .aw-ws-panel');
    expect(workshop).toContain('.aw .aw-ws.is-land .aw-ws-panel');
    expect(workshop).toMatch(/max-height:\s*58dvh/);
  });
  it('respects the safe area and keeps close / back / play buttons at 44 px', () => {
    for (const edge of ['left', 'right', 'top', 'bottom']) expect(workshop).toContain(`safe-area-inset-${edge}`);
    expect(workshop).toMatch(/\.aw-ws-back\s*{[^}]*width:\s*44px;[^}]*height:\s*44px/);
    expect(workshop).toMatch(/\.aw-ws\.is-narrow \.aw-ws-play\s*{\s*width:\s*44px;\s*height:\s*44px/);
    expect(workshop).toMatch(/\.aw-ws\.is-narrow \.aw-ws-leave\s*{[^}]*min-height:\s*44px/);
  });
  it('scrolls the list without chaining', () => {
    expect(workshop).toMatch(/\.is-narrow \.aw-ws-list\s*{[^}]*overscroll-behavior:\s*contain/);
  });
  it('keeps the desktop panel geometry', () => {
    expect(workshop).toMatch(/\.aw \.aw-ws-panel\s*{[^}]*left:\s*20px;[^}]*top:\s*84px;[^}]*bottom:\s*64px;[^}]*width:\s*min\(390px, 40vw\)/);
  });
});

describe('fares.css', () => {
  it('makes the 1 / 2 / 3 answers 56 px+ thumb buttons with 8 px gaps on touch screens', () => {
    const touch = blocks(fares).filter((b) => b.head.startsWith('@media (pointer: coarse)'));
    expect(touch.length).toBeGreaterThanOrEqual(2);
    const all = touch.map((b) => b.body).join('\n');
    expect(all).toMatch(/\.aw-fare-opt\s*{[^}]*min-height:\s*56px/);
    expect(all).toMatch(/\.aw-fare-opts\s*{\s*gap:\s*8px/);
    for (const m of all.matchAll(/\.aw-fare-opt\s*{[^}]*min-height:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(MIN_TAP);
  });
  it('keeps the desktop buttons as they were', () => {
    expect(fares).toMatch(/\.aw \.aw-fare-opt\s*{[^}]*min-height:\s*52px/);
  });
});
