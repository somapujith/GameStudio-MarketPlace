import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Speedometer, { dialValues, writeSpeed } from './Speedometer.jsx';
import { SnapStoreProvider, createSnapStore } from './snapStore.js';

// a fake gauge DOM: the three elements the live speed writes
const fakeGauge = (text = '0') => {
  const num = { firstChild: { data: text }, textContent: text };
  const needle = { style: { transform: '' } };
  const attrs = {};
  const fill = { setAttribute: (k, v) => (attrs[k] = v) };
  const root = { querySelector: (sel) => ({ '.aw-sp-num': num, '.aw-sp-needle': needle, '.aw-sp-fill': fill })[sel] ?? null };
  return { root, num, needle, attrs };
};

describe('dialValues: what a speed does to the gauge', () => {
  it('the number, the needle angle and the arc fill, from one function', () => {
    expect(dialValues(0)).toEqual({ rotate: 'rotate(135.0deg)', dash: '0.00 100', num: '0' });
    expect(dialValues(60)).toEqual({ rotate: 'rotate(270.0deg)', dash: '50.00 100', num: '60' });
    expect(dialValues(120)).toEqual({ rotate: 'rotate(405.0deg)', dash: '100.00 100', num: '120' });
  });
  it('clamps (over the gauge, negative, junk) and rounds the printed number', () => {
    expect(dialValues(300).dash).toBe('100.00 100');
    expect(dialValues(-5)).toMatchObject({ dash: '0.00 100', num: '0' });
    expect(dialValues(41.6).num).toBe('42');
    expect(dialValues(undefined).num).toBe('0');
  });
});

describe('writeSpeed: the live path, straight into the DOM', () => {
  it('updates the text node IN PLACE (React owns it), the needle and the arc', () => {
    const g = fakeGauge('10');
    const textNode = g.num.firstChild;
    expect(writeSpeed(g.root, 60)).toBe(true);
    expect(g.num.firstChild).toBe(textNode); // the same node: React can still update it
    expect(textNode.data).toBe('60');
    expect(g.needle.style.transform).toBe('rotate(270.0deg)');
    expect(g.attrs['stroke-dasharray']).toBe('50.00 100');
  });
  it('writes the same strings the first render produces', () => {
    const g = fakeGauge();
    writeSpeed(g.root, 83);
    const v = dialValues(83);
    expect(g.num.firstChild.data).toBe(v.num);
    expect(g.needle.style.transform).toBe(v.rotate);
    expect(g.attrs['stroke-dasharray']).toBe(v.dash);
  });
  it('falls back to textContent when React has not made a text node, and says false when the gauge is not there', () => {
    const g = fakeGauge();
    g.num.firstChild = null;
    writeSpeed(g.root, 7);
    expect(g.num.textContent).toBe('7');
    expect(writeSpeed(null, 5)).toBe(false);
    expect(writeSpeed({ querySelector: () => null }, 5)).toBe(false);
  });
});

describe('Speedometer reads the store', () => {
  const snap = { kmh: 42, fuel: 0.6, fuelLitres: 7.2, driftCharge: 0.5, boosting: false, drifting: false, rules: { limit: 40, zone: 'city', speeding: true } };
  const html = (s, props) => renderToStaticMarkup(createElement(SnapStoreProvider, { value: createSnapStore(s) }, createElement(Speedometer, props)));
  it('draws the current speed first, then the fuel, the charge and the limit sign', () => {
    const h = html(snap, {});
    expect(h).toContain('<b class="aw-sp-num">42</b>');
    expect(h).toContain('rotate(');
    expect(h).toContain('7.2 L');
    expect(h).toContain('CHARGE');
    expect(h).toContain('aw-limit is-city is-over');
  });
  it('the pod and compact flags and the boost label', () => {
    const h = html({ ...snap, boosting: true }, { compact: true, pod: true });
    expect(h).toContain('aw-sp--compact');
    expect(h).toContain('aw-sp--pod');
    expect(h).toContain('BOOST');
    expect(h).toContain('is-boosting');
  });
  it('a low tank pulses a warning; no snapshot, no gauge', () => {
    expect(html({ ...snap, fuel: 0.1 }, {})).toContain('LOW CNG');
    expect(renderToStaticMarkup(createElement(Speedometer, {}))).toBe('');
  });
});
