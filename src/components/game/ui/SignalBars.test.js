// <SignalBars> markup (levels -> lit bars, colour class, aria text, the pills, the measuring state) and the model behind it,
// plus a guard on the colour tokens: >= 3:1 on the dark pod (with the bars' own plate) and on the cream lobby cards.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SignalBars from './SignalBars.jsx';
import { pillText, signalLabel, signalOf, signalTitle, signalWords } from './signalModel.js';

const html = (props) => renderToString(createElement(SignalBars, props)).replaceAll('<!-- -->', '');
const litCount = (out) => (out.match(/sg__bar is-on/g) || []).length;
const barCount = (out) => (out.match(/<i class="sg__bar/g) || []).length;

describe('<SignalBars> levels', () => {
  it('always draws four bars and lights as many as the level, with that level\'s colour class', () => {
    for (const level of [1, 2, 3, 4]) {
      const out = html({ kind: 'ok', level, rtt: 100 });
      expect(barCount(out)).toBe(4);
      expect(litCount(out)).toBe(level);
      expect(out).toContain(`sg--l${level}`);
      expect(out).toContain(`data-level="${level}"`);
      expect(out).toContain('data-kind="ok"');
    }
  });

  it('says it in words: role=img, the sentence for a screen reader and a tooltip', () => {
    const out = html({ kind: 'ok', level: 3, rtt: 123 });
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Connection: good, 3 of 4 bars, about 120 ms"');
    expect(out).toContain('title="Good connection · 123 ms"');
    expect(html({ kind: 'ok', level: 4, rtt: 40 })).toContain('aria-label="Connection: excellent, 4 of 4 bars, about 40 ms"');
    expect(html({ kind: 'ok', level: 1, rtt: 900 })).toContain('aria-label="Connection: poor, 1 of 4 bars, about 900 ms"');
    expect(html({ kind: 'ok', level: 2 })).toContain('aria-label="Connection: fair, 2 of 4 bars"');
  });

  it('shows no pill for a live connection, and a stale report is marked and dimmed', () => {
    expect(html({ kind: 'ok', level: 4, rtt: 40 })).not.toContain('sg__pill');
    const stale = html({ kind: 'ok', level: 3, rtt: 150, stale: true });
    expect(stale).toContain('is-stale');
    expect(stale).toContain('not updated recently');
    expect(html({ kind: 'ok', level: 3, rtt: 150 })).not.toContain('is-stale');
  });

  it('size picks the bar scale; className is passed through; clamps odd levels', () => {
    expect(html({ kind: 'ok', level: 2, size: 'sm' })).toContain('sg--sm');
    expect(html({ kind: 'ok', level: 2 })).toContain('sg--md');
    expect(html({ kind: 'ok', level: 2, className: 'x-y' })).toContain('x-y');
    expect(litCount(html({ kind: 'ok', level: 9 }))).toBe(4);
    expect(litCount(html({ kind: 'ok', level: -3 }))).toBe(0);
  });

  it('renders nothing for kind "none"', () => {
    expect(html({ kind: 'none' })).toBe('');
  });
});

describe('<SignalBars> measuring and lost connection', () => {
  it('measuring: four dim bars, no colour, no pill', () => {
    const out = html({ kind: 'measuring' });
    expect(barCount(out)).toBe(4);
    expect(litCount(out)).toBe(0);
    expect(out).toContain('sg--measuring');
    expect(out).not.toMatch(/sg--l\d/);
    expect(out).not.toContain('sg__pill');
    expect(out).toContain('aria-label="Connection: measuring"');
  });

  it('offline: all bars grey (slash via CSS) and the red "Offline" pill BESIDE the bars', () => {
    const out = html({ kind: 'offline', level: 0 });
    expect(litCount(out)).toBe(0);
    expect(out).toContain('sg--offline');
    expect(out).toContain('aria-label="Connection: offline"');
    expect(out).toMatch(/<span class="sg__pill sg__pill--offline" aria-hidden="true">Offline<\/span>/);
    // the pill is a sibling after the bars, inside the same wrapper
    expect(out.indexOf('sg__bars')).toBeLessThan(out.indexOf('sg__pill'));
    expect(out.match(/^<span class="sg /)).toBeTruthy();
  });

  it('reconnecting (your own socket retrying): grey bars and the amber "Reconnecting…" pill', () => {
    const out = html({ kind: 'reconnecting', level: 0 });
    expect(litCount(out)).toBe(0);
    expect(out).toContain('sg--reconnecting');
    expect(out).toContain('sg__pill--reconnecting');
    expect(out).toContain('Reconnecting…');
    expect(out).toContain('aria-label="Connection: reconnecting"');
  });

  it('the pill can be left out (the bars still say it)', () => {
    const out = html({ kind: 'offline', level: 0, pill: false });
    expect(out).not.toContain('sg__pill');
    expect(out).toContain('sg--offline');
  });

  it('a level handed to a non-ok kind never lights a bar', () => {
    expect(litCount(html({ kind: 'offline', level: 4 }))).toBe(0);
    expect(litCount(html({ kind: 'measuring', level: 4 }))).toBe(0);
  });
});

describe('signalOf', () => {
  const rp = (extra) => ({ id: 'a', connected: true, ...extra });

  it('other players: the server\'s `net` decides', () => {
    expect(signalOf(rp({ net: { q: 3, rtt: 120 } }))).toEqual({ kind: 'ok', level: 3, rtt: 120, stale: false });
    expect(signalOf(rp({ net: { q: 2, rtt: 300, stale: true } }))).toMatchObject({ kind: 'ok', level: 2, stale: true });
    expect(signalOf(rp({ net: { q: null, rtt: null } }))).toMatchObject({ kind: 'measuring', level: null });
    expect(signalOf(rp({ net: { q: 0, rtt: null } }))).toMatchObject({ kind: 'offline', level: 0 });
    expect(signalOf(rp({ net: { q: 7 } }))).toMatchObject({ kind: 'measuring' });
  });

  it('a seat the server marks disconnected is offline whatever `net` says', () => {
    expect(signalOf(rp({ connected: false, net: { q: 4, rtt: 20 } }))).toMatchObject({ kind: 'offline' });
  });

  it('shows nothing for a non-member or a server without `net` (no bar that never fills)', () => {
    expect(signalOf(null).kind).toBe('none');
    expect(signalOf(undefined).kind).toBe('none');
    expect(signalOf(rp({})).kind).toBe('none');
    expect(signalOf(rp({ net: 'x' })).kind).toBe('none');
  });

  it('you: your own measurement wins, so your bars move without waiting for the server', () => {
    const me = rp({ net: { q: 1, rtt: 800 } });
    expect(signalOf(me, { isMe: true, local: { status: 'open', rtt: 45, level: 4 } })).toEqual({ kind: 'ok', level: 4, rtt: 45, stale: false });
    expect(signalOf(me, { isMe: true, local: { status: 'open', rtt: null, level: null } })).toMatchObject({ kind: 'measuring' });
    expect(signalOf(me, { isMe: true, local: { status: 'connecting', rtt: null, level: null } })).toMatchObject({ kind: 'measuring' });
    expect(signalOf(me, { isMe: true, local: { status: 'reconnecting', rtt: null, level: null } })).toMatchObject({ kind: 'reconnecting', level: 0 });
    expect(signalOf(me, { isMe: true, local: { status: 'closed', rtt: null, level: null } })).toMatchObject({ kind: 'offline' });
  });

  it('without a live local measurement (idle) you are shown like everybody else', () => {
    const me = rp({ net: { q: 2, rtt: 250 } });
    expect(signalOf(me, { isMe: true, local: { status: 'idle', rtt: null, level: null } })).toMatchObject({ kind: 'ok', level: 2 });
    expect(signalOf(me, { isMe: true })).toMatchObject({ kind: 'ok', level: 2 });
    expect(signalOf(null, { isMe: true, local: { status: 'open', rtt: 60, level: 4 } })).toMatchObject({ kind: 'ok', level: 4 });
  });
});

describe('signal text helpers', () => {
  it('pill text only for offline / reconnecting', () => {
    expect(pillText({ kind: 'offline' })).toBe('Offline');
    expect(pillText({ kind: 'reconnecting' })).toBe('Reconnecting…');
    expect(pillText({ kind: 'ok', level: 4 })).toBe('');
    expect(pillText({ kind: 'measuring' })).toBe('');
    expect(pillText(null)).toBe('');
  });

  it('words for a pod\'s aria-label', () => {
    expect(signalWords({ kind: 'ok', level: 3, rtt: 100 })).toBe('connection good, 3 of 4 bars');
    expect(signalWords({ kind: 'offline' })).toBe('offline');
    expect(signalWords({ kind: 'reconnecting' })).toBe('reconnecting');
    expect(signalWords({ kind: 'measuring' })).toBe('');
    expect(signalWords({ kind: 'none' })).toBe('');
  });

  it('labels and titles', () => {
    expect(signalLabel({ kind: 'none' })).toBe('');
    expect(signalTitle({ kind: 'none' })).toBe('');
    expect(signalTitle({ kind: 'offline' })).toMatch(/Offline/);
    expect(signalTitle({ kind: 'reconnecting' })).toMatch(/Reconnecting/);
    expect(signalLabel({ kind: 'ok', level: 4, rtt: 30 })).toBe('Connection: excellent, 4 of 4 bars, about 30 ms');
  });
});

// ---- colour tokens: >= 3:1 (WCAG non-text contrast) ----------------------------------------------------------------
const css = readFileSync(new URL('../../../styles/signal.css', import.meta.url), 'utf8');
const lin = (c) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const over = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
const tokens = (selectorStart) => {
  const at = css.indexOf(selectorStart);
  const block = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...block.matchAll(/--(sg-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};

describe('signal.css colour tokens', () => {
  const dark = tokens('.sg,');
  const light = tokens(":root[data-theme='light'] .sg,\n:root[data-theme='light'] .sg__pill {");
  const lit = (t) => ['sg-4', 'sg-3', 'sg-2', 'sg-1'].map((k) => [k, rgb(t[k])]);

  it('defines a colour per level on both palettes', () => {
    for (const t of [dark, light]) for (const k of ['sg-4', 'sg-3', 'sg-2', 'sg-1', 'sg-unlit', 'sg-plate', 'sg-slash']) expect(t[k], k).toBeTruthy();
  });

  it('night palette: every lit colour is >= 3:1 on the bars\' plate over the worst pod backgrounds', () => {
    // the pod gradient ends, "your" pod, and the lightest turn highlights (22% of a yellow / violet pawn colour)
    const pods = ['#243543', '#1b2731', '#2c3d4b', '#545842', '#444a6a', '#131a33', '#243060'].map(rgb);
    const plate = [8, 12, 18];
    for (const bg of pods) {
      const under = over(plate, 0.55, bg);
      for (const [k, c] of lit(dark)) expect(contrast(c, under), `${k} on ${under}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('sandstone (light hub) palette: every lit colour is >= 3:1 on the cream cards and page', () => {
    for (const bg of ['#fffcf3', '#fffaf2', '#f1e7d6', '#e8dac3', '#f7f1e6'].map(rgb)) {
      for (const [k, c] of lit(light)) expect(contrast(c, bg), `${k} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the four levels are four different colours on each palette', () => {
    for (const t of [dark, light]) expect(new Set(['sg-4', 'sg-3', 'sg-2', 'sg-1'].map((k) => t[k])).size).toBe(4);
  });

  it('respects reduced motion in all three ways', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(":root[data-motion='reduced']");
    expect(css).toContain('.hg-game[data-rm]');
  });
});
