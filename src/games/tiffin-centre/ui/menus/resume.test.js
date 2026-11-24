import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SoloHome } from './index.js';
import { resumeViewModel, savedAgo } from './menuModels.js';

const NOW = 1_700_000_000_000;
const saved = { title: 'Poori Morning', level: 3, pace: 'rush', tick: 45, shiftTicks: 180, money: 1240, savedAt: NOW - 3 * 60 * 1000 };
const noop = () => {};
const home = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(SoloHome, { progress: null, tutorialDone: true, unlockedLevel: 3, onStartTutorial: noop, onStartLevel: noop, onInvite: noop, onBack: noop, now: NOW, ...props })));

describe('saved shift text', () => {
  it('says how long ago', () => {
    expect(savedAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(savedAgo(NOW - 3 * 60_000, NOW)).toBe('3 min ago');
    expect(savedAgo(NOW - 2 * 3600_000, NOW)).toBe('2 hours ago');
    expect(savedAgo(NOW - 3 * 86400_000, NOW)).toBe('3 days ago');
    expect(savedAgo(undefined, NOW)).toBe('a while ago');
    expect(savedAgo(NOW + 9e6, NOW)).toBe('a while ago');
  });
  it('builds the card model; a level 0 save is the tutorial', () => {
    const vm = resumeViewModel(saved, NOW);
    expect(vm).toMatchObject({ tutorial: false, title: 'Poori Morning', pct: 25, left: '2:15', money: 1240, ago: '3 min ago', paceLabel: 'Rush hour', resume: 'Resume' });
    const t = resumeViewModel({ level: 0, tick: 1800, shiftTicks: 3600, savedAt: NOW }, NOW);
    expect(t).toMatchObject({ tutorial: true, resume: 'Continue tutorial', pct: 50 });
    expect(resumeViewModel(null)).toBeNull();
    expect(resumeViewModel({ level: 2, tick: 999, shiftTicks: 10 }, NOW).pct).toBe(100);
  });
});

describe('SoloHome resume card', () => {
  it('shows first, above the tutorial / levels, with a progress bar, Resume and Start fresh', () => {
    const s = home({ saved, onResume: noop, onDiscard: noop });
    expect(s).toContain('Resume your shift');
    expect(s).toContain('Poori Morning');
    expect(s).toContain('saved 3 min ago');
    expect(s).toContain('role="progressbar"');
    expect(s).toContain('aria-valuenow="25"');
    expect(s.indexOf('Resume your shift')).toBeLessThan(s.indexOf('Practice shifts'));
    expect(s.indexOf('Resume your shift')).toBeLessThan(s.indexOf('Open a table with friends'));
    expect(s).toContain('>Resume<');
    expect(s).toContain('Start fresh');
    expect((s.match(/ autofocus=/g) || []).length).toBe(1); // only the Resume button takes the focus
  });
  it('a tutorial save says Continue tutorial and sits above Start tutorial', () => {
    const s = home({ tutorialDone: false, saved: { level: 0, tick: 600, shiftTicks: 3600, savedAt: NOW - 60_000 } });
    expect(s).toContain('Continue tutorial');
    expect(s.indexOf('Continue tutorial')).toBeLessThan(s.indexOf('Start tutorial'));
  });
  it('without a save there is no card, and the usual button keeps the focus', () => {
    const s = home({ saved: null });
    expect(s).not.toContain('Resume your shift');
    expect((s.match(/ autofocus=/g) || []).length).toBe(1);
  });
});
