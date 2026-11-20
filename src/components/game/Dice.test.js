import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dice, dieValue, diceSkinStyle } from './Dice.jsx';

const render = (dice, rolling = false) => renderToString(createElement(Dice, {
  session: { display: { dice }, rolling, options: { roll: true } },
}));

describe('single die presentation', () => {
  it('has one cube and leaves rolling to the central roll button', () => {
    const html = render([4]);
    expect(html.match(/class="cp-cube"/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
    expect(html).toContain('Die shows 4. Move 4 spaces.');
  });

  it('draws one cube whatever the display holds, and never talks about doubles', () => {
    const html = render([3, 5]);
    expect(html.match(/class="cp-cube"/g)).toHaveLength(1);
    expect(html).toContain('Die shows 3.');
    expect(html.toLowerCase()).not.toContain('doubles');
  });

  it('announces ready before the first result and rolling without a stale result', () => {
    const ready = render([0]);
    expect(ready).toContain('Ready to roll');
    expect(ready).not.toContain('Die shows');
    const rolling = render([4], true);
    expect(rolling).toContain('Rolling the die');
    expect(rolling).not.toContain('Move 4');
  });

  it('calls out a six', () => {
    expect(render([6])).toContain('Six! Roll again');
  });
});

describe('dieValue', () => {
  it('is the last roll, falling back to a typical 4 before the first roll', () => {
    expect(dieValue({ display: { dice: [5] } })).toBe(5);
    expect(dieValue({ view: { dice: [2] } })).toBe(2);
    expect(dieValue({ display: { dice: [0] } })).toBe(4);
    expect(dieValue({})).toBe(4);
  });
});

describe('dice skins', () => {
  const skinned = (skin) => renderToString(createElement(Dice, { session: { display: { dice: [3] } }, skin }));

  it('paints the die in the cosmetic colours (face, pip, edge)', () => {
    const html = skinned('dice-cyber');
    expect(html).toContain('has-skin');
    expect(html).toContain('--die-face:#141a3a');
    expect(html).toContain('--die-pip:#5ef2ff');
    expect(html).toContain('--die-edge:#7b6dff');
    expect(html).toContain('data-skin="dice-cyber"');
  });

  it('keeps the default die for no skin, unknown ids and non-dice cosmetics', () => {
    for (const skin of [null, undefined, 'nope', 'frame-pearl']) {
      const html = skinned(skin);
      expect(html).not.toContain('has-skin');
      expect(html).not.toContain('--die-face');
    }
    expect(diceSkinStyle('dice-ivory')).toEqual({ '--die-face': '#fbf7ef', '--die-pip': '#1b1340', '--die-edge': '#d9cdb5' });
  });
});

describe('3D die markup', () => {
  const html = (session, skin) => renderToString(createElement(Dice, { session, skin }));

  it('has six faces with pips, three inner core planes and the animation layers, but still one .cp-cube', () => {
    const h = html({ display: { dice: [2] } });
    expect(h.match(/class="cp-face cp-face--\d"/g)).toHaveLength(6);
    expect(h.match(/class="cp-core /g)).toHaveLength(3);
    for (const c of ['cp-die3d__halo', 'cp-die3d__shadow', 'cp-die3d__float', 'cp-die3d__air', 'cp-die3d__twinkle']) expect(h).toContain(c);
    expect(h.match(/class="cp-cube"/g)).toHaveLength(1);
  });

  it('draws no result pop, burst or ribbon on first paint (they only follow a roll)', () => {
    const h = html({ display: { dice: [6] } });
    for (const c of ['cp-die3d__pop', 'cp-die3d__burst', 'cp-die3d__ribbon']) expect(h).not.toContain(c);
  });

  it('shows the fair / lucky badge from the table settings, and nothing without them', () => {
    const view = (dice) => ({ view: { cfg: { dice }, players: [], turn: 0 }, display: { dice: [3] } });
    expect(html(view('lucky'))).toContain('aria-label="Lucky dice"');
    expect(html(view('fair'))).toContain('aria-label="Fair dice"');
    expect(html(view('fair'))).toContain('Fair dice: pure luck');
    expect(html({ display: { dice: [3] } })).not.toContain('cp-dice__mode');
    expect(html(view('nonsense'))).not.toContain('cp-dice__mode');
  });

  it('is only a tap target on my turn to roll (never a button element; keyboard users have Roll / Space)', () => {
    const base = { me: 'a', options: { roll: true }, view: { phase: 'roll', turn: 0, players: [{ id: 'a' }, { id: 'b' }], cfg: { dice: 'lucky' }, pending: null, dice: [2] }, display: { dice: [2] }, dispatch() {} };
    const mine = html(base);
    expect(mine).toContain('is-ready');
    expect(mine).not.toContain('<button');
    expect(html({ ...base, options: {} })).not.toContain('is-ready');
    expect(html({ ...base, rolling: true })).not.toContain('is-ready');
    expect(html({ ...base, view: { ...base.view, turn: 1 } })).not.toContain('is-ready');
  });

  it('takes the settle time from the presenter', () => {
    expect(html({ display: { dice: [3], diceSettleMs: 321, diceMs: 700 } })).toContain('--cp-die-settle:321ms');
  });
});
