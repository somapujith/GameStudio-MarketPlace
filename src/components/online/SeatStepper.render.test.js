import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SeatStepper from './SeatStepper.jsx';

const html = (props) => renderToStaticMarkup(createElement(SeatStepper, { onChange() {}, ...props }));
const btn = (h, label) => h.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

describe('SeatStepper', () => {
  it('shows the seat count with a minus and a plus the host can use', () => {
    const h = html({ value: 4, joined: 1, min: 2, max: 6 });
    expect(h).toContain('aria-label="4 seats"');
    expect(btn(h, 'One fewer seat')).not.toContain('disabled');
    expect(btn(h, 'One more seat')).not.toContain('disabled');
  });

  it('cannot go below the players already seated, or above the game maximum', () => {
    expect(btn(html({ value: 3, joined: 3, min: 2, max: 6 }), 'One fewer seat')).toContain('disabled');
    expect(btn(html({ value: 6, joined: 1, min: 2, max: 6 }), 'One more seat')).toContain('disabled');
  });

  it('is locked while disconnected or starting', () => {
    const h = html({ value: 4, joined: 1, min: 2, max: 6, disabled: true });
    expect(btn(h, 'One fewer seat')).toContain('disabled');
    expect(btn(h, 'One more seat')).toContain('disabled');
  });

  it('renders nothing when the game has one table size', () => {
    expect(html({ value: 2, joined: 2, min: 2, max: 2 })).toBe('');
  });
});
