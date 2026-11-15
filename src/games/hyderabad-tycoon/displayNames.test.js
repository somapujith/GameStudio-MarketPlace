// The display names are a product decision (2026-11): the game is "Kingpin", the Hyderabad map is "Charminar Chaos",
// the Andhra map stays "Andhra Aatalu". Only DISPLAY text changed: the game id / slug (`hyderabad-tycoon`), map ids,
// routes and storage keys are unchanged. This guards both: the names, and that no shipped source string still says
// the old name. Allow-list: the slug and file names (they contain "hyderabad-tycoon", not "Hyderabad Tycoon") and
// comments (history and the legacy slug).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP, MAPS, MAP_IDS } from '@shared/maps.js';
import { mapInfo, mapLabel, mapTitle } from '@/components/online/mapModel.js';

vi.mock('@/components/art/hub/index.js', () => ({ TycoonCover: () => null, TycoonIcon: () => null }));

const { default: manifest } = await import('./manifest.js');

describe('display names', () => {
  it('the game is Kingpin; its id and slug are untouched', () => {
    expect(manifest.name).toBe('Kingpin');
    expect(manifest.id).toBe('hyderabad-tycoon');
  });

  it('the maps are Charminar Chaos and Andhra Aatalu; their ids are untouched', () => {
    expect(MAPS.hyderabad.name).toBe('Charminar Chaos');
    expect(MAPS.andhra.name).toBe('Andhra Aatalu');
    expect([...MAP_IDS]).toEqual(['hyderabad', 'andhra']);
    expect(DEFAULT_MAP).toBe('hyderabad');
  });

  it('mapTitle shows a map name as it is, for both maps', () => {
    expect(mapTitle(MAPS.hyderabad.name)).toBe('Charminar Chaos');
    expect(mapTitle(MAPS.andhra.name)).toBe('Andhra Aatalu');
    expect(mapInfo('hyderabad').name).toBe('Charminar Chaos');
    expect(mapInfo('andhra').name).toBe('Andhra Aatalu');
    expect(mapLabel('hyderabad')).toBe('Charminar Chaos');
    expect(mapLabel('andhra', { withTe: true })).toBe('Andhra Aatalu · ఆంధ్ర ఆటలు');
  });

  it('the store line names both maps', () => {
    expect(manifest.mapsLine).toBe('2 maps: Charminar Chaos · Andhra Aatalu');
    expect(manifest.features.join(' ')).toContain('Charminar Chaos and Andhra Aatalu');
  });
});

// ---- no user-visible source string still says the old names -------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OLD = [/Hyderabad Tycoon/i, /Hyderabad Hustle/i];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|html)$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The file with `//` line comments and block comments blanked out (strings stay; a `//` inside a URL is kept). */
function withoutComments(src) {
  return src
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

describe('no shipped string uses the old names', () => {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'shared')), ...walk(join(ROOT, 'worker')), join(ROOT, 'index.html')];

  it('scans a real file set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('src/, shared/, worker/ and index.html say Kingpin / Charminar Chaos, never "Hyderabad Tycoon" or "Hyderabad Hustle"', () => {
    const hits = [];
    for (const f of files) {
      const code = withoutComments(readFileSync(f, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (OLD.some((re) => re.test(line))) hits.push(`${relative(ROOT, f).split(sep).join('/')}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
