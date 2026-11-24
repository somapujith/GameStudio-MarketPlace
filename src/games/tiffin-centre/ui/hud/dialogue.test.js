import { describe, it, expect } from 'vitest';
import { LEAVE_MS, MAX_ACTIVE, MAX_BUBBLES, createDialogueRunner, loadDirectorFactory, moodTone, pickBubbles, pickSubtitle, spokenGloss, subtitleLines } from './dialogue.js';
import { mkCustomer, mkState } from './testState.js';

const U = (o = {}) => ({ id: 'u1', customer: 1, lineId: 'te.order.1', lang: 'te', text: 'ఒక దోశ ఇవ్వండి', rom: 'oka dosa ivvandi', en: 'One dosa please', mood: 'calm', sit: 'order', ttlMs: 4000, at: 0, ...o });

describe('subtitle lines', () => {
  it('both = native script then the English gloss (default)', () => {
    expect(subtitleLines(U())).toEqual([{ kind: 'native', text: 'ఒక దోశ ఇవ్వండి' }, { kind: 'english', text: 'One dosa please' }]);
  });
  it('native, roman and english show exactly one line', () => {
    expect(subtitleLines(U(), 'native')).toEqual([{ kind: 'native', text: 'ఒక దోశ ఇవ్వండి' }]);
    expect(subtitleLines(U(), 'roman')).toEqual([{ kind: 'roman', text: 'oka dosa ivvandi' }]);
    expect(subtitleLines(U(), 'english')).toEqual([{ kind: 'english', text: 'One dosa please' }]);
  });
  it('never shows a blank line: missing fields fall back, identical text is not repeated', () => {
    expect(subtitleLines({ en: 'Hello', mood: 'calm' })[0].text).toBe('Hello');
    expect(subtitleLines({ text: 'chai', en: 'chai' })).toHaveLength(1);
    expect(subtitleLines(null)).toEqual([]);
  });
  it('a screen reader hears the English gloss led by the token', () => {
    const s = mkState({ customers: [mkCustomer({ id: 7 })] });
    expect(spokenGloss(U({ customer: 7 }), s)).toBe('Token 7: One dosa please');
    expect(spokenGloss(U({ customer: 99 }), s)).toBe('A customer: One dosa please');
  });
});

describe('mood colours', () => {
  it('maps moods to angry red, happy warm, impatient amber, else calm', () => {
    expect(moodTone('angry')).toBe('angry');
    expect(moodTone('furious')).toBe('angry');
    expect(moodTone('delighted')).toBe('happy');
    expect(moodTone('laughing')).toBe('happy');
    expect(moodTone('impatient')).toBe('impatient');
    expect(moodTone('bored')).toBe('impatient');
    expect(moodTone('neutral')).toBe('calm');
    expect(moodTone(undefined)).toBe('calm');
  });
});

const live = (u, born, extra = {}) => ({ u, born, until: born + 4000, ...extra });

describe('which bubbles and which subtitle', () => {
  const list = [
    live(U({ id: 'a', customer: 1, mood: 'calm' }), 100),
    live(U({ id: 'b', customer: 2, mood: 'angry' }), 90),
    live(U({ id: 'c', customer: 3, mood: 'happy' }), 300),
    live(U({ id: 'd', customer: 4, mood: 'impatient' }), 200),
    live(U({ id: 'e', customer: 5, mood: 'calm' }), 400),
  ];
  it('shows at most three: customers in view first, angriest first, then newest', () => {
    const ids = pickBubbles(list, { inView: new Set([1, 2, 3, 4, 5]) });
    expect(ids).toHaveLength(MAX_BUBBLES);
    expect(ids).toEqual(['b', 'd', 'c']);
    expect(pickBubbles(list, { inView: new Set([1, 5]) })).toEqual(['e', 'a']); // off-screen customers get no bubble
    expect(pickBubbles(list)).toHaveLength(3); // no projection yet: nobody is excluded
  });
  it('the subtitle is the newest line from someone in view', () => {
    expect(pickSubtitle(list, mkState(), new Set([1, 2, 4]))?.u.id).toBe('d');
    expect(pickSubtitle([], mkState())).toBeNull();
  });
  it('with nobody in view it falls to the most urgent customer (a paying one first, then lowest patience)', () => {
    const s = mkState({
      customers: [
        mkCustomer({ id: 1, patience: 30, patienceMax: 40 }),
        mkCustomer({ id: 2, patience: 4, patienceMax: 40 }),
        mkCustomer({ id: 3, st: 'paying', payLeft: 5 }),
      ],
    });
    const l = [live(U({ id: 'x', customer: 1 }), 1), live(U({ id: 'y', customer: 2 }), 2)];
    expect(pickSubtitle(l, s, new Set([9]))?.u.id).toBe('y');
    const l2 = [...l, live(U({ id: 'z', customer: 3 }), 0)];
    expect(pickSubtitle(l2, s, new Set([9]))?.u.id).toBe('z');
  });
});

