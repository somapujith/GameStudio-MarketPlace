// The power-card moments: the pure model (words, geometry, budgets), the SSR states of PowerMoments, and the gates of power-moments.css.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { POWER_CARDS } from '@shared/powerCards.js';
import { flightVars, momentView, originFrac, particleBudget, rectCenter } from './powerMomentModel.js';

vi.mock('@/components/art/index.js', () => ({ CardBack: () => h('i', { className: 'test-cardback' }), Avatar: () => null }));
const { default: PowerMoments } = await import('./PowerMoments.jsx');

const players = [
  { id: 'me', name: 'Asha', pos: 3 },
  { id: 'rav', name: 'Ravi', pos: 12 },
];
const ctx = { players, me: 'me' };
const html = (el) => renderToStaticMarkup(el);
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const session = (power) => ({ me: 'me', power, display: { players }, view: { players } });

describe('momentView', () => {
  it('is null for no moment, junk and unknown kinds', () => {
    for (const m of [null, undefined, 5, {}, { kind: 'nope' }]) expect(momentView(m, ctx)).toBeNull();
  });

  it('draw: my own draw shows the card face, a rival draw never does', () => {
    const mine = momentView({ id: 'a', kind: 'draw', player: 'me', source: 'tile', tile: 7, ms: 900, card: { uid: 'u', id: 'swap', exp: 5 } }, ctx);
    expect(mine).toMatchObject({ kind: 'draw', faceUp: true, from: 7, label: 'Swap Tiles', sr: 'You drew Swap Tiles' });
    expect(mine.card.id).toBe('swap');
    const rival = momentView({ id: 'b', kind: 'draw', player: 'rav', source: 'turn', ms: 900 }, ctx);
    expect(rival).toMatchObject({ faceUp: false, card: null, from: null, sr: 'Ravi drew a power card' });
    // the identity of a rival's card must never leak, even if a junk payload carried one
    const sneaky = momentView({ id: 'c', kind: 'draw', player: 'rav', source: 'turn', card: { id: 'shield' } }, ctx);
    expect(sneaky.faceUp).toBe(false);
    expect(sneaky.card).toBeNull();
    expect(sneaky.sr).not.toMatch(/Shield/);
    // my draw without a known card (no diff found) is a card back with the generic line
    expect(momentView({ id: 'd', kind: 'draw', player: 'me', source: 'turn' }, ctx)).toMatchObject({ faceUp: false, sr: 'You drew a power card' });
  });

  it('play: the ribbon says "<Player> played <Card>" with the one-line effect from the shared metadata', () => {
    for (const c of POWER_CARDS.filter((x) => x.id !== 'swap')) {
      const v = momentView({ id: 'p', kind: 'play', player: 'rav', card: c.id, ms: 1500 }, ctx);
      expect(v.banner).toEqual({ kicker: 'Power card', title: `Ravi played ${c.name}`, sub: c.short });
      expect(v.card.id).toBe(c.id);
      expect(v.tiles).toEqual([]);
    }
    expect(momentView({ id: 'p', kind: 'play', player: 'me', card: 'shield' }, ctx).banner.title).toBe('You played Shield');
  });

  it('play (swap): names the target and lists the two tiles to pulse', () => {
    const v = momentView({ id: 'p', kind: 'play', player: 'me', card: 'swap', target: 'rav' }, ctx);
    expect(v.banner.sub).toBe('Trade places with Ravi');
    expect(v.tiles).toEqual([3, 12]);
    expect(momentView({ id: 'p', kind: 'play', player: 'rav', card: 'swap', target: 'me' }, ctx).banner.sub).toBe('Trade places with you');
    expect(momentView({ id: 'p', kind: 'play', player: 'rav', card: 'swap', target: 'ghost' }, ctx).tiles).toEqual([]); // unknown target: no pulses
  });

  it('play: an unknown card id still reads, without art', () => {
    const v = momentView({ id: 'p', kind: 'play', player: 'rav', card: 'zzz' }, ctx);
    expect(v.card).toBeNull();
    expect(v.banner.title).toBe('Ravi played power card');
  });

  it('shield and double: BLOCKED / x2 RENT with the money', () => {
    const s = momentView({ id: 't', kind: 'shield', player: 'rav', amount: 42000, other: 'me' }, ctx);
    expect(s.banner).toEqual({ kicker: "Ravi's Shield", title: 'BLOCKED', sub: 'Saved ₹42,000' });
    expect(s.sr).toBe("Ravi's Shield blocked ₹42,000");
    const d = momentView({ id: 't', kind: 'double', player: 'me', amount: 30000 }, ctx);
    expect(d.banner).toEqual({ kicker: 'Your Double Rent', title: 'x2 RENT', sub: '+₹30,000' });
    expect(momentView({ id: 't', kind: 'shield', player: 'rav', amount: 0 }, ctx).banner.sub).toBe('Payment waived');
  });

  it('expire: one card or several', () => {
    expect(momentView({ id: 'e', kind: 'expire', player: 'rav', count: 1 }, ctx).text).toBe('A power card expired');
    expect(momentView({ id: 'e', kind: 'expire', player: 'rav', count: 2 }, ctx).text).toBe('2 power cards expired');
    expect(momentView({ id: 'e', kind: 'expire', player: 'rav' }, ctx).text).toBe('A power card expired');
  });
});

