// Toasts.jsx is a thin adapter over the shell toast: one look app-wide.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { ToastHost, TOAST_MS, toastArgs, useToasts } from './Toasts.jsx';
import { ToastProvider } from '@/components/shell/Toast.jsx';

describe('toastArgs (useToasts -> shell toast mapping)', () => {
  it('maps (text, tone) to toast(message, { tone, duration })', () => {
    expect(toastArgs('Copied', 'good')).toEqual(['Copied', { tone: 'good', duration: TOAST_MS.good }]);
    expect(toastArgs('Nope', 'bad')).toEqual(['Nope', { tone: 'bad', duration: 5200 }]);
    expect(toastArgs('Hi')).toEqual(['Hi', { tone: 'info', duration: 3000 }]);
    expect(toastArgs('Gold!', 'gold')[1].tone).toBe('gold');
    expect(toastArgs('Hmm', 'warn')[1].tone).toBe('bad');
    expect(toastArgs('x', 'weird')[1].tone).toBe('info');
    expect(toastArgs(42, 'info')[0]).toBe('42');
    expect(toastArgs('')).toBeNull();
    expect(toastArgs(null)).toBeNull();
  });
});

describe('useToasts', () => {
  it('keeps the { push, node } shape; node is empty at first (with or without the shell provider)', () => {
    let api;
    function Probe() {
      api = useToasts();
      return h('div', null, api.node);
    }
    expect(renderToString(h(Probe))).toBe('<div></div>');
    expect(typeof api.push).toBe('function');
    expect(renderToString(h(ToastProvider, null, h(Probe)))).toContain('hh-toasts');
    expect(api.node).toBeNull();
  });
  it('the fallback host uses the shell markup', () => {
    const html = renderToString(h(ToastHost, { items: [{ id: 1, text: 'Saved', tone: 'good' }], onDismiss: vi.fn() }));
    expect(html).toContain('hh-toast hh-toast--good');
    expect(html).toContain('Saved');
  });
});
