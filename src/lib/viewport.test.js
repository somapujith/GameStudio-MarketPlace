import { describe, expect, it } from 'vitest';
import { installViewportSync, isObscured, isTextField, keyboardInset } from './viewport.js';

describe('keyboardInset', () => {
  it('is the part of the layout viewport the visual viewport no longer covers', () => {
    expect(keyboardInset({ innerHeight: 844, height: 520, offsetTop: 0, scale: 1 })).toBe(324);
    // iOS pans the visual viewport while typing: the keyboard top is offsetTop + height
    expect(keyboardInset({ innerHeight: 844, height: 400, offsetTop: 120, scale: 1 })).toBe(324);
  });
  it('is 0 when closed, for URL-bar resizes and for pinch-zoom', () => {
    expect(keyboardInset({ innerHeight: 844, height: 844 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, height: 790 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, height: 400, scale: 2 })).toBe(0);
    expect(keyboardInset()).toBe(0);
  });
  it('ignores rubber-band (negative offsetTop)', () => {
    expect(keyboardInset({ innerHeight: 800, height: 800, offsetTop: -30 })).toBe(0);
  });
});

describe('isObscured', () => {
  const vp = { offsetTop: 0, height: 500 };
  it('detects boxes under the keyboard or above the visible area', () => {
    expect(isObscured({ top: 300, bottom: 350 }, vp)).toBe(false);
    expect(isObscured({ top: 480, bottom: 540 }, vp)).toBe(true);
    expect(isObscured({ top: -20, bottom: 30 }, vp)).toBe(true);
    expect(isObscured(null, vp)).toBe(false);
  });
});

describe('isTextField', () => {
  it('only matches fields that raise the keyboard', () => {
    expect(isTextField({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextField({ tagName: 'input', type: 'search' })).toBe(true);
    expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextField({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

function fakeEnv({ innerHeight = 800, height = 800, offsetTop = 0, scale = 1 } = {}) {
  const attrs = new Set();
  const style = {};
  const vvHandlers = {};
  const docHandlers = {};
  const vv = {
    height,
    offsetTop,
    scale,
    addEventListener: (t, fn) => ((vvHandlers[t] ||= new Set()).add(fn)),
    removeEventListener: (t, fn) => vvHandlers[t]?.delete(fn),
  };
  const doc = {
    activeElement: null,
    documentElement: {
      style: { setProperty: (k, v) => (style[k] = v), removeProperty: (k) => delete style[k] },
      setAttribute: (k) => attrs.add(k),
      removeAttribute: (k) => attrs.delete(k),
    },
    addEventListener: (t, fn) => ((docHandlers[t] ||= new Set()).add(fn)),
    removeEventListener: (t, fn) => docHandlers[t]?.delete(fn),
  };
  const win = { document: doc, visualViewport: vv, innerHeight, scrollX: 0, scrollY: 0, scrollTo() {}, requestAnimationFrame: (fn) => {
      fn();
      return 0;
    }, cancelAnimationFrame() {} };
  return { win, vv, attrs, style, vvHandlers, docHandlers };
}

describe('installViewportSync', () => {
  it('is a no-op without visualViewport', () => {
    expect(installViewportSync({ document: {} })()).toBeUndefined();
    expect(installViewportSync(undefined)()).toBeUndefined();
  });

  it('publishes --kb-inset / --vvh / data-kb as the keyboard opens and closes', () => {
    const env = fakeEnv();
    const off = installViewportSync(env.win);
    expect(env.style['--kb-inset']).toBe('0px');
    expect(env.attrs.has('data-kb')).toBe(false);

    env.vv.height = 480;
    env.vvHandlers.resize.forEach((fn) => fn());
    expect(env.style['--kb-inset']).toBe('320px');
    expect(env.style['--vvh']).toBe('480px');
    expect(env.attrs.has('data-kb')).toBe(true);

    env.vv.height = 800;
    env.vvHandlers.resize.forEach((fn) => fn());
    expect(env.style['--kb-inset']).toBe('0px');
    expect(env.attrs.has('data-kb')).toBe(false);

    off();
    expect(env.style['--kb-inset']).toBeUndefined();
    expect(env.vvHandlers.resize.size).toBe(0);
  });
});