describe('geometry and budgets', () => {
  it('flightVars are offsets from the viewport centre; a missing end falls back to the centre / the top edge', () => {
    expect(flightVars({ x: 100, y: 100 }, { x: 300, y: 50 }, 400, 800)).toMatchObject({ x0: -100, y0: -300, x1: 100, y1: -350, tx: 300, ty: 50 });
    const f = flightVars(null, null, 400, 800);
    expect(f.x0).toBe(0);
    expect(f.y0).toBe(0);
    expect(f.x1).toBe(0);
    expect(f.y1).toBeLessThan(0);
  });
  it('rectCenter and originFrac are safe and clamped', () => {
    expect(rectCenter({ left: 10, top: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
    expect(rectCenter(null)).toBeNull();
    expect(originFrac({ x: 200, y: 400 }, 400, 800)).toEqual([0.5, 0.5]);
    expect(originFrac({ x: -50, y: 9999 }, 400, 800)).toEqual([0, 1]);
    expect(originFrac(null, 400, 800)).toEqual([0.5, 0.4]);
  });
  it('no particles under reduced motion or on a slow screen; a few for a draw, a burst for a double, none for the rest', () => {
    expect(particleBudget('draw')).toBeGreaterThan(0);
    expect(particleBudget('double')).toBeGreaterThan(particleBudget('draw'));
    expect(particleBudget('double')).toBeLessThanOrEqual(60); // the pool size
    for (const k of ['draw', 'double']) {
      expect(particleBudget(k, { reduced: true })).toBe(0);
      expect(particleBudget(k, { perfLow: true })).toBe(0);
    }
    for (const k of ['play', 'shield', 'expire']) expect(particleBudget(k)).toBe(0);
  });
});

describe('PowerMoments (SSR)', () => {
  it('renders only an empty polite status line between moments', () => {
    const out = html(h(PowerMoments, { session: session(null) }));
    expect(out).toContain('class="pm-root"');
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(text(out)).toBe('');
    expect(out).not.toContain('pm-play');
    expect(html(h(PowerMoments, { session: null }))).toContain('pm-root');
  });

  it('play: the card face with its name and effect, a ribbon of the power tone, two ripples, one status line', () => {
    const out = html(h(PowerMoments, { session: session({ id: 'pw1', kind: 'play', player: 'rav', card: 'shield', ms: 1500 }) }));
    expect(out).toContain('data-kind="play"');
    expect(out).toContain('mo-rib--power');
    expect(out).toContain('pm-card__name');
    expect(out).toContain('Block your next rent or tax.');
    expect(out.match(/pm-ripple/g).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('--pm-ms:1500ms');
    expect(out).toContain('Ravi played Shield');
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).toContain('pm-status');
    expect(out).not.toMatch(/onclick|<button|tabindex/i); // nothing to click, nothing to focus
  });

  it('play (swap) shows the trade line', () => {
    const out = html(h(PowerMoments, { session: session({ id: 'pw2', kind: 'play', player: 'me', card: 'swap', target: 'rav', ms: 1500 }) }));
    expect(out).toContain('Trade places with Ravi');
    expect(out).toContain('data-tone="violet"');
  });

  it('draw: my draw is face up with the card name, a rival draw is a card back with no name', () => {
    const mine = html(h(PowerMoments, { session: session({ id: 'd1', kind: 'draw', player: 'me', source: 'tile', tile: 4, ms: 900, card: { uid: 'u', id: 'double', exp: 5 } }) }));
    expect(mine).toContain('data-face="up"');
    expect(mine).toContain('Double Rent');
    const rival = html(h(PowerMoments, { session: session({ id: 'd2', kind: 'draw', player: 'rav', source: 'turn', ms: 900 }) }));
    expect(rival).toContain('data-face="down"');
    expect(rival).toContain('test-cardback');
    expect(rival).not.toMatch(/Shield|Double Rent|Steal|Swap Tiles/);
    expect(text(rival)).toBe('Ravi drew a power card');
  });

  it('shield and double: the ribbon says BLOCKED / x2 RENT with the money', () => {
    const shield = html(h(PowerMoments, { session: session({ id: 't1', kind: 'shield', player: 'rav', card: 'shield', amount: 42000, ms: 1400 }) }));
    expect(shield).toContain('is-shield');
    expect(shield).toContain('BLOCKED');
    expect(shield).toContain('Saved ₹42,000');
    const dbl = html(h(PowerMoments, { session: session({ id: 't2', kind: 'double', player: 'me', card: 'double', amount: 30000, ms: 1400 }) }));
    expect(dbl).toContain('is-double');
    expect(dbl).toContain('x2 RENT');
    expect(dbl).toContain('+₹30,000');
  });

  it('expire: a small toast', () => {
    const out = html(h(PowerMoments, { session: session({ id: 'x1', kind: 'expire', player: 'rav', count: 2, ms: 700 }) }));
    expect(out).toContain('pm-toast');
    expect(text(out)).toContain('2 power cards expired');
  });

  it('survives a moment with a card id it does not know and a session with no players', () => {
    expect(() => html(h(PowerMoments, { session: { me: 'x', power: { id: 'z', kind: 'play', player: 'q', card: 'zzz', ms: 1500 } } }))).not.toThrow();
  });
});

// ---- power-moments.css ------------------------------------------------------------------------------------------------
const raw = readFileSync(fileURLToPath(new URL('../../../styles/power-moments.css', import.meta.url)), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
const open = css.slice(0, at);
const gates = css.slice(at);
const reduceBlock = gates.slice(0, gates.indexOf(':root[data-motion'));
const afterMedia = gates.slice(gates.indexOf(':root[data-motion'));

function rules(textIn) {
  const flat = textIn.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]+\{/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
}

describe('power-moments.css', () => {
  it('has its gates after the rules and no loop anywhere', () => {
    expect(at).toBeGreaterThan(0);
    expect(css).not.toMatch(/infinite/);
  });

  it('every animated selector is softened or switched off by prefers-reduced-motion AND by the in-game switch', () => {
    const animated = rules(open).filter((r) => /animation\s*:/.test(r.body) && !/animation\s*:\s*none/.test(r.body));
    expect(animated.length).toBeGreaterThanOrEqual(6);
    for (const { sel } of animated) {
      for (const one of sel.split(',').map((x) => x.trim())) {
        expect(reduceBlock, `${one} in @media (prefers-reduced-motion)`).toContain(one);
        expect(afterMedia, `${one} in :root[data-motion] / [data-rm]`).toContain(one);
      }
    }
  });

  it('the decorative one-shots (ripples, rings, dust) are off on a slow device', () => {
    const lines = gates.split('\n').filter((l) => l.includes("[data-perf='low']")).join('\n');
    for (const sel of ['.pm-ripple', '.pm-ring', '.pm-toast__dust']) expect(lines, sel).toContain(sel);
  });

  it('animates only transform / opacity in keyframes', () => {
    const frames = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
    expect(frames.length).toBeGreaterThanOrEqual(8);
    for (const [, name, body] of frames) {
      for (const p of [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1])) expect(['transform', 'opacity'], `${name}: ${p}`).toContain(p);
    }
  });

  it('never takes a pointer event, never uses transition: all, uses the app motion tokens', () => {
    expect(css).toMatch(/\.pm-root\s*\{[^}]*pointer-events:\s*none/);
    expect(css).not.toMatch(/transition\s*:\s*all/);
    expect(css).toMatch(/var\(--dur-2\)/);
    expect(css).toMatch(/var\(--ease-out\)/);
  });

  it('the power ribbon tone exists in moments.css', () => {
    const m = readFileSync(fileURLToPath(new URL('../moments/moments.css', import.meta.url)), 'utf8');
    expect(m).toContain('.mo-rib--power');
  });
});
