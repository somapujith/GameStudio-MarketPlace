import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeConfig, normalizeApiOrigin } from './config.js';

// The exact code the app used before the cross-origin mode existed: same-origin mode must match it byte for byte.
const legacyWsUrl = (path, loc) => {
  const p = String(path).startsWith('/') ? String(path) : `/${path}`;
  if (!loc || !loc.host) return `ws://localhost:8787${p}`;
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${p}`;
};

const WORKER = 'https://gamestudio-marketplace.somapujith.workers.dev';
const PAGE = { protocol: 'https:', host: 'gamestudio-lac.vercel.app', origin: 'https://gamestudio-lac.vercel.app' };

describe('normalizeApiOrigin', () => {
  it('keeps only a clean http(s) origin', () => {
    const warn = vi.fn();
    expect(normalizeApiOrigin(WORKER, warn)).toBe(WORKER);
    expect(normalizeApiOrigin(`${WORKER}/`, warn)).toBe(WORKER);
    expect(normalizeApiOrigin(`  ${WORKER}/api/x?y=1  `, warn)).toBe(WORKER);
    expect(normalizeApiOrigin('http://127.0.0.1:8787', warn)).toBe('http://127.0.0.1:8787');
    expect(warn).not.toHaveBeenCalled();
  });
  it('treats unset, empty and blank as same-origin mode, silently', () => {
    const warn = vi.fn();
    for (const v of [undefined, null, '', '   ', 5]) expect(normalizeApiOrigin(v, warn)).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });
  it('ignores (and warns about) values that are not http(s) origins', () => {
    const warn = vi.fn();
    expect(normalizeApiOrigin('worker.example.com', warn)).toBe('');
    expect(normalizeApiOrigin('ftp://x.example', warn)).toBe('');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('same-origin mode (VITE_API_ORIGIN unset)', () => {
  const cfg = makeConfig(undefined);
  it('is not cross-origin, whatever the page', () => {
    expect(cfg.API_ORIGIN).toBe('');
    expect(cfg.isCrossOrigin(PAGE)).toBe(false);
    expect(cfg.isCrossOrigin(undefined)).toBe(false);
    expect(cfg.isCrossOrigin(null)).toBe(false);
  });
  it('apiUrl returns the path untouched', () => {
    for (const p of ['/api/me', '/api/rooms/ABC234', '/api/leaderboard?game=overall&x=%20', '/api/push/key']) {
      expect(cfg.apiUrl(p)).toBe(p);
      expect(cfg.apiUrl(p, PAGE)).toBe(p);
    }
  });
  it('wsUrl is identical to the previous implementation', () => {
    const locs = [
      { protocol: 'https:', host: 'game.example.com' },
      { protocol: 'http:', host: 'localhost:5173' },
      { protocol: 'http:', host: '192.168.1.20:5173' },
      null,
      undefined,
      {},
    ];
    for (const loc of locs) {
      for (const p of ['/ws/user', 'ws/user', '/ws/room/ABC234']) expect(cfg.wsUrl(p, loc)).toBe(legacyWsUrl(p, loc));
    }
  });
});

describe('cross-origin mode (VITE_API_ORIGIN set)', () => {
  const cfg = makeConfig(WORKER);
  it('is cross-origin from another origin, and from a location-less runtime', () => {
    expect(cfg.API_ORIGIN).toBe(WORKER);
    expect(cfg.isCrossOrigin(PAGE)).toBe(true);
    expect(cfg.isCrossOrigin({ protocol: 'https:', host: 'gamestudio-lac.vercel.app' })).toBe(true);
    expect(cfg.isCrossOrigin(null)).toBe(true);
  });
  it('apiUrl is absolute on the API origin', () => {
    expect(cfg.apiUrl('/api/me', PAGE)).toBe(`${WORKER}/api/me`);
    expect(cfg.apiUrl('/api/leaderboard?game=overall', PAGE)).toBe(`${WORKER}/api/leaderboard?game=overall`);
    expect(cfg.apiUrl('api/me', PAGE)).toBe(`${WORKER}/api/me`);
  });
  it('wsUrl maps https->wss and http->ws from the API origin, never from the page', () => {
    expect(cfg.wsUrl('/ws/user', PAGE)).toBe('wss://gamestudio-marketplace.somapujith.workers.dev/ws/user');
    expect(cfg.wsUrl('/ws/room/ABC234', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'wss://gamestudio-marketplace.somapujith.workers.dev/ws/room/ABC234',
    );
    const local = makeConfig('http://127.0.0.1:8787');
    expect(local.wsUrl('/ws/user', PAGE)).toBe('ws://127.0.0.1:8787/ws/user');
    expect(local.wsUrl('ws/user', null)).toBe('ws://127.0.0.1:8787/ws/user');
  });
  it('a build whose API origin IS the page origin (the Worker serving its own bundle) stays same-origin', () => {
    const own = { protocol: 'https:', host: 'gamestudio-marketplace.somapujith.workers.dev', origin: WORKER };
    expect(cfg.isCrossOrigin(own)).toBe(false);
    expect(cfg.apiUrl('/api/me', own)).toBe('/api/me');
    expect(cfg.wsUrl('/ws/user', own)).toBe(legacyWsUrl('/ws/user', own));
    // ... also when only protocol + host are known
    expect(cfg.isCrossOrigin({ protocol: 'https:', host: 'gamestudio-marketplace.somapujith.workers.dev' })).toBe(false);
  });
});

describe('the module-level instance reads VITE_API_ORIGIN at build time', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('unset: relative URLs', async () => {
    vi.stubEnv('VITE_API_ORIGIN', '');
    vi.resetModules();
    const c = await import('./config.js');
    expect(c.API_ORIGIN).toBe('');
    expect(c.isCrossOrigin()).toBe(false);
    expect(c.apiUrl('/api/me')).toBe('/api/me');
  });
  it('set: absolute URLs', async () => {
    vi.stubEnv('VITE_API_ORIGIN', `${WORKER}/`);
    vi.resetModules();
    const c = await import('./config.js');
    expect(c.API_ORIGIN).toBe(WORKER);
    expect(c.isCrossOrigin()).toBe(true);
    expect(c.apiUrl('/api/me')).toBe(`${WORKER}/api/me`);
    expect(c.wsUrl('/ws/user')).toBe('wss://gamestudio-marketplace.somapujith.workers.dev/ws/user');
  });
});
