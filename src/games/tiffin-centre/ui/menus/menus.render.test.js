// Node-only render tests: every menu screen renders to static markup in each of its states.
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SoloHome, Results, PauseMenu, QuitConfirm, CoachMark, StatusScreen, LevelBriefing } from './index.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const progress = { best: { 1: { stars: 3, earned: 480 }, 2: { stars: 1, earned: 270 } } };

describe('SoloHome', () => {
  it('before the tutorial: a Start tutorial card, a locked co-op teaser, no level cards', () => {
    const s = html(h(SoloHome, { progress: null, tutorialDone: false, unlockedLevel: 1, onStartTutorial: noop, onStartLevel: noop, onInvite: noop, onBack: noop }));
    expect(s).toContain('Start tutorial');
    expect(s).toContain('Unlocks co-op with friends');
    expect(s).toContain('టిఫిన్ సెంటర్');
    expect(s).toContain('Tiffin Centre');
    expect(s).toContain('Co-op table');
    expect(s).not.toContain('Invite friends');
    expect(s).not.toContain('tc-menu-lvl__btn');
    expect(s).toContain('href="/games/tiffin-centre"'); // the Back link comes from paths.game
  });
  it('after the tutorial: Invite friends first, then 12 level cards in five groups with stars and locks', () => {
    const s = html(h(SoloHome, { progress, tutorialDone: true, unlockedLevel: 3, onStartTutorial: noop, onStartLevel: noop, onInvite: noop, onBack: noop }));
    expect(s).not.toContain('Start tutorial');
    expect(s.indexOf('Invite friends')).toBeGreaterThan(-1);
    expect(s.indexOf('Invite friends')).toBeLessThan(s.indexOf('Practice shifts'));
    expect((s.match(/class="tc-menu-lvl /g) || []).length).toBe(12);
    for (const g of ['Morning', 'Afternoon', 'Evening', 'Night', 'Festival']) expect(s).toContain(`<span>${g}</span>`);
    expect(s).toContain('6:00-9:00 AM');
    expect(s).toContain('3 of 3 stars');
    expect(s).toContain('Relaxed');
    expect(s).toContain('Rush hour');
    expect((s.match(/is-locked/g) || []).length).toBe(9); // levels 4..12
    expect(s).toContain('aria-disabled="true"');
    expect(s).toContain('Sunrise Dosa');
    expect(s).toContain('సూర్యోదయ దోశ');
    expect(s).toContain('Best ₹480');
  });
});

const res = (over = {}) => ({ reason: 'cleared', stars: 2, money: 350, level: 1, winnerId: 'a', standings: [{ id: 'a', rank: 1, score: 350, stats: { served: 20, tips: 33 } }], stats: { tips: 33, served: 20, lost: 1, unpaid: 2, combo: 5 }, ...over });

describe('Results', () => {
  it('a cleared practice shift: stars, money, stats, buttons and the unlock banner', () => {
    const s = html(h(Results, { result: res(), level: 1, pace: 'normal', mode: 'practice', onRetry: noop, onNext: noop, onExit: noop, players: [{ id: 'a', name: 'Asha' }] }));
    expect(s).toContain('Great shift!');
    expect(s).toContain('2 of 3 stars');
    expect(s).toContain('Money earned: ₹350');
    expect(s).toContain('Plates served');
    expect(s).toContain('Walked away unpaid');
    expect(s).toContain('Retry shift');
    expect(s).toContain('Next level');
    expect(s).toContain('Back');
    expect(s).toContain('Level 2 opened');
    expect(s).not.toContain('MVP');
  });
  it('a failed shift says Closed for the day and offers no Next level', () => {
    const s = html(h(Results, { result: res({ reason: 'closed', stars: 0, money: 60, winnerId: null }), level: 2, pace: 'rush', mode: 'practice', onRetry: noop, onNext: noop, onExit: noop }));
    expect(s).toContain('Closed for the day');
    expect(s).not.toContain('Next level');
    expect(s).not.toContain('opened:');
    expect(s).toContain('Open the shutters again');
  });
  it('co-op: per-player bars with names and an MVP chip', () => {
    const r = res({ money: 900, stars: 3, winnerId: 'b', standings: [{ id: 'a', rank: 1, score: 300, stats: { served: 9, tips: 5 } }, { id: 'b', rank: 1, score: 600, stats: { served: 14, tips: 9 } }] });
    const s = html(h(Results, { result: r, level: 3, pace: 'normal', mode: 'online', onRetry: noop, onExit: noop, players: [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bilal' }] }));
    expect(s).toContain('Asha');
    expect(s).toContain('Bilal');
    expect(s).toContain('MVP');
    expect(s).toContain('Who brought in the cash');
    expect(s).toContain('Play again');
    expect(s).not.toContain('Next level');
  });
  it('the tutorial result unlocks co-op with a prominent Invite friends', () => {
    const s = html(h(Results, { result: { reason: 'tutorial', level: 0, money: 100, stars: 0, standings: [{ id: 'a', rank: 1, score: 100, stats: {} }] }, level: 0, pace: 'normal', mode: 'tutorial', onInvite: noop, onNext: noop, onExit: noop }));
    expect(s).toContain('Tutorial complete!');
    expect(s).toContain('Co-op with friends unlocked');
    expect(s).toContain('Invite friends');
    expect(s).toContain('tc-menu-btn--primary');
    expect(s).not.toContain('Money earned');
  });
  it('renders with an empty result without throwing', () => {
    expect(() => html(h(Results, { result: null, level: 1 }))).not.toThrow();
  });
});

describe('PauseMenu and QuitConfirm', () => {
  it('render nothing when closed', () => {
    expect(html(h(PauseMenu, { open: false }))).toBe('');
    expect(html(h(QuitConfirm, { open: false }))).toBe('');
  });
  it('pause holds the settings: language, subtitles, voices (with the missing-voice note) and the controls', () => {
    const audio = { isSpeechAvailable: (l) => l !== 'te' };
    const s = html(h(PauseMenu, { open: true, onResume: noop, onRestart: noop, onQuit: noop, onMute: noop, audio }));
    for (const w of ['Customers talk', 'Customer language', 'తెలుగు', 'हिन्दी', 'Hyderabadi', 'Mixed', 'Native + English', 'Roman letters', 'Voices: on', 'Controls', 'Walk along the counter', 'Drag on empty space to look around']) expect(s).toContain(w);
    expect(s).toContain('No Telugu voice on this device');
    expect(s).toContain('role="radiogroup"');
  });
  it('open pause is a labelled modal dialog with Resume, Restart, sound switch and quit', () => {
    const s = html(h(PauseMenu, { open: true, onResume: noop, onRestart: noop, onQuit: noop, muted: true, onMute: noop }));
    expect(s).toContain('role="dialog"');
    expect(s).toContain('aria-modal="true"');
    expect(s).toContain('aria-labelledby="tc-pause-h"');
    expect(s).toContain('Resume');
    expect(s).toContain('Restart shift');
    expect(s).toContain('Sound: off');
    expect(s).toContain('aria-checked="true"');
    expect(s).toContain('Leave the stall');
  });
  it('co-op quit says leaving ends your seat', () => {
    const s = html(h(QuitConfirm, { open: true, onStay: noop, onQuit: noop, teammates: 2 }));
    expect(s).toContain('role="alertdialog"');
    expect(s).toContain('your seat ends');
    expect(s).toContain('2 friends are still serving');
    expect(s).toContain('Stay and serve');
    expect(s).toContain('Leave my seat');
  });
});

describe('CoachMark', () => {
  const step = { id: 's1', say: 'Pehle tawa pe chalo!', text: 'Tap the tawa, anna.', textTouch: 'Tap the glowing tawa.', te: 'పెనం నొక్కండి', hint: 'The big round pan on the left', recipe: 'dosa' };
  const chapters = ['Look', 'Tokens', 'Tawa', 'Idly'];
  it('is a one-line bar: Chotu says, the line, the chapter and a count; the full card lives behind a toggle', () => {
    const s = html(h(CoachMark, { step, index: 1, total: 5, onSkip: noop, chapters, chapter: 2 }));
    expect(s).toContain('Chotu says');
    expect(s).toContain('Pehle tawa pe chalo!');
    expect(s).toContain('Tap the tawa, anna.');
    expect(s).toContain('పెనం నొక్కండి');
    expect(s).toContain('Step 2 of 5');
    expect(s).toContain('Skip tutorial');
    expect(s).toContain('aria-live="polite"');
    expect(s).toContain('aria-expanded="false"');
    expect(s).toMatch(/id="tc-coach-body-s1"[^>]*hidden/);
    expect(s).not.toContain('The big round pan'); // the hint waits for its timer
    expect(s).not.toContain('Got it');
    expect(s).not.toContain('Chef Amma');
  });
  it('shows progress by chapter, not one dot per step', () => {
    const s = html(h(CoachMark, { step, index: 5, total: 16, onSkip: noop, chapters, chapter: 'Tawa' }));
    expect((s.match(/<li class="is-/g) || []).length).toBe(4);
    expect(s).toContain('class="is-done"');
    expect(s).toContain('class="is-active" aria-current="step"');
    expect(s).toContain('Chapters: Tawa, 3 of 4');
    expect(s).not.toContain('tc-menu-dots');
    const bare = html(h(CoachMark, { step, index: 5, total: 16, onSkip: noop }));
    expect(bare).toContain('tc-menu-progress');
  });
  it('reads a session tutorial object (say, text, chapters, step count inside the chapter)', () => {
    const tutorial = {
      index: 2,
      steps: [{ chapter: 'Look' }, { chapter: 'Tokens' }, { chapter: 'Tokens' }],
      chapters: [{ id: 'Look', label: 'Look' }, { id: 'Tokens', label: 'Tokens' }],
      chapter: 1,
      say: 'Token dekho!',
      text: 'Every customer holds a numbered token.',
      te: 'టోకెన్',
      step: { id: 'tokens-2', recipe: 'idly' },
      ackable: true,
    };
    const s = html(h(CoachMark, { tutorial, onSkip: noop, onNext: noop }));
    expect(s).toContain('Token dekho!');
    expect(s).toContain('Every customer holds a numbered token.');
    expect(s).toContain('Tokens 2/2');
    expect(s).toContain('Done'); // the last step of three
    expect(s).toContain('Show recipe');
  });
  it('shows a Got it button only when onNext is given, and renders nothing without a step', () => {
    expect(html(h(CoachMark, { step, index: 0, total: 2, onSkip: noop, onNext: noop }))).toContain('Got it');
    expect(html(h(CoachMark, { step: null, index: 0, total: 1 }))).toBe('');
  });
});

describe('StatusScreen', () => {
  it('has friendly copy and the right actions for every kind', () => {
    const l = html(h(StatusScreen, { kind: 'loading', onExit: noop }));
    expect(l).toContain('Lighting the stove...');
    expect(l).toContain('aria-busy="true"');
    const e = html(h(StatusScreen, { kind: 'error', onRetry: noop, onExit: noop }));
    expect(e).toContain('Try again');
    expect(e).toContain('role="alert"');
    const d = html(h(StatusScreen, { kind: 'disconnected', onRetry: noop, onExit: noop }));
    expect(d).toContain('Reconnect');
    expect(d).toContain('Leave table');
    const w = html(h(StatusScreen, { kind: 'webgl', onRetry: noop, onExit: noop }));
    expect(w).toContain('WebGL');
    expect(w).toContain('Back to games');
  });
});

describe('LevelBriefing', () => {
  it('shows the level, hours, the menu with NEW flags and a tip', () => {
    const s = html(h(LevelBriefing, { level: 2, pace: 'normal', onGo: noop }));
    expect(s).toContain('Idly Sambar');
    expect(s).toContain('ఇడ్లీ సాంబార్');
    expect(s).toContain('6:00-9:30 AM');
    expect(s).toContain('Idly (2 pc)');
    expect(s).toContain('ఇడ్లీ');
    expect(s).toContain('NEW');
    expect(s).toContain('Morning');
    expect(s).toContain('Chotu&#x27;s tip');
    expect(s).toContain('role="dialog"');
  });
  it('level 1 flags nothing as new', () => {
    expect(html(h(LevelBriefing, { level: 1, onGo: noop }))).not.toContain('>NEW<');
  });
});
