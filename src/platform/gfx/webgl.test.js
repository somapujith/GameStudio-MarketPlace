import { describe, expect, it, vi } from 'vitest';
import { isNativeApp, probeWebgl2, webglFailureText } from './webgl.js';

const docWith = (getContext) => ({ createElement: () => ({ getContext }) });
const fakeGl = () => {
  const lose = { loseContext: vi.fn() };
  return { gl: { getParameter: () => 1, getExtension: (n) => (n === 'WEBGL_lose_context' ? lose : null) }, lose };
};

describe('probeWebgl2', () => {
  it('is ok when a context comes back, and releases it', () => {
    const { gl, lose } = fakeGl();
    const r = probeWebgl2({ doc: docWith(() => gl), win: {} });
    expect(r).toEqual({ ok: true, native: false, reason: null });
    expect(lose.loseContext).toHaveBeenCalledTimes(1);
  });

  it('asks for webgl2 only (a WebGL 1 context is not enough for this game)', () => {
    const seen = [];
    probeWebgl2({ doc: docWith((kind) => { seen.push(kind); return null; }), win: {} });
    expect(seen).toEqual(['webgl2']);
  });

  it('says no-webgl2 when the browser returns null', () => {
    expect(probeWebgl2({ doc: docWith(() => null), win: {} })).toEqual({ ok: false, native: false, reason: 'no-webgl2' });
  });

  it('survives getContext throwing', () => {
    const r = probeWebgl2({ doc: docWith(() => { throw new Error('blocked'); }), win: {} });
    expect(r).toMatchObject({ ok: false, reason: 'error' });
  });

  it('survives a context that cannot be lost', () => {
    const gl = { getParameter: () => 1, getExtension: () => { throw new Error('gone'); } };
    expect(probeWebgl2({ doc: docWith(() => gl), win: {} }).ok).toBe(true);
  });

  it('with no DOM (server render, tests) does not claim the browser lacks WebGL', () => {
    expect(probeWebgl2({ doc: null, win: null })).toEqual({ ok: true, native: false, reason: 'no-dom' });
  });

  it('reports the native app', () => {
    const win = { Capacitor: { isNativePlatform: () => true } };
    expect(probeWebgl2({ doc: docWith(() => null), win })).toEqual({ ok: false, native: true, reason: 'no-webgl2' });
  });
});

describe('isNativeApp', () => {
  it('is true only inside the native shell', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp({ Capacitor: {} })).toBe(false);
    expect(isNativeApp({})).toBe(false);
    expect(isNativeApp(null)).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } })).toBe(false);
  });
});

describe('webglFailureText', () => {
  it('points a browser at hardware acceleration', () => {
    const t = webglFailureText({ native: false });
    expect(t.title).toBe('This browser can’t run the 3D city');
    expect(t.body).toContain('hardware acceleration');
    expect(webglFailureText({}, 'Autowala').body).toMatch(/^Autowala needs WebGL 2/);
  });

  it('inside the app there is no hardware-acceleration switch to point at', () => {
    const t = webglFailureText({ native: true }, 'Autowala');
    expect(t.title).toBe('This phone can’t run this game');
    expect(t.body).not.toContain('hardware acceleration');
    expect(t.body).toContain('WebView');
  });
});
