import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import { GROUPS } from '@shared/board.js';

// Board themes: one rule block per catalogue finish, scoped to the equipped theme, static and cheap, and readable.
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const css = read('./board-themes.css');
const boardCss = read('./board.css');
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
const boards = COSMETICS.filter((c) => c.kind === 'board');

/** Split a selector list on top-level commas (commas inside :is( ... ) or [ ... ] belong to one selector). */
function selectors(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Every innermost `selector { declarations }` (also those inside an @media block; keyframe steps are dropped). */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const list = m[1].trim();
    if (/^[\d.%\s,]+$|^(from|to)$/.test(list)) continue; // a keyframe step
    out.push({ list, decl: m[2] });
  }
  return out;
}
const all = rules(body);
/** The declarations of the block `.hg-game[data-board-theme='<f>'] <tail> {`. */
const block = (finish, tail) => {
  const head = `.hg-game[data-board-theme='${finish}'] ${tail}`;
  const hit = all.find((r) => r.list === head);
  if (!hit) throw new Error(`no rule for ${head}`);
  return hit.decl;
};
const prop = (decl, name) => (decl.match(new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`)) || [])[1]?.trim();

// ---- WCAG contrast ------------------------------------------------------------------------------------------------
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** srgb color-mix(): `p` of `a`, the rest `b`. */
const mix = (a, b, p) => {
  const A = rgb(a); const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v * p + B[i] * (1 - p)).toString(16).padStart(2, '0')).join('')}`;
};

const INK = prop(boardCss.match(/\.hb-board \{[^}]*\}/)[0], '--hb-ink'); // #2a1d12, dark ink on a light tile
const INK_DIM = prop(boardCss.match(/\.hb-board \{[^}]*\}/)[0], '--hb-ink-dim'); // #6b5641, the price line
const OBSIDIAN_INK = '#f4ecd8';
const OBSIDIAN_INK_DIM = '#cfc7b4';
const GROUP_COLORS = Object.values(GROUPS).map((g) => g.color);
const OWNER_COLORS = [...GROUP_COLORS, '#ff4d6d', '#3ddc97', '#4cc9f0', '#ffd36b']; // collection colours + typical player colours
// the faint hint each special square keeps (see the --paper rules) and how much of it a theme mixes in
const SPECIAL_TINTS = ['#b9cdee', '#a6dfb2', '#f2c48e', '#b4c4e6', '#ecb2a8'];
// text colours printed on the phone's light faces (phoneboard.css: --pt-ink and the --cap of each mode / deck)
const PHONE_TEXT = ['#243447', '#4a5568', '#8a5a00', '#b8223f', '#1f5cb5', '#8a2fb0'];

