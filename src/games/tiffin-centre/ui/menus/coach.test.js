import { describe, it, expect } from 'vitest';
import { chapterStrip, coachStepFromTutorial, coachViewModel, controlsLine, firstSentence } from './menuModels.js';

describe('coach chapters and device wording', () => {
  const chapters = ['Look', 'Tokens', 'Tawa', 'Idly', 'Kadai', 'Chai', 'Serve and collect', 'Game flow', 'Rush'];
  it('marks done / active / todo from an index, an id, a label or an object', () => {
    const a = chapterStrip(chapters, 2);
    expect(a.items.map((c) => c.state)).toEqual(['done', 'done', 'active', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(a).toMatchObject({ index: 2, label: 'Tawa', count: 9 });
    expect(chapterStrip(chapters, 'Chai').index).toBe(5);
    expect(chapterStrip([{ id: 'a', name: 'Look' }, { id: 'b', label: 'Tokens', te: 'x' }], { id: 'b' })).toMatchObject({ index: 1, label: 'Tokens' });
    expect(chapterStrip(chapters, 99).index).toBe(8);
    expect(chapterStrip(chapters, undefined).items.every((c) => c.state === 'todo')).toBe(true);
    expect(chapterStrip(undefined, 1)).toEqual({ items: [], index: -1, label: '', count: 0 });
  });

  it('chooses the touch wording on a touch screen and the keyboard wording otherwise', () => {
    const step = { id: 'w', text: 'Press A or D to walk', textTouch: 'Tap the tawa to walk', hint: 'Use A / D', hintTouch: 'Tap it', controls: { keyboard: 'A / D walk', touch: 'Tap to walk' } };
    expect(coachViewModel(step, 0, 3, { touch: true })).toMatchObject({ text: 'Tap the tawa to walk', hint: 'Tap it', controls: 'Tap to walk' });
    expect(coachViewModel(step, 0, 3, { touch: false })).toMatchObject({ text: 'Press A or D to walk', hint: 'Use A / D', controls: 'A / D walk' });
    expect(coachViewModel({ text: 'only one', hint: 'h' }, 0, 1, { touch: true })).toMatchObject({ text: 'only one', hint: 'h' });
  });

  it('gives a one-line version, the recipe dish and the position inside the chapter', () => {
    const steps = [{ chapter: 'Look' }, { chapter: 'Tawa' }, { chapter: 'Tawa' }, { chapter: 'Tawa' }];
    const vm = coachViewModel({ id: 'x', say: 'Pehle tawa pe chalo! Jaldi.', text: 'Long text. More.', recipe: 'dosa' }, 2, 4, { chapters: ['Look', 'Tawa'], chapter: 'Tawa', steps });
    expect(vm.line).toBe('Pehle tawa pe chalo!');
    expect(vm.recipe).toBe('dosa');
    expect(vm.chapterStep).toEqual({ at: 2, of: 3 });
    expect(vm.chapters.label).toBe('Tawa');
    expect(firstSentence('x'.repeat(300), 20)).toHaveLength(20);
    expect(controlsLine(['a', 'b'], false)).toContain('a');
    expect(controlsLine('plain', true)).toBe('plain');
    expect(controlsLine(null, true)).toBe('');
  });

  it('reads the fields from a session tutorial object, falling back to its step', () => {
    const t = { say: 'S', text: 'T', te: 'E', index: 1, chapter: 'Look', chapters: ['Look'], step: { id: 'k', textTouch: 'tt', hintTouch: 'ht', ack: true, recipe: 'idly', controls: 'c' }, ackable: false };
    expect(coachStepFromTutorial(t)).toMatchObject({ id: 'k', say: 'S', text: 'T', te: 'E', textTouch: 'tt', hintTouch: 'ht', recipe: 'idly', controls: 'c', chapter: 'Look', ack: false });
    expect(coachStepFromTutorial(null)).toBeNull();
  });
});

describe('with the real tutorial driver', () => {
  it('a bare driver gives the coach everything: say, both wordings, chapters, count inside the chapter', async () => {
    const { createTutorialDriver } = await import('@shared/tiffin-centre/tutorial.js');
    const { createGame } = await import('@shared/tiffin-centre/index.js');
    const d = createTutorialDriver();
    d.advance(createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level: 0, pace: 'normal' }, seed: 3 }), [], { meId: 'me' });
    const step = coachStepFromTutorial(d);
    expect(step.say.length).toBeGreaterThan(0);
    expect(step.text.length).toBeGreaterThan(0);
    expect(step.textTouch.length).toBeGreaterThan(0);
    const vm = coachViewModel(step, d.index, d.steps.length, { touch: true, chapters: d.chapters, chapter: d.chapter, steps: d.steps });
    expect(vm.chapters.count).toBeGreaterThanOrEqual(8);
    expect(vm.chapters.label).toBe('Look');
    expect(vm.chapterStep.at).toBe(1);
    expect(vm.position).toBe(`Step 1 of ${d.steps.length}`);
  });
});
