// The printed tile names for phone boards: short, break-safe, never ellipsised.
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { LABELS, labelLines, labelText } from './tileLabel.js';

describe('labelLines', () => {
  it('gives every tile on the board one or two short lines', () => {
    for (const tile of TILES) {
      const lines = labelLines(tile);
      expect(lines.length, tile.name).toBeGreaterThanOrEqual(1);
      expect(lines.length, tile.name).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line.length, `${tile.name}: "${line}"`).toBeLessThanOrEqual(9);
        expect(line.trim(), tile.name).toBe(line);
        expect(line.length).toBeGreaterThan(1);
      }
    }
  });

  it('keeps every board tile identifiable: the lines spell the short name (or a deliberate abbreviation)', () => {
    for (const tile of TILES) {
      const short = tile.short || tile.name;
      const text = labelText(labelLines(tile));
      expect(text.startsWith(short.slice(0, 3)) || LABELS[short] !== undefined, `${short} -> ${text}`).toBe(true);
      if (short !== 'Fin. District') expect(text.replace(/\s/g, ''), short).toBe(short.replace(/\s/g, ''));
    }
  });

  it('splits long words with a real hyphen at a syllable, never mid-syllable without one', () => {
    expect(labelLines({ short: 'Tolichowki' })).toEqual(['Toli-', 'chowki']);
    expect(labelLines({ short: 'Mehdipatnam' })).toEqual(['Mehdi-', 'patnam']);
    expect(labelLines({ short: 'Gachibowli' })).toEqual(['Gachi-', 'bowli']);
    for (const tile of TILES) {
      const lines = labelLines(tile);
      lines.slice(0, -1).forEach((l) => expect(/-$/.test(l) || /\s|\.$/.test(l) || l.length <= 7, `${tile.name} "${l}"`).toBe(true));
    }
  });

  it('abbreviates the one name that is too long for a phone tile', () => {
    expect(labelLines({ short: 'Fin. District' })).toEqual(['Fin.', 'Dist.']);
  });

  it('falls back sensibly for names it does not know', () => {
    expect(labelLines({ short: 'Gandipet' })).toEqual(['Gandi-', 'pet']);
    expect(labelLines({ short: 'Old Cantonment Road' })).toEqual(['Old', 'Cantonment Road']);
    expect(labelLines({ short: 'Abids' })).toEqual(['Abids']);
    expect(labelLines({ name: 'Moazzam Jahi Market' }).length).toBe(2);
    expect(labelLines({})).toEqual([]);
    expect(labelLines(null)).toEqual([]);
  });

  it('returns a copy, so a caller can not change the table', () => {
    const a = labelLines({ short: 'Tank Bund' });
    a.push('x');
    expect(labelLines({ short: 'Tank Bund' })).toEqual(['Tank', 'Bund']);
  });
});