describe('board-themes.css: one block per finish', () => {
  it('has a block for every FINISHES.board entry, and none for anything else', () => {
    const used = new Set([...body.matchAll(/data-board-theme='([a-z]+)'/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...FINISHES.board].sort());
    for (const f of FINISHES.board) {
      expect(() => block(f, '.hb-board'), f).not.toThrow();
      expect(() => block(f, '.ph'), `${f} phone`).not.toThrow();
    }
  });

  it('mirrors the catalogue colours [night, paper, accent] for each theme', () => {
    expect(boards).toHaveLength(FINISHES.board.length);
    for (const b of boards) {
      const d = block(b.finish, '.hb-board');
      const [night, paper, accent] = b.colors;
      expect(prop(d, '--hb-night'), `${b.finish} night`).toBe(night);
      expect(prop(d, '--hb-paper'), `${b.finish} paper`).toBe(paper);
      expect(prop(d, '--bt-paper'), `${b.finish} --bt-paper`).toBe(paper);
      expect(prop(d, '--hb-gold'), `${b.finish} accent`).toBe(accent);
    }
  });

  it('defines every token the shared rules read, for every theme', () => {
    const tokens = [
      '--bt-night-hi', '--bt-night-lo', '--bt-centre', '--bt-glow', '--bt-edge', '--bt-line', '--bt-jewel', '--bt-rest', '--bt-lit',
      '--bt-frame-fx', '--bt-frame-trim', '--bt-centre-fx', '--bt-img', '--bt-size', '--bt-hi', '--bt-shade', '--bt-tint', '--bt-tile-edge',
      '--hb-gold-2', '--hb-lantern',
    ];
    for (const f of FINISHES.board) {
      const d = block(f, '.hb-board');
      for (const t of tokens) expect(prop(d, t), `${f} ${t}`).toBeTruthy();
    }
  });

  it('scopes every rule under .hg-game[data-board-theme] (the default look has no match)', () => {
    expect(all.length).toBeGreaterThan(40);
    for (const { list } of all) {
      for (const sel of selectors(list)) {
        expect(/\.hg-game\[data-board-theme/.test(sel), sel).toBe(true);
      }
    }
  });

  it('never touches the rules or the data: no layout, sizing, display or content changes outside the goldleaf sheen', () => {
    for (const { list, decl } of all) {
      if (list.includes('::before') && list.includes("'goldleaf'")) continue;
      expect(decl, list).not.toMatch(/(^|[;\s])(display|position|width|height|grid-template|flex|margin|padding|visibility|content)\s*:/);
    }
  });

  it('keeps the map skin in charge of group colours and band patterns: no rule touches .hb-tile__band or --g', () => {
    expect(body).not.toMatch(/hb-tile__band|\.pt__band|\.pt--prop|--g\s*:|--pt-body|--pt-band/);
  });
});

describe('board-themes.css: static and cheap', () => {
  it('uses none of the expensive effects', () => {
    expect(body).not.toMatch(/backdrop-filter/i);
    expect(body).not.toMatch(/(^|[;{\s])filter\s*:/i);
    expect(body).not.toMatch(/mix-blend-mode|background-blend-mode/i);
    expect(body).not.toMatch(/drop-shadow|blur\(/i);
    expect(body).not.toMatch(/will-change/i);
    expect(body).not.toMatch(/%3Cfilter|<filter|feTurbulence|feGaussianBlur/i); // no SVG filter inside a data URI either
  });

  it('keeps every box-shadow small and static', () => {
    for (const { list, decl } of all) {
      for (const s of decl.match(/box-shadow\s*:[^;]+;/g) || []) expect(s.length, `${list}: ${s}`).toBeLessThan(420);
    }
  });

  it('has exactly one animation: an opacity-only sheen on the goldleaf frame, fully gated', () => {
    const anims = all.filter((r) => /animation\s*:/.test(r.decl));
    const running = anims.filter((r) => !/animation\s*:\s*none/.test(r.decl));
    expect(running).toHaveLength(1);
    expect(running[0].list).toContain("[data-board-theme='goldleaf']");
    expect(running[0].decl).toMatch(/animation\s*:\s*bt-sheen\s/);
    // every other theme has no animation at all
    for (const r of anims) expect(r.list, r.list).toContain("[data-board-theme='goldleaf']");

    // enabled only: with no reduced-motion preference, once the table is proven fast, not [data-motion=reduced], not [data-rm]
    expect(running[0].list).toContain(":root[data-perf='high']");
    expect(running[0].list).toContain(":not([data-motion='reduced'])");
    expect(running[0].list).toContain(':not([data-rm])');
    expect(body).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*:root\[data-perf='high'\]/);

    // and switched off for low-performance, reduced motion (attribute and media query) and [data-rm]
    const off = anims.filter((r) => /animation\s*:\s*none/.test(r.decl)).map((r) => r.list).join('\n');
    expect(off).toContain(":root[data-perf='low']");
    expect(off).toContain(":root[data-motion='reduced']");
    expect(off).toContain('[data-rm]');
    expect(body).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation\s*:\s*none/);
  });

  it('has one @keyframes, and it only moves opacity', () => {
    const keyframes = [...body.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})+)\s*\}/g)];
    expect(keyframes.map((k) => k[1])).toEqual(['bt-sheen']);
    const props = [...keyframes[0][2].matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(props)).toEqual(new Set(['opacity']));
  });

  it('draws the sheen under the tiles (on the frame ring), not as a board-sized overlay on them', () => {
    const sheen = all.find((r) => r.list.includes('.hb-frame::before') && /content/.test(r.decl));
    expect(sheen.decl).toMatch(/pointer-events\s*:\s*none/);
    expect(sheen.decl).not.toMatch(/z-index/);
  });
});

