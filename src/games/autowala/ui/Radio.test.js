import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Radio from './Radio.jsx';

const game = (on) => ({ ctx: { sound: { radio: { toggle: vi.fn(), next: vi.fn(), prev: vi.fn() } } }, on });
const snap = (on, menu = null) => ({ menu, radio: { on, station: on ? 1 : -1, name: 'Lo-fi Charminar', te: 'లో-ఫై చార్మినార్', color: '#8f6bff', track: 'Chai at 3 AM', count: 3 } });
const html = (g, s) => renderToStaticMarkup(createElement(Radio, { game: g, snap: s }));

describe('Radio widget', () => {
  it('renders nothing without the sound system, the snapshot, or while a menu is open', () => {
    expect(html({ ctx: {} }, snap(true))).toBe('');
    expect(html(game(true), {})).toBe('');
    expect(html(game(true), snap(true, 'pause'))).toBe('');
  });
  it('is a single power button while off', () => {
    const h = html(game(false), snap(false));
    expect(h).toContain('aw-radio-pw');
    expect(h).toContain('aria-pressed="false"');
    expect(h).not.toContain('aw-radio-info');
  });
  it('shows the station, Telugu name, track and step buttons while on', () => {
    const h = html(game(true), snap(true));
    expect(h).toContain('Lo-fi Charminar');
    expect(h).toContain('లో-ఫై చార్మినార్');
    expect(h).toContain('Chai at 3 AM');
    expect(h).toContain('Next station');
    expect(h).toContain('Previous station');
  });
});
