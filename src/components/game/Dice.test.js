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
