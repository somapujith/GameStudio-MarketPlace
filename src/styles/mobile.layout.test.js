import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Mobile layout contract (docs/CINE_UI.md + the mobile audit): CSS-text checks that keep the phone rules from rotting.
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const touch = strip(read('./cine/touch.css'));
const cine = strip(read('./cine.css'));
const shell = strip(read('./cine/shell.css'));
const detail = strip(read('./cine/detail.css'));
const index = read('../../index.html');

describe('touch layer', () => {
  it('only applies to coarse pointers or phone widths (desktop mouse screens are untouched)', () => {
    const blocks = touch.match(/@media[^{]+\{/g) || [];
    expect(blocks.length).toBeGreaterThan(2);
    for (const b of blocks) expect(b).toMatch(/pointer: coarse|max-width: 599px|min-width: 600px/);
    // nothing sits outside an @media block except the tap-highlight reset
    const outside = touch.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').trim();
    expect(outside.replace(/\s+/g, ' ')).toMatch(/^:root :is\(a, button, summary, \[role='button'\], \[role='tab'\], label\) \{ -webkit-tap-highlight-color: transparent; \}$/);
  });

  it('gives targets 44px and fields 16px', () => {
    expect(touch).toMatch(/\.cj-btn--sm[^{]*\{\s*min-height: 44px;/);
    expect(touch).toMatch(/select, textarea\) \{\s*font-size: 16px;/);
  });

  it('keeps every label at 12px or more', () => {
    for (const m of touch.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });
});

describe('shell tokens', () => {
  it('keeps the centred column tokens and the safe-area offsets', () => {
    expect(cine).toMatch(/--cj-max:\s*1440px/);
    expect(cine).toMatch(/--cj-gutter:/);
    expect(cine).toMatch(/--cj-safe-top:\s*calc\(var\(--topbar-h/);
    expect(cine).toMatch(/--cj-safe-bottom:\s*calc\(var\(--tabbar-h/);
  });

  it('keeps the gutter clear of a landscape notch', () => {
    const g = /--cj-gutter:\s*([^;]+);/.exec(cine)[1];
    expect(g).toContain('--safe-left');
    expect(g).toContain('--safe-right');
  });

  it('the page head clears the logo band plus the notch on phones', () => {
    expect(cine).toMatch(/\.cj-pagehead \{[^}]*padding: var\(--cj-head-top\)/);
    expect(shell).toMatch(/max-width: 899\.98px\) \{\s*:root \{\s*--cj-head-top: max\(84px, calc\(var\(--cj-safe-top/);
  });

  it('parks the skip link above the notch, not just above the page', () => {
    expect(shell).toMatch(/\.hh-skip:not\(:focus-visible\) \{\s*transform: translateY\(calc\(-100% - var\(--safe-top/);
  });
});

describe('game page action row', () => {
  it('lets the pills wrap and keeps the round buttons together at 44px', () => {
    expect(detail).toMatch(/\.cj-detail-round \{\s*display: contents;/);
    expect(detail).toMatch(/\.cj-detail-actions \{\s*flex-wrap: wrap;/);
  });
});

describe('index.html', () => {
  it('keeps viewport-fit=cover, the web-app metas and a theme colour for each scheme', () => {
    expect(index).toMatch(/name="viewport" content="[^"]*viewport-fit=cover/);
    expect(index).toMatch(/name="apple-mobile-web-app-capable"/);
    expect(index).toMatch(/name="mobile-web-app-capable"/);
    expect(index).toMatch(/name="theme-color"[^>]*prefers-color-scheme: dark/);
    expect(index).toMatch(/name="theme-color"[^>]*prefers-color-scheme: light/);
  });

  it('never disables zoom', () => {
    expect(index).not.toMatch(/user-scalable=no|maximum-scale/);
  });
});