describe('the runner', () => {
  const mkDirector = (script) => {
    let i = 0;
    return { calls: [], resets: 0, update(state, events) { this.calls.push([state.tick, events.length]); return script[i++] || []; }, reset() { this.resets += 1; } };
  };

  it('keeps one live line per customer, speaks and animates each new line, and drops lines when they end', () => {
    const director = mkDirector([[U({ id: 'a', ttlMs: 3000 })], [U({ id: 'b', customer: 1, ttlMs: 3000 }), U({ id: 'c', customer: 2 })]]);
    const spoken = [];
    const moved = [];
    const r = createDialogueRunner({ director, speak: (u) => spoken.push(u.id), speaking: (id, ms) => moved.push([id, ms]) });
    expect(r.ingest(mkState({ tick: 1 }), [], 1000).map((u) => u.id)).toEqual(['a']);
    expect(r.ingest(mkState({ tick: 2 }), [], 2000).map((u) => u.id)).toEqual(['b', 'c']);
    const act = r.active(2100);
    expect(act.map((a) => a.u.id).sort()).toEqual(['b', 'c']); // b replaced a (same customer)
    expect(spoken).toEqual(['a', 'b', 'c']);
    expect(moved[0]).toEqual([1, 3000]);
    expect(act.find((a) => a.u.id === 'b').leaving).toBe(false);
    expect(r.active(2000 + 3000 - LEAVE_MS + 5).find((a) => a.u.id === 'b').leaving).toBe(true);
    expect(r.nextDeadline(2100)).toBeGreaterThan(2100);
    expect(r.active(2000 + 3000 + 1).map((a) => a.u.id)).toEqual(['c']);
  });

  it('does not speak while voices are off but still shows the line, and ignores repeats of an id', () => {
    const director = mkDirector([[U({ id: 'a' })], [U({ id: 'a' })]]);
    const spoken = [];
    const r = createDialogueRunner({ director, speak: (u) => spoken.push(u.id), canSpeak: () => false });
    expect(r.ingest(mkState(), [], 0)).toHaveLength(1);
    expect(r.ingest(mkState({ tick: 21 }), [], 10)).toHaveLength(0);
    expect(spoken).toEqual([]);
  });

  it('a restarted shift (the tick goes back) resets the director and the list; a broken director or voice never throws', () => {
    const director = mkDirector([[U({ id: 'a' })], []]);
    const r = createDialogueRunner({ director, speak: () => { throw new Error('no voice'); }, speaking: () => { throw new Error('no mouth'); } });
    expect(() => r.ingest(mkState({ tick: 30 }), [], 0)).not.toThrow();
    r.ingest(mkState({ tick: 2 }), [], 10);
    expect(director.resets).toBe(1);
    expect(r.active(20)).toEqual([]);
    const bad = createDialogueRunner({ director: { update() { throw new Error('boom'); } } });
    expect(bad.ingest(mkState(), [], 0)).toEqual([]);
    expect(createDialogueRunner({}).ingest(mkState(), [], 0)).toEqual([]);
  });

  it('caps the live list and clamps silly ttls', () => {
    const many = Array.from({ length: MAX_ACTIVE + 5 }, (_, i) => U({ id: `m${i}`, customer: i + 1, ttlMs: 999999 }));
    const r = createDialogueRunner({ director: mkDirector([many]) });
    r.ingest(mkState(), [], 0);
    const act = r.active(1);
    expect(act).toHaveLength(MAX_ACTIVE);
    expect(act[0].until).toBeLessThanOrEqual(9000);
  });
});

describe('with the real dialogue director', () => {
  it('turns a new customer into an utterance the HUD can show, speak and gloss', async () => {
    const make = loadDirectorFactory();
    if (!make) return; // the director module is optional for the HUD
    const director = make({ lang: 'te', seed: 5, subtitles: 'both' });
    const spoken = [];
    const r = createDialogueRunner({ director, speak: (u) => spoken.push(u) });
    const c = mkCustomer({ id: 3, name: 'Ravi anna', order: ['dosa'], patience: 38, patienceMax: 40, arrivedAt: 1 });
    let state = mkState({ tick: 1, customers: [c] });
    let shown = [];
    for (let t = 1; t < 12 && !shown.length; t += 1) {
      state = { ...state, tick: t };
      shown = r.ingest(state, t === 1 ? [{ type: 'customer-arrive', customer: 3, spot: 0 }] : [], t * 1000);
    }
    expect(shown.length).toBeGreaterThan(0);
    const u = shown[0];
    expect(u.customer).toBe(3);
    expect(['te', 'hi', 'dk']).toContain(u.lang);
    expect(spoken).toHaveLength(shown.length);
    const [native, english] = subtitleLines(u, 'both');
    expect(native.text.length).toBeGreaterThan(0);
    expect(english === undefined || english.text.length > 0).toBe(true);
    expect(spokenGloss(u, state)).toMatch(/^Token 3: /);
    expect(r.active(1500).length).toBeGreaterThan(0);
    expect(r.active(60000)).toEqual([]);
  });
});
