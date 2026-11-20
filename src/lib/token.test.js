import { describe, it, expect, vi, afterEach } from 'vitest';
import { getToken, setToken, clearToken, TOKEN_KEY } from './token.js';

const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    _m: m,
  };
};

afterEach(() => {
  clearToken();
  vi.unstubAllGlobals();
});

describe('token storage', () => {
  it('uses the hyd_token key in localStorage', () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    expect(TOKEN_KEY).toBe('hyd_token');
    expect(getToken()).toBeNull();
    setToken('a.b.c');
    expect(ls._m.get('hyd_token')).toBe('a.b.c');
    expect(getToken()).toBe('a.b.c');
    clearToken();
    expect(ls._m.has('hyd_token')).toBe(false);
    expect(getToken()).toBeNull();
  });

  it('follows storage as the source of truth (another tab signed out)', () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    setToken('a.b.c');
    ls.removeItem('hyd_token');
    expect(getToken()).toBeNull();
  });

  it('falls back to memory when there is no storage at all', () => {
    // node: no localStorage global
    expect(getToken()).toBeNull();
    setToken('mem.tok.en');
    expect(getToken()).toBe('mem.tok.en');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('falls back to memory when storage throws on every access (blocked site data)', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => setToken('x.y.z')).not.toThrow();
    expect(getToken()).toBe('x.y.z');
    expect(() => clearToken()).not.toThrow();
    expect(getToken()).toBeNull();
  });

  it('keeps the token in memory when only writing fails (quota)', () => {
    const ls = fakeStorage();
    ls.setItem = () => {
      throw new Error('QuotaExceeded');
    };
    vi.stubGlobal('localStorage', ls);
    setToken('q.u.o');
    expect(getToken()).toBe('q.u.o');
  });

  it('survives a throwing localStorage getter', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(getToken()).toBeNull();
      setToken('g.e.t');
      expect(getToken()).toBe('g.e.t');
    } finally {
      delete globalThis.localStorage;
    }
  });

  it('setToken with an empty value clears', () => {
    setToken('a.b.c');
    setToken('');
    expect(getToken()).toBeNull();
  });
});
