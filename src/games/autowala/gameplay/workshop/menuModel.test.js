import { describe, expect, it } from 'vitest';
import { ACCESSORIES, OPTIONS, UPGRADES } from '../catalog.js';
import { CATEGORIES, VIEWS, rowStatus, sectionRows } from './menuModel.js';
import { TEXT_PATHS } from './shop.js';
import { defaultProfile } from '../profile.js';

const allSections = CATEGORIES.flatMap((c) => c.sections.map((s) => ({ c, s })));

describe('menu model', () => {
  it('every catalogue list, text path, accessory and upgrade is reachable from some section', () => {
    const paths = new Set();
    for (const { s } of allSections) {
      if (s.path) paths.add(s.path);
      for (const p of s.paths || []) paths.add(p);
      if (s.kind === 'upgrades') for (const k of Object.keys(UPGRADES)) paths.add(`upgrade.${k}`);
    }
    for (const p of [...Object.keys(OPTIONS), ...Object.keys(TEXT_PATHS), ...Object.keys(ACCESSORIES), 'interior.garland']) expect(paths.has(p), p).toBe(true);
    for (const k of Object.keys(UPGRADES)) expect(paths.has(`upgrade.${k}`)).toBe(true);
  });

  it('every view name exists and every section has at least one row', () => {
    for (const { c, s } of allSections) {
      expect(VIEWS[s.view || c.view], `${c.id}/${s.id}`).toBeTruthy();
      expect(sectionRows(s).length).toBeGreaterThan(0);
    }
  });

  it('row statuses read INSTALLED, FREE, OWNED or a price', () => {
    const p = defaultProfile();
    const rows = sectionRows(allSections.find(({ s }) => s.path === 'horn').s);
    expect(rowStatus(p, p.loadout, rows[0], 1000).label).toBe('INSTALLED');
    expect(rowStatus(p, p.loadout, rows[1], 1000)).toMatchObject({ label: 'Rs 80', tone: 'price', can: true });
    expect(rowStatus(p, p.loadout, rows[9], 100)).toMatchObject({ tone: 'locked', can: false });
    p.owned['horn:cycle'] = true;
    expect(rowStatus(p, p.loadout, rows[1], 0).label).toBe('OWNED');
    const up = sectionRows(allSections.find(({ s }) => s.kind === 'upgrades').s)[0];
    expect(rowStatus(p, p.loadout, up, 1000)).toMatchObject({ label: 'Rs 600', level: 0 });
    p.upgrades.engine = 4;
    expect(rowStatus(p, p.loadout, up, 1000).label).toBe('MAX');
    const tog = sectionRows(allSections.find(({ s }) => s.id === 'rear.accessories').s)[0];
    expect(rowStatus(p, p.loadout, tog, 1000)).toMatchObject({ label: 'Rs 200' });
    p.loadout.rear.ladder = true;
    expect(rowStatus(p, p.loadout, tog, 1000).label).toBe('INSTALLED');
  });
});
