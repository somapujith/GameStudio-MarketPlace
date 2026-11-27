// Tiffin Centre dialogue: what a native-speaker review cannot be replaced by, but a machine CAN check. Parity between the three voices, the
// emotion a line is spoken with against the situation it is used in, and a full bot-played shift in every language mode with every spoken
// line checked for leftovers (an unfilled {placeholder}, undefined, an empty field). Findings of the 2026-11-27 audit: no defect, so these pin it.
import { describe, expect, it, vi } from 'vitest';
import { LINES_TE } from './lines.te.js';
import { LINES_HI } from './lines.hi.js';
import { LINES_DK } from './lines.dk.js';
import { MOODS, SITUATIONS } from './lineKit.js';
import { createDialogueDirector } from './director.js';
import { applyAction, actionCost, chooseAutoAction, createGame, isOver } from '../index.js';

vi.setConfig({ testTimeout: 120000 });

const VOICES = { te: LINES_TE, hi: LINES_HI, dk: LINES_DK };
const count = (lines, sit) => lines.filter((l) => l.sit === sit).length;

describe('the three voices say the same things', () => {
  it('every situation has the same number of lines in Telugu, Hindi and Dakhni (a translated line never goes missing)', () => {
    for (const sit of SITUATIONS) {
      const n = [LINES_TE, LINES_HI, LINES_DK].map((lines) => count(lines, sit));
      expect(new Set(n).size, `${sit}: te ${n[0]} hi ${n[1]} dk ${n[2]}`).toBe(1);
    }
  });

  it('line n of a situation uses the same placeholders, the same customer kinds and the same tag in every voice', () => {
    for (const sit of SITUATIONS) {
      const [te, hi, dk] = [LINES_TE, LINES_HI, LINES_DK].map((lines) => lines.filter((l) => l.sit === sit));
      te.forEach((line, i) => {
        for (const other of [hi[i], dk[i]]) {
          expect(Boolean(other.dish), `${line.id} vs ${other.id}: {dish}`).toBe(Boolean(line.dish));
          expect(Boolean(other.dish2), `${line.id} vs ${other.id}: {dish2}`).toBe(Boolean(line.dish2));
          expect(Boolean(other.n), `${line.id} vs ${other.id}: {n}`).toBe(Boolean(line.n));
          expect(other.tag, `${line.id} vs ${other.id}: tag`).toBe(line.tag);
          expect([...(other.kinds || [])].sort(), `${line.id} vs ${other.id}: kinds`).toEqual([...(line.kinds || [])].sort());
        }
      });
    }
  });

  it('Dakhni is not Hindi with another label: at most 5% of its lines are word for word the Hindi ones', () => {
    const hi = new Set(LINES_HI.map((l) => l.text));
    const same = LINES_DK.filter((l) => hi.has(l.text));
    expect(same.length / LINES_DK.length).toBeLessThan(0.05);
  });
});

describe('the emotion fits the situation', () => {
  const GOOD = ['happy', 'delighted', 'laughing', 'eating'];
  const BAD = ['angry', 'impatient', 'sad'];
  const rule = (sits, banned) => ({ sits, banned });
  const RULES = [
    rule(['waiting-angry', 'angry-leave'], GOOD), // furious people do not smile
    rule(['serve-thanks', 'serve-praise', 'eating-compliment', 'thanks-fast-service', 'combo-praise', 'regular-loyal'], ['angry']),
    rule(['inspector-pass'], ['angry', 'sad']),
    rule(['greet', 'regular-greet'], ['angry']),
  ];
  it.each(Object.keys(VOICES))('%s: no line is spoken with an expression the situation rules out', (lang) => {
    for (const { sits, banned } of RULES) {
      for (const l of VOICES[lang].filter((x) => sits.includes(x.sit))) expect(banned, `${l.id} [${l.mood}] in ${l.sit}: ${l.en}`).not.toContain(l.mood);
    }
    for (const l of VOICES[lang]) expect(MOODS).toContain(l.mood);
  });

  it('every line a customer may say while angry or leaving angry actually sounds angry or put out', () => {
    for (const lang of Object.keys(VOICES)) {
      for (const l of VOICES[lang].filter((x) => x.sit === 'waiting-angry')) expect(['angry', 'impatient'], l.id).toContain(l.mood);
    }
  });
});

describe('a whole shift of speech, every language mode', () => {
  /** Play a bot team through a shift with the director listening. Returns every utterance. */
  function shift(lang, level, seed) {
    const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    let s = createGame({ players, settings: { level, pace: 'normal' }, seed });
    const dir = createDialogueDirector({ lang, seed: `lines-${seed}`, subtitles: 'both' });
    const said = [];
    const hear = (events) => said.push(...dir.update(s, events));
    hear([]);
    const free = { a: 0, b: 0 };
    let guard = 0;
    while (!isOver(s) && guard++ < 900) {
      for (const p of players) {
        if (free[p.id] > s.tick) continue;
        const a = chooseAutoAction(s, p.id);
        if (!a) continue;
        const cost = actionCost(s, p.id, a);
        const r = applyAction(s, a);
        if (r.error) continue;
        s = r.state;
        hear(r.events);
        free[p.id] = s.tick + cost.ticks;
      }
      const t = applyAction(s, { type: 'tick' });
      if (t.error) break;
      s = t.state;
      hear(t.events);
    }
    return said;
  }

  it.each(['auto', 'mixed', 'te', 'hi', 'dk'])('mode %s: no unfilled placeholder, no empty field, a known voice, on levels 3, 9 and 12', (mode) => {
    let spoken = 0;
    for (const level of [3, 9, 12]) {
      for (const u of shift(mode, level, level + 5)) {
        spoken += 1;
        for (const k of ['text', 'rom', 'en']) {
          expect(typeof u[k], `${u.lineId} ${k}`).toBe('string');
          expect(u[k].length, `${u.lineId} ${k}`).toBeGreaterThan(0);
          expect(u[k], `${u.lineId} ${k}`).not.toMatch(/[{}]|undefined|NaN|\[object/);
        }
        expect(['te', 'hi', 'dk']).toContain(u.lang);
        if (mode === 'te' || mode === 'hi' || mode === 'dk') expect(u.lang).toBe(mode);
      }
    }
    expect(spoken).toBeGreaterThan(150);
  });
});
