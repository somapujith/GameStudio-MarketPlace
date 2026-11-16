// The daily reward popup, rendered on the server (effects and portals do not run): its content, and that it stays
// out of the way (renders nothing) until the gate in the browser opens it. CSS gates are read from the stylesheet.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '@/lib/auth.jsx';
import { dailyView, istDayKey } from '@/components/shell/home/homeModel.js';
import DailyRewardPopup, { DailyPopupCard } from './DailyRewardPopup.jsx';

const NOW = Date.UTC(2026, 10, 17, 6, 0, 0);
const READY = { streak: 2, lastClaim: istDayKey(NOW - 86_400_000), canClaim: true, nextReward: 250 };
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const card = (props = {}) => renderToStaticMarkup(h(DailyPopupCard, { view: dailyView(READY, NOW), ...props }));
const auth = (user) => ({ user, loading: false, refresh: async () => null });
const mount = (user, path = '/') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(AuthContext.Provider, { value: auth(user) }, h(DailyRewardPopup))));

describe('DailyPopupCard content', () => {
  const html = card({ coins: 1200, shownCoins: 1200 });
  it('shows the seven-day track with the real amounts and today highlighted', () => {
    const li = html.match(/<li /g) || [];
    expect(li.length).toBe(7);
    // streak 2 and a continuing claim -> today is day 3 (250)
    expect(html).toMatch(/is-current[^>]*>.*?<span class="hh2-daypip__label">250<\/span>/s);
    for (const n of ['150', '200', '250', '300', '350', '400']) expect(html).toContain(`>${n}</span>`);
    expect(html).toContain('aria-label="7-day streak"');
  });
  it('has a big primary Claim button that takes focus first, and a Later button', () => {
    expect(html).toMatch(/<button[^>]*data-autofocus[^>]*>/);
    expect(html).toContain('Claim +250');
    expect(html).toContain('>Later</button>');
    expect(html).toContain('Day 3 of 7');
  });
  it('shows the streak and the balance', () => {
    expect(html).toContain('hh2-daypip');
    expect(html).toMatch(/hh2-daily__streak/);
    expect(html).toContain('Balance');
    expect(html).toContain('1,200');
  });
  it('announces results in a polite live region', () => {
    expect(card({ live: '250 coins claimed.' })).toMatch(/<p class="sr-only" role="status" aria-live="polite">250 coins claimed\.<\/p>/);
    expect(html).toMatch(/role="status" aria-live="polite"><\/p>/);
  });
  it('marks the button busy without disabling it (a disabled button would drop focus out of the trap)', () => {
    const busy = card({ busy: true });
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).not.toMatch(/<button[^>]*\sdisabled/);
    expect(busy).toContain('Collecting');
  });
  it('turns into Done once claimed, and drops Later', () => {
    const done = card({ view: dailyView({ streak: 3, lastClaim: istDayKey(NOW), canClaim: false }, NOW) });
    expect(done).toContain('Done');
    expect(done).not.toContain('Later');
    expect(done).not.toContain('Claim +');
    expect(done).toContain('data-claimed');
  });
  it('shows a failure as an alert', () => {
    expect(card({ error: 'Offline.' })).toContain('role="alert">Offline.</p>');
  });
});

describe('DailyRewardPopup (server render)', () => {
  const member = { id: 'u1', name: 'Asha', isGuest: false, coins: 100, daily: READY };
  it('renders nothing on first paint, even for an eligible member (it waits for its delay)', () => {
    expect(mount(member)).toBe('');
  });
  it('renders nothing for guests, signed-out visitors, claimed members and unknown state', () => {
    expect(mount({ ...member, isGuest: true })).toBe('');
    expect(mount(null)).toBe('');
    expect(mount({ ...member, daily: { streak: 3, lastClaim: istDayKey(), canClaim: false } })).toBe('');
    expect(mount({ ...member, daily: undefined })).toBe('');
    expect(mount(member, '/play/ludo')).toBe('');
  });
});

describe('Modal primitive carries the dialog semantics the popup relies on', () => {
  const modal = read('../../components/shell/Modal.jsx');
  it('is a labelled aria-modal dialog with a trap, Esc, close X and focus restore', () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby');
    expect(modal).toContain("e.key === 'Escape'");
    expect(modal).toContain('data-autofocus');
    expect(modal).toContain('aria-label="Close"');
    expect(modal).toContain('last.current?.focus');
  });
  it('the popup uses it with the Daily reward title', () => {
    const src = read('./DailyRewardPopup.jsx');
    expect(src).toContain("import Modal from '@/components/shell/Modal.jsx'");
    expect(src).toContain('title="Daily reward"');
    expect(src).toContain('useDaily'); // the claim path is the card's, not a copy
    expect(src).not.toContain('claimDailyReward');
  });
});

describe('daily-popup.css gates', () => {
  const css = read('../../styles/daily-popup.css');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  it('has a reduced-motion block for both the OS query and the hub switch', () => {
    expect(noComments).toContain('@media (prefers-reduced-motion: reduce)');
    expect(noComments).toContain(":root[data-motion='reduced'] .hh-modal__panel.dp-panel");
  });
  it('reduced motion leaves a fade only: no panel transform, no stagger, wiggle or sheen', () => {
    const rm = noComments.slice(noComments.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('animation: dp-fade');
    expect(rm).toContain('transform: none');
    for (const sel of ['.dp .hh2-daypip', '.dp .xh-gift--ready', '.dp .xh-claim::after']) expect(rm).toContain(sel);
  });
  it('uses only hub / store / motion tokens, no scale(0), no transition: all, no ease-in', () => {
    expect(noComments).not.toMatch(/scale\(0\)/);
    expect(noComments).not.toMatch(/transition:\s*all/);
    expect(noComments).not.toMatch(/ease-in[^-]/);
    expect(noComments).not.toMatch(/var\(--(?!hub-|st-|dur-|ease-|xh-|hh2-|g-)[a-z0-9-]+/);
  });
  it('animates transform and opacity only', () => {
    const frames = [...noComments.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\n\})/g)].map((m) => m[1]).join('\n');
    expect(frames).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
  it('every dp- class the markup uses is styled', () => {
    const src = read('./DailyRewardPopup.jsx');
    for (const c of new Set([...src.matchAll(/\bdp-[a-z]+/g)].map((m) => m[0]))) {
      if (c === 'dp-fade') continue;
      expect(css, c).toContain(`.${c}`);
    }
  });
});