describe('board-themes.css: readability (WCAG contrast of the tile paper against its ink)', () => {
  /*
   * Measured from the hex values (ratios rounded down; AA body text = 4.5, UI component = 3):
   *
   *   theme      paper    ink on paper  price (dim) on paper  worst tinted ink / dim   highlight ring on paper  phone text on paper
   *   bazaar     #f6e3c4  13.0          5.5                   10.5 / 4.9               3.4                      4.7
   *   lake       #e4f1fb  14.2          6.0                   11.3 / 5.2               3.9                      5.2
   *   grid       #dfe6ff  13.2          5.6                   10.6 / 4.9               4.4                      4.8
   *   marble     #f5f2ee  14.7          6.2                   11.6 / 5.4               4.4                      5.3
   *   emerald    #e8f6ee  14.7          6.2                   11.6 / 5.3               3.9                      5.3
   *   goldleaf   #fbf0cf  14.4          6.1                   11.4 / 5.3               3.8                      5.2
   *   obsidian   #2a2a38  12.0 (light ink #f4ecd8)  8.4 (#cfc7b4)   6.9 / 4.8        9.9                      4.6 (ivory phone faces)
   *
   * "worst tinted" = the paper with a district's collection colour mixed in (9%), an owner colour on top (14%) and the
   * special-square tints, over every collection colour and a set of player colours.
   */
  const lanternOf = (f) => prop(block(f, '.hb-board'), '--hb-lantern');
  const phone = (f) => block(f, '.ph');

  it('reads the ink colours from board.css (so a change there is noticed here)', () => {
    expect(INK).toBe('#2a1d12');
    expect(INK_DIM).toBe('#6b5641');
  });

  for (const b of boards.filter((x) => x.finish !== 'obsidian')) {
    it(`${b.finish}: dark ink on the paper is >= 4.5:1, plain and tinted`, () => {
      const paper = b.colors[1];
      expect(ratio(paper, INK), 'ink on paper').toBeGreaterThanOrEqual(4.5);
      expect(ratio(paper, INK_DIM), 'price on paper').toBeGreaterThanOrEqual(4.5);
      const tint = Number.parseInt(prop(block(b.finish, '.hb-board'), '--bt-tint'), 10) / 100;
      let worstInk = Infinity;
      let worstDim = Infinity;
      for (const g of GROUP_COLORS) {
        const unowned = mix(g, paper, 0.09);
        worstDim = Math.min(worstDim, ratio(unowned, INK_DIM));
        for (const o of OWNER_COLORS) worstInk = Math.min(worstInk, ratio(mix(o, mix(g, paper, 0.08), 0.14), INK));
      }
      for (const s of SPECIAL_TINTS) {
        const t = mix(s, paper, tint);
        worstInk = Math.min(worstInk, ratio(t, INK));
        worstDim = Math.min(worstDim, ratio(t, INK_DIM));
      }
      expect(worstInk, 'tinted ink').toBeGreaterThanOrEqual(4.5);
      expect(worstDim, 'tinted price').toBeGreaterThanOrEqual(4.5);
    });
  }

  it('obsidian: light ink on the charcoal paper is >= 4.5:1, plain and tinted; the rent pill and cameo keep dark ink', () => {
    const paper = boards.find((b) => b.finish === 'obsidian').colors[1];
    expect(ratio(paper, OBSIDIAN_INK)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(paper, OBSIDIAN_INK_DIM)).toBeGreaterThanOrEqual(4.5);
    for (const g of GROUP_COLORS) {
      expect(ratio(mix(g, paper, 0.1), OBSIDIAN_INK_DIM), g).toBeGreaterThanOrEqual(4.5);
      for (const o of OWNER_COLORS) expect(ratio(mix(o, mix(g, paper, 0.1), 0.14), OBSIDIAN_INK), `${g} ${o}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const s of SPECIAL_TINTS) expect(ratio(mix(s, paper, 0.16), OBSIDIAN_INK_DIM), s).toBeGreaterThanOrEqual(4.5);
    // the ink is flipped on the TILE only, and the css really sets those two values
    const tile = all.find((r) => r.list === ".hg-game[data-board-theme='obsidian'] .hb-tile:not(.is-mortgaged):not(.hb-tile--phone)");
    expect(prop(tile.decl, '--hb-ink')).toBe(OBSIDIAN_INK);
    expect(prop(tile.decl, '--hb-ink-dim')).toBe(OBSIDIAN_INK_DIM);
    expect(prop(block('obsidian', '.hb-board'), '--hb-ink')).toBeUndefined();
    // the light rent pill gets dark ink, on the cameo as well
    expect(ratio('#f1ead8', '#2a1d12')).toBeGreaterThanOrEqual(4.5);
    expect(body).toMatch(/is-owned \.hb-tile__price\.is-rent \{ color: #2a1d12; \}/);
  });

  it('the highlight ring (--hb-lantern) holds >= 3:1 on the paper of every theme', () => {
    for (const b of boards) expect(ratio(b.colors[1], lanternOf(b.finish)), b.finish).toBeGreaterThanOrEqual(3);
  });

  it('the phone light faces keep >= 4.5:1 for their printed text on both paper stops', () => {
    for (const b of boards) {
      const d = phone(b.finish);
      for (const name of ['--pt-paper', '--pt-paper-2']) {
        const paper = prop(d, name);
        expect(paper, `${b.finish} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
        for (const ink of PHONE_TEXT) expect(ratio(paper, ink), `${b.finish} ${name} ${ink}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the owner / set / hotel marks alone: no theme rule sets a box-shadow on a set or hotel tile, or on the owner band', () => {
    for (const { list, decl } of all) {
      if (!/box-shadow/.test(decl) || !list.includes('hb-tile')) continue;
      if (/\.ph |\.pt--light/.test(list)) continue; // the phone face rules
      expect(list, list).toContain(':not(.is-set):not(.is-max)');
    }
    expect(body).not.toMatch(/hb-tile__own|hb-tile__chip|hb-pips|hb-pawn|\.pt__pips|\.pt__tag/);
  });
});

describe('board-themes.css: precedence with the Andhra map skin', () => {
  it('the theme selectors out-rank map-andhra.css for the surface, and the panel recolour skips Andhra', () => {
    const andhra = read('./map-andhra.css');
    // map-andhra: `[data-map='andhra'] .hb-frame` is (0,2,0); the theme's `.hg-game[data-board-theme] .hb-board .hb-frame` is (0,4,0)
    expect(andhra).toMatch(/\[data-map='andhra'\] \.hb-frame \{/);
    expect(body).toContain('.hg-game[data-board-theme] .hb-board .hb-frame {');
    expect(body).toContain(".hg-game[data-board-theme]:not([data-map='andhra']) .hb-board .cp .cp__in");
    // the Andhra group-colour patterns live on the bands, which the theme never touches (asserted above)
    expect(andhra).toMatch(/hb-tile__band:not\(\.hb-tile__band--route\)/);
  });
});
