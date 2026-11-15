import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Andhra theme must never touch the Hyderabad map and must stay cheap to paint (software-rendered browsers).
const css = readFileSync(fileURLToPath(new URL('./map-andhra.css', import.meta.url)), 'utf8');
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
const SCOPE = "[data-map='andhra']";

/** Split a selector list on top-level commas (commas inside :is( ... ) belong to one selector). */
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

/** [{ selector list, declarations }] for the top-level rules (the file has no @media nesting). */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ list: m[1].trim(), decl: m[2] });
  return out;
}

describe('map-andhra.css', () => {
  const all = rules(body);

  it('has rules', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("scopes every rule under [data-map='andhra'] (the Hyderabad map is untouched)", () => {
    for (const { list } of all) {
      expect(list.startsWith('@'), list).toBe(false);
      for (const sel of selectors(list)) expect(sel.startsWith(SCOPE), sel).toBe(true);
    }
  });

  it('has no at-rules, so no keyframes / infinite loops / media tricks', () => {
    expect(body).not.toMatch(/@(keyframes|media|supports|container|import|font-face)/);
    expect(body).not.toMatch(/animation/i);
  });

  it('uses none of the expensive effects', () => {
    expect(body).not.toMatch(/backdrop-filter/i);
    expect(body).not.toMatch(/(^|[;{\s])filter\s*:/i);
    expect(body).not.toMatch(/mix-blend-mode/i);
    expect(body).not.toMatch(/drop-shadow|blur\(/i);
    expect(body).not.toMatch(/background-blend-mode/i);
    expect(body).not.toMatch(/will-change/i);
  });

  it('keeps shadows static and small (no box-shadow bigger than the frame it replaces)', () => {
    for (const { list, decl } of all) {
      const shadows = decl.match(/box-shadow\s*:[^;]+;/g) || [];
      for (const s of shadows) expect(s.length, `${list}: ${s}`).toBeLessThan(420);
    }
  });

  it('gives each of the eight collections its own pattern, by board slot', () => {
    for (const slots of [[1, 3, 4], [6, 7, 8], [10, 11, 13], [15, 16, 17], [19, 20, 22], [24, 25, 26], [28, 29, 31], [33, 34, 35]]) {
      for (const t of slots) expect(body, `tile ${t}`).toContain(`.hb-tile[data-tile='${t}']`);
    }
    const urls = body.match(/url\("data:image\/svg\+xml,[^"]+"\)/g) || [];
    expect(new Set(urls).size).toBe(8);
  });
});
