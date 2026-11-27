// The loading, failure and GPU-lost screens: server-side markup only.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { FailureScreen, GpuLostScreen, LoadingScreen } from './BootScreens.jsx';

const html = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

describe('LoadingScreen', () => {
  it('shows the stage, the percentage, and a real progress bar', () => {
    const h = html(createElement(LoadingScreen, { text: 'Laying the roads', pct: 37 }));
    expect(h).toContain('Laying the roads');
    expect(h).toContain('37%');
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="37"');
    expect(h).toContain('width:37%');
    expect(h).toContain('ఆటోవాలా'); // the Telugu title
  });
  it('is a polite live status, not an alert', () => {
    const h = html(createElement(LoadingScreen, {}));
    expect(h).toContain('role="status"');
    expect(h).not.toContain('role="alert"');
    expect(h).toContain('0%');
  });
});

describe('FailureScreen', () => {
  it('explains WebGL and offers only the way back (reloading cannot add WebGL)', () => {
    const h = html(createElement(FailureScreen, { kind: 'webgl' }));
    expect(h).toContain('role="alert"');
    expect(h).toContain('can’t run the 3D city');
    expect(h).toContain('hardware acceleration');
    expect(h).toContain('Back to the game page');
    expect(h).not.toContain('>Reload<');
  });
  it('offers Reload first when the build threw, and the way back second', () => {
    const h = html(createElement(FailureScreen, { kind: 'error' }));
    expect(h).toContain('couldn’t start');
    expect(h.indexOf('>Reload<')).toBeGreaterThan(0);
    expect(h.indexOf('>Reload<')).toBeLessThan(h.indexOf('Back to the game page'));
    expect(h).toContain('is-quiet'); // the secondary button is the quiet one
  });
});

describe('GpuLostScreen', () => {
  it('says what happened, that it waits, and has a Reload button for when it never comes back', () => {
    const h = html(createElement(GpuLostScreen));
    expect(h).toContain('role="alert"');
    expect(h).toContain('graphics card paused the game');
    expect(h).toContain('Waiting for it to come back');
    expect(h).toContain('>Reload<');
  });
});
