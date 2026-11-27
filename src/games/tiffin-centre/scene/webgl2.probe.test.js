// "Can this device run the 3D stall at all?" asked before any 3D chunk is fetched (capabilities.js probeWebgl2 / isNativeApp, and the TiffinGame shell that uses them).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { forgetWebgl2Probe, isNativeApp, probeWebgl2 } from './capabilities.js';

const fakeDoc = (getContext) => ({ createElement: () => ({ getContext }) });

describe('probeWebgl2', () => {
  it('says ok when a WebGL 2 context can be made, and releases it at once', () => {
    let lost = false;
    let asked = null;
    const gl = { getExtension: (n) => (n === 'WEBGL_lose_context' ? { loseContext() { lost = true; } } : null) };
    const r = probeWebgl2({ doc: fakeDoc((kind) => ((asked = kind), gl)) });
    expect(r).toEqual({ ok: true, reason: '' });
    expect(asked).toBe('webgl2'); // WebGL 1 is not enough: three.js 0.187 is WebGL 2 only
    expect(lost).toBe(true);
  });
  it('says not ok when the browser gives no context, or throws', () => {
    expect(probeWebgl2({ doc: fakeDoc(() => null) }).ok).toBe(false);
    expect(probeWebgl2({ doc: fakeDoc(() => null) }).reason).toMatch(/WebGL 2/);
    const t = probeWebgl2({ doc: fakeDoc(() => { throw new Error('GPU process crashed'); }) });
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/GPU process crashed/);
  });
  it('without a DOM nothing can be known: ok (tests, server rendering)', () => {
    expect(probeWebgl2({ doc: null }).ok).toBe(true);
    expect(probeWebgl2({ doc: {} }).ok).toBe(true);
  });
  it('a context that cannot be released does not break the answer', () => {
    const gl = { getExtension: () => { throw new Error('lost'); } };
    expect(probeWebgl2({ doc: fakeDoc(() => gl) }).ok).toBe(true);
  });
});

describe('isNativeApp', () => {
  it('is true only inside the Capacitor app, and never throws', () => {
    expect(isNativeApp({})).toBe(false);
    expect(isNativeApp(null)).toBe(false);
    expect(isNativeApp({ Capacitor: {} })).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeApp({ get Capacitor() { throw new Error('x'); } })).toBe(false);
  });
});

describe('the Tiffin shell on a device without WebGL 2', () => {
  let TiffinGame;
  beforeAll(async () => {
    ({ default: TiffinGame } = await import('../TiffinGame.jsx')); // imported without a document: the app's modules touch it at load
  });
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    forgetWebgl2Probe();
  });

  it('shows the no-WebGL card at once, without rendering the lazy 3D screen', async () => {
    globalThis.document = fakeDoc(() => null);
    forgetWebgl2Probe();
    expect(probeWebgl2().ok).toBe(false); // cached for the page: the shell asks the same question
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(TiffinGame, { session: { mode: 'solo', status: 'loading' } })));
    expect(html).toContain('cannot draw the 3D stall');
    expect(html).toContain('Back to games');
    expect(html).toContain('Turn on hardware acceleration');
    expect(html).not.toContain('Lighting the stove'); // not the loading card of the 3D chunk
  });

  it('in the Android app the same card has no browser advice', async () => {
    globalThis.document = fakeDoc(() => null);
    globalThis.window = { Capacitor: { isNativePlatform: () => true } };
    forgetWebgl2Probe();
    expect(probeWebgl2().ok).toBe(false);
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(TiffinGame, { session: { mode: 'solo', status: 'loading' } })));
    expect(html).toContain("This phone can&#x27;t run this game");
    expect(html).not.toContain('hardware acceleration');
  });
});
