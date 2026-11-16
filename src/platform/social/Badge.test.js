import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import Badge, { badgeCount, badgeLabel, badgeText, nextPop } from './Badge.jsx';

describe('Badge helpers', () => {
  it('normalises counts', () => {
    expect(badgeCount(3)).toBe(3);
    expect(badgeCount('4')).toBe(4);
    expect(badgeCount(-2)).toBe(0);
    expect(badgeCount(NaN)).toBe(0);
    expect(badgeCount(undefined)).toBe(0);
  });
  it('caps the text at 99+', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(5000)).toBe('99+');
  });
  it('words the default label', () => {
    expect(badgeLabel(3)).toBe('3 pending requests');
    expect(badgeLabel(1)).toBe('1 pending request');
  });
  it('pops only when the count goes up', () => {
    expect(nextPop(0, 1, 2)).toBe(1);
    expect(nextPop(1, 2, 2)).toBe(1);
    expect(nextPop(1, 3, 2)).toBe(1);
    expect(nextPop(0, 0, 1)).toBe(1);
  });
});

describe('Badge render', () => {
  it('is hidden at 0', () => {
    expect(renderToString(h(Badge, { count: 0 }))).toBe('');
    expect(renderToString(h(Badge, {}))).toBe('');
  });
  it('shows the count with an accessible label', () => {
    const html = renderToString(h(Badge, { count: 3 }));
    expect(html).toContain('class="bd-badge"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="3 pending requests"');
    expect(html).toContain('>3<');
  });
  it('uses a custom label and extra class, caps visually but not in the label', () => {
    const html = renderToString(h(Badge, { count: 120, label: '120 pending requests', className: 'bd-badge--nav' }));
    expect(html).toContain('bd-badge bd-badge--nav');
    expect(html).toContain('>99+<');
    expect(html).toContain('aria-label="120 pending requests"');
  });
});
