// "Have a code?" sheet, first render (server side). The Modal portal is swapped for a plain wrapper.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/shell/Modal.jsx', () => ({
  default: ({ open, title, children, className }) => (open ? h('div', { role: 'dialog', className }, h('h2', null, title), children) : null),
}));

const { default: CodeSheet } = await import('./CodeSheet.jsx');

const render = (props) => renderToString(h(MemoryRouter, null, h(CodeSheet, { open: true, onClose() {}, ...props })));

describe('CodeSheet', () => {
  it('renders nothing when closed', () => {
    expect(render({ open: false })).toBe('');
  });
  it('opens ready to type or paste: the shared code input, focus target and Paste button', () => {
    const html = render({});
    expect(html).toContain('Join with a code');
    expect(html).toContain('jc__box');
    expect(html).toContain('data-autofocus');
    expect(html).toContain('Paste');
    expect(html).toContain('Find table');
    expect(html).toContain('6-character room code');
  });
  it('uses the grouped 3 + 3 boxes, not the old single field', () => {
    const html = render({});
    expect((html.match(/class="jc__group"/g) || []).length).toBe(2);
    expect(html).not.toContain('hub-code__input');
  });
  it('starts calm: no error shown before an attempt', () => {
    const html = render({});
    expect(html).toContain('jc--idle');
    expect(html).not.toContain('aria-invalid');
  });
});
