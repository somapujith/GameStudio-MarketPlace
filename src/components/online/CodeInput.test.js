// CodeInput v2, server-rendered (node env): grouping, tools, states and the accessible wiring.
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import CodeInput, { pasteHint } from './CodeInput.jsx';

const render = (props) => renderToString(h(CodeInput, { value: '', onChange() {}, ...props }));
const count = (html, re) => (html.match(re) || []).length;

describe('CodeInput: layout', () => {
  it('shows six boxes in two groups of three with a dot between', () => {
    const html = render({ value: 'ABC234' });
    expect(count(html, /class="jc__box[ "]/g)).toBe(6);
    expect(count(html, /class="jc__group"/g)).toBe(2);
    expect(count(html, /class="jc__sep"/g)).toBe(1);
    // the dot sits between the two groups
    const groups = html.split('class="jc__sep"');
    expect(count(groups[0], /class="jc__box[ "]/g)).toBe(3);
    expect(count(groups[1], /class="jc__box[ "]/g)).toBe(3);
  });
  it('keeps one real input holding the plain 6-character value, with the label and the 6-character hint', () => {
    const html = render({ value: 'ABC234', label: 'Room code' });
    expect(count(html, /<input/g)).toBe(1);
    expect(html).toContain('value="ABC234"');
    expect(html).toContain('Room code, 6 characters');
    expect(html).toContain('autoCapitalize="characters"');
  });
  it('shows the typed characters in their boxes and leaves the rest empty', () => {
    const html = render({ value: 'AB2' });
    expect(html).toContain('>A<');
    expect(html).toContain('>2<');
    expect(count(html, /has-char/g)).toBe(3);
  });
});

describe('CodeInput: tools', () => {
  it('offers Paste when empty (no Clear yet)', () => {
    const html = render({ value: '' });
    expect(html).toContain('Paste');
    expect(html).not.toContain('Clear the code');
  });
  it('offers Clear once there is something to clear, and Paste only while the code is incomplete', () => {
    const part = render({ value: 'AB' });
    expect(part).toContain('Paste');
    expect(part).toContain('Clear the code');
    const full = render({ value: 'ABC234' });
    expect(full).not.toContain('>Paste<');
    expect(full).toContain('Clear the code');
  });
  it('showTools={false} leaves just the boxes', () => {
    const html = render({ value: 'AB', showTools: false });
    expect(html).not.toContain('jc__btn');
  });
  it('paste hints say what to do next', () => {
    expect(pasteHint('empty')).toMatch(/copy the code/i);
    expect(pasteHint('unsupported')).toMatch(/press and hold/i);
    expect(pasteHint('blocked')).toMatch(/blocked/i);
  });
});

describe('CodeInput: states and accessibility', () => {
  it('ok: confirms with the check and marks the whole code complete', () => {
    const html = render({ value: 'ABC234', state: 'ok', message: 'Table found.' });
    expect(html).toContain('jc--ok');
    expect(html).toContain('is-complete');
    expect(html).toContain('jc__check');
    expect(html).toContain('is-ok');
  });
  it('error: invalid input tied to a polite-assertive message', () => {
    const html = render({ value: 'ABC234', state: 'error', message: 'No table has that code.' });
    expect(html).toContain('jc--error');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('No table has that code.');
    const id = html.match(/aria-describedby="([^"]+)"/)[1];
    expect(html).toContain(`id="${id.split(' ').pop()}"`); // the message the input points at exists
  });
  it('idle and checking are polite and not invalid', () => {
    const html = render({ value: 'ABC', state: 'checking' });
    expect(html).toContain('jc--checking');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('aria-invalid');
  });
  it('keeps the caller\'s describedBy next to its own message id', () => {
    const html = render({ value: '', describedBy: 'outside-status' });
    expect(html).toMatch(/aria-describedby="outside-status [^"]+"/);
  });
  it('disabled disables the input and the tools', () => {
    const html = render({ value: 'AB', disabled: true });
    expect(html).toContain('is-disabled');
    expect(count(html, /disabled=""/g)).toBeGreaterThanOrEqual(3);
  });
  it('does not use the legacy ho-code / sr-code classes', () => {
    const html = render({ value: 'ABC' });
    expect(html).not.toContain('ho-code');
    expect(html).not.toContain('sr-code');
  });
});
